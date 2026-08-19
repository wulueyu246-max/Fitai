"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  COMPOSER_SCORE_PROPERTIES,
  DEFAULT_TAOBAO_RETRIEVAL_TIMEOUT_MS,
  DEFAULT_TAOBAO_SLOT_TIMEOUT_MS,
  MAX_REFINEMENT_ROUNDS,
  OUTFIT_COMPOSITION_SCHEMA,
  PRODUCT_SELECTION_SCHEMA,
  PRICE_POSITION,
  SHOPPING_PLAN_SCHEMA,
  ShoppingAgentV1Error,
  TaobaoShoppingAgentV1,
  buildPriceContext,
  buildComposerMessages,
  buildPlannerMessages,
  buildRecallBroadeningQuery,
  buildSearchPlan,
  buildSelectorMessages,
  buildShoppingIntent,
  buildShoeTaxonomyPolicy,
  candidatePoolDiversity,
  enrichCandidatePriceContext,
  classifyTaobaoRetrievalError,
  hardGateCandidate,
  normalizeAgentInput,
  normalizeBudgetContext,
  normalizeRefinementQuery,
  normalizeSearchQueryBoundary,
  normalizeShoppingIntent,
  parseAiJson,
  productSelectionSchema,
  refinementDecision,
  selectFinalCandidatePool,
  selectorQualityScore,
  shoeTaxonomyRank,
  validateComposedLooks,
  validateProductSelection,
} = require("../shopping_agent_v1");

test("shoe taxonomy demotes ballet families for default female casual intent without identifiers", () => {
  const policy = buildShoeTaxonomyPolicy({
    user_input: "普通周末穿搭",
    occasion: "casual",
    gender: "female",
  });
  assert.equal(policy.applies, true);
  assert.ok(shoeTaxonomyRank({title: "任意品牌 芭蕾T头鞋"}, policy) < 0);
  assert.ok(shoeTaxonomyRank({title: "任意品牌 白色德训鞋"}, policy) > 0);
  assert.ok(shoeTaxonomyRank({
    candidate_id: "ballet-looking-id",
    title: "普通休闲鞋",
  }, policy) > 0);
});

test("shoe taxonomy remains contextual for explicit aesthetics, gender, and occasions", () => {
  for (const input of [
    {user_input: "ballet aesthetic", occasion: "date", gender: "female"},
    {user_input: "法式甜美约会", occasion: "date", gender: "female"},
    {user_input: "普通休闲", occasion: "casual", gender: "male"},
    {user_input: "普通休闲", occasion: "casual", gender: "unisex"},
    {user_input: "正式商务", occasion: "business formal", gender: "female"},
  ]) {
    const policy = buildShoeTaxonomyPolicy(input);
    assert.equal(policy.applies, false);
    assert.equal(shoeTaxonomyRank({title: "ballet flats"}, policy), 0);
  }
});

test("selector final pool prioritizes a general shoe over a higher-scored ballet shoe", () => {
  const ballet = {...product("shoes", 91, "芭蕾T头鞋"), candidate_id: "shoe-a"};
  const sneaker = {...product("shoes", 92, "简洁小白鞋"), candidate_id: "shoe-b"};
  const assessments = [
    {candidate_id: "shoe-a", status: "KEEP", selection_tier: "HIGH",
      scores: selectorScores(95), reason_codes: []},
    {candidate_id: "shoe-b", status: "KEEP", selection_tier: "NORMAL",
      scores: selectorScores(75), reason_codes: []},
  ];
  const pool = selectFinalCandidatePool([ballet, sneaker], assessments, {
    category: "shoes",
    shoePolicy: buildShoeTaxonomyPolicy({
      user_input: "普通约会穿搭", occasion: "date", gender: "female",
    }),
  });
  assert.equal(pool[0].candidate_id, "shoe-b");
});

function plan(gender = "female", aesthetic = "清新法式休闲") {
  const genderLabel = gender === "male" ? "男款" : gender === "female" ? "女款" : "中性";
  return {
    shopping_intent: {
      gender,
      persona: {expression: gender === "female" ? "女性化" : "利落", maturity: "年轻成人"},
      overall_aesthetic: {
        core_direction: aesthetic,
        traits: ["轻松", "精致"],
        anti_drift: ["明显训练风"],
      },
      body_strategy: {
        goals: ["比例协调"],
        hard_constraints: [],
        soft_tactics: ["腰线清晰"],
      },
      occasion: {type: "日常外出", formality: "休闲"},
      slots: [
        {
          category: "top",
          role: "形成清爽上半身轮廓",
          hard_constraints: [gender, "top", "not_underwear"],
          soft_preferences: ["合身", "方领"],
          avoid: ["家居服"],
          search_query: `${genderLabel} 方领 合身 上衣`,
        },
        {
          category: "bottom",
          role: "建立清晰腰线",
          hard_constraints: [gender, "bottom", "not_underwear"],
          soft_preferences: ["高腰", "A字"],
          avoid: ["家居服"],
          search_query: `${genderLabel} 高腰 A字裙`,
        },
        {
          category: "shoes",
          role: "保持轻盈完整度",
          hard_constraints: [gender, "shoes"],
          soft_preferences: ["轻量", "精致"],
          avoid: ["训练鞋"],
          search_query: `${genderLabel} 轻量 精致 鞋`,
        },
      ],
    },
  };
}

function product(category, index, title) {
  return {
    product_id: `${category}-${index}`,
    source: "taobao",
    title,
    _category_text: title,
    category,
    price: 100 + index,
    sales: String(1000 - index),
    image_url: `https://img.example.com/${category}-${index}.jpg`,
    purchase_url: `https://item.example.com/${category}-${index}`,
    is_mock: false,
  };
}

function candidates(category) {
  if (category === "top") {
    return [
      product("top", 1, "女款方领修身短袖上衣"),
      product("top", 2, "女款轻薄针织上衣"),
      product("top", 3, "女款法式短袖衬衫"),
      product("top", 4, "男士商务衬衫"),
      product("top", 5, "女士家居服睡衣"),
    ];
  }
  if (category === "bottom") {
    return [
      product("bottom", 1, "女款高腰A字半身裙"),
      product("bottom", 2, "女款高腰直筒裤"),
      product("bottom", 3, "女款高腰直筒牛仔裤"),
      product("bottom", 4, "女士纯棉内裤"),
      product("top", 5, "女款短袖上衣"),
    ];
  }
  return [
    product("shoes", 1, "女款浅口玛丽珍鞋"),
    product("shoes", 2, "女款尖头低跟鞋"),
    product("shoes", 3, "女款轻便乐福鞋"),
    product("shoes", 4, "男士运动鞋"),
    product("bottom", 5, "女款直筒裤"),
  ];
}

function selectorScores(value = 82) {
  return {
    category_fit: Math.min(100, value + 10),
    aesthetic_fit: value,
    persona_fit: value,
    silhouette_fit: value,
    outfit_potential: value,
    aesthetic_distinctiveness: value,
    quality_perception: value,
    age_appropriateness: value,
    styling_value: value,
    shoe_refinement_score: value,
    visual_weight_score: value,
    material_quality_score: value,
    hardware_quality_score: value,
    proportion_score: value,
  };
}

function composerScores(value = 82) {
  return {
    aesthetic_coherence: value,
    proportion_balance: value,
    color_harmony: value,
    material_harmony: value,
    visual_hierarchy: value,
    style_story: value,
    distinctiveness: value,
    persona_fit: value,
    body_proportion: value,
    occasion_fit: value,
    value_coherence: value,
    cross_look_distinctiveness: value,
    final_score: value,
  };
}

function containsWeatherKey(value) {
  if (Array.isArray(value)) return value.some(containsWeatherKey);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, item]) =>
    /^(?:weather|weather_mode|weather_constraints|temperature|temperature_c|humidity|rain|wind|wind_kph|condition|forecast)$/i.test(key) ||
    containsWeatherKey(item));
}

test("real-time weather is absent from every Shopping Agent AI boundary", () => {
  const base = {
    request_id: "weather-disabled-1",
    user_input: "我要出去玩，帮我搭配一套",
    authoritative_gender: "female",
    height: 160,
    weight: 49,
  };
  const withoutWeather = normalizeAgentInput(base);
  const withWeather = normalizeAgentInput({
    ...base,
    weather_mode: "explicit",
    weather: {
      temperature_c: 35,
      humidity: 92,
      rain: true,
      wind_kph: 30,
    },
    weather_constraints: ["防泼水", "透气"],
  });
  assert.deepEqual(withWeather, withoutWeather);

  const plannerPayload = JSON.parse(buildPlannerMessages(withWeather, {})[1].content);
  const intent = buildShoppingIntent(plan().shopping_intent, withWeather);
  const group = {
    slot: intent.slots[0],
    query: intent.slots[0].search_query,
    candidates: candidates("top").slice(0, 3).map((item, index) => ({
      ...item,
      candidate_id: `candidate_${index + 1}`,
    })),
  };
  const selectorMessages = buildSelectorMessages(intent, group);
  const selections = ["top", "bottom", "shoes"].map((category) => ({
    slot: intent.slots.find((slot) => slot.category === category),
    final_candidate_pool: candidates(category).slice(0, 2).map((item, index) => ({
      ...item,
      candidate_id: `${category}_${index + 1}`,
      selection_tier: "HIGH",
      selector_quality_score: 80,
      selector_scores: selectorScores(80),
    })),
  }));
  const composerMessages = buildComposerMessages(intent, selections);

  assert.equal(containsWeatherKey(withWeather), false);
  assert.equal(containsWeatherKey(plannerPayload), false);
  assert.equal(containsWeatherKey(intent), false);
  assert.equal(containsWeatherKey(selectorMessages), false);
  assert.equal(containsWeatherKey(composerMessages), false);
  assert.equal(Object.hasOwn(COMPOSER_SCORE_PROPERTIES, "weather_fit"), false);
});

test("authoritative gender overrides AI drift and remains fixed across every AI boundary", async () => {
  const input = normalizeAgentInput({
    user_input: "我要出去玩，帮我搭配一套",
    authoritative_gender: "female",
  });
  const rawPlan = plan("male");
  const drift = [];
  const intent = buildShoppingIntent(rawPlan.shopping_intent, input, {
    onGenderDrift: (value) => drift.push(value),
  });
  assert.equal(intent.gender, "female");
  assert.equal(intent.persona.gender, "female");
  assert.equal(intent.persona.expression, "feminine_or_neutral_feminine");
  assert.ok(intent.slots.every((slot) => slot.gender === "female"));
  assert.ok(intent.slots.every((slot) => slot.search_query.includes("女")));
  assert.ok(intent.slots.every((slot) => !slot.hard_constraints.includes("male")));
  assert.deepEqual(drift, [{
    phase: "shopping_intent_search_plan",
    received_gender: "male",
    applied_gender: "female",
    resolution: "AUTHORITATIVE_OVERRIDE",
  }]);

  const topGroup = {
    slot: intent.slots[0],
    candidates: candidates("top").slice(0, 3).map((item, index) => ({
      ...item,
      candidate_id: `candidate_${index + 1}`,
    })),
  };
  const selectorPayload = JSON.parse(
    buildSelectorMessages(intent, topGroup, {authoritativeGender: "female"})[1]
      .content[0].text,
  );
  assert.equal(selectorPayload.authoritative_gender, "female");
  assert.equal(selectorPayload.selector_gender, "female");
  assert.equal(selectorPayload.persona_expression, "feminine_or_neutral_feminine");

  const selections = ["top", "bottom", "shoes"].map((category) => ({
    slot: intent.slots.find((slot) => slot.category === category),
    final_candidate_pool: candidates(category).slice(0, 2).map((item, index) => ({
      ...item,
      candidate_id: `${category}_${index + 1}`,
      selection_tier: "HIGH",
      selector_quality_score: 80,
      selector_scores: selectorScores(80),
    })),
  }));
  const composerPayload = JSON.parse(
    buildComposerMessages(intent, selections, {authoritativeGender: "female"})[1]
      .content[0].text,
  );
  assert.equal(composerPayload.authoritative_gender, "female");
  assert.equal(composerPayload.composer_gender, "female");
  assert.equal(composerPayload.shopping_intent.gender, "female");

  const agent = new TaobaoShoppingAgentV1({
    client: new FakeAiClient({planGender: "male"}),
    model: "qwen3.7-plus",
    productProvider: new FakeProvider(),
    logger: {info() {}, warn() {}},
  });
  const result = await agent.run({
    user_input: "我要出去玩，帮我搭配一套",
    authoritative_gender: "female",
  });
  assert.equal(result.state, "success");
  assert.equal(result.authoritative_gender, "female");
  assert.equal(result.planner_fallback_used, false);
  assert.equal(result.gender_context_drift[0].error_code,
    "SHOPPING_AGENT_GENDER_CONTEXT_DRIFT");
  assert.ok(Object.values(result.search_queries).every((query) => query.includes("女")));
});

test("female persona permits neutral-feminine styling without forcing skirts or pink", () => {
  const input = normalizeAgentInput({
    user_input: "想穿得中性利落一点，不要裙装",
    authoritative_gender: "female",
  });
  const raw = plan("female").shopping_intent;
  raw.slots[1] = {
    ...raw.slots[1],
    soft_preferences: ["高腰", "直筒"],
    search_query: "女 高腰 牛仔裤",
  };
  const intent = buildShoppingIntent(raw, input);
  assert.equal(intent.persona.expression, "neutral_feminine");
  assert.equal(intent.slots.some((slot) => /粉色/.test(slot.search_query)), false);
  assert.equal(intent.slots.some((slot) => slot.category === "bottom" &&
    /裙/.test(slot.search_query)), false);
  assert.ok(intent.slots.every((slot) => slot.search_query.includes("女")));
});

test("male authoritative gender remains fixed and produces male queries", () => {
  const input = normalizeAgentInput({
    user_input: "我要出去玩，帮我搭配一套",
    authoritative_gender: "male",
  });
  const intent = buildShoppingIntent(plan("male").shopping_intent, input);
  assert.equal(intent.gender, "male");
  assert.equal(intent.persona.expression, "masculine_or_neutral_masculine");
  assert.ok(intent.slots.every((slot) => slot.gender === "male"));
  assert.ok(intent.slots.every((slot) => slot.search_query.includes("男")));
});

