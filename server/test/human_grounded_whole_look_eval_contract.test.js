"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const fixture = require("../evaluation/golden/human_grounded_whole_look_v1.json");
const {
  BASELINE_INTEGRITY_SCHEMA,
  EVAL_POLICY,
  INTENT_EXPRESSION_SCHEMA,
  evaluateHumanGroundedWholeLook,
  evaluatePairwise,
  runFrozenReplay,
} = require("../evaluation/human_grounded_whole_look_eval_contract");
const {evaluateFinalLookQuality} = require("../final_look_quality");

const byId = new Map(fixture.samples.map((sample) => [sample.sample_id, sample]));
const positive = byId.get("human-positive-80");

test("schemas separate wearable baseline from intent expression", () => {
  assert.deepEqual(BASELINE_INTEGRITY_SCHEMA.map(({key}) => key), [
    "category_integrity",
    "gender_integrity",
    "body_fit",
    "color_harmony",
    "footwear_compatibility",
    "quality_consistency",
    "silhouette_coherence",
  ]);
  assert.deepEqual(INTENT_EXPRESSION_SCHEMA.map(({key}) => key), [
    "scene_expression_strength",
    "desired_impression_coverage",
    "design_interest",
    "contemporary_expression",
    "silhouette_interest",
    "color_story",
    "footwear_statement",
    "styling_distinction",
    "overall_memorability",
  ]);
  assert.ok(EVAL_POLICY.intent_expression_weight > EVAL_POLICY.baseline_weight);
});

test("UNKNOWN remains null and cannot become the legacy compatibility score of 60", () => {
  const sample = structuredClone(positive);
  sample.intent_expression.design_interest = {
    status: "UNKNOWN",
    source: "product_evidence_missing",
    confidence: 0,
    evidence: [],
  };
  const result = evaluateHumanGroundedWholeLook(sample);

  assert.equal(result.intent_expression.dimensions.design_interest.score, null);
  assert.equal(result.intent_expression.dimensions.design_interest.status, "UNKNOWN");
  assert.equal(result.passed, false);
  assert.ok(result.reason_codes.includes(
    "REQUIRED_INTENT_EVIDENCE_MISSING:DESIGN_INTEREST",
  ));
});

test("a perfect wearable baseline cannot compensate for missing explicit intent evidence", () => {
  const sample = structuredClone(positive);
  Object.values(sample.baseline_integrity).forEach((entry) => {
    entry.score = 100;
  });
  for (const key of sample.required_intent_dimensions) {
    sample.intent_expression[key] = {
      status: "UNKNOWN",
      source: "product_evidence_missing",
      confidence: 0,
      evidence: [],
    };
  }
  const result = evaluateHumanGroundedWholeLook(sample);

  assert.equal(result.baseline_integrity.score, 100);
  assert.equal(result.passed, false);
  assert.equal(result.missing_required_intent_evidence.length, 3);
  assert.ok(result.reason_codes.includes(
    "REQUIRED_INTENT_EVIDENCE_MISSING:SCENE_EXPRESSION_STRENGTH",
  ));
  assert.ok(result.reason_codes.includes(
    "REQUIRED_INTENT_EVIDENCE_MISSING:DESIRED_IMPRESSION_COVERAGE",
  ));
  assert.ok(result.reason_codes.includes(
    "REQUIRED_INTENT_EVIDENCE_MISSING:DESIGN_INTEREST",
  ));
});

for (const [negativeId, humanScore] of [
  ["human-negative-a-40", 40],
  ["human-negative-b-50", 50],
  ["human-negative-c-55", 55],
]) {
  test(`human 80 positive outranks human ${humanScore} negative through intent expression`, () => {
    const result = evaluatePairwise(positive, byId.get(negativeId));
    assert.equal(result.passed, true);
    assert.equal(result.winner, "human-positive-80");
    assert.ok(result.score_margin > 0);
    assert.ok(result.positive_intent_expression_score >
      result.negative_intent_expression_score);
    assert.equal(result.win_basis, "INTENT_EXPRESSION_WITH_BASELINE_INTEGRITY");
  });
}

test("all three ordinary-but-coherent negatives fail the intent-expression layer", () => {
  for (const sample of fixture.samples.filter(({label}) => label === "negative")) {
    const result = evaluateHumanGroundedWholeLook(sample);
    assert.equal(result.passed, false, sample.sample_id);
    assert.ok(result.baseline_integrity.score >= EVAL_POLICY.baseline_floor,
      sample.sample_id);
    assert.ok(result.intent_expression.score < EVAL_POLICY.intent_expression_floor,
      sample.sample_id);
    assert.ok(result.reason_codes.includes("INTENT_EXPRESSION_INSUFFICIENT"),
      sample.sample_id);
  }
});

test("brand and price cannot influence pairwise results", () => {
  const decorated = structuredClone(positive);
  decorated.products.forEach((product, index) => {
    product.brand = `brand-${index}`;
    product.price = 100000 + index;
  });
  const original = evaluateHumanGroundedWholeLook(positive);
  const changed = evaluateHumanGroundedWholeLook(decorated);
  assert.equal(changed.overall_score, original.overall_score);
  assert.deepEqual(changed.scoring_inputs, {brand_used: false, price_used: false});
});

test("legacy quality snapshots demonstrate why missing expression looked like PASS", () => {
  for (const sample of fixture.samples.filter(({label}) => label === "negative")) {
    const legacy = evaluateFinalLookQuality(sample.legacy_machine_snapshot);
    assert.equal(legacy.status, "PASS", sample.sample_id);
    for (const dimension of ["scene", "desired_impression", "contemporary", "statement"]) {
      assert.equal(legacy.dimension_scores[dimension], 60, `${sample.sample_id}:${dimension}`);
      assert.ok(legacy.defaulted_dimensions.includes(dimension));
    }
  }
});

test("explicit targets cannot be replaced by a neutral minimal/daily fallback", () => {
  const polluted = structuredClone(positive);
  polluted.target_contract = fixture.legacy_target_pollution_probe;
  const result = evaluateHumanGroundedWholeLook(polluted);
  assert.equal(result.target_fidelity.passed, false);
  assert.equal(result.passed, false);
  assert.ok(result.reason_codes.includes(
    "EXPLICIT_TARGET_NOT_PRESERVED:SCENE_EXPRESSION_STRENGTH",
  ));
  assert.ok(result.reason_codes.includes(
    "EXPLICIT_TARGET_NOT_PRESERVED:DESIGN_INTEREST",
  ));
});

test("frozen replay is stable and contains exactly the three required pairwise contracts", () => {
  const first = runFrozenReplay(fixture);
  const second = runFrozenReplay(structuredClone(fixture));
  assert.deepEqual(second, first);
  assert.equal(first.passed, true);
  assert.equal(first.pairwise.length, 3);
  assert.equal(first.pairwise.every(({passed}) => passed), true);
  assert.equal(first.evaluations.filter(({passed}) => passed).length, 1);
  assert.equal(first.evaluations.find(({passed}) => passed).sample_id,
    "human-positive-80");
});
