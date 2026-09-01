"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  authoritativeIntent,
  evaluateProductionWholeLook,
} = require("../whole_look_human_grounded_score");

function evidence(value, source = "raw_taobao_title", confidence = 0.9) {
  return {value, source, confidence, evidence: [`observed:${value}`]};
}

function fit(score, status = "MATCH", label = "observed") {
  return {
    score,
    status,
    source: "candidate_enrichment",
    confidence: 0.88,
    evidence: [label],
  };
}

function product(id, category, overrides = {}) {
  return {
    candidate_id: id,
    product_id: id,
    category,
    original_gender: "female",
    gender: "female",
    title: `${id} 商品`,
    candidate_enrichment: {
      style_expression: evidence("design_expression"),
      desired_impression_evidence: evidence(["design_led", "youthful"]),
      contemporary_expression: evidence("contemporary"),
      occasion_expression: evidence("nightlife_social"),
      silhouette_evidence: evidence(category === "top" ? "cropped" :
        category === "bottom" ? "a_line" : "fitted"),
      color_evidence: evidence(category === "shoes" ? "black" : "white"),
      footwear_evidence: category === "shoes" ? evidence("loafer") : undefined,
    },
    target_fit_assessment: {
      audience_fit: fit(98, "MATCH", "adult female audience"),
      occasion_fit: fit(88, "MATCH", "night social evidence"),
      desired_impression_fit: fit(86, "MATCH", "young design-led evidence"),
      contemporary_fit: fit(84, "MATCH", "contemporary evidence"),
      quality_fit: fit(74, "PARTIAL", "consistent product quality"),
    },
    ...overrides,
  };
}

function entries(products) {
  return products.map((entry) => ({
    product: entry,
    requirement: {category: entry.category},
  }));
}

function context(overrides = {}) {
  return {
    decision_pipeline: "new_decision_pipeline.v1",
    aesthetic_target_profile: {
      id: "minimal",
      scene: "daily",
      dimensions: {design_interest: 0.1},
    },
    decision_context: {
      user_truth: {gender: "female", scene: "nightlife"},
      intent: {user_intent_brain: {
        scene_intent: {value: "nightlife", source: "user", confidence: 1},
        desired_impression: {
          value: ["年轻", "有设计感"], source: "user", confidence: 1,
        },
        formality_preference: {
          value: "relaxed", source: "user", confidence: 1,
        },
        statement_level: {value: "medium", source: "user", confidence: 1},
        explicit_avoid: {value: ["overly_formal"], source: "user", confidence: 1},
      }},
      ...overrides,
    },
  };
}

function strategyTrace(overrides = {}) {
  return {
    bodyProportion: 78,
    colorHarmony: 84,
    footwearCompatibility: 88,
    materialTexture: 74,
    silhouetteCoherence: 86,
    formality: 82,
    ...overrides,
  };
}

test("production score exposes the two-layer human-grounded contract", () => {
  const products = [
    product("positive-top", "top", {title: "浅色短款设计感上衣"}),
    product("positive-bottom", "bottom", {title: "浅色百褶A字裙"}),
    product("positive-shoes", "shoes", {title: "黑色厚底乐福鞋"}),
  ];
  const result = evaluateProductionWholeLook({
    entries: entries(products),
    strategyTrace: strategyTrace(),
    context: context(),
    target: context().aesthetic_target_profile,
    lookCandidateId: "positive-look",
  });

  assert.equal(result.status, "PASS");
  assert.ok(result.baseline_integrity_score >= 60);
  assert.ok(result.intent_expression_score >= 60);
  assert.ok(result.final_score >= 60);
  assert.equal(result.defaulted_dimensions.length, 0);
  assert.equal(result.intent_authority.scene, "nightlife");
  assert.deepEqual(result.intent_authority.desired_impression,
    ["年轻", "有设计感"]);
  assert.equal(result.intent_authority.explicit_intent_overridden_by_target_profile,
    false);
  assert.equal(result.intent_authority.target_profile_id, "minimal");
});

