const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CALIBRATION_PROVENANCE,
  CRITICAL_DIMENSION_FLOOR,
  OVERALL_QUALITY_FLOOR,
  QUALITY_DIMENSIONS,
  evaluateFinalLookQuality,
} = require("../final_look_quality");

function dimensions(score = 72, overrides = {}) {
  return Object.fromEntries(QUALITY_DIMENSIONS.map((dimension) => [
    dimension,
    overrides[dimension] ?? score,
  ]));
}

test("V1 overall floor follows the existing 60-point wearable calibration", () => {
  const below = evaluateFinalLookQuality({
    overall_score: 59.99,
    dimension_scores: dimensions(72),
  });
  const boundary = evaluateFinalLookQuality({
    overall_score: 60,
    dimension_scores: dimensions(60),
  });

  assert.equal(OVERALL_QUALITY_FLOOR, 60);
  assert.equal(below.status, "FAIL");
  assert.ok(below.reason_codes.includes("OVERALL_BELOW_QUALITY_FLOOR"));
  assert.equal(boundary.status, "PASS");
  assert.equal(CALIBRATION_PROVENANCE.source_kind,
    "existing_project_scoring_semantics");
  assert.equal(CALIBRATION_PROVENANCE.anchors[60], "wearable_but_ordinary");
});

test("31-36 scores are rejected for every critical whole-look dimension", () => {
  QUALITY_DIMENSIONS.forEach((dimension, index) => {
    const value = 31 + (index % 6);
    const result = evaluateFinalLookQuality({
      overall_score: 86,
      dimension_scores: dimensions(86, {[dimension]: value}),
    });
    assert.equal(result.status, "FAIL", dimension);
    assert.ok(result.reason_codes.includes("LOW_QUALITY_LOOK"), dimension);
    assert.ok(result.reason_codes.includes(
      `CRITICAL_DIMENSION_BELOW_FLOOR:${dimension.toUpperCase()}`,
    ), dimension);
  });
  assert.equal(CRITICAL_DIMENSION_FLOOR, 40);
});

test("high overall cannot mask a severe critical-dimension failure", () => {
  const result = evaluateFinalLookQuality({
    overall_score: 94,
    dimension_scores: dimensions(88, {footwear: 35}),
  });

  assert.equal(result.status, "FAIL");
  assert.equal(result.overall_score, 94);
  assert.deepEqual(result.reason_codes, [
    "LOW_QUALITY_LOOK",
    "CRITICAL_DIMENSION_BELOW_FLOOR:FOOTWEAR",
  ]);
});

test("neutral, sporty, and formal looks share one style-agnostic contract", () => {
  for (const label of ["neutral", "sporty", "formal"]) {
    const result = evaluateFinalLookQuality({
      overall_score: 74,
      dimension_scores: dimensions(68),
      label,
    });
    assert.equal(result.status, "PASS", label);
    assert.deepEqual(Object.keys(result.dimension_scores), QUALITY_DIMENSIONS);
    assert.equal(result.calibration_provenance.policy.overall_floor, 60);
  }
});

test("missing dimensions use the documented compatibility default instead of zero", () => {
  const result = evaluateFinalLookQuality({overall_score: 80});
  assert.equal(result.status, "PASS");
  assert.equal(result.dimension_scores.scene, 60);
  assert.equal(result.defaulted_dimensions.includes("scene"), true);
  assert.equal(result.dimension_score_provenance.scene,
    "calibrated_compatibility_default");
});
