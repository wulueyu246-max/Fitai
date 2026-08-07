const assert = require("node:assert/strict");
const test = require("node:test");

const {
  ProductAestheticReranker,
  applyDiversityScores,
  brandQualityAssessment,
  buildMessages,
  catalogAestheticAssessment,
  validateSelection,
} = require("../product_aesthetic_reranker");

function product(id, category = "top", relevance = 80) {
  return {
    product_id: id,
    source: "taobao",
    platform: "taobao",
    is_mock: false,
    category,
    brand: `brand-${id.split("-")[0]}`,
    title: `${category} product ${id}`,
    price: 100,
    image_url: `https://img.example.com/${id}.jpg`,
    purchase_url: `https://s.click.taobao.com/${id}`,
    relevance_score: relevance,
  };
}

function group(category, ids) {
  return {
    requirement: {
      category,
      gender: "male",
      item_name: `${category} item`,
      search_keywords: [`male ${category} item`],
    },
    candidates: ids.map((id, index) => product(id, category, 90 - index)),
  };
}

function response(selectedProducts) {
  return {
    choices: [{
      message: {
        content: JSON.stringify({selected_products: selectedProducts}),
      },
    }],
  };
}

function selection(productId, overrides = {}) {
  return {
    product_id: productId,
    ai_taste_score: 94,
    fit_score: 91,
    outfit_coherence_score: 95,
    value_score: 86,
    reason: "Clean shape and coherent color.",
    concern: "Check fabric details before purchase.",
    ...overrides,
  };
}

test("validates candidate IDs and applies the weighted final score", () => {
  const groups = [group("top", ["top-1", "top-2"]), group("shoes", ["shoe-1"])];
  const products = validateSelection({
    selected_products: [selection("invented"), selection("shoe-1"), selection("top-1")],
  }, groups, 6);

  assert.deepEqual(products.map((item) => item.product_id), ["top-1", "shoe-1"]);
  assert.equal(products[0].final_score, 77.6);
  assert.equal(products[0].aesthetic_score, 84.7);
  assert.equal(products[0].brand_quality_score, 45);
  assert.equal(products[0].diversity_score, 100);
  assert.equal(products[0].ai_label, "AI首选");
  assert.equal(products[0].ai_rerank_fallback, false);
  assert.equal(products.some((item) => item.product_id === "invented"), false);
});

test("three identical male Clean Fit generations use different primary combinations", async () => {
  let calls = 0;
  const reranker = new ProductAestheticReranker({
    client: {
      chat: {completions: {create: async (request) => {
        calls += 1;
        assert.deepEqual(request.response_format, {type: "json_object"});
        assert.equal(request.enable_thinking, false);
        const prompt = JSON.parse(request.messages[1].content);
        assert.equal(prompt.product_groups.length, 2);
        return response([
          selection("top-1"), selection("top-2"), selection("top-3"), selection("top-4"),
          selection("shoe-1"), selection("shoe-2"), selection("shoe-3"), selection("shoe-4"),
        ]);
      }}},
    },
    model: "test-model",
    logger: {info() {}, warn() {}},
  });
  const input = {
    groups: [
      group("top", ["top-1", "top-2", "top-3", "top-4"]),
      group("shoes", ["shoe-1", "shoe-2", "shoe-3", "shoe-4"]),
    ],
    context: {gender: "male", style: "Clean Fit", scene: "date"},
    requestId: "request-1",
  };

  const first = await reranker.rerank(input);
  const second = await reranker.rerank({...input, requestId: "request-2"});
  const third = await reranker.rerank({...input, requestId: "request-3"});

  assert.equal(calls, 1);
  const primaryCombination = (products) => ["top", "shoes"]
    .map((category) => products.find((item) => item.category === category).product_id)
    .join(":");
  assert.equal(new Set([
    primaryCombination(first),
    primaryCombination(second),
    primaryCombination(third),
  ]).size, 3);
  assert.equal(reranker.getStats().call_count, 1);
  assert.equal(reranker.getStats().cache_hits, 2);
});

