const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const express = require("express");

const {buildRawTaobaoProduct} = require("../taobao_candidate_enrichment");
const {
  TAOBAO_RAW_PROBE_ARTIFACT_MAX_BYTES,
  TAOBAO_RAW_PROBE_ARTIFACT_PATH,
  TAOBAO_RAW_PROBE_ARTIFACT_TTL_MS,
  TAOBAO_RAW_PROBE_MAX_PRODUCTS,
  TAOBAO_RAW_PROBE_PAGE_SIZE,
  TAOBAO_RAW_PROBE_PATH,
  TAOBAO_RAW_PROBE_QUERIES,
  createTaobaoRawProbeArtifactDownloadHandler,
  createTaobaoRawProbeArtifactStore,
  createTaobaoRawProbeHandler,
  executeTaobaoRawProbe,
} = require("../taobao_raw_probe_endpoint");

const TOKEN = "test-only-independent-probe-token-0123456789abcdef";
const BASE_ENV = Object.freeze({
  RENDER: "true",
  ENABLE_TAOBAO_RAW_PROBE: "true",
  INTERNAL_PROBE_TOKEN: TOKEN,
  TAOBAO_APP_KEY: "test-app-key",
  TAOBAO_APP_SECRET: "test-taobao-secret",
  TAOBAO_PID: "mm_100_200_300",
  TAOBAO_ADZONE_ID: "300",
});

test("probe and artifact scope are fixed and bounded", () => {
  assert.equal(TAOBAO_RAW_PROBE_PATH, "/internal/probes/taobao-raw-v1");
  assert.equal(TAOBAO_RAW_PROBE_ARTIFACT_PATH,
    "/internal/probes/taobao-raw-v1/artifacts/:artifact_id");
  assert.deepEqual(TAOBAO_RAW_PROBE_QUERIES, ["女装上衣", "男装裤子", "女鞋"]);
  assert.equal(TAOBAO_RAW_PROBE_PAGE_SIZE, 10);
  assert.equal(TAOBAO_RAW_PROBE_MAX_PRODUCTS, 30);
  assert.equal(TAOBAO_RAW_PROBE_ARTIFACT_TTL_MS, 15 * 60 * 1000);
  assert.equal(TAOBAO_RAW_PROBE_ARTIFACT_MAX_BYTES, 1024 * 1024);
});

test("disabled probe is hidden before provider or artifact access", async () => {
  let providerCalls = 0;
  const response = recorder();
  await createTaobaoRawProbeHandler({
    environment: {...BASE_ENV, ENABLE_TAOBAO_RAW_PROBE: "false"},
    providerFactory: () => {
      providerCalls += 1;
      throw new Error("provider must not run");
    },
  })(request(TOKEN), response);
  assert.equal(response.statusCode, 404);
  assert.equal(providerCalls, 0);
});

test("wrong token is rejected without provider access", async () => {
  let providerCalls = 0;
  const response = recorder();
  await createTaobaoRawProbeHandler({
    environment: BASE_ENV,
    providerFactory: () => {
      providerCalls += 1;
      throw new Error("provider must not run");
    },
  })(request("wrong-token"), response);
  assert.equal(response.statusCode, 403);
  assert.equal(providerCalls, 0);
});

test("probe captures only three fixed queries and sanitizes the fixture", async () => {
  const calls = [];
  const result = await executeTaobaoRawProbe({
    environment: BASE_ENV,
    providerFactory: fakeProviderFactory({count: 12, calls}),
    now: () => new Date("2026-08-28T12:30:00.000Z"),
    logger: silentLogger(),
  });
  assert.deepEqual(calls,
    TAOBAO_RAW_PROBE_QUERIES.map((keyword) => ({keyword, limit: 10})));
  assert.equal(result.product_count, 30);
  assert.equal(result.fixture.products.length, 30);
  const serialized = JSON.stringify(result.fixture);
  assert.doesNotMatch(serialized,
    /test-taobao-secret|mm_100_200_300|sign=private|token=private|forbidden_secret/);
  assert.ok(result.fixture.products.every((product) =>
    Object.values(product.commerce || {})
      .filter((value) => typeof value === "string" && /^https?:/i.test(value))
      .every((value) => !value.includes("?"))));
});

