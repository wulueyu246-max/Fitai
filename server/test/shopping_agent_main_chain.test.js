"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  adaptShoppingAgentSuccess,
  buildDirectShoppingAgentBasePayload,
  buildShoppingAgentMainInput,
  dispatchOutfitProductionPath,
  integrateShoppingAgentMainChain,
  shoppingAgentFeatureEnabled,
} = require("../shopping_agent_main_chain");

const outfitRequest = Object.freeze({
  requestId: "request-main-1",
  user_input: "我要出去玩，帮我搭配一套",
  request: "我要出去玩，帮我搭配一套",
  gender: "female",
  authoritative_gender: "female",
  height: 160,
  weight: 49,
  scene: "出去玩",
  context: {
    scene: "出去玩",
    body_profile: {shape: "slim"},
    weather: {temperature_c: 28},
    weather_constraints: ["透气"],
  },
});

test("feature flag enables test environments and supports explicit rollback", () => {
  assert.equal(shoppingAgentFeatureEnabled({}, "test"), true);
  assert.equal(shoppingAgentFeatureEnabled({}, "production"), false);
  assert.equal(shoppingAgentFeatureEnabled({SHOPPING_AGENT_V1_ENABLED: "true"}), true);
  assert.equal(shoppingAgentFeatureEnabled({SHOPPING_AGENT_V1_ENABLED: "false"}, "test"), false);
});

test("main-chain input preserves User Truth without depending on legacy analysis", () => {
  const input = buildShoppingAgentMainInput(outfitRequest, {
    bodyProfile: "纤细",
    style: "清新休闲",
    style_expression: "feminine",
    styling_constitution: {selected_aesthetic_direction: "清新休闲"},
  }, "request-main-1");
  assert.equal(input.user_input, outfitRequest.user_input);
  assert.equal(input.authoritative_gender, "female");
  assert.equal(input.persona.gender, "female");
  assert.equal(input.persona.expression, "feminine_or_neutral_feminine");
  assert.equal(input.persona.source, "authoritative_user_truth");
  assert.equal(input.persona.style, undefined);
  assert.equal(Object.hasOwn(input, "weather"), false);
  assert.equal(Object.hasOwn(input, "weather_mode"), false);
  assert.deepEqual(
    input.styling_policy.decision_priority.slice(0, 2),
    ["explicit_user_intent", "persona_gender_body"],
  );
});

test("request budget ranges reach Shopping Intent as enforceable ceilings", () => {
  const input = buildShoppingAgentMainInput({
    ...outfitRequest,
    itemBudget: "200-500",
    outfitBudget: "800-1500",
  }, null, "request-budget-range");
  assert.deepEqual(input.budget, {item_budget: 500, outfit_budget: 1500});

  const openEnded = buildShoppingAgentMainInput({
    ...outfitRequest,
    itemBudget: "1000+",
    outfitBudget: "3000+",
  }, null, "request-budget-open");
  assert.deepEqual(openEnded.budget, {item_budget: null, outfit_budget: null});
});

test("weather context and a failing weather source never enter Agent input", () => {
  const context = {
    ...outfitRequest.context,
    humidity: 95,
  };
  Object.defineProperty(context, "weather", {
    enumerable: true,
    get() {
      throw new Error("weather service unavailable");
    },
  });
  const input = buildShoppingAgentMainInput({
    ...outfitRequest,
    context,
  }, null, "request-weather-disabled");
  assert.equal(Object.hasOwn(input, "weather"), false);
  assert.equal(Object.hasOwn(input, "weather_mode"), false);
  assert.equal(Object.hasOwn(input, "weather_constraints"), false);
});

test("direct base payload is Flutter-safe and keeps authoritative gender", () => {
  const payload = buildDirectShoppingAgentBasePayload(outfitRequest, "request-main-1");
  assert.equal(payload.gender, "female");
  assert.equal(payload.analysisMode, "shopping_agent_v1");
  assert.equal(Object.hasOwn(payload, "weather_mode"), false);
  assert.equal(typeof payload.bodyProfile, "string");
  assert.equal(typeof payload.recommendations.top, "string");
});