test("penalizes duplicate IDs, images, brands, and highly similar titles across Looks", () => {
  const firstGroup = group("top", ["shared", "minimal"]);
  firstGroup.requirement.look_id = "look-1";
  firstGroup.candidates.forEach((item) => { item.look_id = "look-1"; });
  firstGroup.candidates[0].title = "男士白色短袖Polo衫";
  firstGroup.candidates[0].brand = "Same Brand";
  const secondGroup = group("top", ["shared", "korean"]);
  secondGroup.requirement.look_id = "look-2";
  secondGroup.candidates.forEach((item) => { item.look_id = "look-2"; });
  secondGroup.candidates[0].title = "男士白色短袖Polo衫";
  secondGroup.candidates[0].brand = "Same Brand";
  secondGroup.candidates[0].image_url = firstGroup.candidates[0].image_url;
  secondGroup.candidates[1].title = "男士蓝色宽松牛津纺衬衫";
  secondGroup.candidates[1].brand = "Different Brand";
  const selected = [...firstGroup.candidates, ...secondGroup.candidates].map((item) => ({
    ...item,
    ai_taste_score: 90,
  }));

  const result = applyDiversityScores(selected, [firstGroup, secondGroup], {
    selectionLimit: 2,
  }).products;
  const secondLook = result.filter((item) => item.look_id === "look-2");

  assert.equal(secondLook[0].product_id, "korean");
  assert.ok(secondLook[0].diversity_score > secondLook[1].diversity_score);
  assert.ok(secondLook.every((item) => item.aesthetic_score === 90));
});

test("catalog aesthetic prior lowers cheap keyword-stuffed products", () => {
  const requirement = {category: "top", style: "Clean Fit", material: "纯棉"};
  const refined = catalogAestheticAssessment({
    title: "男士纯棉立体剪裁短袖Polo",
    brand: "Quality Brand",
    shop_name: "品牌官方旗舰店",
    image_url: "https://img.alicdn.com/refined.jpg",
    material: "精梳纯棉",
    price: 199,
  }, requirement);
  const cheap = catalogAestheticAssessment({
    title: "爆款网红清仓特价男士短袖短袖短袖买一送一厂家直销全网最低",
    image_url: "http://example.com/default-image.jpg",
    price: 9.9,
  }, requirement);

  assert.ok(refined.catalog_aesthetic_score >= 85);
  assert.ok(cheap.catalog_aesthetic_score <= 20);
  assert.ok(cheap.aesthetic_quality_flags.includes("low_end_marketing"));
  assert.ok(cheap.aesthetic_quality_flags.includes("suspiciously_low_price"));
});

test("brand quality tiers score premium and established brands above unbranded goods", () => {
  assert.deepEqual(
    brandQualityAssessment({brand: "COS", title: "男士纯棉白T"}),
    {brand_quality_score: 100, brand_tier: "S", brand_name: "cos"},
  );
  assert.deepEqual(
    brandQualityAssessment({brand: "Uniqlo", title: "男士纯棉白T"}),
    {brand_quality_score: 85, brand_tier: "A", brand_name: "uniqlo"},
  );
  assert.equal(brandQualityAssessment({
    brand: "山谷设计",
    shop_name: "山谷设计原创品牌旗舰店",
    title: "男士纯棉白T",
  }).brand_tier, "B");
  assert.equal(brandQualityAssessment({title: "男士普通淘宝白T"}).brand_quality_score, 25);
  assert.ok(brandQualityAssessment({
    brand: "COS",
    title: "明星同款男士白T",
  }).brand_quality_score <= 35);
});

test("COS and Uniqlo products rank before an ordinary Taobao white tee", async () => {
  const ordinary = product("ordinary", "top", 92);
  ordinary.brand = "";
  ordinary.shop_name = "普通服装店";
  ordinary.title = "男士纯棉白色短袖T恤";
  const uniqlo = product("uniqlo", "top", 86);
  uniqlo.brand = "Uniqlo";
  uniqlo.title = "Uniqlo 男士纯棉白色短袖T恤";
  const cos = product("cos", "top", 84);
  cos.brand = "COS";
  cos.title = "COS 男士精梳棉白色短袖T恤";
  const reranker = new ProductAestheticReranker({
    logger: {info() {}, warn() {}},
  });

  const products = await reranker.rerank({
    groups: [{
      requirement: {category: "top", gender: "male", material: "纯棉"},
      candidates: [ordinary, uniqlo, cos],
    }],
  });

  assert.deepEqual(products.slice(0, 2).map((item) => item.brand), ["COS", "Uniqlo"]);
  assert.ok(products[0].brand_quality_score > products[2].brand_quality_score);
});