test("AI unisex output cannot downgrade an authoritative female request", () => {
  const input = normalizeAgentInput({
    user_input: "帮我穿得自然利落",
    authoritative_gender: "female",
  });
  const raw = plan("female").shopping_intent;
  raw.gender = "unisex";
  const drift = [];
  const intent = buildShoppingIntent(raw, input, {
    onGenderDrift: (value) => drift.push(value),
  });
  assert.equal(intent.gender, "female");
  assert.equal(intent.persona.gender, "female");
  assert.ok(intent.slots.every((slot) => slot.gender === "female"));
  assert.ok(intent.slots.every((slot) => /^女/u.test(slot.search_query)));
  assert.equal(drift[0].received_gender, "unisex");
});

class FakeProvider {
  constructor() {
    this.calls = [];
  }

  async searchShoppingAgentCandidates(input) {
    this.calls.push(input);
    const products = candidates(input.category);
    return {products, raw_count: products.length, valid_count: products.length};
  }
}

class FakeAiClient {
  constructor({
    composerLookCount = 2,
    foreignComposerId = false,
    wrapComposer = false,
    directComposerArray = false,
    duplicateComposerCombination = false,
    refinementCategories = [],
    emptyRefinementQueryCategories = [],
    failRefinementCategory = null,
    failPlanner = false,
    failComposer = false,
    planGender = "female",
  } = {}) {
    this.calls = [];
    this.composerLookCount = composerLookCount;
    this.foreignComposerId = foreignComposerId;
    this.wrapComposer = wrapComposer;
    this.directComposerArray = directComposerArray;
    this.duplicateComposerCombination = duplicateComposerCombination;
    this.refinementCategories = new Set(refinementCategories);
    this.emptyRefinementQueryCategories = new Set(emptyRefinementQueryCategories);
    this.failRefinementCategory = failRefinementCategory;
    this.failPlanner = failPlanner;
    this.failComposer = failComposer;
    this.planGender = planGender;
    this.chat = {completions: {create: this.create.bind(this)}};
  }

  async create(input) {
    this.calls.push(input);
    const name = input.response_format.type === "json_object"
      ? "fitai_real_product_outfit_composer"
      : input.response_format.json_schema.name;
    let payload;
    if (name === "fitai_shopping_agent_v1_plan") {
      if (this.failPlanner) {
        const error = new Error("planner timed out");
        error.name = "AbortError";
        throw error;
      }
      payload = plan(this.planGender);
    } else if (name.startsWith("fitai_product_selector_")) {
      const metadata = JSON.parse(input.messages[1].content[0].text);
      if (metadata.selector_round === 2 &&
          metadata.slot.category === this.failRefinementCategory) {
        const error = new Error("refinement selector timed out");
        error.name = "AbortError";
        throw error;
      }
      const requiresRefinement = this.refinementCategories.has(metadata.slot.category) &&
        metadata.selector_round === 1;
      const baseScore = requiresRefinement ? 66 : 84;
      payload = {
        assessments: metadata.candidates.map((candidate, index) => ({
          candidate_id: candidate.candidate_id,
          status: "KEEP",
          selection_tier: requiresRefinement ? "NORMAL" : index < 2 ? "HIGH" : "NORMAL",
          scores: selectorScores(baseScore - index),
          reason_codes: [],
        })),
        quality_sufficient: !requiresRefinement,
        refinement_needed: requiresRefinement,
        refinement_reasons: requiresRefinement ? ["商品普通且同质"] : [],
        candidate_pool_homogeneity: requiresRefinement ? "HIGH" : "LOW",
        refinement_query: this.emptyRefinementQueryCategories.has(metadata.slot.category)
          ? ""
          : `${metadata.shopping_intent.gender === "female" ? "女款" : "男款"} ${
            metadata.slot.category === "top" ? "设计感短袖上衣" :
            metadata.slot.category === "bottom" ? "高腰垂感下装" : "轻盈精致鞋"
          }`,
      };
    } else if (name === "fitai_real_product_outfit_composer") {
      if (this.failComposer) {
        const error = new Error("composer timed out");
        error.name = "AbortError";
        throw error;
      }
      const metadata = JSON.parse(input.messages[1].content[0].text);
      const pools = metadata.candidate_pools;
      payload = {
        looks: Array.from({length: this.composerLookCount}, (_, index) => ({
          look_id: `look-${index + 1}`,
          top_candidate_id: index === 0 && this.foreignComposerId
            ? "candidate_999" : pools.top[index].candidate_id,
          bottom_candidate_id: pools.bottom[index].candidate_id,
          shoes_candidate_id: pools.shoes[index].candidate_id,
          scores: composerScores(82),
        })),
      };
      if (this.duplicateComposerCombination && payload.looks.length > 1) {
        payload.looks[1] = {
          ...payload.looks[1],
          top_candidate_id: payload.looks[0].top_candidate_id,
          bottom_candidate_id: payload.looks[0].bottom_candidate_id,
          shoes_candidate_id: payload.looks[0].shoes_candidate_id,
        };
      }
      if (this.directComposerArray) payload = payload.looks;
      else if (this.wrapComposer) payload = [payload];
    } else {
      throw new Error(`unexpected schema ${name}`);
    }
    return {
      choices: [{finish_reason: "stop", message: {content: JSON.stringify(payload)}}],
    };
  }
}

class LimitedGateProvider extends FakeProvider {
  constructor(counts = {}) {
    super();
    this.counts = counts;
  }

  async searchShoppingAgentCandidates(input) {
    this.calls.push(input);
    const products = candidates(input.category).slice(
      0,
      this.counts[input.category] ?? 3,
    );
    return {products, raw_count: products.length, valid_count: products.length};
  }
}

class SlotSelectorTimeoutClient extends FakeAiClient {
  constructor(category, options = {}) {
    super(options);
    this.timeoutCategory = category;
  }

  async create(input) {
    const name = input.response_format.type === "json_object"
      ? "fitai_real_product_outfit_composer"
      : input.response_format.json_schema.name;
    if (name === `fitai_product_selector_${this.timeoutCategory}`) {
      this.calls.push(input);
      const error = new Error(`${this.timeoutCategory} selector timed out`);
      error.code = "ETIMEDOUT";
      throw error;
    }
    return super.create(input);
  }
}

test("Shopping Agent V1 schemas are strict objects", () => {
  for (const schema of [
    SHOPPING_PLAN_SCHEMA,
    PRODUCT_SELECTION_SCHEMA,
    OUTFIT_COMPOSITION_SCHEMA,
  ]) {
    assert.equal(schema.type, "object");
    assert.equal(schema.additionalProperties, false);
    assert.ok(Array.isArray(schema.required));
  }
  assert.ok(Object.hasOwn(
    PRODUCT_SELECTION_SCHEMA.properties.assessments.items.properties.scores.properties,
    "aesthetic_distinctiveness",
  ));
  for (const field of [
    "shoe_refinement_score",
    "visual_weight_score",
    "material_quality_score",
    "hardware_quality_score",
    "proportion_score",
  ]) {
    assert.ok(Object.hasOwn(
      PRODUCT_SELECTION_SCHEMA.properties.assessments.items.properties.scores.properties,
      field,
    ));
  }
  assert.equal(Object.hasOwn(
    productSelectionSchema("top").properties.assessments.items.properties
      .scores.properties,
    "shoe_refinement_score",
  ), false);
  assert.ok(Object.hasOwn(PRODUCT_SELECTION_SCHEMA.properties, "refinement_needed"));
  assert.ok(Object.hasOwn(
    OUTFIT_COMPOSITION_SCHEMA.properties.looks.items.properties.scores.properties,
    "visual_hierarchy",
  ));
  assert.ok(Object.hasOwn(
    OUTFIT_COMPOSITION_SCHEMA.properties.looks.items.properties.scores.properties,
    "final_score",
  ));
  assert.ok(Object.hasOwn(
    OUTFIT_COMPOSITION_SCHEMA.properties.looks.items.properties.scores.properties,
    "value_coherence",
  ));
  assert.ok(Object.hasOwn(
    OUTFIT_COMPOSITION_SCHEMA.properties.looks.items.properties.scores.properties,
    "cross_look_distinctiveness",
  ));
  assert.deepEqual(
    Object.keys(OUTFIT_COMPOSITION_SCHEMA.properties.looks.items.properties),
    [
      "look_id",
      "top_candidate_id",
      "bottom_candidate_id",
      "shoes_candidate_id",
      "scores",
    ],
  );
  assert.equal(MAX_REFINEMENT_ROUNDS, 1);
});

test("Phase 2 score calibration and tiers prioritize exceptional KEEP candidates", () => {
  const products = [1, 2, 3].map((index) => ({
    ...product("top", index, `女款上衣${index}`),
    candidate_id: `candidate_00${index}`,
  }));
  const assessments = [
    {
      candidate_id: "candidate_001",
      status: "KEEP",
      selection_tier: "NORMAL",
      scores: selectorScores(79),
      reason_codes: [],
    },
    {
      candidate_id: "candidate_002",
      status: "KEEP",
      selection_tier: "HIGH",
      scores: selectorScores(76),
      reason_codes: [],
    },
    {
      candidate_id: "candidate_003",
      status: "UNCERTAIN",
      selection_tier: "NONE",
      scores: selectorScores(90),
      reason_codes: [],
    },
  ];
  assert.ok(selectorQualityScore(assessments[0]) >= 70);
  const pool = selectFinalCandidatePool(products, assessments);
  assert.deepEqual(pool.map((item) => item.candidate_id), [
    "candidate_002",
    "candidate_001",
    "candidate_003",
  ]);
});

test("shoe image refinement can demote an otherwise inflated HIGH candidate", () => {
  const products = [
    {...product("shoes", 1, "女款厚底大扣件玛丽珍鞋"), candidate_id: "candidate_001"},
    {...product("shoes", 2, "女款轻量精致乐福鞋"), candidate_id: "candidate_002"},
  ];
  const weakShoeScores = {
    ...selectorScores(88),
    shoe_refinement_score: 42,
    visual_weight_score: 38,
    material_quality_score: 45,
    hardware_quality_score: 35,
    proportion_score: 44,
  };
  const strongShoeScores = {
    ...selectorScores(82),
    shoe_refinement_score: 84,
    visual_weight_score: 86,
    material_quality_score: 80,
    hardware_quality_score: 82,
    proportion_score: 85,
  };
  const pool = selectFinalCandidatePool(products, [
    {
      candidate_id: "candidate_001",
      status: "KEEP",
      selection_tier: "HIGH",
      scores: weakShoeScores,
      reason_codes: [],
    },
    {
      candidate_id: "candidate_002",
      status: "KEEP",
      selection_tier: "HIGH",
      scores: strongShoeScores,
      reason_codes: [],
    },
  ]);

  assert.equal(pool[0].candidate_id, "candidate_002");
  const demoted = pool.find((item) => item.candidate_id === "candidate_001");
  assert.equal(demoted.selection_tier, "NORMAL");
  assert.ok(demoted.cheapness_risk > 45);
  assert.ok(demoted.shoe_quality_reason_codes.includes("SHOE_VISUAL_WEIGHT_CONFLICT"));
  assert.ok(demoted.shoe_quality_reason_codes.includes("SHOE_CHEAPNESS_RISK_HIGH"));
});

test("low shoe aesthetic quality uses the existing single refinement budget", () => {
  const shoppingIntent = plan().shopping_intent;
  const decision = refinementDecision({
    selector_keep: 3,
    top_candidate_quality: 82,
    shoe_aesthetic_quality: 58,
    candidate_pool_homogeneity: "LOW",
    quality_sufficient: true,
    selector_refinement_suggested: false,
    refinement_needed: false,
    refinement_reasons: [],
    refinement_query: "女款 轻盈 精致 乐福鞋",
    query: shoppingIntent.slots[2].search_query,
    slot: shoppingIntent.slots[2],
    diversity: {diversity_insufficient: false},
  }, {shoppingIntent});

  assert.equal(decision.needed, true);
  assert.ok(decision.reasons.includes("SHOE_AESTHETIC_QUALITY_LOW"));
  assert.equal(decision.server_refinement_required, true);
});

test("Phase 2.5 price context marks a robust high outlier without hard rejection", () => {
  const products = [99, 159, 229, 1737].map((price, index) => ({
    ...product("bottom", index + 1, `女款直筒牛仔裤${index + 1}`),
    candidate_id: `candidate_00${index + 1}`,
    price,
  }));
  const context = buildPriceContext(products);
  const enriched = products.map((item) => enrichCandidatePriceContext(item, context, {}));

  assert.deepEqual(context, {
    min_price: 99,
    median_price: 194,
    p75_price: 606,
    max_price: 1737,
    observed_count: 4,
  });
  assert.equal(enriched.at(-1).price_position, PRICE_POSITION.OUTLIER_HIGH);
  assert.ok(enriched.at(-1).value_reason_codes.includes("PRICE_OUTLIER_HIGH"));

  const assessments = enriched.map((item, index) => ({
    candidate_id: item.candidate_id,
    status: "KEEP",
    selection_tier: index === 3 ? "HIGH" : "NORMAL",
    scores: selectorScores(index === 3 ? 72 : 76 - index),
    reason_codes: [],
  }));
  const pool = selectFinalCandidatePool(enriched, assessments);
  assert.equal(pool.length, 3);
  assert.ok(!pool.some((item) => item.candidate_id === "candidate_004"));
  const allCandidates = selectFinalCandidatePool(enriched, [
    assessments[3],
    assessments[0],
    assessments[1],
    assessments[2],
  ]);
  assert.ok(allCandidates.every((item) => item.candidate_id !== "candidate_004"));
});

test("Phase 2.5 keeps an exceptional price outlier but requires value evidence", () => {
  const products = [99, 159, 229, 1737].map((price, index) => ({
    ...product("bottom", index + 1, `女款直筒牛仔裤${index + 1}`),
    candidate_id: `candidate_00${index + 1}`,
    price,
  }));
  const context = buildPriceContext(products);
  const enriched = products.map((item) => enrichCandidatePriceContext(item, context, {}));
  const assessments = enriched.map((item, index) => ({
    candidate_id: item.candidate_id,
    status: "KEEP",
    selection_tier: index === 3 ? "HIGH" : "NORMAL",
    scores: selectorScores(index === 3 ? 90 : 72),
    reason_codes: [],
  }));
  const pool = selectFinalCandidatePool(enriched, assessments);
  const premium = pool.find((item) => item.candidate_id === "candidate_004");
  assert.ok(premium);
  assert.equal(premium.selection_tier, "HIGH");
  assert.ok(premium.value_reason_codes.includes(
    "PRICE_PREMIUM_JUSTIFIED_BY_SELECTION_EVIDENCE",
  ));
  assert.ok(premium.value_reasonableness >= 60);
  assert.ok(premium.selector_scores.outfit_potential <
    premium.selector_raw_scores.outfit_potential);
});

