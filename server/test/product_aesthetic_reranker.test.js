const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CALIBRATED_PRODUCT_WEIGHTS,
  ProductAestheticReranker,
  applyDiversityScores,
  brandQualityAssessment,
  buildMessages,
  catalogAestheticAssessment,
  compositeProductScore,
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
  assert.ok(products[0].final_score >= 0 && products[0].final_score <= 100);
  assert.equal(products[0].aesthetic_score, 94);
  assert.equal(products[0].brand_quality_score, 45);
  assert.equal(products[0].diversity_score, 100);
  assert.equal(products[0].ai_label, "AI首选");
  assert.equal(products[0].ai_rerank_fallback, false);
  assert.equal(products.some((item) => item.product_id === "invented"), false);
});

test("Outfit Blueprint is the highest product decision and rejects avoid items", () => {
  const groups = [{
    requirement: {
      category: "shoes",
      gender: "female",
      item_name: "玛丽珍皮鞋",
      search_keywords: ["女士 玛丽珍皮鞋"],
    },
    candidates: [
      {
        ...product("mary-jane", "shoes", 78),
        title: "女士蝴蝶结玛丽珍皮鞋",
      },
      {
        ...product("running", "shoes", 99),
        title: "轻量跑步运动鞋训练鞋",
      },
    ],
  }];
  const context = {
    outfit_blueprint: {
      style_identity: "浪漫精致造型",
      visual_keywords: ["浪漫", "精致"],
      must_have_items: {shoes: ["玛丽珍皮鞋"]},
      avoid_items: ["运动鞋", "跑步鞋", "训练鞋"],
    },
  };
  const products = validateSelection({
    selected_products: [selection("running"), selection("mary-jane")],
  }, groups, 4, context);

  assert.deepEqual(products.map((item) => item.product_id), ["mary-jane"]);
  assert.ok(products[0].blueprint_match_score >= 65);
  assert.ok(products[0].matched_elements.length > 0);
  assert.deepEqual(products[0].conflict_elements, []);
});

test("high-intent Blueprint hard gate controls mature, classic, and unknown styles", () => {
  const cases = [
    {
      name: "成熟女性",
      category: "shoes",
      required: "尖头低跟鞋",
      accepted: "女士真皮尖头低跟鞋",
      rejected: "轻量运动跑步鞋",
      avoid: ["运动鞋", "跑步鞋"],
    },
    {
      name: "低调经典",
      category: "top",
      required: "羊绒针织衫",
      accepted: "低Logo纯羊绒针织衫",
      rejected: "大Logo运动连帽卫衣",
      avoid: ["大Logo", "运动卫衣"],
    },
    {
      name: "凌晨巴黎私人艺术展后的冷感女性",
      category: "shoes",
      required: "银灰不对称尖头鞋",
      accepted: "女士银灰不对称尖头单鞋",
      rejected: "彩色厚底训练运动鞋",
      avoid: ["训练鞋", "运动鞋"],
    },
  ];

  for (const entry of cases) {
    const accepted = product(`${entry.name}-accepted`, entry.category, 72);
    accepted.title = entry.accepted;
    const rejected = product(`${entry.name}-rejected`, entry.category, 99);
    rejected.title = entry.rejected;
    const groups = [{
      requirement: {
        category: entry.category,
        gender: "female",
        item_name: entry.required,
        search_keywords: [`女士 ${entry.required}`],
      },
      candidates: [rejected, accepted],
    }];
    const products = validateSelection({
      selected_products: [
        selection(rejected.product_id),
        selection(accepted.product_id),
      ],
    }, groups, 4, {
      style_profile: {intent_priority_score: 95},
      outfit_blueprint: {
        style_identity: entry.name,
        core_elements: [entry.required],
        must_have_items: {[entry.category]: [entry.required]},
        avoid_items: entry.avoid,
      },
    });

    assert.deepEqual(products.map((item) => item.product_id), [accepted.product_id]);
    assert.ok(Number.isFinite(products[0].blueprint_match_score));
    assert.ok(products[0].blueprint_match_score >= 50);
  }
});