test("POST returns only artifact metadata and writes a complete artifact", async () => {
  await withArtifactStore(async ({store, root}) => {
    const response = recorder();
    await createTaobaoRawProbeHandler({
      environment: BASE_ENV,
      providerFactory: fakeProviderFactory({count: 1}),
      now: () => new Date("2026-08-28T13:00:00.000Z"),
      logger: silentLogger(),
      artifactStore: store,
    })(request(TOKEN), response);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(Object.keys(response.body).sort(), [
      "artifact_id",
      "artifact_ready",
      "availability_matrix",
      "checksum",
      "probe_status",
      "product_count",
    ]);
    assert.equal("raw_products" in response.body, false);
    assert.equal(response.body.artifact_ready, true);
    assert.match(response.body.artifact_id, /^[a-f0-9]{48}$/);
    assert.match(response.body.checksum, /^sha256:[a-f0-9]{64}$/);
    assert.deepEqual(await fs.readdir(root), [`${response.body.artifact_id}.json`]);
    await removeArtifact(store, response.body.artifact_id);
  });
});

test("unauthorized artifact download returns 403 and preserves the file", async () => {
  await withArtifactStore(async ({store, root}) => {
    const metadata = await store.create(sampleFixture());
    const response = recorder();
    await createTaobaoRawProbeArtifactDownloadHandler({
      environment: BASE_ENV,
      artifactStore: store,
      logger: silentLogger(),
    })(artifactRequest("wrong-token", metadata.artifact_id), response);
    assert.equal(response.statusCode, 403);
    assert.deepEqual(await fs.readdir(root), [`${metadata.artifact_id}.json`]);
    await removeArtifact(store, metadata.artifact_id);
  });
});

test("artifact download is hidden when the flag is disabled", async () => {
  await withArtifactStore(async ({store, root}) => {
    const metadata = await store.create(sampleFixture());
    const response = recorder();
    await createTaobaoRawProbeArtifactDownloadHandler({
      environment: {...BASE_ENV, ENABLE_TAOBAO_RAW_PROBE: "false"},
      artifactStore: store,
      logger: silentLogger(),
    })(artifactRequest(TOKEN, metadata.artifact_id), response);
    assert.equal(response.statusCode, 404);
    assert.deepEqual(await fs.readdir(root), [`${metadata.artifact_id}.json`]);
    await removeArtifact(store, metadata.artifact_id);
  });
});

test("authorized download is complete, checksum-matched, and single-use", async () => {
  await withArtifactStore(async ({store, root}) => {
    const server = await startArtifactServer(store);
    try {
      const baseUrl = serverUrl(server);
      const post = await fetch(`${baseUrl}${TAOBAO_RAW_PROBE_PATH}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "content-type": "application/json",
        },
        body: "{}",
      });
      assert.equal(post.status, 200);
      const summary = await post.json();
      const url = `${baseUrl}${TAOBAO_RAW_PROBE_PATH}/artifacts/${summary.artifact_id}`;
      const download = await fetch(url, {
        headers: {authorization: `Bearer ${TOKEN}`},
      });
      assert.equal(download.status, 200);
      assert.match(download.headers.get("content-disposition") || "", /^attachment;/);
      const body = await download.text();
      const checksum = `sha256:${crypto.createHash("sha256")
        .update(body, "utf8")
        .digest("hex")}`;
      assert.equal(checksum, summary.checksum);
      const fixture = JSON.parse(body);
      assert.equal(fixture.product_count, 3);
      assert.equal(fixture.products.length, 3);

      const repeated = await fetch(url, {
        headers: {authorization: `Bearer ${TOKEN}`},
      });
      assert.equal(repeated.status, 404);
      await waitForDirectoryEmpty(root);
      assert.deepEqual(await fs.readdir(root), []);
    } finally {
      await closeServer(server);
    }
  });
});

test("expired artifact is deleted and unavailable", async () => {
  let currentTime = 1_000;
  await withArtifactStore(async ({root}) => {
    const store = createTaobaoRawProbeArtifactStore({
      rootDirectory: root,
      clock: () => currentTime,
    });
    const metadata = await store.create(sampleFixture());
    currentTime += TAOBAO_RAW_PROBE_ARTIFACT_TTL_MS + 1;
    const response = recorder();
    await createTaobaoRawProbeArtifactDownloadHandler({
      environment: BASE_ENV,
      artifactStore: store,
      logger: silentLogger(),
    })(artifactRequest(TOKEN, metadata.artifact_id), response);
    assert.equal(response.statusCode, 404);
    assert.deepEqual(await fs.readdir(root), []);
  }, {createStore: false});
});

test("oversize fixture fails before writing a partial artifact", async () => {
  await withArtifactStore(async ({root}) => {
    const store = createTaobaoRawProbeArtifactStore({
      rootDirectory: root,
      maxBytes: 32,
    });
    const response = recorder();
    await createTaobaoRawProbeHandler({
      environment: BASE_ENV,
      providerFactory: fakeProviderFactory({count: 1}),
      now: () => new Date("2026-08-28T13:00:00.000Z"),
      logger: silentLogger(),
      artifactStore: store,
    })(request(TOKEN), response);
    assert.equal(response.statusCode, 413);
    assert.equal(response.body.error_code, "PROBE_ARTIFACT_TOO_LARGE");
    assert.deepEqual(await fs.readdir(root), []);
  }, {createStore: false});
});

test("artifact id cannot traverse to an arbitrary path", async () => {
  await withArtifactStore(async ({store}) => {
    const response = recorder();
    await createTaobaoRawProbeArtifactDownloadHandler({
      environment: BASE_ENV,
      artifactStore: store,
      logger: silentLogger(),
    })(artifactRequest(TOKEN, "../../server/.env"), response);
    assert.equal(response.statusCode, 404);
  });
});

test("application registers the protected artifact route before public 404", async () => {
  const names = [
    "RENDER",
    "ENABLE_TAOBAO_RAW_PROBE",
    "INTERNAL_PROBE_TOKEN",
    "TAOBAO_APP_SECRET",
    "TAOBAO_PID",
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  Object.assign(process.env, BASE_ENV);
  const {app} = require("../index");
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    const response = await fetch(
      `${serverUrl(server)}${TAOBAO_RAW_PROBE_PATH}/artifacts/${"a".repeat(48)}`,
      {headers: {authorization: "Bearer wrong-token"}},
    );
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {error: "FORBIDDEN"});
  } finally {
    await closeServer(server);
    for (const name of names) {
      if (previous[name] == null) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

function fakeProviderFactory({count, calls = []}) {
  return ({environment, rawCapture}) => {
    assert.equal(environment.PRODUCT_PROVIDER, "taobao");
    return {
      name: "taobao",
      configured: true,
      async recommend({keyword, limit}) {
        calls.push({keyword, limit});
        const products = Array.from({length: Math.min(count, limit)}, (_, index) =>
          buildRawTaobaoProduct({
            item_basic_info: {
              item_id: `${keyword}-${index}`,
              title: `${keyword} 商品 ${index}`,
              category_name: keyword,
              zk_final_price: "99.00",
              pict_url: `https://img.example.com/${index}.jpg?token=private`,
            },
            publish_info: {
              click_url: `https://s.click.taobao.com/item?pid=${BASE_ENV.TAOBAO_PID}&sign=private`,
            },
          }, {observedAt: "2026-08-28T13:00:00.000Z"}));
        rawCapture({
          query: keyword,
          products: products.map((product) => ({
            ...product,
            forbidden_secret: BASE_ENV.TAOBAO_APP_SECRET,
          })),
          responseSummary: {requestId: `request-${keyword}`},
        });
        return products;
      },
    };
  };
}

