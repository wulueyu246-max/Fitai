"use strict";

const CONTRACT_VERSION = "human_grounded_whole_look_eval.v1";

const BASELINE_INTEGRITY_SCHEMA = Object.freeze([
  dimension("category_integrity", 0.13),
  dimension("gender_integrity", 0.12),
  dimension("body_fit", 0.13),
  dimension("color_harmony", 0.16),
  dimension("footwear_compatibility", 0.16),
  dimension("quality_consistency", 0.14),
  dimension("silhouette_coherence", 0.16),
]);

const INTENT_EXPRESSION_SCHEMA = Object.freeze([
  dimension("scene_expression_strength", 0.16),
  dimension("desired_impression_coverage", 0.16),
  dimension("design_interest", 0.15),
  dimension("contemporary_expression", 0.10),
  dimension("silhouette_interest", 0.10),
  dimension("color_story", 0.09),
  dimension("footwear_statement", 0.09),
  dimension("styling_distinction", 0.08),
  dimension("overall_memorability", 0.07),
]);

const STATUS = Object.freeze({
  EVIDENCED: "EVIDENCED",
  UNKNOWN: "UNKNOWN",
  NOT_APPLICABLE: "NOT_APPLICABLE",
});

const EVAL_POLICY = Object.freeze({
  baseline_floor: 60,
  intent_expression_floor: 60,
  overall_floor: 60,
  minimum_layer_evidence_coverage: 0.75,
  baseline_weight: 0.35,
  intent_expression_weight: 0.65,
});

function evaluateHumanGroundedWholeLook(sample = {}) {
  const baseline = evaluateLayer(
    sample.baseline_integrity,
    BASELINE_INTEGRITY_SCHEMA,
  );
  const intent = evaluateLayer(
    sample.intent_expression,
    INTENT_EXPRESSION_SCHEMA,
  );
  const requiredIntentDimensions = new Set(
    array(sample.required_intent_dimensions).map(String),
  );
  const missingRequiredIntentEvidence = [...requiredIntentDimensions]
    .filter((key) => intent.dimensions[key]?.status !== STATUS.EVIDENCED);
  const targetFidelity = evaluateTargetFidelity(sample.target_contract);
  const overallScore = baseline.score == null || intent.score == null
    ? null
    : round(
      baseline.score * EVAL_POLICY.baseline_weight +
      intent.score * EVAL_POLICY.intent_expression_weight,
    );
  const reasonCodes = [];

  if (!targetFidelity.passed) reasonCodes.push(...targetFidelity.reason_codes);
  if (baseline.coverage < EVAL_POLICY.minimum_layer_evidence_coverage) {
    reasonCodes.push("BASELINE_EVIDENCE_COVERAGE_INSUFFICIENT");
  }
  if (intent.coverage < EVAL_POLICY.minimum_layer_evidence_coverage) {
    reasonCodes.push("INTENT_EVIDENCE_COVERAGE_INSUFFICIENT");
  }
  missingRequiredIntentEvidence.forEach((key) => {
    reasonCodes.push(`REQUIRED_INTENT_EVIDENCE_MISSING:${key.toUpperCase()}`);
  });
  if (baseline.score == null || baseline.score < EVAL_POLICY.baseline_floor) {
    reasonCodes.push("BASELINE_INTEGRITY_INSUFFICIENT");
  }
  if (intent.score == null || intent.score < EVAL_POLICY.intent_expression_floor) {
    reasonCodes.push("INTENT_EXPRESSION_INSUFFICIENT");
  }
  if (overallScore == null || overallScore < EVAL_POLICY.overall_floor) {
    reasonCodes.push("HUMAN_GROUNDED_OVERALL_INSUFFICIENT");
  }

  return deepFreeze({
    version: CONTRACT_VERSION,
    sample_id: string(sample.sample_id) || null,
    human_score: finiteScore(sample.human_score),
    status: reasonCodes.length === 0 ? "PASS" : "FAIL",
    passed: reasonCodes.length === 0,
    baseline_integrity: baseline,
    intent_expression: intent,
    overall_score: overallScore,
    required_intent_dimensions: [...requiredIntentDimensions],
    missing_required_intent_evidence: missingRequiredIntentEvidence,
    target_fidelity: targetFidelity,
    reason_codes: unique(reasonCodes),
    scoring_inputs: Object.freeze({
      brand_used: false,
      price_used: false,
    }),
  });
}