test("final score uses calibrated aesthetic target dimensions and weak brand diversity ties", () => {
  assert.equal(
    Math.round(Object.values(CALIBRATED_PRODUCT_WEIGHTS)
      .reduce((sum, value) => sum + value, 0) * 100),
    100,
  );
  const score = compositeProductScore({
    matchScore: 100,
    bodyStrategyScore: 100,
    blueprintMatchScore: 100,
    styleMatchScore: 100,
    occasionFitScore: 100,
    silhouetteFitScore: 100,
    colorFitScore: 100,
    footwearFitScore: 100,
    qualityFitScore: 100,
    genderFitScore: 100,
    aestheticScore: 100,
    visualQualityScore: 100,
    brandQualityScore: 100,
    diversityScore: 100,
  });
  const exactLowBrand = compositeProductScore({
    matchScore: 100,
    bodyStrategyScore: 100,
    blueprintMatchScore: 100,
    styleMatchScore: 100,
    occasionFitScore: 100,
    silhouetteFitScore: 100,
    colorFitScore: 100,
    footwearFitScore: 100,
    qualityFitScore: 100,
    genderFitScore: 100,
    aestheticScore: 100,
    visualQualityScore: 100,
    brandQualityScore: 25,
    diversityScore: 100,
  });
  const mismatchHighBrand = compositeProductScore({
    matchScore: 100,
    bodyStrategyScore: 100,
    blueprintMatchScore: 100,
    styleMatchScore: 8,
    occasionFitScore: 35,
    silhouetteFitScore: 60,
    colorFitScore: 60,
    footwearFitScore: 60,
    qualityFitScore: 100,
    genderFitScore: 100,
    aestheticScore: 100,
    visualQualityScore: 100,
    brandQualityScore: 100,
    diversityScore: 100,
  });

  assert.equal(score, 100);
  assert.ok(exactLowBrand > mismatchHighBrand);
});