test("enabled production path bypasses wrong Blueprint, Native Look and style repair", async () => {
  const legacyCalls = {
    intent: 0,
    blueprint: 0,
    nativeLook: 0,
    styleRepair: 0,
  };
  const logs = [];
  let receivedInput;
  let receivedOptions;
  const routed = await dispatchOutfitProductionPath({
    enabled: true,
    agent: {
      run: async (input, options) => {
        receivedInput = input;
        receivedOptions = options;
        return successResult();
      },
    },
    outfitRequest,
    requestId: "request-main-1",
    deadlineMs: 155_000,
    legacyPath: async () => {
      legacyCalls.intent += 1;
      legacyCalls.blueprint += 1;
      legacyCalls.nativeLook += 1;
      legacyCalls.styleRepair += 1;
      throw new Error("legacy Blueprint returned wrong gender");
    },
    logger: {info: (event, details) => logs.push({event, details})},
  });

  assert.equal(routed.mode, "shopping_agent_v1");
  assert.equal(routed.payload.shopping_agent_status, "success");
  assert.equal(routed.payload.outfit_plans.length, 2);
  assert.deepEqual(legacyCalls, {
    intent: 0,
    blueprint: 0,
    nativeLook: 0,
    styleRepair: 0,
  });
  assert.equal(receivedInput.authoritative_gender, "female");
  assert.equal(receivedOptions.deadlineMs, 155_000);
  assert.deepEqual(logs[0].details, {
    request_id: "request-main-1",
    authoritative_gender: "female",
    legacy_intent_calls: 0,
    blueprint_calls: 0,
    native_look_calls: 0,
    style_repair_calls: 0,
    legacy_purchase_specification_calls: 0,
    shopping_agent_weather_input_present: false,
    hard_deadline_ms: 155_000,
  });
});

test("disabled production path preserves the legacy rollback callback", async () => {
  let legacyCalls = 0;
  const routed = await dispatchOutfitProductionPath({
    enabled: false,
    outfitRequest,
    legacyPath: async () => {
      legacyCalls += 1;
      return {legacy: true};
    },
  });
  assert.equal(routed.mode, "legacy");
  assert.deepEqual(routed.payload, {legacy: true});
  assert.equal(legacyCalls, 1);
});

test("male, female and unisex identity remain authoritative in Agent input", () => {
  for (const gender of ["male", "female", "unisex"]) {
    const input = buildShoppingAgentMainInput({
      ...outfitRequest,
      gender,
      authoritative_gender: gender,
      context: {
        ...outfitRequest.context,
        gender,
        authoritative_gender: gender,
      },
    }, null, `request-${gender}`);
    assert.equal(input.gender, gender);
    assert.equal(input.authoritative_gender, gender);
    assert.equal(input.body_profile.gender, gender);
    assert.equal(input.persona.gender, gender);
  }
});

test("successful Agent output maps two candidate-backed Looks for Flutter", () => {
  const response = adaptShoppingAgentSuccess(successResult(), {
    basePayload: basePayload(),
    outfitRequest,
    now: () => new Date("2026-08-17T00:00:00.000Z"),
  });
  assert.equal(response.shopping_agent_status, "success");
  assert.equal(response.outfit_plans.length, 2);
  assert.equal(response.shopping_agent_looks.length, 2);
  assert.equal(response.shopping_agent_products.length, 6);
  assert.equal(response.outfit_plans[0].top.candidate_id, "top-1");
  assert.equal(response.outfit_plans[0].top.purchase_url, "https://item.example/top-1");
  assert.equal(response.outfit_plans[0].top.image_url, "https://img.example/top-1.jpg");
  assert.equal(response.outfit_plans[0].top.price, 129);
  assert.match(response.outfit_plans[0].reason, /真实淘宝商品/);
  for (const field of [
    "display_style_name",
    "display_style_summary",
    "display_top_advice",
    "display_bottom_advice",
    "display_shoes_advice",
    "display_look_explanation",
  ]) {
    assert.match(response[field], /[\u3400-\u9fff]/u);
  }
});

