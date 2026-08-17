"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  adaptShoppingAgentSuccess,
  buildShoppingAgentMainInput,
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

test("main-chain input preserves user truth and styling context", () => {
  const input = buildShoppingAgentMainInput(outfitRequest, {
    bodyProfile: "纤细",
    style: "清新休闲",
    style_expression: "feminine",
    styling_constitution: {selected_aesthetic_direction: "清新休闲"},
  }, "request-main-1");
  assert.equal(input.user_input, outfitRequest.user_input);
  assert.equal(input.authoritative_gender, "female");
  assert.equal(input.persona.style, "清新休闲");
  assert.equal(input.weather.temperature_c, 28);
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
  assert.match(response.outfit_plans[0].reason, /真实淘宝候选/);
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