test("Phase 2.5 explicit high item budget avoids an automatic outlier penalty", () => {
  const products = [99, 159, 229, 1737].map((price, index) => ({
    ...product("bottom", index + 1, `女款直筒牛仔裤${index + 1}`),
    candidate_id: `candidate_00${index + 1}`,
    price,
  }));
  const budget = normalizeBudgetContext({item_budget: 2000}, "");
  const context = buildPriceContext(products);
  const enriched = products.map((item) => enrichCandidatePriceContext(item, context, budget));
  const premium = enriched.at(-1);
  const pool = selectFinalCandidatePool(enriched, enriched.map((item) => ({
    candidate_id: item.candidate_id,
    status: "KEEP",
    selection_tier: item === premium ? "HIGH" : "NORMAL",
    scores: selectorScores(item === premium ? 80 : 75),
    reason_codes: [],
  })));
  const selectedPremium = pool.find((item) => item.candidate_id === premium.candidate_id);
  assert.ok(selectedPremium);
  assert.equal(selectedPremium.selection_tier, "HIGH");
  assert.equal(selectedPremium.value_adjustment, 0);
  assert.ok(selectedPremium.value_reason_codes.includes("WITHIN_EXPLICIT_ITEM_BUDGET"));
});

test("explicit item budget is a hard candidate boundary independent of aesthetics", () => {
  const products = [499, 501].map((price, index) => enrichCandidatePriceContext({
    ...product("bottom", index + 1, `budget-boundary-${index + 1}`),
    candidate_id: `budget_${index + 1}`,
    price,
  }, buildPriceContext([{price: 499}, {price: 501}]), {item_budget: 500}));
  assert.ok(products[1].value_reason_codes.includes("USER_BUDGET_CONSTRAINT"));
  const pool = selectFinalCandidatePool(products, products.map((item, index) => ({
    candidate_id: item.candidate_id,
    status: "KEEP",
    selection_tier: "HIGH",
    scores: selectorScores(index === 1 ? 100 : 60),
    reason_codes: [],
  })));
  assert.deepEqual(pool.map((item) => item.candidate_id), ["budget_1"]);
});

test("explicit outfit budget rejects over-boundary Looks at final validation", () => {
  const intent = buildShoppingIntent(plan().shopping_intent, normalizeAgentInput({
    user_input: "budget boundary",
    authoritative_gender: "female",
    budget: {outfit_budget: 1000},
  }));
  const selections = ["top", "bottom", "shoes"].map((category, categoryIndex) => ({
    slot: intent.slots.find((slot) => slot.category === category),
    final_candidate_pool: [400, categoryIndex === 0 ? 399 : 300].map((price, index) => ({
      ...product(category, index + 1, `${category}-budget-${index + 1}`),
      candidate_id: `${category}_${index + 1}`,
      price,
      explicit_budget: {outfit_budget: 1000},
    })),
  }));
  const result = validateComposedLooks({looks: [
    {
      look_id: "over",
      top_candidate_id: "top_1",
      bottom_candidate_id: "bottom_1",
      shoes_candidate_id: "shoes_1",
      scores: composerScores(100),
    },
    {
      look_id: "within",
      top_candidate_id: "top_2",
      bottom_candidate_id: "bottom_2",
      shoes_candidate_id: "shoes_2",
      scores: composerScores(60),
    },
  ]}, selections, {authoritativeGender: "female"});
  assert.deepEqual(result.looks.map((look) => look.look_id), ["within"]);
  assert.equal(result.budget_rejections[0].error_code, "USER_BUDGET_CONSTRAINT");
  assert.equal(result.budget_rejections[0].total_price, 1200);
});

function aiResponse(content, finishReason = "stop") {
  return {choices: [{finish_reason: finishReason, message: {content}}]};
}

test("Shopping Agent structured parser records a valid object safely", () => {
  const diagnostics = [];
  const payload = parseAiJson(aiResponse(JSON.stringify(plan())), {
    onDiagnostic: (value) => diagnostics.push(value),
  });
  assert.deepEqual(payload, plan());
  assert.deepEqual(diagnostics, [{
    finish_reason: "stop",
    content_type: "string",
    content_length: JSON.stringify(plan()).length,
    json_parse_success: true,
    parsed_json_type: "object",
    schema_error_kind: null,
    top_level_keys: ["shopping_intent"],
  }]);
});

test("Shopping Agent structured parser diagnoses every legal non-object JSON type", () => {
  const cases = [
    {
      value: [{shopping_intent: plan().shopping_intent}],
      kind: "TOP_LEVEL_ARRAY",
      type: "array",
      extra: {
        array_length: 1,
        first_item_type: "object",
        first_item_keys: ["shopping_intent"],
      },
    },
    {value: "wrapped", kind: "TOP_LEVEL_STRING", type: "string", extra: {}},
    {value: 42, kind: "TOP_LEVEL_NUMBER", type: "number", extra: {}},
    {value: true, kind: "TOP_LEVEL_BOOLEAN", type: "boolean", extra: {}},
    {value: null, kind: "TOP_LEVEL_NULL", type: "null", extra: {}},
  ];
  for (const item of cases) {
    const diagnostics = [];
    assert.throws(
      () => parseAiJson(aiResponse(JSON.stringify(item.value)), {
        onDiagnostic: (value) => diagnostics.push(value),
      }),
      (error) => error.code === "SHOPPING_AGENT_SCHEMA_INVALID" &&
        error.schema_error_kind === item.kind,
    );
    assert.equal(diagnostics.length, 1);
    assert.deepEqual(diagnostics[0], {
      finish_reason: "stop",
      content_type: "string",
      content_length: JSON.stringify(item.value).length,
      json_parse_success: true,
      parsed_json_type: item.type,
      schema_error_kind: item.kind,
      ...item.extra,
    });
  }
});

test("Product Selector parser accepts object and one safe assessments wrapper only", () => {
  const payload = {assessments: []};
  assert.deepEqual(
    parseAiJson(aiResponse(JSON.stringify(payload)), {
      allowSingleAssessmentWrapper: true,
    }),
    payload,
  );
  assert.deepEqual(
    parseAiJson(aiResponse(JSON.stringify([payload])), {
      allowSingleAssessmentWrapper: true,
    }),
    payload,
  );

  for (const invalid of [
    [],
    [payload, payload],
    ["not-an-object"],
    [{}],
  ]) {
    assert.throws(
      () => parseAiJson(aiResponse(JSON.stringify(invalid)), {
        allowSingleAssessmentWrapper: true,
      }),
      (error) => error.code === "SHOPPING_AGENT_SCHEMA_INVALID" &&
        error.schema_error_kind === "INVALID_SELECTOR_ARRAY_WRAPPER",
    );
  }
});

test("Composer parser canonicalizes only the three supported response structures", () => {
  const looks = [1, 2].map((index) => ({
    look_id: `look-${index}`,
    top_candidate_id: `top-${index}`,
    bottom_candidate_id: `bottom-${index}`,
    shoes_candidate_id: `shoes-${index}`,
    scores: composerScores(80),
  }));
  const payload = {looks};
  const diagnostics = [];
  assert.deepEqual(
    parseAiJson(aiResponse(JSON.stringify(payload)), {
      allowSingleLooksWrapper: true,
      onDiagnostic: (value) => diagnostics.push(value),
    }),
    payload,
  );
  assert.deepEqual(
    parseAiJson(aiResponse(JSON.stringify([payload])), {
      allowSingleLooksWrapper: true,
      onDiagnostic: (value) => diagnostics.push(value),
    }),
    payload,
  );
  assert.deepEqual(
    parseAiJson(aiResponse(JSON.stringify(looks)), {
      allowSingleLooksWrapper: true,
      onDiagnostic: (value) => diagnostics.push(value),
    }),
    payload,
  );
  assert.deepEqual(
    diagnostics.map((item) => ({
      structure: item.composer_raw_structure,
      rawLength: item.raw_array_length,
      lookCount: item.normalized_look_count,
    })),
    [
      {structure: "OBJECT_WRAPPER", rawLength: null, lookCount: 2},
      {structure: "SINGLE_ARRAY_WRAPPER", rawLength: 1, lookCount: 2},
      {structure: "DIRECT_LOOK_ARRAY", rawLength: 2, lookCount: 2},
    ],
  );

  for (const invalid of [
    [],
    [payload, payload],
    ["not-an-object"],
    [looks[0], "not-a-look"],
    [{...looks[0], shoes_candidate_id: undefined}],
  ]) {
    assert.throws(
      () => parseAiJson(aiResponse(JSON.stringify(invalid)), {
        allowSingleLooksWrapper: true,
      }),
      (error) => error.code === "SHOPPING_AGENT_SCHEMA_INVALID" &&
        error.schema_error_kind === "INVALID_COMPOSER_ARRAY_WRAPPER",
    );
  }
});

test("Composer explicitly rejects JSON Schema echo and invalid JSON", () => {
  const schemaEcho = {
    type: "object",
    additionalProperties: false,
    properties: {looks: {type: "array", items: {type: "object"}}},
  };
  for (const value of [schemaEcho, [schemaEcho]]) {
    assert.throws(
      () => parseAiJson(aiResponse(JSON.stringify(value)), {
        allowSingleLooksWrapper: true,
      }),
      (error) => error.code === "SHOPPING_AGENT_SCHEMA_INVALID" &&
        error.schema_error_kind === "COMPOSER_SCHEMA_ECHO",
    );
  }
  assert.throws(
    () => parseAiJson(aiResponse("```json\n{\"looks\":[]}\n```"), {
      allowSingleLooksWrapper: true,
    }),
    (error) => error.code === "SHOPPING_AGENT_SCHEMA_INVALID" &&
      error.schema_error_kind === "INVALID_JSON",
  );
});

test("Shopping Intent reports a missing top-level shopping_intent explicitly", () => {
  const input = normalizeAgentInput({user_input: "出去玩", gender: "female"});
  const parsed = parseAiJson(aiResponse("{}"));
  assert.throws(
    () => normalizeShoppingIntent(parsed.shopping_intent, input),
    (error) => error.code === "SHOPPING_AGENT_SCHEMA_INVALID" &&
      error.schema_error_kind === "MISSING_SHOPPING_INTENT",
  );
});

test("Shopping Intent reports an invalid slots count explicitly", () => {
  const input = normalizeAgentInput({user_input: "出去玩", gender: "female"});
  const intent = structuredClone(plan().shopping_intent);
  intent.slots.pop();
  assert.throws(
    () => normalizeShoppingIntent(intent, input),
    (error) => error.code === "SHOPPING_AGENT_SCHEMA_INVALID" &&
      error.schema_error_kind === "INVALID_SLOTS",
  );
});

test("Taobao retrieval budgets leave a bounded outer safety margin", () => {
  assert.equal(DEFAULT_TAOBAO_SLOT_TIMEOUT_MS, 25_000);
  assert.equal(DEFAULT_TAOBAO_RETRIEVAL_TIMEOUT_MS, 30_000);
  assert.ok(DEFAULT_TAOBAO_RETRIEVAL_TIMEOUT_MS > DEFAULT_TAOBAO_SLOT_TIMEOUT_MS);
});

test("Shopping Intent preserves only flexible slot intent and one executable query", () => {
  const input = normalizeAgentInput({
    user_input: "我要出去玩，帮我搭配一套",
    gender: "female",
    height: 160,
    weight: 49,
  });
  const intent = normalizeShoppingIntent(plan().shopping_intent, input);
  assert.equal(intent.gender, "female");
  assert.deepEqual(intent.slots.map((slot) => slot.category), ["top", "bottom", "shoes"]);
  assert.ok(intent.slots.every((slot) => slot.search_query.includes("女")));
  assert.ok(intent.slots.every((slot) => !Object.hasOwn(slot, "product_type")));
});

test("Search Recall Boundary strips weather, color and excess attributes before Taobao", () => {
  const input = normalizeAgentInput({
    user_input: "我要出去玩，帮我搭一套",
    gender: "female",
    weather: {condition: "下雨", temperature_c: 32},
  });
  const rawPlan = plan();
  rawPlan.shopping_intent.overall_aesthetic.core_direction =
    "都市轻浪漫 (Urban Light Romantic)";
  rawPlan.shopping_intent.slots[0].search_query =
    "女式法式防泼水短袖衬衫奶油白";
  rawPlan.shopping_intent.slots[1].search_query =
    "女式高腰A字迷你半身裙薄荷绿";
  rawPlan.shopping_intent.slots[2].search_query =
    "女式透明粗跟雨靴可爱风";

  const intent = buildShoppingIntent(rawPlan.shopping_intent, input);
  assert.equal(intent.slots[0].search_query, "女 法式 短袖 衬衫");
  assert.equal(intent.slots[1].search_query, "女 A字 半身裙");
  assert.equal(intent.slots[2].search_query, "女 可爱 粗跟 鞋");
  assert.ok(intent.slots.every((slot) => slot.query_attribute_count <= 2));
  assert.ok(intent.slots.every((slot) =>
    slot.query_complexity_status === "SIMPLIFIED"));
  assert.doesNotMatch(intent.slots[0].search_query, /防泼水|奶油白/);
  assert.doesNotMatch(intent.slots[1].search_query, /薄荷绿/);
  assert.doesNotMatch(intent.slots[2].search_query, /雨靴/);
});

test("weather cannot choose rain boots but an explicit user request can", () => {
  const rawSlot = {category: "shoes", search_query: "女式透明粗跟雨靴可爱风"};
  const weatherOnly = buildSearchPlan(rawSlot, {
    gender: "female",
    category: "shoes",
    userInput: "今天下雨，帮我搭一套",
  });
  const explicit = buildSearchPlan(rawSlot, {
    gender: "female",
    category: "shoes",
    userInput: "我要一双雨靴",
  });
  assert.doesNotMatch(weatherOnly.query, /雨靴|雨鞋/);
  assert.match(explicit.query, /雨靴/);
});