test("ordinary brands are allowed with an explicit brand fallback marker", async () => {
  const logs = [];
  const candidates = ["one", "two", "three", "four"].map((id) => {
    const item = product(id, "top", 80);
    item.brand = "";
    item.shop_name = "普通服装店";
    item.title = `男士纯棉短袖T恤 ${id}`;
    return item;
  });
  const reranker = new ProductAestheticReranker({
    logger: {info() {}, warn: (...args) => logs.push(args)},
  });

  const products = await reranker.rerank({
    groups: [{requirement: {category: "top", gender: "male"}, candidates}],
  });

  assert.equal(products.length, 4);
  assert.ok(products.every((item) => item.brand_fallback === true));
  assert.equal(logs[0][1].brand_fallback, true);
});

test("model failure falls back to relevance ordering without throwing", async () => {
  const warnings = [];
  const reranker = new ProductAestheticReranker({
    client: {
      chat: {completions: {create: async () => {
        throw Object.assign(new Error("upstream unavailable"), {code: "ETIMEDOUT"});
      }}},
    },
    model: "test-model",
    logger: {info() {}, warn: (...args) => warnings.push(args)},
  });

  const products = await reranker.rerank({
    groups: [group("top", ["top-1", "top-2"])],
    context: {gender: "male"},
  });

  assert.deepEqual(products.map((item) => item.product_id), ["top-1", "top-2"]);
  assert.ok(products.every((item) => item.ai_rerank_fallback === true));
  assert.equal(reranker.getStats().fallback_count, 1);
  assert.equal(warnings[0][1].errorCode, "ETIMEDOUT");
});

test("invalid score or unknown product never enters the selected result", () => {
  const products = validateSelection({
    selected_products: [
      selection("top-1", {ai_taste_score: 101}),
      selection("unknown"),
      selection("top-2"),
    ],
  }, [group("top", ["top-1", "top-2"])], 6);

  assert.deepEqual(products.map((item) => item.product_id), ["top-2"]);
});

test("model prompt excludes affiliate credentials and unrelated context", () => {
  const messages = buildMessages([group("top", ["top-1"])], {
    gender: "male",
    scene: "date",
    appSecret: "never-send-this-secret",
    pid: "never-send-this-pid",
    sign: "never-send-this-signature",
  });
  const serialized = JSON.stringify(messages);

  assert.equal(serialized.includes("never-send-this-secret"), false);
  assert.equal(serialized.includes("never-send-this-pid"), false);
  assert.equal(serialized.includes("never-send-this-signature"), false);
});

test("budget is a soft AI signal and over-budget selections explain the tradeoff", () => {
  const budgetGroup = group("top", ["top-1"]);
  budgetGroup.candidates[0].budget_preference_score = 80;
  budgetGroup.candidates[0].budget_note =
    "价格略高于单品预算（约 ¥200），但可因品质或搭配效果考虑。";
  const messages = buildMessages([budgetGroup], {
    user_requirements: {
      item_budget: "50-200",
      outfit_budget: "300-800",
    },
  });
  const prompt = JSON.parse(messages[1].content);
  assert.equal(prompt.user_requirements.item_budget, "50-200");
  assert.equal(prompt.user_requirements.outfit_budget, "300-800");
  assert.equal(prompt.product_groups[0].candidates[0].budget_preference_score, 80);
  assert.match(messages[0].content, /soft preferences/);

  const products = validateSelection({
    selected_products: [selection("top-1")],
  }, [budgetGroup], 6);
  assert.equal(products.length, 1);
  assert.match(products[0].recommendation_reason, /略高于单品预算/);
});

