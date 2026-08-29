"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  canonicalProductIdentity,
  evaluateProductAcceptance,
} = require("../product_acceptance_gate");
const {
  calibratedProductScore,
  classifyRerankerFailure,
} = require("../product_aesthetic_reranker");
const {composeOutfitCandidates} = require("../outfit_aesthetic_strategy");
const {
  AutoProductProvider,
  runSharedCandidatePipeline,
} = require("../product_provider");

function context({
  raw = "年轻约会，干净时髦，不要像上班",
  gender = "male",
  scene = "date",
  desired = ["年轻", "干净", "时髦"],
  explicitStyle = null,
} = {}) {
  return {
    gender,
    scene,
    decision_pipeline: "new_decision_pipeline.v1",
    decision_context: {
      raw_user_input: raw,
      user_truth: {gender, scene, explicit_avoid: []},
      intent: {user_intent_brain: {
        desired_impression: {value: desired, source: "user", confidence: 1},
        explicit_avoid: {value: [], source: "user", confidence: 1},
        explicit_style: {value: explicitStyle, source: "user", confidence: 1},
      }},
    },
  };
}

function requirement(category, overrides = {}) {
  return {
    look_id: "look-1",
    concept_id: "concept-1",
    category,
    gender: "male",
    scene: "date",
    ...overrides,
  };
}

function product(title, overrides = {}) {
  return {
    product_id: overrides.product_id || "candidate-1",
    title,
    category: overrides.category || "shoes",
    original_category: overrides.category || "shoes",
    gender: overrides.gender || "male",
    original_gender: overrides.gender || "male",
    price: overrides.price ?? 199,
    image_url: overrides.image_url || "https://img.example.com/item.jpg",
    source: "taobao",
    is_mock: false,
    ...overrides,
  };
}

test("A: young male date prefers contemporary casual footwear evidence", () => {
  const ctx = context();
  const req = requirement("shoes");
  const modern = evaluateProductAcceptance(
    product("男士简约时髦休闲鞋新款"),
    req,
    ctx,
  );
  const traditional = evaluateProductAcceptance(
    product("男士传统布鞋一脚蹬"),
    req,
    ctx,
  );
  assert.equal(modern.allowed, true);
  assert.equal(traditional.allowed, true);
  assert.ok(modern.acceptance.penalty < traditional.acceptance.penalty);
  assert.equal(
    traditional.acceptance.evidence.contemporary_fit.value,
    "mismatch",
  );
});

test("B: young female nightlife penalizes mature commuter expression", () => {
  const ctx = context({
    raw: "今晚出去玩，年轻一点，有设计感，别太正式",
    gender: "female",
    scene: "nightlife",
    desired: ["年轻", "有设计感"],
  });
  const req = requirement("shoes", {gender: "female", scene: "nightlife"});
  const modern = evaluateProductAcceptance(
    product("女款设计感轻量浅口鞋", {gender: "female"}),
    req,
    ctx,
  );
  const mature = evaluateProductAcceptance(
    product("女士成熟通勤妈妈款单鞋", {gender: "female"}),
    req,
    ctx,
  );
  assert.ok(modern.acceptance.penalty < mature.acceptance.penalty);
  assert.equal(mature.acceptance.evidence.audience_fit.value, "mismatch");
});

test("C: confirmed child product is a hard reject for an adult request", () => {
  const result = evaluateProductAcceptance(
    product("品牌男童短袖T恤", {category: "top"}),
    requirement("top"),
    context(),
  );
  assert.equal(result.allowed, false);
  assert.equal(result.acceptance.result, "HARD_REJECT");
  assert.deepEqual(result.acceptance.hard_reasons, [
    "AUDIENCE_SEVERE_MISMATCH",
  ]);
});