test("Golden and Flutter contexts share the same Shopping Intent and Search Plan boundary", () => {
  const rawPlan = plan();
  rawPlan.shopping_intent.slots[0].search_query =
    "女式法式防泼水短袖衬衫奶油白";
  rawPlan.shopping_intent.slots[2].search_query =
    "女式透明粗跟雨靴可爱风";
  const golden = normalizeAgentInput({
    user_input: "我要出去玩，帮我搭一套",
    gender: "female",
    height: 160,
    weight: 49,
  });
  const flutter = normalizeAgentInput({
    user_input: "我要出去玩，帮我搭一套",
    gender: "female",
    height: 160,
    weight: 49,
    persona: {style: "都市轻浪漫", outfit_blueprint: {source: "flutter"}},
    occasion: "约会",
    weather: {condition: "rain", constraints: ["防泼水", "透气"]},
  });
  const goldenIntent = buildShoppingIntent(rawPlan.shopping_intent, golden);
  const flutterIntent = buildShoppingIntent(rawPlan.shopping_intent, flutter);
  assert.deepEqual(
    flutterIntent.slots.map((slot) => slot.search_query),
    goldenIntent.slots.map((slot) => slot.search_query),
  );
  assert.ok(flutterIntent.slots.every((slot) => slot.query_attribute_count <= 2));
});

test("invalid AI query wording falls back to a deterministic high-recall plan", () => {
  const input = normalizeAgentInput({
    user_input: "帮我搭一套显高显腿长的穿搭。",
    gender: "female",
  });
  const rawPlan = plan();
  rawPlan.shopping_intent.slots[0].search_query = "女款显高显瘦日常单品";
  rawPlan.shopping_intent.slots[1].search_query = "女款修饰腿型自然选择";
  rawPlan.shopping_intent.slots[2].search_query = "女款轻盈显高搭配单品";

  const intent = buildShoppingIntent(rawPlan.shopping_intent, input);
  assert.deepEqual(intent.slots.map((slot) => slot.search_query), [
    "女 方领 上衣",
    "女 A字 下装",
    "女 轻量 鞋",
  ]);
  assert.ok(intent.slots.every((slot) => slot.search_plan_fallback_used));
  assert.ok(intent.slots.every((slot) => slot.search_plan_fallback_reason));
});

test("initial query gender conflict is logged and deterministically overridden", () => {
  const input = normalizeAgentInput({user_input: "帮我搭一套", gender: "female"});
  const rawPlan = plan();
  rawPlan.shopping_intent.slots[0].search_query = "男士显瘦单品";
  const drift = [];
  const intent = buildShoppingIntent(rawPlan.shopping_intent, input, {
    onGenderDrift: (value) => drift.push(value),
  });
  assert.match(intent.slots[0].search_query, /^女/u);
  assert.doesNotMatch(intent.slots[0].search_query, /男/u);
  assert.equal(intent.slots[0].search_plan_fallback_reason,
    "SHOPPING_AGENT_GENDER_CONTEXT_DRIFT");
  assert.equal(drift[0].phase, "search_plan");
  assert.equal(drift[0].received_gender, "male");
});

test("ZERO_RESULT_RECALL uses one deterministic broadening round before selectors", async () => {
  class ZeroThenBroadProvider {
    constructor() {
      this.calls = [];
      this.counts = new Map();
    }

    async searchShoppingAgentCandidates(input) {
      this.calls.push(input);
      const count = (this.counts.get(input.category) || 0) + 1;
      this.counts.set(input.category, count);
      if (count === 1) {
        return {
          products: [],
          raw_count: 0,
          valid_count: 0,
          attempts: 1,
          zero_result_recall: true,
          recall_error_code: "ZERO_RESULT_RECALL",
        };
      }
      const products = candidates(input.category);
      return {products, raw_count: products.length, valid_count: products.length, attempts: 1};
    }
  }

  const logs = [];
  const provider = new ZeroThenBroadProvider();
  const client = new FakeAiClient();
  const agent = new TaobaoShoppingAgentV1({
    client,
    model: "qwen3.7-plus",
    productProvider: provider,
    logger: {
      info(event, details) { logs.push({event, details}); },
      warn(event, details) { logs.push({event, details}); },
    },
  });
  const result = await agent.run({
    user_input: "我要出去玩，帮我搭一套",
    authoritative_gender: "female",
    height: 160,
    weight: 49,
  });

  assert.equal(result.state, "success");
  assert.equal(result.taobao_call_count, 6);
  assert.equal(result.ai_call_count, 5);
  assert.ok(result.final_look_count >= 2);
  for (const category of ["top", "bottom", "shoes"]) {
    const calls = provider.calls.filter((call) => call.category === category);
    assert.equal(calls.length, 2);
    assert.notEqual(calls[0].query, calls[1].query);
    const metric = result.slot_metrics.find((item) => item.category === category);
    assert.equal(metric.recall_broadening_used, true);
    assert.equal(metric.broadening_reason, "ZERO_RESULT_RECALL");
    assert.equal(metric.refinement_attempted, false);
  }
  assert.equal(logs.filter(({event}) =>
    event === "shopping_agent_v1_recall_broadening").length, 3);
});

test("recall broadening removes optional traits without changing gender or category", () => {
  const broadening = buildRecallBroadeningQuery({
    shoppingIntent: {gender: "female"},
    slot: {category: "top"},
    originalQuery: "女 法式 短袖 衬衫",
  });
  assert.equal(broadening.query, "女 衬衫");
  assert.equal(normalizeSearchQueryBoundary(
    broadening.query,
    "female",
    "top",
  ).canonical_category, "top");
});

test("Phase 2.5 carries explicit item and outfit budgets without inventing a cap", () => {
  const explicit = normalizeAgentInput({
    user_input: "出去玩",
    gender: "female",
    budget: {item_budget: 300, outfit_budget: 1000},
  });
  const intent = normalizeShoppingIntent(plan().shopping_intent, explicit);
  assert.deepEqual(intent.budget, {item_budget: 300, outfit_budget: 1000});

  const absent = normalizeAgentInput({user_input: "出去玩", gender: "female"});
  assert.deepEqual(absent.budget, {item_budget: null, outfit_budget: null});

  const natural = normalizeAgentInput({
    user_input: "单件300左右，整套1000以内",
    gender: "female",
  });
  assert.deepEqual(natural.budget, {item_budget: 300, outfit_budget: 1000});
});

test("refinement query validation uses canonical category and explicit gender", () => {
  const input = normalizeAgentInput({
    user_input: "我要出去玩，帮我搭配一套",
    gender: "female",
  });
  const initialPlan = plan();
  initialPlan.shopping_intent.slots[0].search_query = "女短款修身针织衫";
  const initialIntent = normalizeShoppingIntent(initialPlan.shopping_intent, input);
  assert.equal(initialIntent.slots[0].search_query, "女 短款 针织衫");

  assert.deepEqual(
    normalizeRefinementQuery("女 方领 修身 短袖", "female", "top"),
    {query: "女 方领 修身 短袖", canonical_category: "top"},
  );
  assert.deepEqual(
    normalizeRefinementQuery("女 韩系 polo 针织", "female", "top"),
    {query: "女 韩系 polo 针织", canonical_category: "top"},
  );
  assert.deepEqual(
    normalizeRefinementQuery("女 设计感 针织衫", "female", "top"),
    {query: "女 设计感 针织衫", canonical_category: "top"},
  );

  assert.throws(
    () => normalizeRefinementQuery("女 高腰牛仔裤", "female", "top"),
    (error) => error.schema_error_kind === "REFINEMENT_QUERY_CATEGORY_MISMATCH" &&
      error.message.startsWith("top.refinement_query"),
  );
  assert.throws(
    () => normalizeRefinementQuery("男士短袖衬衫", "female", "top"),
    (error) => error.schema_error_kind === "REFINEMENT_QUERY_GENDER_MISMATCH" &&
      error.message.startsWith("top.refinement_query"),
  );
  assert.throws(
    () => normalizeRefinementQuery("男女同款短袖", "female", "top"),
    (error) => error.schema_error_kind === "REFINEMENT_QUERY_GENDER_MISMATCH",
  );
  assert.throws(
    () => normalizeRefinementQuery("", "female", "top"),
    (error) => error.schema_error_kind === "REFINEMENT_QUERY_EMPTY" &&
      error.message.startsWith("top.refinement_query"),
  );
});

test("hard gate rejects wrong gender, wrong category and underwear/homewear only", () => {
  const intent = normalizeShoppingIntent(
    plan().shopping_intent,
    normalizeAgentInput({user_input: "出去玩", gender: "female"}),
  );
  const top = intent.slots[0];
  assert.equal(hardGateCandidate(product("top", 1, "女款方领上衣"), top, intent).status, "PASS");
  assert.deepEqual(
    hardGateCandidate(product("top", 2, "男士商务衬衫"), top, intent).reason_codes,
    ["WRONG_GENDER"],
  );
  assert.ok(hardGateCandidate(product("bottom", 3, "女款直筒裤"), top, intent)
    .reason_codes.includes("WRONG_CATEGORY"));
  assert.ok(hardGateCandidate(product("top", 4, "女士家居服睡衣"), top, intent)
    .reason_codes.includes("UNDERWEAR_OR_HOMEWEAR"));
});

test("selector candidate ID invariant rejects missing, duplicate and foreign IDs", () => {
  const values = [
    {...product("top", 1, "女款上衣"), candidate_id: "candidate_001"},
    {...product("top", 2, "女款衬衫"), candidate_id: "candidate_002"},
  ];
  const assessment = (candidateId) => ({
    candidate_id: candidateId,
    status: "KEEP",
    selection_tier: "HIGH",
    scores: selectorScores(90),
    reason_codes: [],
  });
  const selection = (assessments) => ({
    assessments,
    quality_sufficient: true,
    refinement_needed: false,
    refinement_reasons: [],
    candidate_pool_homogeneity: "LOW",
    refinement_query: "女款设计感上衣",
  });
  assert.throws(
    () => validateProductSelection(selection([assessment("candidate_001")]), values),
    ShoppingAgentV1Error,
  );
  assert.throws(
    () => validateProductSelection(selection([
      assessment("candidate_001"), assessment("candidate_999"),
    ]), values),
    ShoppingAgentV1Error,
  );
  const wrapped = parseAiJson(aiResponse(JSON.stringify([{
    ...selection([assessment("candidate_001"), assessment("candidate_999")]),
  }])), {allowSingleAssessmentWrapper: true});
  assert.throws(
    () => validateProductSelection(wrapped, values),
    ShoppingAgentV1Error,
  );
});

test("composer rejects candidate IDs outside the real candidate pools", () => {
  const pools = ["top", "bottom", "shoes"].map((category, index) => ({
    slot: {category},
    final_candidate_pool: [{
      ...product(category, 1, `${category} product`),
      candidate_id: `candidate_00${index + 1}`,
    }],
  }));
  const result = validateComposedLooks({looks: [{
    look_id: "look-1",
    top_candidate_id: "candidate_999",
    bottom_candidate_id: "candidate_002",
    shoes_candidate_id: "candidate_003",
    scores: composerScores(90),
  }]}, pools);
  assert.equal(result.looks.length, 0);
  assert.equal(result.invalid_candidate_reference.length, 1);
  assert.deepEqual(result.invalid_candidate_reference[0].categories, ["top"]);
  assert.deepEqual(result.candidate_reference_audit[0], {
    look_id: "look-1",
    requested_top_id: "candidate_999",
    requested_bottom_id: "candidate_002",
    requested_shoes_id: "candidate_003",
    top_id_valid: false,
    bottom_id_valid: true,
    shoes_id_valid: true,
    error_code: "COMPOSER_INVALID_CANDIDATE_REFERENCE",
  });
});

test("composer validates candidate references against each slot whitelist", () => {
  const pools = ["top", "bottom", "shoes"].map((category) => ({
    slot: {category},
    final_candidate_pool: [1, 2, 3].map((index) => ({
      ...product(category, index, `${category} product ${index}`),
      candidate_id: `${category}_${index}`,
    })),
  }));
  const look = (lookId, topId, bottomId, shoesId) => ({
    look_id: lookId,
    top_candidate_id: topId,
    bottom_candidate_id: bottomId,
    shoes_candidate_id: shoesId,
    scores: composerScores(82),
  });

  const valid = validateComposedLooks({looks: [
    look("look-1", "top_1", "bottom_1", "shoes_1"),
    look("look-2", "top_2", "bottom_2", "shoes_2"),
    look("look-3", "top_3", "bottom_3", "shoes_3"),
  ]}, pools);
  assert.equal(valid.looks.length, 3);
  assert.equal(valid.invalid_candidate_reference.length, 0);
  assert.ok(valid.candidate_reference_audit.every((item) =>
    item.top_id_valid && item.bottom_id_valid && item.shoes_id_valid));

  const crossSlot = validateComposedLooks({looks: [
    look("top-cross-slot", "bottom_1", "bottom_1", "shoes_1"),
    look("bottom-missing", "top_1", "candidate_missing", "shoes_1"),
    look("shoes-cross-slot", "top_1", "bottom_1", "top_1"),
  ]}, pools);
  assert.equal(crossSlot.looks.length, 0);
  assert.deepEqual(
    crossSlot.invalid_candidate_reference.map((item) => item.categories),
    [["top"], ["bottom"], ["shoes"]],
  );
  assert.ok(crossSlot.candidate_reference_audit.every((item) =>
    item.error_code === "COMPOSER_INVALID_CANDIDATE_REFERENCE"));

  const mixed = validateComposedLooks({looks: [
    look("look-1", "top_1", "bottom_1", "shoes_1"),
    look("bad-look", "bottom_2", "bottom_2", "shoes_2"),
    look("look-3", "top_3", "bottom_3", "shoes_3"),
  ]}, pools);
  assert.equal(mixed.looks.length, 2);
  assert.equal(mixed.invalid_candidate_reference.length, 1);
  assert.deepEqual(mixed.invalid_candidate_reference[0].categories, ["top"]);
});

