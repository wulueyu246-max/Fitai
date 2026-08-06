const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {gzipSync} = require("node:zlib");

const {
  TaobaoApiClient,
  safeTransportDetails,
  signTaobaoRequest,
} = require("../taobao_client");

test("Taobao client signs official parameters and logs only safe request diagnostics", async () => {
  let requestBody = "";
  const logs = [];
  const client = new TaobaoApiClient({
    appKey: "public-test-key",
    appSecret: "private-test-secret",
    fetchImpl: async (_url, options) => {
      requestBody = options.body;
      return new Response(JSON.stringify({ok_response: {}}), {status: 200});
    },
    logger: {info: (...args) => logs.push(args), warn: (...args) => logs.push(args)},
  });
  await client.call("taobao.test.method", {
    q: "上衣",
    adzone_id: "300",
  }, {
    requestId: "request-1",
    provider: "taobao",
    siteId: "200",
  });
  const body = Object.fromEntries(new URLSearchParams(requestBody));
  const {sign, ...unsigned} = body;
  assert.equal(sign, signTaobaoRequest(unsigned, "private-test-secret"));
  assert.equal(requestBody.includes("private-test-secret"), false);
  const logged = JSON.stringify(logs);
  assert.equal(logged.includes("private-test-secret"), false);
  assert.equal(logged.includes(sign), false);
  assert.equal(logged.includes("public-test-key"), true);
  assert.equal(logged.includes('"site_id":"200"'), true);
  assert.equal(logged.includes('"adzone_id":"300"'), true);
  assert.equal(logged.includes('"provider":"taobao"'), true);
});

test("Taobao client maps permission errors to a safe code without leaking response text", async () => {
  const client = new TaobaoApiClient({
    appKey: "key",
    appSecret: "secret",
    maxRetries: 1,
    fetchImpl: async () => new Response(JSON.stringify({
      error_response: {code: 27, sub_code: "isv.permission-api-package-limit", sub_msg: "sensitive details"},
    }), {status: 200}),
    logger: {warn() {}},
  });
  await assert.rejects(
    () => client.call("taobao.test.method"),
    (error) => error.code === "TAOBAO_PERMISSION_DENIED" && !error.message.includes("sensitive"),
  );
});

test("Taobao client logs complete safe TOP error fields without credentials", async () => {
  const logs = [];
  const client = new TaobaoApiClient({
    appKey: "public-test-key",
    appSecret: "private-test-secret",
    fetchImpl: async () => new Response(JSON.stringify({
      error_response: {
        code: 29,
        sub_code: "isv.invalid-app-key",
        msg: "Invalid app key public-test-key",
        sub_msg: "Denied private-test-secret mm_1_2_3",
        request_id: "top-request-123",
      },
    }), {status: 200}),
    logger: {warn: (...args) => logs.push(args)},
  });

  await assert.rejects(() => client.call("taobao.test.method"));
  const details = logs[0][1];
  assert.equal(details.taobao_error_code, "29");
  assert.equal(details.taobao_sub_code, "isv.invalid-app-key");
  assert.equal(details.taobao_request_id, "top-request-123");
  assert.match(details.taobao_msg, /Invalid app key/);
  assert.match(details.taobao_sub_msg, /Denied/);
  assert.equal(JSON.stringify(details).includes("public-test-key"), true);
  assert.equal(JSON.stringify(details).includes("private-test-secret"), false);
  assert.equal(JSON.stringify(details).includes("mm_1_2_3"), false);
});

test("Taobao client decodes a gzip response even when content-encoding is missing", async () => {
  const payload = {ok_response: {items: [{item_id: "1"}]}};
  const client = new TaobaoApiClient({
    appKey: "key",
    appSecret: "secret",
    fetchImpl: async () => new Response(gzipSync(JSON.stringify(payload)), {
      status: 200,
      headers: {"content-type": "application/json"},
    }),
    logger: {info() {}, warn() {}},
  });

  assert.deepEqual(await client.call("taobao.test.method"), payload);
});

test("Flutter source contains no Taobao server credential variables", () => {
  const root = path.resolve(__dirname, "..", "..", "lib");
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      if (entry.isFile() && entry.name.endsWith(".dart")) files.push(target);
    }
  };
  visit(root);
  const source = files.map((file) => fs.readFileSync(file, "utf8")).join("\n");
  assert.equal(source.includes("TAOBAO_APP_SECRET"), false);
  assert.equal(source.includes("TAOBAO_APP_KEY"), false);
});

test("transport diagnostics preserve cause safely without credentials", () => {
  const cause = Object.assign(new Error(
    "connect failed ?app_key=sensitive&sign=signature&token=token-value",
  ), {code: "ECONNRESET"});
  const error = new Error("fetch failed", {cause});
  const details = safeTransportDetails(
    error,
    "https://eco.taobao.com/router/rest",
  );
  assert.equal(details.causeName, "Error");
  assert.equal(details.causeCode, "ECONNRESET");
  assert.equal(details.hostname, "eco.taobao.com");
  assert.equal(JSON.stringify(details).includes("sensitive"), false);
  assert.equal(JSON.stringify(details).includes("signature"), false);
  assert.equal(JSON.stringify(details).includes("token-value"), false);
});