test("response adapter separates English canonical semantics from Chinese display copy", () => {
  const result = successResult();
  result.shopping_intent = {
    gender: "female",
    persona: {expression: "feminine_or_neutral_feminine"},
    overall_aesthetic: {core_direction: "clean_fit"},
    body_strategy: {
      goals: ["leg_elongation"],
      soft_tactics: ["upper_body_foundation", "lightweight_finish"],
    },
    slots: [
      {category: "top", role: "upper body foundation"},
      {category: "bottom", role: "leg elongation"},
      {category: "shoes", role: "lightweight finish"},
    ],
  };
  const response = adaptShoppingAgentSuccess(result, {
    basePayload: basePayload(),
    outfitRequest,
    now: () => new Date("2026-08-17T00:00:00.000Z"),
  });
  const displayFields = [
    response.display_style_name,
    response.display_style_summary,
    response.display_top_advice,
    response.display_bottom_advice,
    response.display_shoes_advice,
    response.display_look_explanation,
    response.outfit_plans[0].style,
    response.outfit_plans[0].reason,
  ];
  assert.ok(displayFields.every((value) => /[\u3400-\u9fff]/u.test(value)));
  assert.ok(displayFields.every((value) =>
    !/clean_fit|leg_elongation|upper_body_foundation|lightweight_finish/i.test(value)));
  assert.equal(response.style, "清爽利落风");
  assert.equal(response.styling_summary.overall_aesthetic, undefined);
});

test("unknown canonical style builds Chinese display copy from structured evidence", () => {
  const result = successResult();
  result.shopping_intent = {
    gender: "female",
    persona: {expression: "feminine_or_neutral_feminine"},
    overall_aesthetic: {
      core_direction: "quiet_weekend_signature",
      traits: ["轻盈", "浪漫"],
    },
    body_strategy: {
      goals: ["优化小个子比例"],
      soft_tactics: ["leg_elongation"],
    },
    occasion: {type: "周末出游", formality: "casual"},
    slots: [
      {category: "top", role: "upper body foundation", soft_preferences: ["短款"]},
      {category: "bottom", role: "leg elongation", soft_preferences: ["高腰"]},
      {category: "shoes", role: "lightweight finish", soft_preferences: ["轻量"]},
    ],
  };
  const response = adaptShoppingAgentSuccess(result, {
    basePayload: basePayload(),
    outfitRequest,
    now: () => new Date("2026-08-17T00:00:00.000Z"),
  });
  const displayFields = [
    response.display_style_name,
    response.display_style_summary,
    response.display_top_advice,
    response.display_bottom_advice,
    response.display_shoes_advice,
    response.display_look_explanation,
    response.outfit_plans[0].style,
    response.outfit_plans[0].reason,
  ];

  assert.equal(response.display_style_name, "轻盈浪漫风");
  assert.match(response.display_style_summary, /优化小个子比例/u);
  assert.match(response.display_style_summary, /周末出游/u);
  assert.match(response.display_style_summary, /短款/u);
  assert.ok(displayFields.every((value) => /[\u3400-\u9fff]/u.test(value)));
  assert.ok(displayFields.every((value) =>
    !/quiet_weekend_signature|feminine_or_neutral_feminine|leg_elongation|casual/i
      .test(value)));
});

test("response adapter preserves request gender and records downstream drift", () => {
  const result = successResult();
  result.authoritative_gender = "male";
  const logs = [];
  const response = adaptShoppingAgentSuccess(result, {
    basePayload: basePayload(),
    outfitRequest,
    logger: {warn: (event, details) => logs.push({event, details})},
  });
  assert.equal(response.gender, "female");
  assert.equal(response.gender_context_drift, true);
  assert.equal(response.outfit_plans.every((plan) => plan.gender === "female"), true);
  assert.equal(logs[0].event, "SHOPPING_AGENT_GENDER_CONTEXT_DRIFT");
});

test("response adapter rejects an explicitly male product in a female result", () => {
  const result = successResult();
  result.looks[0].items.top.title = "男士修身短袖T恤";
  assert.throws(
    () => adaptShoppingAgentSuccess(result, {basePayload: basePayload(), outfitRequest}),
    (error) => error.code === "SHOPPING_AGENT_GENDER_CONTEXT_DRIFT",
  );
});

test("response adapter cannot expose an over-budget Look", () => {
  assert.throws(
    () => adaptShoppingAgentSuccess(successResult(), {
      basePayload: basePayload(),
      outfitRequest: {...outfitRequest, outfitBudget: "300以内"},
    }),
    (error) => error.code === "SHOPPING_AGENT_RESPONSE_ADAPTER_INVALID" &&
      /USER_BUDGET_CONSTRAINT/.test(error.message),
  );
});