test("composer rejects an explicitly cross-gender candidate even when its ID is allowed", () => {
  const pools = ["top", "bottom", "shoes"].map((category) => ({
    slot: {category, gender: "female"},
    final_candidate_pool: [{
      ...product(
        category,
        1,
        category === "top" ? "男士修身短袖T恤" : `女款${category}商品`,
      ),
      candidate_id: `${category}_1`,
    }],
  }));
  const result = validateComposedLooks({looks: [{
    look_id: "look-gender-conflict",
    top_candidate_id: "top_1",
    bottom_candidate_id: "bottom_1",
    shoes_candidate_id: "shoes_1",
    scores: composerScores(82),
  }]}, pools, {authoritativeGender: "female"});
  assert.equal(result.looks.length, 0);
  assert.equal(
    result.invalid_candidate_reference[0].error_code,
    "SHOPPING_AGENT_GENDER_CONTEXT_DRIFT",
  );
  assert.equal(
    result.candidate_reference_audit[0].error_code,
    "SHOPPING_AGENT_GENDER_CONTEXT_DRIFT",
  );
});

test("default female ranking demotes an all-neutral Look without feminine evidence", () => {
  const structuredCandidate = (category, id, axes) => ({
    ...product(category, id, `${category} plain product`),
    candidate_id: `${category}_${id}`,
    brand: `arbitrary-brand-${id}`,
    variation_axes: axes,
  });
  const pools = [
    {slot: {category: "top", gender: "female"}, final_candidate_pool: [
      structuredCandidate("top", "neutral", {
        top_family: "tshirt", top_silhouette: "relaxed", expression: "clean",
      }),
      structuredCandidate("top", "shaped", {
        top_family: "knit_top", top_silhouette: "fitted", expression: "clean",
      }),
    ]},
    {slot: {category: "bottom", gender: "female"}, final_candidate_pool: [
      structuredCandidate("bottom", "neutral", {
        bottom_family: "straight_pants", expression: "minimal",
      }),
      structuredCandidate("bottom", "mixed", {
        bottom_family: "straight_pants", expression: "clean",
      }),
    ]},
    {slot: {category: "shoes", gender: "female"}, final_candidate_pool: [
      structuredCandidate("shoes", "neutral", {
        shoe_family: "sneaker", expression: "sporty",
      }),
      structuredCandidate("shoes", "mixed", {
        shoe_family: "loafer", expression: "clean",
      }),
    ]},
  ];
  const look = (lookId, suffix) => ({
    look_id: lookId,
    top_candidate_id: `top_${suffix === "neutral" ? "neutral" : "shaped"}`,
    bottom_candidate_id: `bottom_${suffix}`,
    shoes_candidate_id: `shoes_${suffix}`,
    scores: composerScores(80),
  });
  const result = validateComposedLooks({looks: [
    look("all-neutral-first", "neutral"),
    look("feminine-evidence-second", "mixed"),
  ]}, pools, {
    authoritativeGender: "female",
    personaExpression: "feminine_or_neutral_feminine",
  });
  assert.deepEqual(result.looks.map((item) => item.look_id), [
    "feminine-evidence-second", "all-neutral-first",
  ]);
  assert.equal(result.looks[1].female_expression_status, "DEPRIORITIZED_ALL_NEUTRAL");
});

test("female expression ranking permits one or two neutral items when the Look has evidence", () => {
  const pools = [
    {slot: {category: "top", gender: "female"}, final_candidate_pool: [{
      ...product("top", 71, "plain top"), candidate_id: "random_top",
      variation_axes: {top_family: "knit_top", top_silhouette: "fitted", expression: "clean"},
    }]},
    {slot: {category: "bottom", gender: "female"}, final_candidate_pool: [{
      ...product("bottom", 72, "plain bottom"), candidate_id: "random_bottom",
      variation_axes: {bottom_family: "straight_pants", expression: "minimal"},
    }]},
    {slot: {category: "shoes", gender: "female"}, final_candidate_pool: [{
      ...product("shoes", 73, "plain shoes"), candidate_id: "random_shoes",
      variation_axes: {shoe_family: "sneaker", expression: "sporty"},
    }]},
  ];
  const result = validateComposedLooks({looks: [{
    look_id: "mixed-expression", top_candidate_id: "random_top",
    bottom_candidate_id: "random_bottom", shoes_candidate_id: "random_shoes",
    scores: composerScores(79),
  }]}, pools, {
    authoritativeGender: "female",
    personaExpression: "feminine_or_neutral_feminine",
  });
  assert.equal(result.looks[0].female_expression_status, "PASS");
});

test("explicit neutral female intent and male or unisex paths preserve composer order", () => {
  const poolsFor = (gender) => ["top", "bottom", "shoes"].map((category) => ({
    slot: {category, gender},
    final_candidate_pool: ["a", "b"].map((id) => ({
      ...product(category, id, `${category} product ${id}`),
      candidate_id: `${category}_${id}`,
      variation_axes: category === "top"
        ? {top_family: "tshirt", top_silhouette: "relaxed", expression: "clean"}
        : category === "bottom"
          ? {bottom_family: "straight_pants", expression: "minimal"}
          : {shoe_family: "sneaker", expression: "sporty"},
    })),
  }));
  const looks = ["a", "b"].map((id) => ({
    look_id: `look-${id}`, top_candidate_id: `top_${id}`,
    bottom_candidate_id: `bottom_${id}`, shoes_candidate_id: `shoes_${id}`,
    scores: composerScores(77),
  }));
  for (const [gender, personaExpression] of [
    ["female", "neutral_feminine"],
    ["male", "masculine_or_neutral_masculine"],
    ["unisex", "neutral"],
  ]) {
    const result = validateComposedLooks({looks}, poolsFor(gender), {
      authoritativeGender: gender, personaExpression,
    });
    assert.deepEqual(result.looks.map((item) => item.look_id), ["look-a", "look-b"]);
    assert.ok(result.looks.every((item) => item.female_expression_status === "NOT_APPLICABLE"));
  }
});

test("Availability First keeps candidate-different Looks with limited structural diversity", () => {
  const pools = [
    {
      slot: {category: "top"},
      final_candidate_pool: [
        {...product("top", 1, "女款短款修身针织衫"), candidate_id: "top_1"},
        {...product("top", 2, "女款另一品牌短款修身针织衫"), candidate_id: "top_2"},
      ],
    },
    {
      slot: {category: "bottom"},
      final_candidate_pool: [
        {...product("bottom", 1, "女款高腰直筒牛仔裤"), candidate_id: "bottom_1"},
        {...product("bottom", 2, "女款另一品牌高腰直筒牛仔裤"), candidate_id: "bottom_2"},
      ],
    },
    {
      slot: {category: "shoes"},
      final_candidate_pool: [
        {...product("shoes", 1, "女款灰色德训鞋"), candidate_id: "shoes_1"},
        {...product("shoes", 2, "女款银色德训鞋"), candidate_id: "shoes_2"},
      ],
    },
  ];
  const looks = [1, 2].map((index) => ({
    look_id: `look-${index}`,
    top_candidate_id: `top_${index}`,
    bottom_candidate_id: `bottom_${index}`,
    shoes_candidate_id: `shoes_${index}`,
    scores: composerScores(76),
  }));
  const result = validateComposedLooks({looks}, pools);
  assert.equal(result.looks.length, 2);
  assert.equal(result.structural_duplicate.length, 1);
  assert.equal(result.structural_duplicate[0].error_code, "STRUCTURAL_DUPLICATE");
  assert.equal(result.structural_duplicate[0].fatal, false);
  assert.equal(result.structural_duplicate_detected, true);
  assert.equal(result.exact_duplicate_detected, false);
  assert.equal(result.look_diversity_status, "LIMITED");
  assert.deepEqual(
    result.looks.map((look) => look.structural_diversity_status),
    ["PASS", "LIMITED"],
  );
  assert.equal(result.diversity_insufficient, true);
});

test("Availability First still rejects an exact candidate combination duplicate", () => {
  const pools = ["top", "bottom", "shoes"].map((category) => ({
    slot: {category},
    final_candidate_pool: [{
      ...product(category, 1, `${category} product`),
      candidate_id: `${category}_1`,
    }],
  }));
  const look = (lookId) => ({
    look_id: lookId,
    top_candidate_id: "top_1",
    bottom_candidate_id: "bottom_1",
    shoes_candidate_id: "shoes_1",
    scores: composerScores(76),
  });
  const result = validateComposedLooks({looks: [look("look-1"), look("look-2")]}, pools);
  assert.equal(result.looks.length, 1);
  assert.equal(result.exact_duplicate.length, 1);
  assert.equal(result.exact_duplicate[0].error_code, "EXACT_DUPLICATE");
  assert.equal(result.exact_duplicate_detected, true);
});

test("Phase 2.5 accepts a real bottom or shoe family variation in one aesthetic", () => {
  const pools = [
    {
      slot: {category: "top"},
      final_candidate_pool: [
        {...product("top", 1, "女款短款修身针织衫"), candidate_id: "top_1"},
        {...product("top", 2, "女款短款修身针织衫 米白"), candidate_id: "top_2"},
      ],
    },
    {
      slot: {category: "bottom"},
      final_candidate_pool: [
        {...product("bottom", 1, "女款高腰直筒牛仔裤"), candidate_id: "bottom_1"},
        {...product("bottom", 2, "女款高腰A字半身裙"), candidate_id: "bottom_2"},
      ],
    },
    {
      slot: {category: "shoes"},
      final_candidate_pool: [
        {...product("shoes", 1, "女款灰色德训鞋"), candidate_id: "shoes_1"},
        {...product("shoes", 2, "女款轻便乐福鞋"), candidate_id: "shoes_2"},
      ],
    },
  ];
  const looks = [1, 2].map((index) => ({
    look_id: `look-${index}`,
    top_candidate_id: `top_${index}`,
    bottom_candidate_id: `bottom_${index}`,
    shoes_candidate_id: `shoes_${index}`,
    scores: composerScores(78),
  }));
  const result = validateComposedLooks({looks}, pools);
  assert.equal(result.looks.length, 2);
  assert.equal(result.structural_duplicate.length, 0);
  assert.equal(result.diversity_insufficient, false);
});

test("Phase 2.5 reports a homogeneous candidate pool as a diversity gap", () => {
  const pool = [1, 2, 3].map((index) => ({
    ...product("shoes", index, `女款${index}号灰色德训鞋`),
    candidate_id: `shoes_${index}`,
  }));
  const diversity = candidatePoolDiversity(pool, "shoes");
  assert.equal(diversity.evidence_sufficient, true);
  assert.equal(diversity.unique_structure_count, 1);
  assert.equal(diversity.diversity_insufficient, true);
  const decision = refinementDecision({
    selector_keep: 3,
    top_candidate_quality: 82,
    candidate_pool_homogeneity: "LOW",
    quality_sufficient: true,
    refinement_needed: false,
    refinement_reasons: [],
    refinement_query: "女款 简洁芭蕾鞋",
    query: "女款 灰色德训鞋",
    slot: {category: "shoes", search_query: "女款 灰色德训鞋"},
    diversity,
  }, {shoppingIntent: plan().shopping_intent});
  assert.equal(decision.needed, true);
  assert.ok(decision.reasons.includes("DIVERSITY_GAP"));
});

test("server is the sole refinement authority and selector suggestion is advisory", () => {
  const shoppingIntent = plan().shopping_intent;
  const base = {
    selector_keep: 3,
    top_candidate_quality: 82,
    candidate_pool_homogeneity: "LOW",
    quality_sufficient: true,
    selector_refinement_suggested: true,
    refinement_needed: true,
    refinement_reasons: ["SELECTOR_WANTS_MORE"],
    refinement_query: "女款 设计感 上衣",
    query: shoppingIntent.slots[0].search_query,
    slot: shoppingIntent.slots[0],
    diversity: {diversity_insufficient: false},
  };
  const notRequired = refinementDecision(base, {shoppingIntent});
  assert.equal(notRequired.selector_refinement_suggested, true);
  assert.equal(notRequired.server_refinement_required, false);
  assert.equal(notRequired.refinement_query_source, "NONE");
  assert.equal(notRequired.query, "");
  const budgetExhausted = refinementDecision({
    ...base,
    top_candidate_quality: 60,
  }, {shoppingIntent, maxRefinementRounds: 0});
  assert.equal(budgetExhausted.server_refinement_required, false);

  const required = refinementDecision({
    ...base,
    top_candidate_quality: 70,
  }, {shoppingIntent});
  assert.equal(required.server_refinement_required, true);
  assert.equal(required.refinement_query_source, "SELECTOR");
  assert.equal(required.query, "女款 设计感 上衣");
});

test("server builder supplies a valid query when diversity requires refinement", () => {
  const shoppingIntent = plan().shopping_intent;
  const decision = refinementDecision({
    selector_keep: 3,
    top_candidate_quality: 82,
    candidate_pool_homogeneity: "LOW",
    quality_sufficient: true,
    selector_refinement_suggested: false,
    refinement_needed: false,
    refinement_reasons: [],
    refinement_query: "",
    query: shoppingIntent.slots[2].search_query,
    slot: shoppingIntent.slots[2],
    diversity: {diversity_insufficient: true},
  }, {shoppingIntent});
  assert.equal(decision.server_refinement_required, true);
  assert.equal(decision.selector_refinement_suggested, false);
  assert.equal(decision.refinement_query_source, "SERVER_BUILDER");
  assert.equal(decision.canonical_category, "shoes");
  assert.match(decision.query, /女/);
  assert.notEqual(
    decision.query.replace(/\s/g, ""),
    shoppingIntent.slots[2].search_query.replace(/\s/g, ""),
  );
});

test("refinement builder and validation failures use their own stage and codes", () => {
  const shoppingIntent = plan().shopping_intent;
  const selection = {
    selector_keep: 2,
    top_candidate_quality: 70,
    candidate_pool_homogeneity: "LOW",
    selector_refinement_suggested: false,
    refinement_needed: false,
    refinement_query: "",
    query: shoppingIntent.slots[0].search_query,
    slot: shoppingIntent.slots[0],
    diversity: {diversity_insufficient: false},
  };
  assert.throws(
    () => refinementDecision(selection, {shoppingIntent, queryBuilder: () => ""}),
    (error) => error.code === "REFINEMENT_QUERY_GENERATION_FAILED" &&
      error.details.phase === "product_selector_refinement",
  );
  assert.throws(
    () => refinementDecision({
      ...selection,
      selector_refinement_suggested: true,
      refinement_needed: true,
      refinement_query: "男士短袖衬衫",
    }, {shoppingIntent}),
    (error) => error.code === "REFINEMENT_QUERY_VALIDATION_FAILED" &&
      error.details.phase === "product_selector_refinement" &&
      error.details.validation_error_kind === "REFINEMENT_QUERY_GENDER_MISMATCH",
  );
  assert.throws(
    () => refinementDecision({
      ...selection,
      refinement_query: "女款高腰牛仔裤",
    }, {shoppingIntent}),
    (error) => error.code === "REFINEMENT_QUERY_VALIDATION_FAILED" &&
      error.details.validation_error_kind === "REFINEMENT_QUERY_CATEGORY_MISMATCH",
  );
});