function evaluatePairwise(positiveSample, negativeSample) {
  const positive = evaluateHumanGroundedWholeLook(positiveSample);
  const negative = evaluateHumanGroundedWholeLook(negativeSample);
  const comparable = positive.overall_score != null && negative.overall_score != null;
  const margin = comparable
    ? round(positive.overall_score - negative.overall_score)
    : null;
  const passed = comparable && positive.passed && !negative.passed && margin > 0 &&
    positive.intent_expression.score > negative.intent_expression.score;
  return deepFreeze({
    positive_sample_id: positive.sample_id,
    negative_sample_id: negative.sample_id,
    positive_score: positive.overall_score,
    negative_score: negative.overall_score,
    score_margin: margin,
    positive_intent_expression_score: positive.intent_expression.score,
    negative_intent_expression_score: negative.intent_expression.score,
    winner: passed ? positive.sample_id : null,
    passed,
    win_basis: passed
      ? "INTENT_EXPRESSION_WITH_BASELINE_INTEGRITY"
      : "PAIRWISE_CONTRACT_NOT_SATISFIED",
  });
}

function runFrozenReplay(fixture = {}) {
  const samples = array(fixture.samples);
  const byId = new Map(samples.map((sample) => [sample.sample_id, sample]));
  const evaluations = samples.map(evaluateHumanGroundedWholeLook);
  const pairwise = array(fixture.pairwise_contracts).map((contract) => {
    const positive = byId.get(contract.positive_sample_id);
    const negative = byId.get(contract.negative_sample_id);
    if (!positive || !negative) {
      return Object.freeze({...contract, passed: false, error: "SAMPLE_NOT_FOUND"});
    }
    return evaluatePairwise(positive, negative);
  });
  return deepFreeze({
    contract_version: CONTRACT_VERSION,
    fixture_version: fixture.fixture_version || null,
    evaluations,
    pairwise,
    passed: evaluations.length > 0 &&
      evaluations.some((entry) => entry.passed) &&
      pairwise.length === 3 && pairwise.every((entry) => entry.passed),
  });
}

function evaluateLayer(input, schema) {
  const source = input && typeof input === "object" ? input : {};
  const dimensions = {};
  let applicableWeight = 0;
  let evidencedWeight = 0;
  let weightedTotal = 0;

  for (const definition of schema) {
    const assessment = normalizeAssessment(source[definition.key]);
    dimensions[definition.key] = assessment;
    if (assessment.status === STATUS.NOT_APPLICABLE) continue;
    applicableWeight += definition.weight;
    if (assessment.status !== STATUS.EVIDENCED) continue;
    evidencedWeight += definition.weight;
    weightedTotal += assessment.score * definition.weight;
  }

  return deepFreeze({
    score: evidencedWeight > 0 ? round(weightedTotal / evidencedWeight) : null,
    coverage: applicableWeight > 0 ? round(evidencedWeight / applicableWeight, 4) : 1,
    dimensions,
  });
}

function normalizeAssessment(input) {
  const source = input && typeof input === "object" ? input : {};
  const requestedStatus = String(source.status || STATUS.UNKNOWN).toUpperCase();
  const status = Object.hasOwn(STATUS, requestedStatus)
    ? STATUS[requestedStatus]
    : STATUS.UNKNOWN;
  if (status !== STATUS.EVIDENCED) {
    return Object.freeze({
      status,
      score: null,
      source: string(source.source) || null,
      confidence: finiteConfidence(source.confidence),
      evidence: Object.freeze(array(source.evidence).map(String)),
    });
  }
  const assessmentScore = finiteScore(source.score);
  const evidence = array(source.evidence).map(String).filter(Boolean);
  const evidenceSource = string(source.source);
  const valid = assessmentScore != null && evidence.length > 0 &&
    evidenceSource && evidenceSource !== "user_requirement";
  return Object.freeze({
    status: valid ? STATUS.EVIDENCED : STATUS.UNKNOWN,
    score: valid ? assessmentScore : null,
    source: evidenceSource || null,
    confidence: finiteConfidence(source.confidence),
    evidence: Object.freeze(evidence),
  });
}

function evaluateTargetFidelity(contract) {
  const source = contract && typeof contract === "object" ? contract : {};
  const explicit = array(source.explicit_requirements);
  const resolved = array(source.resolved_requirements);
  const missing = explicit.filter((requirement) => !resolved.some((candidate) =>
    candidate?.dimension === requirement?.dimension &&
    candidate?.value === requirement?.value &&
    candidate?.source === "user_intent",
  ));
  return deepFreeze({
    passed: explicit.length > 0 && missing.length === 0,
    explicit_requirement_count: explicit.length,
    preserved_requirement_count: explicit.length - missing.length,
    missing_requirements: missing,
    reason_codes: missing.map((entry) =>
      `EXPLICIT_TARGET_NOT_PRESERVED:${String(entry?.dimension || "UNKNOWN").toUpperCase()}`),
  });
}

function dimension(key, weight) {
  return Object.freeze({key, weight});
}

function finiteScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(100, round(number)));
}

function finiteConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(1, round(number, 4)));
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
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
  BASELINE_INTEGRITY_SCHEMA,
  CONTRACT_VERSION,
  EVAL_POLICY,
  INTENT_EXPRESSION_SCHEMA,
  STATUS,
  evaluateHumanGroundedWholeLook,
  evaluatePairwise,
  runFrozenReplay,
};