test("Agent failure is explicit and never exposes legacy products", async () => {
  const response = await integrateShoppingAgentMainChain({
    enabled: true,
    agent: {run: async () => ({
      request_id: "request-main-1",
      state: "retryable",
      reason: "PARTIAL_TAOBAO_RETRIEVAL",
      first_failure_stage: "taobao_retrieval",
    })},
    basePayload: {
      ...basePayload(),
      recommendations: {
        ...basePayload().recommendations,
        products: [{product_id: "legacy-product"}],
      },
    },
    outfitRequest,
    analysis: {},
    requestId: "request-main-1",
  });
  assert.equal(response.shopping_agent_status, "failed");
  assert.equal(response.shopping_agent_first_failure_stage, "taobao_retrieval");
  assert.equal(response.shopping_agent_retryable, true);
  assert.deepEqual(response.recommendations.products, []);
  assert.deepEqual(response.outfit_plans, []);
});

test("diagnostics persistence failure never changes a successful outfit response", async () => {
  const warnings = [];
  const response = await integrateShoppingAgentMainChain({
    enabled: true,
    agent: {run: async () => successResult()},
    basePayload: basePayload(),
    outfitRequest,
    analysis: {},
    requestId: "request-main-1",
    candidateFunnelStore: {persist: async () => {
      throw Object.assign(new Error("diagnostics unavailable"), {code: "WRITE_FAILED"});
    }},
    logger: {warn: (event, details) => warnings.push({event, details})},
  });
  assert.equal(response.shopping_agent_status, "success");
  assert.equal(response.outfit_plans.length, 2);
  assert.equal(warnings[0].event, "shopping_candidate_funnel_persistence_failed");
});

test("refinement contract failures keep the product selector refinement stage", async () => {
  const error = new Error("refinement query validation failed");
  error.code = "REFINEMENT_QUERY_VALIDATION_FAILED";
  error.details = {phase: "product_selector_refinement"};
  const response = await integrateShoppingAgentMainChain({
    enabled: true,
    agent: {run: async () => { throw error; }},
    basePayload: basePayload(),
    outfitRequest,
    analysis: {},
    requestId: "request-main-1",
  });
  assert.equal(response.shopping_agent_status, "failed");
  assert.equal(response.shopping_agent_first_failure_stage, "product_selector_refinement");
  assert.equal(response.shopping_agent_error_code, "REFINEMENT_QUERY_VALIDATION_FAILED");
});

test("disabled flag preserves the old response for rollback", async () => {
  let calls = 0;
  const original = basePayload();
  const response = await integrateShoppingAgentMainChain({
    enabled: false,
    agent: {run: async () => { calls += 1; }},
    basePayload: original,
    outfitRequest,
    analysis: {},
    requestId: "request-main-1",
  });
  assert.equal(calls, 0);
  assert.equal(response.shopping_agent_status, "disabled");
  assert.deepEqual(response.recommendations, original.recommendations);
});

test("incomplete product mapping fails instead of inventing UI fields", () => {
  const result = successResult();
  delete result.looks[0].items.top.purchase_url;
  assert.throws(
    () => adaptShoppingAgentSuccess(result, {
      basePayload: basePayload(),
      outfitRequest,
    }),
    /candidate mapping is incomplete/,
  );
});

function basePayload() {
  return {
    bodyProfile: "纤细",
    style: "清新休闲",
    recommendations: {
      top: "上衣",
      bottom: "下装",
      shoes: "鞋履",
      accessories: "配饰",
      summary: "总结",
      products: [],
    },
    looks: [],
    products: [],
  };
}

function successResult() {
  const candidate = (slot, index) => ({
    candidate_id: `${slot}-${index}`,
    product_id: `tb-${slot}-${index}`,
    title: `${slot} 商品 ${index}`,
    category: slot,
    price: 100 + index * 29,
    image_url: `https://img.example/${slot}-${index}.jpg`,
    purchase_url: `https://item.example/${slot}-${index}`,
    brand: "测试品牌",
    source: "taobao",
    selection_tier: "HIGH",
    selector_quality_score: 82,
    selector_scores: {aesthetic_fit: 84},
  });
  const items1 = Object.fromEntries(["top", "bottom", "shoes"].map(
    (slot) => [slot, candidate(slot, 1)],
  ));
  const items2 = Object.fromEntries(["top", "bottom", "shoes"].map(
    (slot) => [slot, candidate(slot, 2)],
  ));
  return {
    request_id: "request-main-1",
    state: "success",
    authoritative_gender: "female",
    shopping_intent: {
      overall_aesthetic: {core_direction: "清新休闲"},
    },
    looks: [
      {look_id: "look-1", items: items1, scores: {final_score: 84}},
      {look_id: "look-2", items: items2, scores: {final_score: 80}},
    ],
  };
}