test("Composer scores require raw finite JSON numbers from 0 through 100", () => {
  const pools = ["top", "bottom", "shoes"].map((category) => ({
    slot: {category},
    final_candidate_pool: [{
      ...product(category, 1, `${category} product`),
      candidate_id: `${category}_1`,
    }],
  }));
  const compose = (scores, onScoreError) => validateComposedLooks({looks: [{
    look_id: "look-score-contract",
    top_candidate_id: "top_1",
    bottom_candidate_id: "bottom_1",
    shoes_candidate_id: "shoes_1",
    scores,
  }]}, pools, {onScoreError});

  const boundaryScores = composerScores(95);
  boundaryScores.aesthetic_coherence = 0;
  boundaryScores.final_score = 100;
  const valid = compose(boundaryScores);
  assert.equal(valid.looks[0].scores.aesthetic_coherence, 0);
  assert.equal(valid.looks[0].scores.proportion_balance, 95);
  assert.equal(valid.looks[0].scores.final_score, 100);

  const invalidCases = [
    {label: "numeric string", value: "95", kind: "NON_NUMERIC_SCORE", type: "string"},
    {label: "ratio string", value: "95/100", kind: "NON_NUMERIC_SCORE", type: "string"},
    {label: "percentage string", value: "95%", kind: "NON_NUMERIC_SCORE", type: "string"},
    {label: "above range", value: 105, kind: "SCORE_ABOVE_100", type: "number"},
    {label: "below range", value: -1, kind: "SCORE_BELOW_ZERO", type: "number"},
    {label: "null", value: null, kind: "NON_NUMERIC_SCORE", type: "null"},
    {label: "NaN", value: Number.NaN, kind: "NON_FINITE_SCORE", type: "number"},
    {label: "Infinity", value: Number.POSITIVE_INFINITY, kind: "NON_FINITE_SCORE", type: "number"},
  ];
  for (const item of invalidCases) {
    const scores = composerScores(80);
    scores.aesthetic_coherence = item.value;
    let diagnostic;
    let error;
    try {
      compose(scores, (entry) => { diagnostic = entry; });
    } catch (caught) {
      error = caught;
    }
    assert.ok(error, item.label);
    assert.equal(error.code, "SHOPPING_AGENT_SCHEMA_INVALID", item.label);
    assert.equal(error.details.score_error_kind, item.kind, item.label);
    assert.equal(error.details.look_id, "look-score-contract", item.label);
    assert.equal(error.details.score_field, "aesthetic_coherence", item.label);
    assert.equal(error.details.raw_type, item.type, item.label);
    assert.deepEqual(diagnostic, {
      look_id: "look-score-contract",
      score_field: "aesthetic_coherence",
      raw_type: item.type,
      raw_value: Number.isNaN(item.value)
        ? "NaN"
        : item.value === Number.POSITIVE_INFINITY
          ? "Infinity"
          : item.value,
      score_error_kind: item.kind,
    }, item.label);
  }

  const missingScores = composerScores(80);
  delete missingScores.aesthetic_coherence;
  let missingDiagnostic;
  assert.throws(
    () => compose(missingScores, (entry) => { missingDiagnostic = entry; }),
    (error) => error.code === "SHOPPING_AGENT_SCHEMA_INVALID" &&
      error.details.score_error_kind === "MISSING_SCORE" &&
      error.details.raw_type === "missing" &&
      error.details.raw_value === null,
  );
  assert.equal(missingDiagnostic.score_error_kind, "MISSING_SCORE");
});

test("Composer wrapper keeps references strict and uses existing candidates for availability", async () => {
  const wrappedAgent = new TaobaoShoppingAgentV1({
    client: new FakeAiClient({wrapComposer: true}),
    model: "qwen3.7-plus",
    productProvider: new FakeProvider(),
    logger: {info() {}},
  });
  const wrappedResult = await wrappedAgent.run({
    user_input: "我要出去玩，帮我搭配一套",
    authoritative_gender: "female",
  });
  assert.equal(wrappedResult.final_look_count, 2);

  const foreignAgent = new TaobaoShoppingAgentV1({
    client: new FakeAiClient({foreignComposerId: true, wrapComposer: true}),
    model: "qwen3.7-plus",
    productProvider: new FakeProvider(),
    logger: {info() {}},
  });
  const foreignResult = await foreignAgent.run({
    user_input: "出去玩",
    authoritative_gender: "female",
  });
  assert.equal(foreignResult.final_look_count, 3);
  assert.equal(foreignResult.invalid_candidate_reference.length, 1);
  assert.equal(foreignResult.availability_fallback_used, true);

  const oneLookAgent = new TaobaoShoppingAgentV1({
    client: new FakeAiClient({composerLookCount: 1, wrapComposer: true}),
    model: "qwen3.7-plus",
    productProvider: new FakeProvider(),
    logger: {info() {}},
  });
  const oneLookResult = await oneLookAgent.run({
    user_input: "出去玩",
    authoritative_gender: "female",
  });
  assert.ok(oneLookResult.final_look_count >= 2);
  assert.equal(oneLookResult.availability_fallback_used, true);

  const directForeignAgent = new TaobaoShoppingAgentV1({
    client: new FakeAiClient({foreignComposerId: true, directComposerArray: true}),
    model: "qwen3.7-plus",
    productProvider: new FakeProvider(),
    logger: {info() {}},
  });
  const directForeignResult = await directForeignAgent.run({
    user_input: "出去玩",
    authoritative_gender: "female",
  });
  assert.ok(directForeignResult.final_look_count >= 2);
  assert.equal(directForeignResult.invalid_candidate_reference.length, 1);
  assert.equal(directForeignResult.availability_fallback_used, true);

  const directOneLookAgent = new TaobaoShoppingAgentV1({
    client: new FakeAiClient({composerLookCount: 1, directComposerArray: true}),
    model: "qwen3.7-plus",
    productProvider: new FakeProvider(),
    logger: {info() {}},
  });
  const directOneLookResult = await directOneLookAgent.run({
    user_input: "出去玩",
    authoritative_gender: "female",
  });
  assert.ok(directOneLookResult.final_look_count >= 2);
  assert.equal(directOneLookResult.availability_fallback_used, true);

  const directDuplicateAgent = new TaobaoShoppingAgentV1({
    client: new FakeAiClient({directComposerArray: true, duplicateComposerCombination: true}),
    model: "qwen3.7-plus",
    productProvider: new FakeProvider(),
    logger: {info() {}},
  });
  const directDuplicateResult = await directDuplicateAgent.run({
    user_input: "出去玩",
    authoritative_gender: "female",
  });
  assert.ok(directDuplicateResult.final_look_count >= 2);
  assert.equal(directDuplicateResult.exact_duplicate_detected, true);
  assert.equal(directDuplicateResult.availability_fallback_used, true);
});

test("Availability First fails only when the real pools cannot form two exact combinations", async () => {
  class SingleCombinationProvider extends FakeProvider {
    async searchShoppingAgentCandidates(input) {
      this.calls.push(input);
      const products = [candidates(input.category)[0]];
      return {products, raw_count: 1, valid_count: 1};
    }
  }
  const agent = new TaobaoShoppingAgentV1({
    client: new FakeAiClient({composerLookCount: 1}),
    model: "qwen3.7-plus",
    productProvider: new SingleCombinationProvider(),
    logger: {info() {}, warn() {}},
  });
  await assert.rejects(
    () => agent.run({user_input: "出去玩", authoritative_gender: "female"}),
    (error) => error.code === "SHOPPING_AGENT_INSUFFICIENT_LOOKS",
  );
});

test("minimal proof uses exactly five AI calls, three Taobao calls and real IDs", async () => {
  const client = new FakeAiClient();
  const provider = new FakeProvider();
  const agent = new TaobaoShoppingAgentV1({
    client,
    model: "qwen3.7-plus",
    productProvider: provider,
    logger: {info() {}},
  });
  const result = await agent.run({
    user_input: "我要出去玩，帮我搭配一套",
    authoritative_gender: "female",
    height: 160,
    weight: 49,
    occasion: "出去玩",
  });
  assert.equal(result.ai_call_count, 5);
  assert.equal(result.taobao_call_count, 3);
  const composerCall = client.calls.find((call) =>
    call.response_format.type === "json_object");
  const structuredCalls = client.calls.filter((call) =>
    call.response_format.type === "json_schema");
  assert.ok(composerCall);
  assert.deepEqual(composerCall.response_format, {type: "json_object"});
  assert.equal(structuredCalls.length, 4);
  assert.ok(structuredCalls.every((call) => call.response_format.json_schema.strict === true));
  assert.ok(structuredCalls.every((call) => call.response_format.json_schema.schema));
  const composerInput = JSON.parse(composerCall.messages[1].content[0].text);
  assert.match(composerInput.instruction, /JSON number/);
  assert.match(composerInput.instruction, /"final_score":78/);
  assert.match(composerInput.instruction, /0到1或0到10归一化表达/);
  for (const category of ["top", "bottom", "shoes"]) {
    const allowedIds = composerInput[`${category.toUpperCase()}_ALLOWED_IDS`];
    const candidates = composerInput.candidate_pools[category];
    assert.deepEqual(allowedIds, candidates.map((candidate) => candidate.candidate_id));
    assert.ok(candidates.every((candidate) =>
      typeof candidate.title === "string" &&
      typeof candidate.image === "string" &&
      Number.isFinite(candidate.price) &&
      candidate.scores && typeof candidate.scores === "object"));
  }
  assert.equal(result.state, "success");
  assert.equal(provider.calls.length, 3);
  assert.equal(result.final_look_count, 2);
  assert.equal(result.invalid_candidate_reference.length, 0);
  assert.ok(Object.values(result.candidate_pools).flat().every((item) =>
    /^candidate_\d{3}$/.test(item.candidate_id)));
  assert.notDeepEqual(result.looks[0].candidate_ids, result.looks[1].candidate_ids);
  assert.ok(result.looks.every((look) =>
    Object.values(look.items).every((item) => item.source === "taobao" && item.is_mock === false)));
  assert.ok(result.slot_metrics.every((slot) => slot.candidate_gate_fail >= 2));
});

test("planner AI failure uses deterministic User Truth fallback without extra AI calls", async () => {
  const client = new FakeAiClient({failPlanner: true});
  const agent = new TaobaoShoppingAgentV1({
    client,
    model: "qwen3.7-plus",
    productProvider: new FakeProvider(),
    logger: {info() {}, warn() {}},
  });
  const result = await agent.run({
    user_input: "我要出去玩，帮我搭配一套",
    authoritative_gender: "female",
  });

  assert.equal(result.state, "success");
  assert.equal(result.planner_fallback_used, true);
  assert.equal(result.authoritative_gender, "female");
  assert.ok(result.final_look_count >= 2);
  assert.equal(result.ai_call_count, 5);
  assert.ok(result.search_queries.top.includes("女"));
});

test("Composer AI failure uses existing candidate pools and preserves invariants", async () => {
  const client = new FakeAiClient({failComposer: true});
  const agent = new TaobaoShoppingAgentV1({
    client,
    model: "qwen3.7-plus",
    productProvider: new FakeProvider(),
    logger: {info() {}, warn() {}},
  });
  const result = await agent.run({
    user_input: "我要出去玩，帮我搭配一套",
    authoritative_gender: "female",
  });

  assert.equal(result.state, "success");
  assert.equal(result.composer_fallback_used, true);
  assert.ok(result.final_look_count >= 2);
  assert.deepEqual(result.invalid_candidate_reference, []);
  assert.ok(result.looks.every((look) =>
    ["top", "bottom", "shoes"].every((slot) =>
      result.candidate_pools[slot].some((candidate) =>
        candidate.candidate_id === look.items[slot].candidate_id))));
});

test("selector slots settle independently and a timed-out shoes call uses gated fallback", async () => {
  class ShoesTimeoutClient extends FakeAiClient {
    async create(input) {
      const name = input.response_format.type === "json_object"
        ? "fitai_real_product_outfit_composer"
        : input.response_format.json_schema.name;
      if (name === "fitai_product_selector_shoes") {
        this.calls.push(input);
        const error = new Error("shoes selector timed out");
        error.code = "ETIMEDOUT";
        throw error;
      }
      return super.create(input);
    }
  }
  class LargeShoesProvider extends FakeProvider {
    async searchShoppingAgentCandidates(input) {
      this.calls.push(input);
      if (input.category !== "shoes") {
        const products = candidates(input.category);
        return {products, raw_count: products.length, valid_count: products.length};
      }
      const families = ["浅口芭蕾鞋", "轻便乐福鞋", "低跟玛丽珍鞋"];
      const products = Array.from({length: 27}, (_, index) => ({
        ...product("shoes", index + 1, `女款${families[index % families.length]}${index + 1}`),
        product_aesthetic_score: 82 - (index % 3),
        style_match_score: 84 - (index % 3),
        body_strategy_match_score: 80,
        relevance_score: 86 - (index % 3),
        shoe_refinement_score: 82,
        visual_weight_score: 84,
        material_quality_score: 81,
        hardware_quality_score: 80,
        proportion_score: 83,
      }));
      return {products, raw_count: products.length, valid_count: products.length};
    }
  }

  const logs = [];
  const agent = new TaobaoShoppingAgentV1({
    client: new ShoesTimeoutClient(),
    model: "qwen3.7-plus",
    productProvider: new LargeShoesProvider(),
    logger: {
      info(event, details) { logs.push({event, details}); },
      warn(event, details) { logs.push({event, details}); },
    },
  });
  const result = await agent.run({user_input: "出去玩", authoritative_gender: "female"});
  const byCategory = Object.fromEntries(result.slot_metrics.map((slot) => [
    slot.category,
    slot,
  ]));

  assert.equal(result.state, "success");
  assert.equal(result.final_look_count, 2);
  assert.equal(byCategory.top.selector_status, "SUCCESS");
  assert.equal(byCategory.bottom.selector_status, "SUCCESS");
  assert.equal(byCategory.shoes.selector_status, "FALLBACK_USED");
  assert.equal(byCategory.shoes.selector_ai_status, "AI_TIMEOUT");
  assert.equal(byCategory.shoes.selector_error_code, "SELECTOR_AI_TIMEOUT");
  assert.equal(byCategory.shoes.selector_fallback_used, true);
  assert.equal(byCategory.shoes.selector_fallback_candidate_count, 3);
  assert.equal(result.candidate_pools.shoes.length, 3);
  assert.equal(result.per_slot_selector_summary.length, 3);
  assert.equal(result.per_slot_selector_summary.find((slot) =>
    slot.category === "shoes").gate_pass_count, 27);
  assert.equal(result.per_slot_selector_summary.find((slot) =>
    slot.category === "top").selector_error_code, null);
  assert.equal(logs.filter(({event}) => event === "per_slot_selector_summary").length, 3);
});