test("UNKNOWN explicit scene evidence stays null and fails without a default 60", () => {
  const products = [
    product("unknown-top", "top"),
    product("unknown-bottom", "bottom"),
    product("unknown-shoes", "shoes"),
  ];
  products.forEach((entry) => {
    entry.target_fit_assessment.occasion_fit = {
      score: 50,
      status: "UNKNOWN",
      source: "unknown_product_evidence",
      confidence: 0,
      evidence: [],
    };
  });
  const result = evaluateProductionWholeLook({
    entries: entries(products),
    strategyTrace: strategyTrace(),
    context: context(),
  });

  assert.equal(result.status, "FAIL");
  assert.equal(result.intent_expression.dimensions.scene_expression_strength.score,
    null);
  assert.ok(result.failure_reasons.includes(
    "REQUIRED_INTENT_EVIDENCE_MISSING:SCENE_EXPRESSION_STRENGTH",
  ));
  assert.equal(result.dimension_scores.scene, null);
});

test("baseline coherence cannot compensate for missing intent expression", () => {
  const products = [
    product("ordinary-top", "top"),
    product("ordinary-bottom", "bottom"),
    product("ordinary-shoes", "shoes"),
  ];
  products.forEach((entry) => {
    entry.candidate_enrichment.style_expression = undefined;
    entry.candidate_enrichment.desired_impression_evidence = undefined;
    entry.target_fit_assessment.desired_impression_fit = {
      score: 50, status: "UNKNOWN", source: "unknown_product_evidence",
      confidence: 0, evidence: [],
    };
  });
  const result = evaluateProductionWholeLook({
    entries: entries(products),
    strategyTrace: strategyTrace({
      bodyProportion: 100,
      colorHarmony: 100,
      footwearCompatibility: 100,
      materialTexture: 100,
      silhouetteCoherence: 100,
    }),
    context: context(),
  });

  assert.ok(result.baseline_integrity_score >= 90);
  assert.equal(result.status, "FAIL");
  assert.ok(result.failure_reasons.includes(
    "REQUIRED_INTENT_EVIDENCE_MISSING:DESIRED_IMPRESSION_COVERAGE",
  ));
  assert.ok(result.failure_reasons.includes(
    "REQUIRED_INTENT_EVIDENCE_MISSING:DESIGN_INTEREST",
  ));
});

test("DecisionContext intent remains authoritative over minimal/daily target fallback", () => {
  const resolved = authoritativeIntent(context());
  assert.equal(resolved.scene, "nightlife");
  assert.deepEqual(resolved.desired_impression, ["年轻", "有设计感"]);
  assert.equal(resolved.statement_preference, "medium");
  assert.equal(resolved.formality_preference, "relaxed");
  assert.deepEqual(resolved.explicit_avoid, ["overly_formal"]);
});

test("brand and price do not affect human-grounded whole-look scoring", () => {
  const base = [
    product("brandless-top", "top"),
    product("brandless-bottom", "bottom"),
    product("brandless-shoes", "shoes", {title: "黑色厚底乐福鞋"}),
  ];
  const decorated = structuredClone(base);
  decorated.forEach((entry, index) => {
    entry.brand = `expensive-brand-${index}`;
    entry.price = 999999 + index;
  });
  const first = evaluateProductionWholeLook({
    entries: entries(base), strategyTrace: strategyTrace(), context: context(),
  });
  const second = evaluateProductionWholeLook({
    entries: entries(decorated), strategyTrace: strategyTrace(), context: context(),
  });
  assert.equal(second.final_score, first.final_score);
  assert.equal(second.intent_expression_score, first.intent_expression_score);
});

test("explicit formality and avoid remain authoritative production checks", () => {
  const products = [
    product("authority-top", "top"),
    product("authority-bottom", "bottom"),
    product("authority-shoes", "shoes", {
      product_acceptance_result: "HARD_REJECT",
    }),
  ];
  const result = evaluateProductionWholeLook({
    entries: entries(products),
    strategyTrace: strategyTrace({formality: undefined}),
    context: context(),
  });

  assert.equal(result.status, "FAIL");
  assert.equal(result.authority_checks.formality_consumed, false);
  assert.equal(result.authority_checks.explicit_avoid_consumed, false);
  assert.ok(result.failure_reasons.includes("FORMALITY_EVIDENCE_MISSING"));
  assert.ok(result.failure_reasons.includes("EXPLICIT_AVOID_VIOLATION"));
});