test("ten identical male Clean Fit generations never repeat the same primary combination consecutively", async () => {
  let calls = 0;
  const reranker = new ProductAestheticReranker({
    visualEvaluationEnabled: false,
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

  const primaryCombination = (products) => ["top", "shoes"]
    .map((category) => products.find((item) => item.category === category).product_id)
    .join(":");
  const combinations = [];
  for (let index = 0; index < 10; index += 1) {
    const products = await reranker.rerank({
      ...input,
      requestId: `request-${index + 1}`,
    });
    combinations.push(primaryCombination(products));
  }
  assert.ok(combinations.every((combination, index) =>
    index === 0 || combination !== combinations[index - 1]));
  assert.ok(new Set(combinations).size >= 3);
  assert.equal(calls, 1);
  assert.equal(reranker.getStats().call_count, 1);
  assert.equal(reranker.getStats().cache_hits, 9);
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
  assert.equal(refined.aesthetic_score, refined.catalog_aesthetic_score);
  assert.ok(cheap.catalog_aesthetic_score <= 20);
  assert.ok(cheap.aesthetic_quality_flags.includes("low_end_marketing"));
  assert.ok(cheap.aesthetic_quality_flags.includes("suspiciously_low_price"));
});

test("brand, image presentation and title quality directly affect aesthetic score", () => {
  const requirement = {category: "bag", style: "minimal"};
  const official = catalogAestheticAssessment({
    title: "品牌官方设计师系列通勤包",
    brand: "Studio Brand",
    shop_name: "品牌官方旗舰店",
    image_url: "https://img.alicdn.com/official-white.jpg",
    image_quality_hint: "white_background",
    material: "头层牛皮",
    price: 699,
  }, requirement);
  const unbranded = catalogAestheticAssessment({
    title: "普通通勤包",
    image_url: "https://img.alicdn.com/standard.jpg",
    price: 199,
  }, requirement);
  const promotional = catalogAestheticAssessment({
    title: "促销爆款学生同款通勤包9.9秒杀",
    brand: "Unknown Factory",
    image_url: "https://img.alicdn.com/promo-poster.jpg",
    image_quality_hint: "promotion_poster",
    price: 9.9,
  }, requirement);

  assert.ok(official.aesthetic_score >= unbranded.aesthetic_score + 40);
  assert.ok(promotional.aesthetic_score < unbranded.aesthetic_score);
  assert.ok(promotional.aesthetic_quality_flags.includes("promotion_poster"));
  assert.ok(promotional.aesthetic_quality_flags.includes("low_end_marketing"));
});

test("female date dress scoring favors tailoring and design over a plain basic dress", () => {
  const requirement = {
    category: "dress", gender: "female", scene: "约会",
    style: "高级甜美", item_name: "精致连衣裙",
  };
  const designed = catalogAestheticAssessment({
    title: "女士方领收腰褶裥伞摆连衣裙", brand: "Studio Brand",
    shop_name: "品牌官方旗舰店",
    image_url: "https://img.alicdn.com/designed-dress.jpg",
    image_quality_hint: "model_display", material: "提花面料", price: 399,
  }, requirement);
  const basic = catalogAestheticAssessment({
    title: "女士纯色基础款连衣裙", brand: "Studio Brand",
    shop_name: "品牌官方旗舰店",
    image_url: "https://img.alicdn.com/basic-dress.jpg",
    image_quality_hint: "model_display", material: "普通面料", price: 399,
  }, requirement);

  assert.ok(designed.aesthetic_score >= basic.aesthetic_score + 20);
  assert.ok(designed.aesthetic_quality_flags.includes("feminine_dress_design_detail"));
  assert.ok(basic.aesthetic_quality_flags.includes("generic_basic_dress"));
});

test("neutral dress intent does not receive the female scene-specific adjustment", () => {
  const basic = catalogAestheticAssessment({
    title: "纯色基础款连衣裙", brand: "Studio Brand",
    shop_name: "品牌官方旗舰店",
    image_url: "https://img.alicdn.com/neutral-dress.jpg",
    image_quality_hint: "model_display", material: "棉", price: 399,
  }, {
    category: "dress", gender: "unisex", scene: "约会",
    style: "中性利落", item_name: "连衣裙",
  });

  assert.equal(basic.aesthetic_quality_flags.includes("generic_basic_dress"), false);
  assert.equal(basic.aesthetic_quality_flags.includes("feminine_dress_design_detail"), false);
});

test("batch visual review filters an image dominated by store advertising", async () => {
  let calls = 0;
  const advertised = product("ad-poster", "top", 96);
  advertised.title = "男士质感短袖衬衫";
  const clean = product("clean-model", "top", 88);
  clean.title = "男士垂感短袖衬衫";
  const reranker = new ProductAestheticReranker({
    client: {
      chat: {completions: {create: async (request) => {
        calls += 1;
        if (Array.isArray(request.messages[1].content)) {
          const images = request.messages[1].content.filter((part) =>
            part.type === "image_url");
          assert.equal(images.length, 2);
          assert.ok(images.every((part) => part.image_url.detail === "auto"));
          return {
            choices: [{message: {content: JSON.stringify({
              image_assessments: [
                {
                  requirement_index: 0,
                  product_id: "ad-poster",
                  visual_quality_score: 18,
                  fashion_taste_score: 20,
                  commercial_ad_penalty: 92,
                  subject_coverage_score: 25,
                  reason: "50年老店和北京商城广告字占据主图",
                },
                {
                  requirement_index: 0,
                  product_id: "clean-model",
                  visual_quality_score: 90,
                  fashion_taste_score: 86,
                  commercial_ad_penalty: 5,
                  subject_coverage_score: 88,
                  reason: "干净模特展示，服装主体清晰",
                },
              ],
            })}}],
          };
        }
        const payload = JSON.parse(request.messages[1].content);
        assert.deepEqual(
          payload.product_groups[0].candidates.map((item) => item.product_id),
          ["clean-model"],
        );
        return response([selection("clean-model", {
          body_strategy_match_score: 89,
        })]);
      }}},
    },
    model: "test-model",
    logger: {info() {}, warn() {}},
  });

  const products = await reranker.rerank({
    groups: [{
      requirement: {category: "top", gender: "male", item_name: "垂感短袖衬衫"},
      candidates: [advertised, clean],
    }],
    context: {
      gender: "male",
      outfit_plan: {
        styling_strategy: {visual_goals: ["create_vertical_line"]},
      },
    },
  });

  assert.equal(calls, 2);
  assert.deepEqual(products.map((item) => item.product_id), ["clean-model"]);
  assert.equal(products[0].commercial_ad_penalty, 5);
  assert.equal(products[0].body_strategy_match_score, 89);
  assert.equal(reranker.getStats().visual_call_count, 1);
});

test("aesthetic quality scoring applies to every supported product category", () => {
  for (const category of ["top", "bottom", "shoes", "bag", "hat", "accessory"]) {
    const assessment = catalogAestheticAssessment({
      title: `品牌官方设计师系列${category}`,
      brand: "Studio Brand",
      shop_name: "品牌官方旗舰店",
      image_url: `https://img.alicdn.com/${category}.jpg`,
      image_quality_hint: "model_display",
      price: 399,
    }, {category});

    assert.ok(assessment.aesthetic_score >= 80, `${category} should receive quality scoring`);
  }
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

  assert.deepEqual(
    new Set(products.slice(0, 2).map((item) => item.brand)),
    new Set(["COS", "Uniqlo"]),
  );
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
    visualEvaluationEnabled: false,
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

test("product AI is capped at 20 seconds and timeout returns real fallback products", async () => {
  let observedTimeout = 0;
  const reranker = new ProductAestheticReranker({
    visualEvaluationEnabled: false,
    timeoutMs: 90_000,
    client: {
      chat: {completions: {create: async (_request, options) => {
        observedTimeout = options.timeout;
        throw Object.assign(new Error("time budget exceeded"), {code: "ETIMEDOUT"});
      }}},
    },
    model: "test-model",
    logger: {info() {}, warn() {}},
  });

  const products = await reranker.rerank({
    groups: [group("top", ["top-1", "top-2", "top-3", "top-4", "top-5"])],
    context: {gender: "female", style_expression: "feminine"},
  });

  assert.ok(observedTimeout > 0 && observedTimeout <= 20_000);
  assert.equal(products.length, 5);
  assert.ok(products.every((item) => item.source === "taobao"));
  assert.ok(products.every((item) => item.ai_rerank_fallback === true));
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
  const promotional = product("top-promo", "top", 98);
  promotional.title = "男士短袖Polo促销9.9秒杀";
  promotional.image_quality_hint = "promotion_poster";
  const reranker = new ProductAestheticReranker({
    visualEvaluationEnabled: false,
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
      candidates: [blocked, promotional, safe],
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

test("under-selected groups use local fallback without another AI call", async () => {
  let calls = 0;
  const reranker = new ProductAestheticReranker({
    visualEvaluationEnabled: false,
    client: {
      chat: {completions: {create: async (request) => {
        calls += 1;
        const payload = JSON.parse(request.messages[1].content);
        assert.equal(payload.product_groups.length, 1);
        return response([selection("top-1")]);
      }}},
    },
    model: "test-model",
    logger: {info() {}, warn() {}},
  });

  const products = await reranker.rerank({
    groups: [group("top", ["top-1", "top-2", "top-3", "top-4", "top-5"])],
    context: {gender: "male"},
  });

  assert.equal(calls, 1);
  assert.equal(products.length, 5);
  assert.ok(products.every((product) => product.ai_rerank_fallback === true));
  assert.equal(reranker.getStats().call_count, 1);
  assert.equal(reranker.getStats().fallback_count, 1);
});

test("multiple incomplete groups fall back locally within one AI call", async () => {
  const repairedCategories = [];
  const reranker = new ProductAestheticReranker({
    visualEvaluationEnabled: false,
    client: {
      chat: {completions: {create: async (request) => {
        const payload = JSON.parse(request.messages[1].content);
        assert.equal(payload.product_groups.length, 2);
        return response([selection("top-1"), selection("shoe-1")]);
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

  assert.deepEqual(repairedCategories, []);
  assert.equal(products.length, 10);
  assert.ok(products.every((product) => product.ai_rerank_fallback === true));
  assert.equal(reranker.getStats().call_count, 1);
});