test("two Gate PASS candidates survive a Selector timeout as a two-item fallback", async () => {
  const result = await new TaobaoShoppingAgentV1({
    client: new SlotSelectorTimeoutClient("top"),
    model: "qwen3.7-plus",
    productProvider: new LimitedGateProvider({top: 2}),
    logger: {info() {}, warn() {}},
  }).run({user_input: "出去玩", authoritative_gender: "female"});
  const top = result.slot_metrics.find((slot) => slot.category === "top");

  assert.equal(result.state, "success");
  assert.equal(top.candidate_gate_pass, 2);
  assert.equal(top.selector_status, "FALLBACK_USED");
  assert.equal(top.selector_fallback_candidate_count, 2);
  assert.equal(result.candidate_pools.top.length, 2);
  assert.ok(result.final_look_count >= 2);
});

test("one Gate PASS candidate can combine with other slots after Selector timeout", async () => {
  const result = await new TaobaoShoppingAgentV1({
    client: new SlotSelectorTimeoutClient("top", {failComposer: true}),
    model: "qwen3.7-plus",
    productProvider: new LimitedGateProvider({top: 1, bottom: 3, shoes: 3}),
    logger: {info() {}, warn() {}},
  }).run({user_input: "出去玩", authoritative_gender: "female"});
  const top = result.slot_metrics.find((slot) => slot.category === "top");
  const combinations = new Set(result.looks.map((look) =>
    [look.items.top.candidate_id, look.items.bottom.candidate_id,
      look.items.shoes.candidate_id].join("|")));

  assert.equal(result.state, "success");
  assert.equal(top.candidate_gate_pass, 1);
  assert.equal(top.selector_status, "FALLBACK_USED");
  assert.equal(top.selector_fallback_candidate_count, 1);
  assert.equal(result.candidate_pools.top.length, 1);
  assert.equal(result.candidate_pools.bottom.length, 3);
  assert.equal(result.candidate_pools.shoes.length, 3);
  assert.ok(result.final_look_count >= 2);
  assert.ok(combinations.size >= 2);
  assert.equal(result.composer_fallback_used, true);
});

test("a selector timeout cannot revive an AI-rejected candidate from another slot", async () => {
  class RejectTopAndTimeoutShoesClient extends FakeAiClient {
    constructor() {
      super();
      this.rejectedTopId = null;
    }

    async create(input) {
      const name = input.response_format.type === "json_object"
        ? "fitai_real_product_outfit_composer"
        : input.response_format.json_schema.name;
      if (name === "fitai_product_selector_shoes") {
        this.calls.push(input);
        const error = new Error("temporary connection reset");
        error.code = "ECONNRESET";
        throw error;
      }
      if (name === "fitai_product_selector_top") {
        this.calls.push(input);
        const metadata = JSON.parse(input.messages[1].content[0].text);
        this.rejectedTopId = metadata.candidates[0].candidate_id;
        const payload = {
          assessments: metadata.candidates.map((candidate, index) => ({
            candidate_id: candidate.candidate_id,
            status: index === 0 ? "REJECT" : "KEEP",
            selection_tier: index === 0 ? "NONE" : "HIGH",
            scores: selectorScores(84 - index),
            reason_codes: index === 0 ? ["AI_VISUAL_REJECT"] : [],
          })),
          quality_sufficient: true,
          refinement_needed: false,
          refinement_reasons: [],
          candidate_pool_homogeneity: "LOW",
          refinement_query: "",
        };
        return {choices: [{finish_reason: "stop", message: {content: JSON.stringify(payload)}}]};
      }
      return super.create(input);
    }
  }
  class PreScoredProvider extends FakeProvider {
    async searchShoppingAgentCandidates(input) {
      this.calls.push(input);
      const products = candidates(input.category).map((item) => input.category === "shoes" ? {
        ...item,
        product_aesthetic_score: 82,
        style_match_score: 82,
        body_strategy_match_score: 82,
        relevance_score: 82,
        shoe_refinement_score: 82,
        visual_weight_score: 82,
        material_quality_score: 82,
        hardware_quality_score: 82,
        proportion_score: 82,
      } : item);
      return {products, raw_count: products.length, valid_count: products.length};
    }
  }

  const client = new RejectTopAndTimeoutShoesClient();
  const result = await new TaobaoShoppingAgentV1({
    client,
    model: "qwen3.7-plus",
    productProvider: new PreScoredProvider(),
    logger: {info() {}, warn() {}},
  }).run({user_input: "出去玩", authoritative_gender: "female"});

  assert.equal(result.state, "success");
  assert.ok(client.rejectedTopId);
  assert.ok(!result.candidate_pools.top.some((candidate) =>
    candidate.candidate_id === client.rejectedTopId));
  assert.equal(result.slot_metrics.find((slot) =>
    slot.category === "top").selector_fallback_used, false);
  assert.equal(result.slot_metrics.find((slot) =>
    slot.category === "shoes").selector_fallback_used, true);
});

test("selector AI input is pre-ranked and capped at eight images per slot", async () => {
  class TenCandidateProvider extends FakeProvider {
    async searchShoppingAgentCandidates(input) {
      this.calls.push(input);
      const family = input.category === "top" ? "上衣" :
        input.category === "bottom" ? "直筒裤" : "乐福鞋";
      const products = Array.from({length: 10}, (_, index) => ({
        ...product(input.category, index + 1, `女款${index + 1}号${family}`),
        product_aesthetic_score: 70 + index,
        relevance_score: 70 + index,
      }));
      return {products, raw_count: products.length, valid_count: products.length};
    }
  }
  const client = new FakeAiClient();
  const result = await new TaobaoShoppingAgentV1({
    client,
    model: "qwen3.7-plus",
    productProvider: new TenCandidateProvider(),
    logger: {info() {}, warn() {}},
  }).run({user_input: "出去玩", authoritative_gender: "female"});

  assert.equal(result.state, "success");
  for (const category of ["top", "bottom", "shoes"]) {
    const call = client.calls.find((item) => item.response_format.type === "json_schema" &&
      item.response_format.json_schema.name === `fitai_product_selector_${category}`);
    const metadata = JSON.parse(call.messages[1].content[0].text);
    assert.equal(metadata.candidates.length, 8);
    assert.equal(call.messages[1].content.filter((item) =>
      item.type === "image_url").length, 8);
    assert.equal(result.slot_metrics.find((slot) =>
      slot.category === category).selector_ai_input_count, 8);
    assert.equal(result.slot_metrics.find((slot) =>
      slot.category === category).selector_fallback_used, false);
  }
});

test("zero gated shoes fail without selector fallback or Composer", async () => {
  const client = new FakeAiClient();
  const provider = {
    async searchShoppingAgentCandidates(input) {
      const products = input.category === "shoes"
        ? [product("bottom", 1, "女款直筒裤")]
        : candidates(input.category);
      return {products, raw_count: products.length, valid_count: products.length};
    },
  };
  const agent = new TaobaoShoppingAgentV1({
    client,
    model: "qwen3.7-plus",
    productProvider: provider,
    logger: {info() {}, warn() {}},
  });

  await assert.rejects(
    () => agent.run({user_input: "出去玩", authoritative_gender: "female"}),
    (error) => error.code === "SHOPPING_AGENT_NO_HARD_GATE_CANDIDATES" &&
      error.details.category === "shoes",
  );
  assert.equal(client.calls.length, 1);
});

test("one invalid Composer reference keeps two valid Looks and logs safe ID audit", async () => {
  const logs = [];
  const agent = new TaobaoShoppingAgentV1({
    client: new FakeAiClient({composerLookCount: 3, foreignComposerId: true}),
    model: "qwen3.7-plus",
    productProvider: new FakeProvider(),
    logger: {
      info(event, details) { logs.push({event, details}); },
      warn(event, details) { logs.push({event, details}); },
    },
  });

  const result = await agent.run({
    user_input: "我要出去玩，帮我搭配一套",
    authoritative_gender: "female",
  });
  assert.equal(result.final_look_count, 2);
  assert.equal(result.invalid_candidate_reference.length, 1);
  assert.equal(result.candidate_reference_audit.length, 3);
  const invalidLog = logs.find((item) =>
    item.event === "COMPOSER_INVALID_CANDIDATE_REFERENCE");
  assert.ok(invalidLog);
  assert.equal(invalidLog.details.requested_top_id, "candidate_999");
  assert.equal(invalidLog.details.top_id_valid, false);
  assert.equal(invalidLog.details.bottom_id_valid, true);
  assert.equal(invalidLog.details.shoes_id_valid, true);
  assert.equal(invalidLog.details.error_code, "COMPOSER_INVALID_CANDIDATE_REFERENCE");
});

test("Phase 2 refines only an insufficient homogeneous slot once and preserves invariants", async () => {
  class RefinementProvider {
    constructor() {
      this.calls = [];
    }

    async searchShoppingAgentCandidates(input) {
      this.calls.push(input);
      if (input.category === "top" && input.query.includes("设计感")) {
        const products = [
          product("top", 11, "女款设计感方领短袖上衣"),
          product("top", 12, "女款韩系短款Polo针织上衣"),
          product("top", 13, "女款不对称领修身上衣"),
        ];
        return {products, raw_count: 3, valid_count: 3};
      }
      const products = candidates(input.category);
      return {products, raw_count: products.length, valid_count: products.length};
    }
  }

  const client = new FakeAiClient({refinementCategories: ["top"]});
  const provider = new RefinementProvider();
  const logs = [];
  const agent = new TaobaoShoppingAgentV1({
    client,
    model: "qwen3.7-plus",
    productProvider: provider,
    logger: {
      info(event, details) { logs.push({event, details}); },
      warn(event, details) { logs.push({event, details}); },
    },
  });
  const result = await agent.run({
    user_input: "我要出去玩，帮我搭配一套",
    authoritative_gender: "female",
    height: 160,
    weight: 49,
  });

  assert.equal(result.state, "success");
  assert.equal(result.ai_call_count, 6);
  assert.equal(result.taobao_call_count, 4);
  assert.equal(provider.calls.filter((call) => call.category === "top").length, 2);
  assert.equal(provider.calls.filter((call) => call.category === "bottom").length, 1);
  assert.equal(provider.calls.filter((call) => call.category === "shoes").length, 1);
  assert.match(result.refinement_queries.top, /女.*上衣/);
  assert.equal(result.refinement_queries.bottom, null);
  assert.equal(result.refinement_queries.shoes, null);
  const topMetric = result.slot_metrics.find((slot) => slot.category === "top");
  assert.equal(topMetric.refinement.triggered, true);
  assert.equal(topMetric.refinement.status, "SUCCESS");
  assert.equal(topMetric.refinement_attempted, true);
  assert.equal(topMetric.refinement_succeeded, true);
  assert.equal(topMetric.refinement_fallback_used, false);
  assert.equal(topMetric.refinement_error_code, null);
  assert.equal(topMetric.refinement.rounds.length, 2);
  assert.ok(topMetric.refinement.reasons.includes("CANDIDATE_POOL_HOMOGENEITY_HIGH"));
  assert.equal(topMetric.candidate_pool_homogeneity, "LOW");
  assert.deepEqual(
    result.candidate_pools.top.slice(0, 2).map((item) => item.selection_tier),
    ["HIGH", "HIGH"],
  );
  assert.ok(result.candidate_pools.top.every((item) => item.title.includes("女款")));
  assert.ok(result.candidate_pools.top.some((item) => item.title.includes("设计感")));
  const refinementSelectorCall = client.calls.find((call) =>
    call.response_format.json_schema.name === "fitai_product_selector_top_refinement_1");
  assert.ok(refinementSelectorCall);
  const refinementMetadata = JSON.parse(refinementSelectorCall.messages[1].content[0].text);
  assert.deepEqual(
    refinementMetadata.slot.hard_constraints,
    plan().shopping_intent.slots[0].hard_constraints,
  );
  assert.equal(
    refinementSelectorCall.messages[1].content.filter((item) =>
      item.type === "image_url").length,
    3,
  );
  assert.equal(result.invalid_candidate_reference.length, 0);
  assert.ok(result.final_look_count >= 2);
  const refinementValidation = logs.find(({event, details}) =>
    event === "shopping_agent_v1_refinement_decision" &&
    details.slot_key.endsWith(":top") &&
    details.validation_status === "PASS");
  assert.ok(refinementValidation);
  assert.equal(refinementValidation.details.initial_query, "女 方领 上衣");
  assert.match(refinementValidation.details.refinement_query, /女.*上衣/);
  assert.equal(refinementValidation.details.canonical_category, "top");
  assert.equal(refinementValidation.details.validation_error_kind, null);
  assert.equal(refinementValidation.details.selector_refinement_suggested, true);
  assert.equal(refinementValidation.details.server_refinement_required, true);
  assert.equal(refinementValidation.details.refinement_query_source, "SELECTOR");
});

