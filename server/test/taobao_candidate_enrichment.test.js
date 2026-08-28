const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildRawAvailabilityMatrix,
  buildRawTaobaoProduct,
  createSanitizedRawFixture,
} = require("../taobao_candidate_enrichment");
const {TaobaoProductProvider} = require("../product_provider");

function realShape(overrides = {}) {
  return {
    item_basic_info: {
      item_id: "123",
      title: "女装上衣",
      category_name: "女士上装",
      pict_url: "https://img.example.com/item.jpg?token=secret",
      white_image: "//img.example.com/white.jpg?auth=secret",
      item_url: "https://item.example.com/123?secret=value",
      shop_title: "示例店铺",
      seller_nick: "示例卖家",
      brand_name: "示例品牌",
      annual_vol: "1200",
      volume: "300",
      tk_total_sales: "450",
      ...overrides.item_basic_info,
    },
    price_promotion_info: {
      final_promotion_price: "99.50",
      reserve_price: "129",
      coupon_amount: "10",
      ...overrides.price_promotion_info,
    },
    publish_info: {
      income_info: {commission_rate: "12", commission_amount: "3.5"},
      click_url: "https://s.click.example.com/?sign=do-not-keep",
      ...overrides.publish_info,
    },
  };
}

test("RawTaobaoProduct captures business fields before normalization and strips URL queries", () => {
  const raw = buildRawTaobaoProduct(realShape(), {
    query: "女装上衣",
    observedAt: "2026-08-28T01:02:03.000Z",
  });
  assert.equal(raw.identity.item_id, "123");
  assert.equal(raw.text.title, "女装上衣");
  assert.equal(raw.pricing.price, 99.5);
  assert.deepEqual(raw.sales_evidence, {
    annual_vol: 1200,
    volume: 300,
    tk_total_sales: 450,
  });
  assert.equal(raw.media.pict_url, "https://img.example.com/item.jpg");
  assert.equal(raw.commerce.item_url, "https://item.example.com/123");
  assert.equal(raw.promotion.commission_rate, 12);
  assert.equal(Object.isFrozen(raw), true);
});

test("sanitized fixture is allowlisted, checksummed, and never retains secrets or signatures", () => {
  const raw = buildRawTaobaoProduct(realShape(), {query: "女装上衣"});
  const tainted = {
    ...raw,
    app_secret: "secret",
    pid: "mm_1_2_3",
    sign: "signature",
    token: "bearer-token",
    unexpected: {private: true},
  };
  const fixture = createSanitizedRawFixture({
    products: [tainted],
    queries: [{query: "女装上衣", api_success: true, result_count: 1}],
    capturedAt: "2026-08-28T01:02:03.000Z",
  });
  const serialized = JSON.stringify(fixture);
  assert.equal(fixture.checksum.length, 64);
  assert.equal(fixture.product_count, 1);
  assert.doesNotMatch(serialized, /app_secret|mm_1_2_3|signature|bearer-token|unexpected/);
  assert.doesNotMatch(serialized, /\?/);
});

test("availability matrix keeps annual_vol, volume, and tk_total_sales separate", () => {
  const first = buildRawTaobaoProduct(realShape(), {query: "女装上衣"});
  const second = buildRawTaobaoProduct(realShape({
    item_basic_info: {item_id: "456", annual_vol: null, volume: "9", tk_total_sales: null},
  }), {query: "女装上衣"});
  const matrix = buildRawAvailabilityMatrix([first, second]);
  const byField = Object.fromEntries(matrix.map((row) => [row.field, row]));
  assert.equal(byField["sales_evidence.annual_vol"].status, "CONDITIONAL");
  assert.equal(byField["sales_evidence.volume"].status, "AVAILABLE");
  assert.equal(byField["sales_evidence.tk_total_sales"].status, "CONDITIONAL");
});

test("Taobao provider exposes raw capture before public product normalization", async () => {
  const captures = [];
  const provider = new TaobaoProductProvider({
    pid: "mm_100_200_300",
    adzoneId: "300",
    client: {
      async call() {
        return {
          tbk_dg_material_optional_upgrade_response: {
            result_list: {map_data: [realShape()]},
          },
        };
      },
    },
    rawCapture: (capture) => captures.push(capture),
    logger: {info() {}, warn() {}, error() {}},
  });
  await provider.recommend({keyword: "女装上衣", limit: 10});
  assert.equal(captures.length, 1);
  assert.equal(captures[0].query, "女装上衣");
  assert.equal(captures[0].products[0].sales_evidence.annual_vol, 1200);
  assert.equal(captures[0].products[0].category.category_name, "女士上装");
});
