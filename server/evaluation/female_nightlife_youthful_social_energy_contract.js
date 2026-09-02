"use strict";

const CONTRACT_VERSION =
  "female_nightlife_youthful_social_energy_contract.v1";

const STATUS = Object.freeze({
  EVIDENCED: "EVIDENCED",
  UNKNOWN: "UNKNOWN",
});

const ENERGY_COMPONENTS = Object.freeze([
  "vitality",
  "focal_point",
  "memorability",
  "social_presence",
]);

const INTENT_EXPRESSION_SCHEMA = Object.freeze([
  dimension("scene_expression_strength", 0.16),
  dimension("desired_impression_coverage", 0.15),
  dimension("design_interest", 0.15),
  dimension("styling_distinction", 0.13),
  dimension("overall_memorability", 0.12),
  dimension("youthful_social_energy", 0.21),
  dimension("footwear_statement", 0.08),
]);

const POLICY = Object.freeze({
  pass_floor: 70,
  medium_floor: 45,
  youthful_social_energy_floor: 65,
  required_evidence_coverage: 1,
});

function evaluateFemaleNightlifeYouthfulSocialEnergy(sample = {}) {
  const input = object(sample.intent_expression);
  const dimensions = {};
  const missing = [];
  let total = 0;

  for (const definition of INTENT_EXPRESSION_SCHEMA) {
    const assessment = definition.key === "youthful_social_energy"
      ? evaluateEnergy(input[definition.key])
      : normalizeAssessment(input[definition.key]);
    dimensions[definition.key] = assessment;
    if (assessment.status !== STATUS.EVIDENCED) {
      missing.push(definition.key);
      continue;
    }
    total += assessment.score * definition.weight;
  }

  const coverage = round(
    (INTENT_EXPRESSION_SCHEMA.length - missing.length) /
      INTENT_EXPRESSION_SCHEMA.length,
    4,
  );
  const score = missing.length === 0 ? round(total) : null;
  const energy = dimensions.youthful_social_energy;
  const reasons = [];
  if (sample.golden_source !== "human_feedback") {
    reasons.push("GOLDEN_SOURCE_NOT_HUMAN_FEEDBACK");
  }
  missing.forEach((key) => reasons.push(
    `REQUIRED_EVIDENCE_MISSING:${key.toUpperCase()}`,
  ));
  if (energy.status === STATUS.EVIDENCED &&
      energy.score < POLICY.youthful_social_energy_floor) {
    reasons.push("YOUTHFUL_SOCIAL_ENERGY_INSUFFICIENT");
  }

  const band = score == null ? "FAIL" :
    score >= POLICY.pass_floor &&
      energy.score >= POLICY.youthful_social_energy_floor ? "PASS" :
      score >= POLICY.medium_floor ? "MEDIUM" : "FAIL";
  if (band === "FAIL" && score != null && reasons.length === 0) {
    reasons.push("INTENT_EXPRESSION_INSUFFICIENT");
  }
  if (band === "MEDIUM") reasons.push("INTENT_EXPRESSION_MEDIUM_ONLY");

  return deepFreeze({
    version: CONTRACT_VERSION,
    sample_id: string(sample.sample_id) || null,
    status: band,
    passed: band === "PASS" && reasons.length === 0,
    score,
    evidence_coverage: coverage,
    dimensions,
    missing_required_evidence: missing,
    reason_codes: unique(reasons),
    age_inference_used: false,
    footwear_category_used_as_statement_proxy: false,
  });
}

function evaluatePairwise(positive, comparison) {
  const winner = evaluateFemaleNightlifeYouthfulSocialEnergy(positive);
  const other = evaluateFemaleNightlifeYouthfulSocialEnergy(comparison);
  const margin = winner.score == null || other.score == null
    ? null : round(winner.score - other.score);
  const passed = winner.passed && !other.passed && margin > 0 &&
    winner.dimensions.youthful_social_energy.score >
      other.dimensions.youthful_social_energy.score;
  return deepFreeze({
    positive_sample_id: winner.sample_id,
    comparison_sample_id: other.sample_id,
    positive_score: winner.score,
    comparison_score: other.score,
    score_margin: margin,
    winner: passed ? winner.sample_id : null,
    win_basis: passed
      ? "HUMAN_GROUNDED_INTENT_EXPRESSION"
      : "PAIRWISE_CONTRACT_NOT_SATISFIED",
    passed,
  });
}

function evaluateEnergy(input) {
  const source = object(input);
  const components = {};
  const missing = [];
  for (const key of ENERGY_COMPONENTS) {
    const assessment = normalizeAssessment(object(source.components)[key]);
    components[key] = assessment;
    if (assessment.status !== STATUS.EVIDENCED) missing.push(key);
  }
  if (missing.length > 0) {
    return deepFreeze({
      status: STATUS.UNKNOWN,
      score: null,
      source: string(source.source) || null,
      confidence: confidence(source.confidence),
      evidence: [],
      components,
      missing_components: missing,
    });
  }
  return deepFreeze({
    status: STATUS.EVIDENCED,
    score: round(average(Object.values(components).map(({score}) => score))),
    source: unique(Object.values(components).map(({source}) => source)).join("+"),
    confidence: Math.min(...Object.values(components)
      .map(({confidence: value}) => value ?? 0)),
    evidence: unique(Object.values(components).flatMap(({evidence}) => evidence)),
    components,
    missing_components: [],
  });
}

function normalizeAssessment(input) {
  const source = object(input);
  const score = finiteScore(source.score);
  const evidence = array(source.evidence).map(String).filter(Boolean);
  const evidenceSource = string(source.source);
  const valid = String(source.status || "").toUpperCase() === STATUS.EVIDENCED &&
    score != null && evidence.length > 0 && evidenceSource === "human_feedback";
  return deepFreeze({
    status: valid ? STATUS.EVIDENCED : STATUS.UNKNOWN,
    score: valid ? score : null,
    source: evidenceSource || null,
    confidence: confidence(source.confidence),
    evidence: valid ? evidence : [],
  });
}

function dimension(key, weight) {
  return Object.freeze({key, weight});
}

function finiteScore(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : null;
}

function confidence(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : null;
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function string(value) {
  return typeof value === "string" ? value.trim() : "";
}

function unique(values) {
  return [...new Set(values)];
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

module.exports = {
  CONTRACT_VERSION,
  ENERGY_COMPONENTS,
  INTENT_EXPRESSION_SCHEMA,
  POLICY,
  STATUS,
  evaluateFemaleNightlifeYouthfulSocialEnergy,
  evaluatePairwise,
};