test("D: explicit business/formal intent does not reject mature business shoes", () => {
  const ctx = context({
    raw: "正式商务活动，需要稳重的正装",
    scene: "formal_event",
    desired: ["正式", "稳重"],
    explicitStyle: "formal",
  });
  const result = evaluateProductAcceptance(
    product("男士商务正装牛津皮鞋"),
    requirement("shoes", {scene: "formal_event", style: "formal"}),
    ctx,
  );
  assert.equal(result.allowed, true);
  assert.notEqual(result.acceptance.evidence.contemporary_fit.value, "mismatch");
  assert.notEqual(result.acceptance.evidence.occasion_fit.value, "mismatch");
});

test("E: explicit vintage/traditional intent allows traditional footwear", () => {
  const ctx = context({
    raw: "想要复古传统风格的日常穿搭",
    scene: "daily",
    desired: ["复古", "传统"],
    explicitStyle: "american_vintage",
  });
  const result = evaluateProductAcceptance(
    product("男士传统布鞋复古款"),
    requirement("shoes", {scene: "daily", style: "american_vintage"}),
    ctx,
  );
  assert.equal(result.allowed, true);
  assert.notEqual(result.acceptance.evidence.contemporary_fit.value, "mismatch");
});

test("F: a low-priced but supported fashionable product is not price-rejected", () => {
  const ctx = context({gender: "female", desired: ["有设计感", "时髦"]});
  const result = evaluateProductAcceptance(
    product("女款不对称拼接设计感上衣", {
      category: "top",
      gender: "female",
      price: 5,
      candidate_enrichment: {
        quality_evidence: {
          value: "evidence_available",
          source: "api_and_text",
          confidence: 0.8,
          evidence: ["title:立体剪裁"],
        },
      },
    }),
    requirement("top", {gender: "female"}),
    ctx,
  );
  assert.equal(result.allowed, true);
  assert.equal(
    result.acceptance.evidence.commerce_quality.value,
    "low_price_but_supported",
  );
});

test("G: a high price cannot overturn a severe aesthetic mismatch", () => {
  const ctx = context();
  const req = requirement("shoes");
  const suitable = evaluateProductAcceptance(
    product("男士简约时髦休闲鞋", {price: 129}),
    req,
    ctx,
  ).product;
  const expensiveMismatch = evaluateProductAcceptance(
    product("男士传统成熟布鞋一脚蹬", {price: 1299}),
    req,
    ctx,
  ).product;
  const assessment = {
    style_fit: 80,
    occasion_fit: 80,
    silhouette_fit: 75,
    color_fit: 75,
    footwear_fit: 80,
    quality_fit: 80,
    gender_fit: 100,
    style_classification: "TEST",
    occasion_classification: "TEST",
    metadata_missing: [],
  };
  const score = (item) => calibratedProductScore({
    assessment,
    relevanceScore: 80,
    blueprintMatchScore: 80,
    aestheticScore: 80,
    visualQualityScore: 70,
    bodyStrategyScore: 70,
    brandQualityScore: 90,
    product: item,
  }).finalScore;
  assert.ok(score(suitable) > score(expensiveMismatch));
});

function strategyProduct(lookId, category, id, title, overrides = {}) {
  return product(title, {
    look_id: lookId,
    category,
    original_category: category,
    product_id: id,
    image_url: `https://img.example.com/${id}.jpg`,
    style_match_score: 80,
    aesthetic_score: 80,
    final_score: 80,
    brand_quality_score: 60,
    body_strategy_match_score: 70,
    product_acceptance_penalty: 0,
    ...overrides,
  });
}

