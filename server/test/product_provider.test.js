const assert = require("node:assert/strict");
const test = require("node:test");

const {
  AutoProductProvider,
  MockProductProvider,
  TaobaoProductProvider,
  createProductProvider,
  mapTaobaoProduct,
} = require("../product_provider");
const {
  TAOBAO_MATERIAL_SAMPLE_METHOD,
  TAOBAO_MATERIAL_SEARCH_METHOD,
  TaobaoApiError,
} = require("../taobao_client");
const {TaobaoService} = require("../taobao_service");

function taobaoItem(overrides = {}) {
  return {
    item_basic_info: {
      item_id: "123456",
      title: "通勤外套",
      shop_title: "示例店铺",
      category_name: "外套",
      pict_url: "//img.example.com/coat.jpg",
      ...overrides.item_basic_info,
    },
    price_promotion_info: {
      final_promotion_price: "399",
      ...overrides.price_promotion_info,
    },
    publish_info: {...overrides.publish_info},
  };
}

function response(method, items) {
  const key = method === TAOBAO_MATERIAL_SAMPLE_METHOD
    ? "tbk_dg_material_recommend_response"
    : "tbk_dg_material_optional_upgrade_response";
  return {[key]: {result_list: {map_data: items}}};
}

function providerWithClient(client) {
  return new TaobaoProductProvider({
    pid: "mm_100_200_300",
    adzoneId: "300",
    client,
  });
}

test("uses MockProductProvider when Taobao credentials are absent", async () => {
  const warnings = [];
  const provider = createProductProvider({
    environment: {PRODUCT_PROVIDER: "auto"},
    logger: {warn: (...args) => warnings.push(args)},
  });
  const products = await provider.recommend({category: "外套"});
  assert.ok(provider instanceof MockProductProvider);
  assert.ok(products.length > 0);
  assert.ok(products.every((product) => product.is_mock === true));
  assert.ok(products.every((product) => product.purchase_url === ""));
  assert.equal(warnings[0][1].configured, false);
  assert.deepEqual(warnings[0][1].missingVariables, [
    "TAOBAO_APP_KEY",
    "TAOBAO_APP_SECRET",
    "TAOBAO_PID",
    "TAOBAO_ADZONE_ID",
  ]);
});

test("missing secret is named safely without logging configured values", () => {
  const warnings = [];
  createProductProvider({
    environment: {
      PRODUCT_PROVIDER: "auto",
      TAOBAO_APP_KEY: "sensitive-app-key-value",
      TAOBAO_PID: "mm_1_2_3",
      TAOBAO_ADZONE_ID: "3",
    },
    logger: {info() {}, warn: (...args) => warnings.push(args)},
  });
  assert.deepEqual(warnings[0][1].missingVariables, ["TAOBAO_APP_SECRET"]);
  assert.equal(JSON.stringify(warnings).includes("mm_1_2_3"), false);
  assert.equal(JSON.stringify(warnings).includes("sensitive-app-key-value"), false);
});

test("16516 material search maps only fields actually returned", async () => {
  const calls = [];
  const provider = providerWithClient({
    call: async (method, params) => {
      calls.push({method, params});
      return response(method, [taobaoItem({
        item_basic_info: {annual_vol: "268"},
        price_promotion_info: {reserve_price: "499", coupon_amount: "20"},
        publish_info: {
          click_url: "//s.click.taobao.com/promotion",
          income_info: {commission_rate: "1550"},
        },
      })]);
    },
  });
  const products = await provider.recommend({category: "外套", style: "通勤", limit: 1});
  assert.equal(calls[0].method, TAOBAO_MATERIAL_SEARCH_METHOD);
  assert.equal(calls[0].params.adzone_id, "300");
  assert.equal(products.length, 1);
  assert.equal(products[0].category, "outerwear");
  assert.equal(products[0].purchase_url, "https://s.click.taobao.com/promotion");
  assert.equal(products[0].original_price, 499);
  assert.equal(products[0].coupon_amount, 20);
  assert.equal(products[0].sales, "268");
  assert.equal(products[0].commission_rate, 0.155);
  assert.equal(products[0].is_mock, false);
});

test("empty 16516 result uses 27399 material sample before Mock", async () => {
  const calls = [];
  const provider = providerWithClient({
    call: async (method) => {
      calls.push(method);
      if (method === TAOBAO_MATERIAL_SEARCH_METHOD) return response(method, []);
      return response(method, [taobaoItem()]);
    },
  });
  const products = await provider.recommend({category: "outerwear", limit: 1});
  assert.deepEqual(calls, [TAOBAO_MATERIAL_SEARCH_METHOD, TAOBAO_MATERIAL_SAMPLE_METHOD]);
  assert.equal(products[0].source, "taobao");
  assert.ok(products[0].tags.includes("sample"));
});

