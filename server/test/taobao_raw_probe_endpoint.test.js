const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildRawTaobaoProduct,
} = require("../taobao_candidate_enrichment");
const {
  TAOBAO_RAW_PROBE_QUERIES,
  createTaobaoRawProbeHandler,
  executeTaobaoRawProbe,
  probeAvailability,
} = require("../taobao_raw_probe_endpoint");

const TOKEN = "test-only-high-entropy-token-0123456789abcdef";

function responseRecorder() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

function enabledEnvironment(overrides = {}) {
  return {
    RENDER: "true",
    ENABLE_TAOBAO_RAW_PROBE: "true",
    INTERNAL_PROBE_TOKEN: TOKEN,
    TAOBAO_APP_KEY: "configured-app-key",
    TAOBAO_APP_SECRET: "configured-app-secret",
    TAOBAO_PID: "mm_100_200_300",
    TAOBAO_ADZONE_ID: "300",
    ...overrides,
  };
}

function fakeProviderFactory(record) {
  return ({environment, rawCapture}) => {
    record.environment = environment;
    return {
      name: "taobao",
      configured: true,
      async recommend({keyword, limit}) {
        record.calls.push({keyword, limit});
        rawCapture({
          query: keyword,
          products: [buildRawTaobaoProduct({
            item_basic_info: {
              item_id: `${record.calls.length}`,
              title: `${keyword}真实商品`,
              category_name: "服饰",
              pict_url: `https://img.example.com/${record.calls.length}.jpg?token=removed`,
              item_url: `https://item.example.com/${record.calls.length}?sign=removed`,
              annual_vol: "100",
            },
            price_promotion_info: {final_promotion_price: "88"},
            publish_info: {income_info: {commission_rate: "10"}},
          }, {query: keyword, observedAt: "2026-08-28T01:02:03.000Z"})],
          responseSummary: {requestId: `request-${record.calls.length}`},
        });
        return [];
      },
    };
  };
}

test("probe remains hidden unless flag, Render runtime, and independent token are valid", () => {
  assert.equal(probeAvailability(enabledEnvironment()).enabled, true);
  assert.equal(probeAvailability(enabledEnvironment({ENABLE_TAOBAO_RAW_PROBE: "false"})).enabled, false);
  assert.equal(probeAvailability(enabledEnvironment({RENDER: "false"})).enabled, false);
  assert.equal(probeAvailability(enabledEnvironment({INTERNAL_PROBE_TOKEN: "short"})).enabled, false);
  assert.equal(probeAvailability(enabledEnvironment({
    INTERNAL_PROBE_TOKEN: "configured-app-secret",
  })).enabled, false);
});

test("disabled probe returns 404 before creating a provider", async () => {
  let called = false;
  const handler = createTaobaoRawProbeHandler({
    environment: enabledEnvironment({ENABLE_TAOBAO_RAW_PROBE: "false"}),
    providerFactory: () => {
      called = true;
    },
  });
  const res = responseRecorder();
  await handler({headers: {}}, res);
  assert.equal(res.statusCode, 404);
  assert.equal(called, false);
});

test("enabled probe rejects missing or invalid bearer tokens without calling Taobao", async () => {
  let called = false;
  const handler = createTaobaoRawProbeHandler({
    environment: enabledEnvironment(),
    providerFactory: () => {
      called = true;
    },
  });
  const res = responseRecorder();
  await handler({headers: {authorization: "Bearer wrong-token"}}, res);
  assert.equal(res.statusCode, 403);
  assert.equal(called, false);
});

test("authorized probe performs only three fixed ten-item queries with no Mock fallback", async () => {
  const record = {calls: [], environment: null};
  const result = await executeTaobaoRawProbe({
    environment: enabledEnvironment({PRODUCT_PROVIDER: "mock"}),
    providerFactory: fakeProviderFactory(record),
    now: () => new Date("2026-08-28T01:02:03.000Z"),
  });
  assert.deepEqual(record.calls, TAOBAO_RAW_PROBE_QUERIES.map((keyword) => ({keyword, limit: 10})));
  assert.equal(record.environment.PRODUCT_PROVIDER, "taobao");
  assert.equal(result.probe_status, "SUCCESS");
  assert.equal(result.raw_product_count, 3);
  assert.equal(result.fixture_checksum.length, 64);
  assert.equal(result.fixture_storage.persisted_on_render, false);
  assert.equal(result.query_summary[0].request_id, "request-1");
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /configured-app-secret|mm_100_200_300|removed|INTERNAL_PROBE_TOKEN/);
});

test("authorized handler returns a sanitized success response", async () => {
  const record = {calls: [], environment: null};
  const handler = createTaobaoRawProbeHandler({
    environment: enabledEnvironment(),
    providerFactory: fakeProviderFactory(record),
    now: () => new Date("2026-08-28T01:02:03.000Z"),
    logger: {info() {}, warn() {}, error() {}},
  });
  const res = responseRecorder();
  await handler({headers: {authorization: `Bearer ${TOKEN}`}}, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.probe_status, "SUCCESS");
  assert.equal(res.payload.query_summary.length, 3);
});
