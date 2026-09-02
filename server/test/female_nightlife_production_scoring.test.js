"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const golden = require(
  "../evaluation/golden/female_nightlife_youthful_social_energy_v1.json"
);
const {
  evaluateFemaleNightlifeYouthfulSocialEnergy,
  evaluatePairwise,
} = require(
  "../evaluation/female_nightlife_youthful_social_energy_contract"
);
const {
  FEMALE_NIGHTLIFE_SCORING_CONTRACT,
  resolveFemaleNightlifeScoringContract,
} = require("../female_nightlife_scoring_adapter");
const {evaluateProductionWholeLook} = require(
  "../whole_look_human_grounded_score"
);

const PENDING_SCENES = Object.freeze([
  {gender: "female", scene: "casual_social"},
  {gender: "female", scene: "elevated_social"},
  {gender: "male", scene: "casual_social"},
  {gender: "male", scene: "date_social"},
  {gender: "male", scene: "nightlife"},
]);

function semantic(value) {
  return {value, source: "raw_taobao_title", confidence: 0.9,
    evidence: [`observed:${Array.isArray(value) ? value.join("|") : value}`]};
}

function fit(score, evidence) {
  return {score, status: "MATCH", source: "candidate_enrichment",
    confidence: 0.9, evidence: [evidence]};
}

function product(id, category) {
  const silhouette = category === "top" ? "cropped" :
    category === "bottom" ? "a_line" : "fitted";
  const color = category === "shoes" ? "black" : "ivory";
  return {
    candidate_id: id, product_id: id, category,
    original_gender: "female", gender: "female",
    title: `${color} ${silhouette} design-led ${category}`,
    candidate_enrichment: {
      style_expression: semantic("design_expression"),
      desired_impression_evidence: semantic(["design_led", "youthful"]),
      contemporary_expression: semantic("contemporary"),
      occasion_expression: semantic("nightlife_social"),
      silhouette_evidence: semantic(silhouette),
      color_evidence: semantic(color),
      footwear_evidence: category === "shoes" ? semantic("loafer") : undefined,
    },
    target_fit_assessment: {
      audience_fit: fit(96, "adult female audience"),
      occasion_fit: fit(88, "night social evidence"),
      desired_impression_fit: fit(86, "young design-led evidence"),
      contemporary_fit: fit(84, "contemporary evidence"),
      quality_fit: fit(76, "consistent quality"),
    },
  };
}

function productionInput(strategyOverrides = {}) {
  const products = [product("top-1", "top"), product("bottom-1", "bottom"),
    product("shoes-1", "shoes")];
  return {
    entries: products.map((entry) => ({product: entry,
      requirement: {category: entry.category}})),
    strategyTrace: {bodyProportion: 78, colorHarmony: 84,
      footwearCompatibility: 88, materialTexture: 76,
      silhouetteCoherence: 86, formality: 82, ...strategyOverrides},
    context: {decision_context: {
      user_truth: {gender: "female", scene: "nightlife"},
      intent: {user_intent_brain: {
        scene_intent: {value: "nightlife_social", source: "user"},
        desired_impression: {value: ["年轻", "有设计感"], source: "user"},
        formality_preference: {value: "relaxed", source: "user"},
        statement_level: {value: "medium", source: "user"},
        explicit_avoid: {value: ["overly_formal"], source: "user"},
      }},
    }},
  };
}

test("production activation is limited to female_nightlife", () => {
  for (const scene of ["nightlife", "nightlife_social"]) {
    const active = resolveFemaleNightlifeScoringContract({gender: "female", scene});
    assert.equal(active.enabled, true);
    assert.equal(active.contract_id, "female_nightlife");
  }
  for (const pending of PENDING_SCENES) {
    assert.equal(resolveFemaleNightlifeScoringContract(pending).enabled, false);
  }
});

test("production consumes all six calibrated expression dimensions", () => {
  const result = evaluateProductionWholeLook(productionInput());
  assert.equal(result.status, "PASS");
  assert.equal(result.scene_scoring_contract.enabled, true);
  for (const dimension of FEMALE_NIGHTLIFE_SCORING_CONTRACT
    .required_intent_dimensions) {
    assert.ok(result.required_intent_dimensions.includes(dimension));
    assert.equal(result.intent_expression.dimensions[dimension].status, "EVIDENCED");
  }
  assert.equal(
    Number.isFinite(result.intent_expression.dimensions
      .youthful_social_energy.score),
    true,
  );
});

test("UNKNOWN youthful social energy stays missing instead of matching", () => {
  const input = productionInput();
  for (const entry of input.entries) {
    delete entry.product.candidate_enrichment.silhouette_evidence;
  }
  const result = evaluateProductionWholeLook(input);
  assert.equal(result.status, "FAIL");
  assert.equal(
    result.intent_expression.dimensions.youthful_social_energy.score,
    null,
  );
  assert.ok(result.reason_codes.includes(
    "REQUIRED_INTENT_EVIDENCE_MISSING:YOUTHFUL_SOCIAL_ENERGY"));
});

test("pending scenes do not receive youthful social energy scoring", () => {
  const input = productionInput();
  input.context.decision_context.user_truth.scene = "casual_social";
  input.context.decision_context.intent.user_intent_brain.scene_intent = {
    value: "casual_social", source: "user",
  };
  const result = evaluateProductionWholeLook(input);
  assert.equal(result.scene_scoring_contract.enabled, false);
  assert.equal(result.intent_expression.dimensions.youthful_social_energy,
    undefined);
});

test("strong expression cannot compensate for weak baseline integrity", () => {
  const result = evaluateProductionWholeLook(productionInput({
    bodyProportion: 25, colorHarmony: 25, footwearCompatibility: 25,
    materialTexture: 25, silhouetteCoherence: 25,
  }));
  assert.ok(result.intent_expression_score >= 60);
  assert.ok(result.baseline_integrity_score < 60);
  assert.equal(result.status, "FAIL");
  assert.ok(result.failure_reasons.includes("BASELINE_INTEGRITY_INSUFFICIENT"));
});

test("human 84.54 positive passes and old nightlife results do not pass", () => {
  const positive = golden.samples.find(({sample_id}) =>
    sample_id === golden.positive_sample_id);
  const negatives = golden.samples.filter(({sample_id}) =>
    sample_id !== positive.sample_id);
  const positiveResult = evaluateFemaleNightlifeYouthfulSocialEnergy(positive);
  const negativeResults = negatives.map(
    evaluateFemaleNightlifeYouthfulSocialEnergy);
  assert.equal(positiveResult.status, "PASS");
  assert.equal(positiveResult.score, 84.54);
  assert.deepEqual(negativeResults.map(({score}) => score),
    [28.82, 49.62, 43.52]);
  assert.equal(negativeResults.some(({status}) => status === "PASS"), false);
  assert.equal(negatives.every((sample) =>
    evaluatePairwise(positive, sample).passed), true);
});
