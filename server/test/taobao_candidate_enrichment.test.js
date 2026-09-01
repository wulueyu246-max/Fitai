const assert = require("node:assert/strict");
const test = require("node:test");

const {
  attachEnrichmentToCandidate,
  buildRawAvailabilityMatrix,
  buildRawTaobaoProduct,
  createSanitizedRawFixture,
  enrichTaobaoCandidate,
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

test("Taobao image provenance survives raw capture and enrichment attachment", () => {
  const raw = buildRawTaobaoProduct(realShape(), {
    query: "女装上衣",
    observedAt: "2026-08-28T01:02:03.000Z",
  });
  const enriched = enrichTaobaoCandidate(raw);
  const attached = attachEnrichmentToCandidate({
    product_id: "123",
    source: "taobao",
  }, raw, enriched);

  assert.equal(attached.white_image, "https://img.example.com/white.jpg");
  assert.equal(attached.pict_url, "https://img.example.com/item.jpg");
  assert.equal(attached.image_url, "https://img.example.com/white.jpg");
  assert.deepEqual(attached.image_provenance.evidence,
    ["raw_product.media.white_image"]);
  assert.equal(attached.image_provenance.status, "AVAILABLE");
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

test("Optional product taxonomy is evidence-backed and distinguishes hosiery from socks", () => {
  const cases = [
    {
      title: "女士轻薄黑色连裤袜",
      categoryName: "女士袜品",
      expectedCategory: "accessory",
      expectedSubcategory: "hosiery",
      evidence: /连裤袜/u,
    },
    {
      title: "女士白色中筒袜",
      categoryName: "女士袜品",
      expectedCategory: "accessory",
      expectedSubcategory: "socks",
      evidence: /中筒袜/u,
    },
    {
      title: "女士设计感单肩包",
      categoryName: "箱包",
      expectedCategory: "bag",
      expectedSubcategory: "shoulder_bag",
      evidence: /单肩包|箱包/u,
    },
    {
      title: "女士羊毛贝雷帽",
      categoryName: "帽类",
      expectedCategory: "hat",
      expectedSubcategory: "beret",
      evidence: /贝雷帽|帽类/u,
    },
    {
      title: "女士淡水珍珠项链",
      categoryName: "珠宝首饰",
      expectedCategory: "accessory",
      expectedSubcategory: "jewelry",
      evidence: /项链|珠宝/u,
    },
  ];

  for (const [index, fixture] of cases.entries()) {
    const raw = buildRawTaobaoProduct(realShape({
      item_basic_info: {
        item_id: `optional-${index}`,
        title: fixture.title,
        category_name: fixture.categoryName,
        level_one_category_name: fixture.categoryName,
      },
    }), {query: "与商品事实无关的请求词"});
    const enriched = enrichTaobaoCandidate(raw);

    assert.equal(enriched.normalized_category.value, fixture.expectedCategory);
    assert.equal(enriched.category_evidence, enriched.normalized_category);
    assert.equal(enriched.subcategory.value, fixture.expectedSubcategory);
    assert.match(enriched.normalized_category.source, /product_fact|title|api_category/u);
    assert.ok(enriched.normalized_category.confidence >= 0.9);
    assert.ok(enriched.subcategory.confidence >= 0.9);
    assert.match(enriched.subcategory.evidence.join(" "), fixture.evidence);
    assert.doesNotMatch(
      enriched.subcategory.evidence.join(" "),
      /与商品事实无关的请求词/u,
    );
  }
});

test("Optional taxonomy can use vision product facts without treating request text as evidence", () => {
  const raw = buildRawTaobaoProduct(realShape({
    item_basic_info: {
      item_id: "vision-bag",
      title: null,
      category_name: null,
      level_one_category_name: null,
    },
  }), {query: "连裤袜"});
  const enriched = enrichTaobaoCandidate(raw, {
    visionObservation: {
      visible_category: {
        value: "bag",
        confidence: 0.88,
        evidence: ["visible shoulder bag"],
      },
    },
  });

  assert.equal(enriched.normalized_category.value, "bag");
  assert.equal(enriched.subcategory.value, "bag");
  assert.equal(enriched.normalized_category.source, "vision");
  assert.equal(enriched.normalized_category.confidence, 0.88);
  assert.ok(enriched.subcategory.evidence.some((value) => /visible shoulder bag/u.test(value)));
  assert.equal(enriched.subcategory.evidence.some((value) => /连裤袜/u.test(value)), false);
});

test("Contract F: request slot and query never overwrite observed Optional product facts", () => {
  const ordinarySocks = buildRawTaobaoProduct(realShape({
    item_basic_info: {
      item_id: "optional-socks",
      title: "女士白色中筒袜",
      category_name: "女士袜品",
      level_one_category_name: "袜品",
    },
  }), {query: "女士连裤袜"});
  const ordinarySocksEnriched = enrichTaobaoCandidate(ordinarySocks, {
    requestSlot: "hosiery",
    requirement: {category: "accessory", subcategory: "hosiery"},
  });
  assert.equal(ordinarySocksEnriched.normalized_category.value, "accessory");
  assert.equal(ordinarySocksEnriched.subcategory.value, "socks");
  assert.ok(ordinarySocksEnriched.subcategory.evidence.some((value) => /中筒袜/u.test(value)));
  assert.equal(ordinarySocksEnriched.subcategory.evidence.some((value) => /连裤袜/u.test(value)), false);

  const raw = buildRawTaobaoProduct(realShape({
    item_basic_info: {
      item_id: "optional-jewelry",
      title: "女士淡水珍珠项链",
      category_name: "珠宝首饰",
      level_one_category_name: "配饰",
    },
  }), {query: "女 连裤袜 设计感"});

  const enriched = enrichTaobaoCandidate(raw, {
    requestSlot: "hosiery",
    requirement: {
      category: "accessory",
      subcategory: "hosiery",
      styling_completion_slot: "hosiery",
    },
  });

  assert.equal(enriched.normalized_category.value, "accessory");
  assert.equal(enriched.subcategory.value, "jewelry");
  assert.ok(enriched.subcategory.evidence.some((value) => /项链|珠宝/u.test(value)));
  assert.equal(enriched.subcategory.evidence.some((value) => /连裤袜/u.test(value)), false);
  assert.equal(enriched.subcategory.source, "mixed_product_fact_evidence");
});