test("AI reranker excludes low-value products and records safe block diagnostics", async () => {
  const warnings = [];
  const safe = product("top-safe", "top", 85);
  safe.title = "男士短袖Polo";
  const blocked = product("top-underwear", "top", 99);
  blocked.title = "Tom Ford 男士内裤";
  const reranker = new ProductAestheticReranker({
    client: {
      chat: {completions: {create: async (request) => {
        const payload = JSON.parse(request.messages[1].content);
        assert.deepEqual(
          payload.product_groups[0].candidates.map((item) => item.product_id),
          ["top-safe"],
        );
        return response([selection("top-safe")]);
      }}},
    },
    model: "test-model",
    logger: {info() {}, warn: (...args) => warnings.push(args)},
  });

  const products = await reranker.rerank({
    groups: [{
      requirement: {
        category: "top",
        gender: "male",
        item_name: "男士Polo",
        search_keywords: ["男士 Polo"],
      },
      candidates: [blocked, safe],
    }],
    context: {gender: "male"},
  });

  assert.deepEqual(products.map((item) => item.product_id), ["top-safe"]);
  assert.equal(warnings[0][1].blocked_category[0], "underwear");
  assert.equal(warnings[0][1].blocked_keyword[0], "内裤");
});

test("model prompt requires four to six selections for every sufficiently large group", () => {
  const messages = buildMessages([
    group("top", ["top-1", "top-2", "top-3", "top-4", "top-5"]),
    group("shoes", ["shoe-1", "shoe-2"]),
  ], {gender: "male"});
  const payload = JSON.parse(messages[1].content);

  assert.equal(payload.product_groups[0].required_minimum, 4);
  assert.equal(payload.product_groups[0].maximum, 5);
  assert.equal(payload.product_groups[1].required_minimum, 2);
  assert.equal(payload.product_groups[1].maximum, 2);
  assert.match(messages[0].content, /而不是整套合计选择 4 至 6 件/);
});

test("under-selected groups receive one focused repair call", async () => {
  let calls = 0;
  const reranker = new ProductAestheticReranker({
    client: {
      chat: {completions: {create: async (request) => {
        calls += 1;
        const payload = JSON.parse(request.messages[1].content);
        if (calls === 1) return response([selection("top-1")]);
        assert.equal(payload.product_groups.length, 1);
        return response([
          selection("top-1"),
          selection("top-2"),
          selection("top-3"),
          selection("top-4"),
        ]);
      }}},
    },
    model: "test-model",
    logger: {info() {}, warn() {}},
  });

  const products = await reranker.rerank({
    groups: [group("top", ["top-1", "top-2", "top-3", "top-4", "top-5"])],
    context: {gender: "male"},
  });

  assert.equal(calls, 2);
  assert.equal(products.length, 4);
  assert.ok(products.every((product) => product.ai_rerank_fallback === false));
  assert.equal(reranker.getStats().call_count, 2);
  assert.equal(reranker.getStats().fallback_count, 0);
});

test("multiple incomplete groups are repaired independently", async () => {
  const repairedCategories = [];
  const reranker = new ProductAestheticReranker({
    client: {
      chat: {completions: {create: async (request) => {
        const payload = JSON.parse(request.messages[1].content);
        if (payload.product_groups.length > 1) {
          return response([selection("top-1"), selection("shoe-1")]);
        }
        const candidates = payload.product_groups[0].candidates;
        const category = candidates[0].product_id.startsWith("top") ? "top" : "shoes";
        repairedCategories.push(category);
        return response(candidates.slice(0, 4).map((item) => selection(item.product_id)));
      }}},
    },
    model: "test-model",
    logger: {info() {}, warn() {}},
  });

  const products = await reranker.rerank({
    groups: [
      group("top", ["top-1", "top-2", "top-3", "top-4", "top-5"]),
      group("shoes", ["shoe-1", "shoe-2", "shoe-3", "shoe-4", "shoe-5"]),
    ],
    context: {gender: "female"},
  });

  assert.deepEqual(repairedCategories.sort(), ["shoes", "top"]);
  assert.equal(products.length, 8);
  assert.ok(products.every((product) => product.ai_rerank_fallback === false));
  assert.equal(reranker.getStats().call_count, 3);
});
