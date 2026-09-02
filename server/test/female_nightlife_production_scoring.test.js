"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const golden = require(
  "../evaluation/golden/human_grounded_whole_look_v1.json"
);
const {
  evaluateHumanGroundedWholeLook,
  evaluatePairwise,
} = require("../evaluation/human_grounded_whole_look_eval_contract");
const {
  FEMALE_NIGHTLIFE_SCORING_CONTRACT,
  applyFemaleNightlifeScoringContract,
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

function phaseOneSample(sample) {
  const copy = structuredClone(sample);
  copy.required_intent_dimensions = applyFemaleNightlifeScoringContract(
    copy.required_intent_dimensions,
    {gender: "female", scene: "nightlife"},
  ).required_intent_dimensions;
  return copy;
}

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

test("production consumes all five calibrated expression dimensions", () => {
  const result = evaluateProductionWholeLook(productionInput());
  assert.equal(result.status, "PASS");
  assert.equal(result.scene_scoring_contract.enabled, true);
  for (const dimension of FEMALE_NIGHTLIFE_SCORING_CONTRACT
    .required_intent_dimensions) {
    assert.ok(result.required_intent_dimensions.includes(dimension));
    assert.equal(result.intent_expression.dimensions[dimension].status, "EVIDENCED");
  }
});

test("UNKNOWN calibrated evidence stays missing instead of matching", () => {
  const positive = phaseOneSample(golden.samples[0]);
  positive.intent_expression.styling_distinction = {status: "UNKNOWN",
    score: null, source: "product_evidence_missing", confidence: 0, evidence: []};
  const result = evaluateHumanGroundedWholeLook(positive);
  assert.equal(result.status, "FAIL");
  assert.ok(result.reason_codes.includes(
    "REQUIRED_INTENT_EVIDENCE_MISSING:STYLING_DISTINCTION"));
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

test("human positive passes and the 40/50/55 negatives still fail", () => {
  const samples = golden.samples.map(phaseOneSample);
  const positive = samples[0];
  const positiveResult = evaluateHumanGroundedWholeLook(positive);
  const negatives = samples.slice(1);
  assert.equal(positiveResult.status, "PASS");
  assert.equal(negatives.every((sample) =>
    evaluateHumanGroundedWholeLook(sample).status === "FAIL"), true);
  assert.deepEqual(negatives.map((sample) => sample.human_score), [40, 50, 55]);
  assert.equal(negatives.every((sample) =>
    evaluatePairwise(positive, sample).passed), true);
});