test("one Taobao category failure does not block other categories", async () => {
  const provider = providerWithClient({
    call: async (method, params) => {
      if (params.q?.includes("上衣")) throw new TaobaoApiError("denied", {code: "TAOBAO_PERMISSION_DENIED"});
      if (method === TAOBAO_MATERIAL_SAMPLE_METHOD) return response(method, []);
      return response(method, [taobaoItem({
        item_basic_info: {item_id: `item-${params.q}`, category_name: "鞋", title: params.q},
      })]);
    },
  });
  const products = await provider.recommend({limit: 1});
  assert.ok(products.some((product) => product.is_mock === true && product.category === "top"));
  assert.ok(products.some((product) => product.source === "taobao"));
});

test("missing optional Taobao fields neither throw nor fabricate commerce facts", () => {
  const product = mapTaobaoProduct({item_id: "minimal", title: "基础上衣"}, {fallbackCategory: "top"});
  assert.equal(product.purchase_url, "");
  assert.equal(product.detail_url, "");
  assert.equal("original_price" in product, false);
  assert.equal("coupon_amount" in product, false);
  assert.equal("commission_rate" in product, false);
  assert.equal("sales" in product, false);
  assert.equal(product.stock_status, "unknown");
});

test("non-HTTPS URLs never become purchase links", () => {
  const product = mapTaobaoProduct({
    item_id: "unsafe",
    title: "基础上衣",
    click_url: "http://example.com/promotion",
    item_url: "http://example.com/item",
  }, {fallbackCategory: "top"});
  assert.equal(product.purchase_url, "");
  assert.equal(product.detail_url, "");
});

test("auto mode requires PID and Adzone and gates Taobao with health check", async () => {
  const client = {call: async (method) => response(method, [taobaoItem()])};
  const provider = createProductProvider({
    environment: {
      PRODUCT_PROVIDER: "auto",
      TAOBAO_APP_KEY: "app-key",
      TAOBAO_APP_SECRET: "app-secret",
      TAOBAO_PID: "mm_1_2_3",
      TAOBAO_ADZONE_ID: "3",
    },
    client,
    logger: {info() {}, warn() {}},
  });
  assert.ok(provider instanceof AutoProductProvider);
  const products = await provider.recommend({category: "outerwear", limit: 1});
  assert.equal(provider.health, true);
  assert.equal(products[0].source, "taobao");

  const missingAdzone = createProductProvider({
    environment: {
      PRODUCT_PROVIDER: "auto",
      TAOBAO_APP_KEY: "app-key",
      TAOBAO_APP_SECRET: "app-secret",
      TAOBAO_PID: "mm_1_2_3",
    },
    logger: {warn() {}},
  });
  assert.ok(missingAdzone instanceof MockProductProvider);
});

test("permission failure in auto health check safely falls back to Mock", async () => {
  const provider = createProductProvider({
    environment: {
      PRODUCT_PROVIDER: "auto",
      TAOBAO_APP_KEY: "app-key",
      TAOBAO_APP_SECRET: "app-secret",
      TAOBAO_PID: "mm_1_2_3",
      TAOBAO_ADZONE_ID: "3",
    },
    client: {call: async () => { throw new TaobaoApiError("denied", {code: "TAOBAO_PERMISSION_DENIED"}); }},
    logger: {warn() {}},
  });
  const products = await provider.recommend({category: "top"});
  assert.equal(provider.health, false);
  assert.equal(provider.status, "mock");
  assert.ok(products.every((product) => product.is_mock === true));
});

test("auto mode coalesces concurrent health checks", async () => {
  let healthCalls = 0;
  let releaseHealth;
  const healthGate = new Promise((resolve) => { releaseHealth = resolve; });
  const taobao = {
    healthCheck: async () => {
      healthCalls += 1;
      await healthGate;
    },
    recommend: async () => [{product_id: "taobao-1", source: "taobao"}],
  };
  const mock = {recommend: async () => [{product_id: "mock-1", is_mock: true}]};
  const provider = new AutoProductProvider({
    taobao,
    mock,
    logger: {info() {}, warn() {}},
  });

  const first = provider.recommend({category: "top"});
  const second = provider.recommend({category: "shoes"});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(healthCalls, 1);
  releaseHealth();
  const results = await Promise.all([first, second]);
  assert.equal(provider.status, "taobao");
  assert.ok(results.flat().every((product) => product.source === "taobao"));
});

test("mismatched PID and Adzone safely keep Mock active", () => {
  const warnings = [];
  const provider = createProductProvider({
    environment: {
      PRODUCT_PROVIDER: "auto",
      TAOBAO_APP_KEY: "app-key",
      TAOBAO_APP_SECRET: "app-secret",
      TAOBAO_PID: "mm_1_2_300",
      TAOBAO_ADZONE_ID: "999",
    },
    logger: {info() {}, warn: (...args) => warnings.push(args)},
  });
  assert.ok(provider instanceof MockProductProvider);
  assert.equal(warnings[0][1].errorCode, "TAOBAO_PID_ADZONE_MISMATCH");
});

test("TaobaoService keeps provider implementation server-side", async () => {
  const service = new TaobaoService({provider: {recommend: async () => [{product_id: "p1"}]}});
  assert.deepEqual(await service.search({keyword: "外套"}), [{product_id: "p1"}]);
});