test("H: three distinct looks strongly penalize the same underlying core product", () => {
  const requirements = [];
  const products = [];
  for (let index = 1; index <= 3; index += 1) {
    const lookId = `look-${index}`;
    requirements.push(
      requirement("top", {look_id: lookId}),
      requirement("bottom", {look_id: lookId}),
      requirement("shoes", {look_id: lookId}),
    );
    products.push(
      strategyProduct(lookId, "top", `top-${index}`, `简约上衣${index}`),
      strategyProduct(lookId, "bottom", `bottom-${index}`, `直筒裤${index}`),
      strategyProduct(lookId, "shoes", `shared-listing-${index}`, "同一款简约休闲鞋", {
        final_score: 95,
        image_url: "https://img.example.com/shared-shoe.jpg?tracking=ignored",
      }),
    );
    if (index > 1) {
      products.push(strategyProduct(
        lookId,
        "shoes",
        `alternate-${index}`,
        `替代休闲鞋${index}`,
        {final_score: 84},
      ));
    }
  }
  const result = composeOutfitCandidates({
    requirements,
    products,
    context: context(),
  });
  const selectedShoes = result.products.filter((item) => item.category === "shoes");
  assert.equal(selectedShoes.length, 3);
  assert.equal(new Set(selectedShoes.map(canonicalProductIdentity)).size, 3);
  assert.equal(
    selectedShoes.filter((item) => item.title === "同一款简约休闲鞋").length,
    1,
  );
});

test("reranker fallback classification distinguishes timeout and parser errors", () => {
  assert.equal(
    classifyRerankerFailure({code: "AI_RERANK_TIMEOUT"}).category,
    "TIMEOUT",
  );
  assert.equal(
    classifyRerankerFailure({name: "SyntaxError", message: "invalid JSON"}).category,
    "SCHEMA_OR_RESPONSE_VALIDATION",
  );
});

test("shared pipeline records acceptance evidence from gate through Strategy", async () => {
  const lookId = "acceptance-trace-look";
  const requirements = [
    requirement("top", {look_id: lookId}),
    requirement("bottom", {look_id: lookId}),
    requirement("shoes", {look_id: lookId}),
  ];
  const candidates = {
    top: [
      product("品牌男童短袖T恤", {
        look_id: lookId,
        product_id: "child-top",
        category: "top",
      }),
      product("男士简约干净短袖T恤", {
        look_id: lookId,
        product_id: "adult-top",
        category: "top",
      }),
    ],
    bottom: [product("男士简约直筒长裤", {
      look_id: lookId,
      product_id: "adult-bottom",
      category: "bottom",
    })],
    shoes: [product("男士简约时髦休闲鞋", {
      look_id: lookId,
      product_id: "adult-shoes",
      category: "shoes",
    })],
  };
  const result = await runSharedCandidatePipeline({
    requirements,
    groups: requirements.map((item) => ({
      requirement: item,
      candidates: candidates[item.category],
    })),
    context: context(),
    provider: "taobao",
    logger: {info() {}, warn() {}},
    reranker: {
      async rerank({groups}) {
        return groups.flatMap((group) => group.candidates.map((item) => ({
          ...item,
          final_score: 80,
          ai_match_score: 80,
          ai_rerank_fallback: false,
        })));
      },
    },
  });
  const child = result.trace.gate_reject.find((item) =>
    item.candidate_id === "child-top");
  assert.equal(child.reason, "PRODUCT_ACCEPTANCE_AUDIENCE_SEVERE_MISMATCH");
  assert.equal(child.product_acceptance_result, "HARD_REJECT");
  assert.equal(
    child.product_acceptance_evidence.audience_fit.source,
    "explicit_product_text",
  );
  assert.equal(result.trace.reranker_executed, true);
  assert.equal(result.trace.strategy_executed, true);
  assert.equal(result.trace.strategy_selected.length, 3);
  assert.equal(result.trace.strategy_selected.every((item) =>
    item.product_acceptance_result !== null &&
    item.underlying_product_key.length === 24), true);
});

test("Auto provider forwards the child provider candidate trace", async () => {
  const childTrace = {request_id: "trace-id", strategy_selected: []};
  const auto = new AutoProductProvider({
    taobao: {
      lastPipelineTrace: childTrace,
      async recommendForQueries() { return []; },
    },
    allowMockFallback: false,
    logger: {warn() {}},
  });
  await auto.recommendForQueries([], {});
  assert.equal(auto.lastPipelineTrace, childTrace);
});