async function withArtifactStore(callback, {createStore = true} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fitai-probe-artifact-test-"));
  const store = createStore
    ? createTaobaoRawProbeArtifactStore({rootDirectory: root})
    : undefined;
  try {
    return await callback({root, store});
  } finally {
    await fs.rm(root, {recursive: true, force: true});
  }
}

async function startArtifactServer(store) {
  const app = express();
  app.use(express.json());
  app.post(TAOBAO_RAW_PROBE_PATH, createTaobaoRawProbeHandler({
    environment: BASE_ENV,
    providerFactory: fakeProviderFactory({count: 1}),
    now: () => new Date("2026-08-28T13:00:00.000Z"),
    logger: silentLogger(),
    artifactStore: store,
  }));
  app.get(TAOBAO_RAW_PROBE_ARTIFACT_PATH,
    createTaobaoRawProbeArtifactDownloadHandler({
      environment: BASE_ENV,
      artifactStore: store,
      logger: silentLogger(),
    }));
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function sampleFixture() {
  return {
    schema_version: "raw_taobao_product_probe_v1",
    product_count: 1,
    products: [{identity: {item_id: "sample-item"}, text: {title: "测试商品"}}],
  };
}

function request(token) {
  return {headers: {authorization: `Bearer ${token}`}};
}

function artifactRequest(token, artifactId) {
  return {...request(token), params: {artifact_id: artifactId}};
}

function recorder() {
  return {
    statusCode: null,
    body: null,
    headersSent: false,
    status(value) {
      this.statusCode = value;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
  };
}

function serverUrl(server) {
  return `http://127.0.0.1:${server.address().port}`;
}

async function closeServer(server) {
  await new Promise((resolve, reject) => server.close((error) =>
    error ? reject(error) : resolve()));
}

async function removeArtifact(store, artifactId) {
  const artifact = await store.claim(artifactId);
  if (artifact) await store.removeClaimed(artifact);
}

async function waitForDirectoryEmpty(root) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if ((await fs.readdir(root)).length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function silentLogger() {
  return {info() {}, warn() {}, error() {}};
}
