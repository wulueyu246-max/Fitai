"use strict";

const FINAL_LOOK_QUALITY_VERSION = "whole_look_quality_floor_v1";
const OVERALL_QUALITY_FLOOR = 60;
const CRITICAL_DIMENSION_FLOOR = 40;
const QUALITY_DIMENSIONS = Object.freeze([
  "scene",
  "desired_impression",
  "contemporary",
  "style",
  "silhouette",
  "color",
  "footwear",
  "quality",
  "body",
  "statement",
]);

const CALIBRATION_PROVENANCE = Object.freeze({
  source: "shopping_agent_v1.selector_score_calibration",
  source_kind: "existing_project_scoring_semantics",
  scale: "0_to_100",
  version: "v1",
  anchors: Object.freeze({
    60: "wearable_but_ordinary",
    70: "attractive_and_recommendable",
    80: "clearly_worth_recommending",
    90: "stylist_grade_excellent",
  }),
  policy: Object.freeze({
    overall_floor: OVERALL_QUALITY_FLOOR,
    critical_dimension_floor: CRITICAL_DIMENSION_FLOOR,
  }),
});

function evaluateFinalLookQuality(input = {}) {
  const overallScore = score(input.overall_score ?? input.overallScore ??
    input.final_score ?? input.finalScore);
  const suppliedDimensions = input.dimension_scores ?? input.dimensionScores ??
    input.dimensions ?? {};
  const defaultedDimensions = [];
  const dimensionScores = Object.freeze(Object.fromEntries(
    QUALITY_DIMENSIONS.map((dimension) => {
      const supplied = score(readDimension(suppliedDimensions, dimension));
      if (supplied == null) defaultedDimensions.push(dimension);
      return [dimension, supplied ?? OVERALL_QUALITY_FLOOR];
    }),
  ));
  const reasonCodes = [];
  if (overallScore == null) reasonCodes.push("OVERALL_SCORE_MISSING");
  else if (overallScore < OVERALL_QUALITY_FLOOR) {
    reasonCodes.push("OVERALL_BELOW_QUALITY_FLOOR");
  }
  for (const dimension of QUALITY_DIMENSIONS) {
    const value = dimensionScores[dimension];
    if (value < CRITICAL_DIMENSION_FLOOR) {
      reasonCodes.push(`CRITICAL_DIMENSION_BELOW_FLOOR:${dimension.toUpperCase()}`);
    }
  }
  const passed = reasonCodes.length === 0;
  if (!passed) reasonCodes.unshift("LOW_QUALITY_LOOK");
  return Object.freeze({
    version: FINAL_LOOK_QUALITY_VERSION,
    status: passed ? "PASS" : "FAIL",
    passed,
    overall_score: overallScore,
    overall_floor: OVERALL_QUALITY_FLOOR,
    critical_dimension_floor: CRITICAL_DIMENSION_FLOOR,
    dimension_scores: dimensionScores,
    defaulted_dimensions: Object.freeze(defaultedDimensions),
    dimension_score_provenance: Object.freeze(Object.fromEntries(
      QUALITY_DIMENSIONS.map((dimension) => [
        dimension,
        defaultedDimensions.includes(dimension)
          ? "calibrated_compatibility_default" : "supplied_or_derived",
      ]),
    )),
    reason_codes: Object.freeze(reasonCodes),
    calibration_provenance: CALIBRATION_PROVENANCE,
  });
}

function readDimension(dimensions, dimension) {
  if (!dimensions || typeof dimensions !== "object") return null;
  const aliases = {
    desired_impression: ["desiredImpression", "impression"],
    contemporary: ["contemporary_fit", "contemporaryFit"],
    silhouette: ["silhouette_fit", "silhouetteFit"],
    footwear: ["footwear_fit", "footwearFit"],
    body: ["body_proportion", "bodyProportion"],
    statement: ["statement_balance", "statementBalance", "visual_hierarchy"],
  };
  for (const key of [dimension, ...(aliases[dimension] || [])]) {
    if (Object.hasOwn(dimensions, key)) return dimensions[key];
  }
  return null;
}

function score(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(100, Math.round(number * 100) / 100));
}

module.exports = {
  CALIBRATION_PROVENANCE,
  CRITICAL_DIMENSION_FLOOR,
  FINAL_LOOK_QUALITY_VERSION,
  OVERALL_QUALITY_FLOOR,
  QUALITY_DIMENSIONS,
  evaluateFinalLookQuality,
};
