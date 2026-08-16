"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DEFAULT_TAOBAO_RETRIEVAL_TIMEOUT_MS,
  DEFAULT_TAOBAO_SLOT_TIMEOUT_MS,
  MAX_REFINEMENT_ROUNDS,
  OUTFIT_COMPOSITION_SCHEMA,
  PRODUCT_SELECTION_SCHEMA,
  SHOPPING_PLAN_SCHEMA,
  ShoppingAgentV1Error,
  TaobaoShoppingAgentV1,
  classifyTaobaoRetrievalError,
  hardGateCandidate,
  normalizeAgentInput,
  normalizeRefinementQuery,
  normalizeShoppingIntent,
  parseAiJson,
  selectFinalCandidatePool,
  selectorQualityScore,
  validateComposedLooks,
  validateProductSelection,
} = require("../shopping_agent_v1");

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
      weather_constraints: {
        material: ["透气"],
        thickness: "轻薄",
        comfort: ["活动方便"],
        safety: [],
      },
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
    weather_fit: value,
  };
}

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
  } = {}) {
    this.calls = [];
    this.composerLookCount = composerLookCount;
    this.foreignComposerId = foreignComposerId;
    this.wrapComposer = wrapComposer;
    this.directComposerArray = directComposerArray;
    this.duplicateComposerCombination = duplicateComposerCombination;
    this.refinementCategories = new Set(refinementCategories);
    this.chat = {completions: {create: this.create.bind(this)}};
  }

  async create(input) {
    this.calls.push(input);
    const name = input.response_format.type === "json_object"
      ? "fitai_real_product_outfit_composer"
      : input.response_format.json_schema.name;
    let payload;
    if (name === "fitai_shopping_agent_v1_plan") {
      payload = plan();
    } else if (name.startsWith("fitai_product_selector_")) {
      const metadata = JSON.parse(input.messages[1].content[0].text);
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
        refinement_query: `${metadata.shopping_intent.gender === "female" ? "女款" : "男款"} ${
          metadata.slot.category === "top" ? "设计感短袖上衣" :
          metadata.slot.category === "bottom" ? "高腰垂感下装" : "轻盈精致鞋"
        }`,
      };
    } else if (name === "fitai_real_product_outfit_composer") {
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
  assert.ok(Object.hasOwn(PRODUCT_SELECTION_SCHEMA.properties, "refinement_needed"));
  assert.ok(Object.hasOwn(
    OUTFIT_COMPOSITION_SCHEMA.properties.looks.items.properties.scores.properties,
    "visual_hierarchy",
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

test("refinement query validation uses canonical category and explicit gender", () => {
  const input = normalizeAgentInput({
    user_input: "我要出去玩，帮我搭配一套",
    gender: "female",
  });
  const initialPlan = plan();
  initialPlan.shopping_intent.slots[0].search_query = "女短款修身针织衫";
  const initialIntent = normalizeShoppingIntent(initialPlan.shopping_intent, input);
  assert.equal(initialIntent.slots[0].search_query, "女短款修身针织衫");

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

test("Composer wrapper keeps candidate references and minimum Look count strict", async () => {
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
  await assert.rejects(
    () => foreignAgent.run({user_input: "出去玩", authoritative_gender: "female"}),
    (error) => error.code === "SHOPPING_AGENT_INSUFFICIENT_LOOKS",
  );

  const oneLookAgent = new TaobaoShoppingAgentV1({
    client: new FakeAiClient({composerLookCount: 1, wrapComposer: true}),
    model: "qwen3.7-plus",
    productProvider: new FakeProvider(),
    logger: {info() {}},
  });
  await assert.rejects(
    () => oneLookAgent.run({user_input: "出去玩", authoritative_gender: "female"}),
    (error) => error.code === "SHOPPING_AGENT_INSUFFICIENT_LOOKS",
  );

  const directForeignAgent = new TaobaoShoppingAgentV1({
    client: new FakeAiClient({foreignComposerId: true, directComposerArray: true}),
    model: "qwen3.7-plus",
    productProvider: new FakeProvider(),
    logger: {info() {}},
  });
  await assert.rejects(
    () => directForeignAgent.run({user_input: "出去玩", authoritative_gender: "female"}),
    (error) => error.code === "SHOPPING_AGENT_INSUFFICIENT_LOOKS",
  );

  const directOneLookAgent = new TaobaoShoppingAgentV1({
    client: new FakeAiClient({composerLookCount: 1, directComposerArray: true}),
    model: "qwen3.7-plus",
    productProvider: new FakeProvider(),
    logger: {info() {}},
  });
  await assert.rejects(
    () => directOneLookAgent.run({user_input: "出去玩", authoritative_gender: "female"}),
    (error) => error.code === "SHOPPING_AGENT_INSUFFICIENT_LOOKS",
  );

  const directDuplicateAgent = new TaobaoShoppingAgentV1({
    client: new FakeAiClient({directComposerArray: true, duplicateComposerCombination: true}),
    model: "qwen3.7-plus",
    productProvider: new FakeProvider(),
    logger: {info() {}},
  });
  await assert.rejects(
    () => directDuplicateAgent.run({user_input: "出去玩", authoritative_gender: "female"}),
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
    event === "shopping_agent_v1_refinement_query_validation" &&
    details.slot_key.endsWith(":top") &&
    details.validation_status === "PASS");
  assert.ok(refinementValidation);
  assert.equal(refinementValidation.details.initial_query, "女款 方领 合身 上衣");
  assert.match(refinementValidation.details.refinement_query, /女.*上衣/);
  assert.equal(refinementValidation.details.canonical_category, "top");
  assert.equal(refinementValidation.details.validation_error_kind, null);
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