test("server diversity authority builds a missing query and runs only one refinement", async () => {
  class DiversityGapProvider extends FakeProvider {
    async searchShoppingAgentCandidates(input) {
      this.calls.push(input);
      if (input.category === "shoes" && this.calls.filter((call) =>
        call.category === "shoes").length === 1) {
        const products = [1, 2, 3].map((index) =>
          product("shoes", index, `女款${index}号灰色德训鞋`));
        return {products, raw_count: products.length, valid_count: products.length};
      }
      if (input.category === "shoes") {
        const products = [
          product("shoes", 11, "女款轻便乐福鞋"),
          product("shoes", 12, "女款浅口芭蕾鞋"),
          product("shoes", 13, "女款简洁低帮鞋"),
        ];
        return {products, raw_count: products.length, valid_count: products.length};
      }
      const products = candidates(input.category);
      return {products, raw_count: products.length, valid_count: products.length};
    }
  }

  const client = new FakeAiClient({emptyRefinementQueryCategories: ["shoes"]});
  const provider = new DiversityGapProvider();
  const logs = [];
  const agent = new TaobaoShoppingAgentV1({
    client,
    model: "qwen3.7-plus",
    productProvider: provider,
    logger: {
      info(event, details) { logs.push({event, details}); },
      warn(event, details) { logs.push({event, details}); },
    },
  });
  const result = await agent.run({user_input: "出去玩", authoritative_gender: "female"});
  const shoesCalls = provider.calls.filter((call) => call.category === "shoes");
  const shoesMetric = result.slot_metrics.find((slot) => slot.category === "shoes");
  const decisionLog = logs.find(({event, details}) =>
    event === "shopping_agent_v1_refinement_decision" &&
    details.slot_key.endsWith(":shoes"));

  assert.equal(result.state, "success");
  assert.equal(shoesCalls.length, 2);
  assert.equal(result.max_refinement_rounds, 1);
  assert.equal(shoesMetric.selector_refinement_suggested, false);
  assert.equal(shoesMetric.server_refinement_required, true);
  assert.equal(shoesMetric.refinement_query_source, "SERVER_BUILDER");
  assert.equal(shoesMetric.refinement_reason, "DIVERSITY_GAP");
  assert.equal(shoesMetric.refinement.rounds.length, 2);
  assert.equal(decisionLog.details.validation_status, "PASS");
  assert.equal(decisionLog.details.canonical_category, "shoes");
});

test("refinement network failure falls back to three legal first-round candidates", async () => {
  class NetworkFailureRefinementProvider extends FakeProvider {
    async searchShoppingAgentCandidates(input) {
      this.calls.push(input);
      if (input.category === "top" && input.query.includes("设计感")) {
        input.onAttempt?.(1);
        input.onAttempt?.(2);
        const error = new Error("connect timed out");
        error.code = "TAOBAO_NETWORK_ERROR";
        error.details = {cause_code: "UND_ERR_CONNECT_TIMEOUT"};
        error.attempts = 2;
        throw error;
      }
      const products = candidates(input.category);
      return {products, raw_count: products.length, valid_count: products.length};
    }
  }

  const client = new FakeAiClient({refinementCategories: ["top"]});
  const provider = new NetworkFailureRefinementProvider();
  const agent = new TaobaoShoppingAgentV1({
    client,
    model: "qwen3.7-plus",
    productProvider: provider,
    logger: {info() {}, warn() {}},
  });
  const result = await agent.run({user_input: "出去玩", authoritative_gender: "female"});
  const topMetric = result.slot_metrics.find((slot) => slot.category === "top");

  assert.equal(result.state, "success");
  assert.equal(result.final_look_count, 2);
  assert.equal(result.taobao_call_count, 4);
  assert.equal(result.ai_call_count, 5);
  assert.equal(topMetric.refinement_status, "failed_fallback");
  assert.equal(topMetric.refinement.status, "failed_fallback");
  assert.equal(topMetric.refinement_attempted, true);
  assert.equal(topMetric.refinement_succeeded, false);
  assert.equal(topMetric.refinement_fallback_used, true);
  assert.equal(topMetric.refinement_error_code, "TAOBAO_NETWORK_ERROR");
  assert.equal(topMetric.refinement.refinement_cause_code, "UND_ERR_CONNECT_TIMEOUT");
  assert.equal(result.candidate_pools.top.length, 3);
  assert.ok(result.candidate_pools.top.every((item) => !item.title.includes("设计感")));
});

test("refinement Selector failure keeps sufficient first-round candidates and reaches Composer", async () => {
  class FreshRefinementProvider extends FakeProvider {
    async searchShoppingAgentCandidates(input) {
      this.calls.push(input);
      if (input.category === "top" && this.calls.filter((call) =>
        call.category === "top").length > 1) {
        const products = [
          product("top", 11, "女款设计感方领短袖上衣"),
          product("top", 12, "女款短款Polo针织上衣"),
          product("top", 13, "女款不对称领修身上衣"),
        ];
        return {products, raw_count: products.length, valid_count: products.length};
      }
      const products = candidates(input.category);
      return {products, raw_count: products.length, valid_count: products.length};
    }
  }
  const client = new FakeAiClient({
    refinementCategories: ["top"],
    failRefinementCategory: "top",
  });
  const logs = [];
  const agent = new TaobaoShoppingAgentV1({
    client,
    model: "qwen3.7-plus",
    productProvider: new FreshRefinementProvider(),
    logger: {
      info(event, details) { logs.push({event, details}); },
      warn(event, details) { logs.push({event, details}); },
    },
  });

  const result = await agent.run({
    user_input: "我要出去玩，帮我搭配一套",
    authoritative_gender: "female",
  });
  const topMetric = result.slot_metrics.find((slot) => slot.category === "top");
  assert.equal(result.state, "success");
  assert.ok(result.final_look_count >= 2);
  assert.equal(topMetric.refinement_status, "failed_fallback");
  assert.equal(topMetric.refinement_fallback_used, true);
  assert.equal(topMetric.final_candidate_pool.length, 3);
  assert.ok(logs.some(({event, details}) =>
    event === "shopping_agent_v1_refinement_selector" &&
    details.category === "top" &&
    details.status === "failed_fallback"));
});

test("zero legal first-round candidates fail before optional refinement or Composer", async () => {
  const client = new FakeAiClient({refinementCategories: ["top"]});
  const provider = {
    async searchShoppingAgentCandidates(input) {
      const products = input.category === "top" ? [] : candidates(input.category);
      return {products, raw_count: products.length, valid_count: products.length};
    },
  };
  const agent = new TaobaoShoppingAgentV1({
    client,
    model: "qwen3.7-plus",
    productProvider: provider,
    logger: {info() {}, warn() {}},
  });

  await assert.rejects(
    () => agent.run({user_input: "出去玩", authoritative_gender: "female"}),
    (error) => error.code === "SHOPPING_AGENT_NO_HARD_GATE_CANDIDATES" &&
      error.details.category === "top",
  );
  assert.equal(client.calls.length, 1);
});

test("refinement provider hard error keeps existing handling without network fallback", async () => {
  class BusinessFailureRefinementProvider extends FakeProvider {
    async searchShoppingAgentCandidates(input) {
      this.calls.push(input);
      if (input.category === "top" && input.query.includes("设计感")) {
        const error = new Error("Taobao permission denied");
        error.code = "TAOBAO_PERMISSION_DENIED";
        error.attempts = 1;
        throw error;
      }
      const products = candidates(input.category);
      return {products, raw_count: products.length, valid_count: products.length};
    }
  }

  const client = new FakeAiClient({refinementCategories: ["top"]});
  const agent = new TaobaoShoppingAgentV1({
    client,
    model: "qwen3.7-plus",
    productProvider: new BusinessFailureRefinementProvider(),
    logger: {info() {}, warn() {}},
  });
  const result = await agent.run({user_input: "出去玩", authoritative_gender: "female"});
  const topMetric = result.slot_metrics.find((slot) => slot.category === "top");

  assert.equal(result.state, "success");
  assert.equal(topMetric.refinement.status, "FAILED");
  assert.equal(topMetric.refinement_attempted, true);
  assert.equal(topMetric.refinement_succeeded, false);
  assert.equal(topMetric.refinement_fallback_used, false);
  assert.equal(topMetric.refinement_error_code, "TAOBAO_PROVIDER_ERROR");
});

test("male casual and cute female retain authoritative gender in the proof contract", () => {
  const maleInput = normalizeAgentInput({user_input: "男生日常休闲", gender: "male"});
  const maleIntent = normalizeShoppingIntent(plan("male", "清爽男性休闲").shopping_intent, maleInput);
  assert.equal(maleIntent.gender, "male");
  assert.ok(maleIntent.slots.every((slot) => slot.search_query.includes("男")));

  const cuteInput = normalizeAgentInput({user_input: "穿得可爱一点", gender: "female"});
  const defaultPlan = plan("female", "清新法式休闲");
  const cutePlan = plan("female", "轻甜可爱");
  cutePlan.shopping_intent.slots[0].search_query = "女款 蝴蝶结 短款 上衣";
  cutePlan.shopping_intent.slots[1].search_query = "女款 高腰 A字 短裙";
  cutePlan.shopping_intent.slots[2].search_query = "女款 低跟 玛丽珍 鞋";
  const cuteIntent = normalizeShoppingIntent(cutePlan.shopping_intent, cuteInput);
  assert.equal(cuteIntent.overall_aesthetic.core_direction, "轻甜可爱");
  assert.equal(cuteIntent.gender, "female");
  assert.ok(cuteIntent.slots.every((slot) => slot.search_query.includes("女")));
  assert.notDeepEqual(
    cuteIntent.slots.map((slot) => slot.search_query),
    defaultPlan.shopping_intent.slots.map((slot) => slot.search_query),
  );
});

test("a top timeout preserves successful bottom and shoes and skips every selector", async () => {
  const client = new FakeAiClient();
  const provider = {
    async searchShoppingAgentCandidates({category, signal, onAttempt}) {
      onAttempt?.(1);
      if (category === "top") {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve({products: candidates(category)}), 100);
          signal.addEventListener("abort", () => {
            clearTimeout(timer);
            const error = new Error("aborted");
            error.code = "TAOBAO_TIMEOUT";
            error.attempts = 1;
            reject(error);
          }, {once: true});
        });
      }
      const products = candidates(category);
      return {products, raw_count: products.length, valid_count: products.length, attempts: 1};
    },
  };
  const logs = [];
  const agent = new TaobaoShoppingAgentV1({
    client,
    model: "qwen3.7-plus",
    productProvider: provider,
    taobaoSlotTimeoutMs: 10,
    taobaoRetrievalTimeoutMs: 50,
    logger: {
      info(event, details) { logs.push({event, details}); },
      warn(event, details) { logs.push({event, details}); },
    },
  });
  const result = await agent.run({user_input: "出去玩", authoritative_gender: "female"});
  assert.equal(result.state, "retryable");
  assert.equal(result.reason, "PARTIAL_TAOBAO_RETRIEVAL");
  assert.equal(result.failed_slots.length, 1);
  assert.equal(result.failed_slots[0].category, "top");
  assert.equal(result.failed_slots[0].error_code, "TAOBAO_SLOT_TIMEOUT");
  assert.deepEqual(Object.keys(result.retrieved_candidates).sort(), ["bottom", "shoes"]);
  assert.equal(result.retrieved_candidates.bottom.length, 3);
  assert.equal(result.retrieved_candidates.shoes.length, 3);
  assert.equal(result.final_look_count, 0);
  assert.equal(result.ai_call_count, 1);
  assert.equal(client.calls.length, 1);
  assert.equal(logs.filter((entry) => entry.event === "shopping_agent_v1_taobao_slot").length, 3);
});

test("a bottom provider error preserves other slots and never enters Composer", async () => {
  const client = new FakeAiClient();
  const provider = {
    async searchShoppingAgentCandidates({category, onAttempt}) {
      onAttempt?.(1);
      if (category === "bottom") {
        const error = new Error("provider unavailable");
        error.code = "TAOBAO_PERMISSION_DENIED";
        error.attempts = 1;
        throw error;
      }
      const products = candidates(category);
      return {products, raw_count: products.length, valid_count: products.length, attempts: 1};
    },
  };
  const agent = new TaobaoShoppingAgentV1({
    client,
    model: "qwen3.7-plus",
    productProvider: provider,
    logger: {info() {}, warn() {}},
  });
  const result = await agent.run({user_input: "出去玩", authoritative_gender: "female"});
  assert.equal(result.state, "retryable");
  assert.equal(result.failed_slots[0].category, "bottom");
  assert.equal(result.failed_slots[0].error_code, "TAOBAO_PROVIDER_ERROR");
  assert.deepEqual(Object.keys(result.retrieved_candidates).sort(), ["shoes", "top"]);
  assert.equal(result.looks.length, 0);
  assert.equal(client.calls.length, 1);
});

test("retrieval error classification distinguishes local proxy and provider failures", () => {
  assert.equal(
    classifyTaobaoRetrievalError({code: "LOCAL_TO_RENDER_TIMEOUT"}),
    "LOCAL_TO_RENDER_TIMEOUT",
  );
  assert.equal(
    classifyTaobaoRetrievalError({code: "TAOBAO_TIMEOUT"}),
    "TAOBAO_SLOT_TIMEOUT",
  );
  assert.equal(
    classifyTaobaoRetrievalError({
      code: "TAOBAO_NETWORK_ERROR",
      details: {cause_code: "ETIMEDOUT"},
    }),
    "TAOBAO_NETWORK_ERROR",
  );
  assert.equal(
    classifyTaobaoRetrievalError({code: "TAOBAO_PERMISSION_DENIED"}),
    "TAOBAO_PROVIDER_ERROR",
  );
});

test("two top ETIMEDOUT attempts retain successful slots and report network error", async () => {
  const client = new FakeAiClient();
  const provider = {
    async searchShoppingAgentCandidates({category, onAttempt}) {
      if (category === "top") {
        onAttempt?.(1);
        onAttempt?.(2);
        const error = new Error("network unavailable");
        error.code = "TAOBAO_NETWORK_ERROR";
        error.details = {cause_code: "ETIMEDOUT"};
        error.attempts = 2;
        throw error;
      }
      onAttempt?.(1);
      const products = candidates(category);
      return {products, raw_count: products.length, valid_count: products.length, attempts: 1};
    },
  };
  const agent = new TaobaoShoppingAgentV1({
    client,
    model: "qwen3.7-plus",
    productProvider: provider,
    logger: {info() {}, warn() {}},
  });

  const result = await agent.run({user_input: "出去玩", authoritative_gender: "female"});
  assert.equal(result.state, "retryable");
  assert.equal(result.reason, "PARTIAL_TAOBAO_RETRIEVAL");
  assert.equal(result.failed_slots[0].category, "top");
  assert.equal(result.failed_slots[0].error_code, "TAOBAO_NETWORK_ERROR");
  assert.equal(result.failed_slots[0].cause_code, "ETIMEDOUT");
  assert.equal(result.failed_slots[0].attempts, 2);
  assert.deepEqual(Object.keys(result.retrieved_candidates).sort(), ["bottom", "shoes"]);
  assert.equal(result.final_look_count, 0);
  assert.equal(client.calls.length, 1);
});
