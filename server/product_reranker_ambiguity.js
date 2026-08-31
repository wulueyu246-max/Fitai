"use strict";

const DEFAULT_ADJUDICATION_MARGIN = 3;
const MAX_ADJUDICATION_CALLS = 3;

const UNCERTAIN_VALUES = new Set([
  "unknown",
  "unsupported",
  "compatible_or_unknown",
]);

const CONFLICT_FIELDS = Object.freeze([
  ["audience_fit", "AUDIENCE_FIT_CONFLICT"],
  ["occasion_fit", "OCCASION_FIT_CONFLICT"],
]);

const UNCERTAINTY_FIELDS = Object.freeze([
  ["contemporary_fit", "CONTEMPORARY_FIT_UNCERTAIN"],
  ["desired_impression_fit", "DESIRED_IMPRESSION_FIT_UNCERTAIN"],
]);

function buildAmbiguityPlan(groups = [], {
  margin = DEFAULT_ADJUDICATION_MARGIN,
  maxCalls = MAX_ADJUDICATION_CALLS,
} = {}) {
  const safeMargin = positiveNumber(margin, DEFAULT_ADJUDICATION_MARGIN);
  const safeMaxCalls = Math.min(
    MAX_ADJUDICATION_CALLS,
    positiveInteger(maxCalls, MAX_ADJUDICATION_CALLS),
  );
  const slots = (Array.isArray(groups) ? groups : []).map((group, index) =>
    detectGroupAmbiguity(group, {index, margin: safeMargin}));
  const selectedIndexes = new Set(slots
    .filter((slot) => slot.ai_adjudication_required)
    .sort(compareAmbiguityPriority)
    .slice(0, safeMaxCalls)
    .map((slot) => slot.group_index));
  const plannedSlots = slots.map((slot) => Object.freeze({
    ...slot,
    selected_for_adjudication: selectedIndexes.has(slot.group_index),
    status: !slot.ai_adjudication_required
      ? slot.status
      : selectedIndexes.has(slot.group_index)
        ? "AI_ADJUDICATION_REQUIRED"
        : "ADJUDICATION_LIMIT_REACHED",
  }));
  return Object.freeze({
    margin: safeMargin,
    max_calls: safeMaxCalls,
    total_slot_count: plannedSlots.length,
    ambiguity_count: plannedSlots.filter((slot) =>
      slot.ai_adjudication_required).length,
    selected_count: selectedIndexes.size,
    slots: Object.freeze(plannedSlots),
  });
}

function detectGroupAmbiguity(group = {}, {
  index = 0,
  margin = DEFAULT_ADJUDICATION_MARGIN,
} = {}) {
  const candidates = (Array.isArray(group?.candidates) ? group.candidates : [])
    .filter((candidate) => String(
      candidate?.product_acceptance_result || "PASS",
    ).toUpperCase() !== "HARD_REJECT")
    .slice(0, 2);
  const requirement = group?.requirement || {};
  const slot = String(
    requirement.category || requirement.slot || candidates[0]?.category || "",
  ).trim().toLowerCase();
  const lookId = String(
    requirement.look_id || requirement.lookId || candidates[0]?.look_id || "",
  ).trim();
  const top = candidates[0] || null;
  const second = candidates[1] || null;
  if (!top) {
    return Object.freeze({
      group_index: index,
      look_id: lookId,
      slot,
      top_candidate_id: "",
      second_candidate_id: "",
      top_score: null,
      second_score: null,
      score_gap: null,
      reasons: Object.freeze([]),
      priority_score: 0,
      ai_adjudication_required: false,
      status: "NO_ELIGIBLE_CANDIDATES",
    });
  }
  if (!second) {
    return Object.freeze({
      group_index: index,
      look_id: lookId,
      slot,
      top_candidate_id: candidateId(top),
      second_candidate_id: "",
      top_score: deterministicScore(top),
      second_score: null,
      score_gap: null,
      reasons: Object.freeze([]),
      priority_score: 0,
      ai_adjudication_required: false,
      status: "SINGLE_CANDIDATE",
    });
  }

  const topScore = deterministicScore(top);
  const secondScore = deterministicScore(second);
  const scoreGap = Math.max(0, topScore - secondScore);
  const reasons = [];
  if (scoreGap < positiveNumber(margin, DEFAULT_ADJUDICATION_MARGIN)) {
    reasons.push("DETERMINISTIC_MARGIN_AMBIGUOUS");
  }

  for (const [field, reason] of CONFLICT_FIELDS) {
    if (acceptanceEvidenceConflict(top, second, field)) reasons.push(reason);
  }
  for (const [field, reason] of UNCERTAINTY_FIELDS) {
    if (acceptanceEvidenceUncertain(top, field) ||
        acceptanceEvidenceUncertain(second, field)) reasons.push(reason);
  }
  if (visualStyleEvidenceConflict(top) || visualStyleEvidenceConflict(second)) {
    reasons.push("VISUAL_STYLE_EVIDENCE_CONFLICT");
  }
  if (highScoreStyleDivergence(top, second)) {
    reasons.push("HIGH_SCORE_STYLE_EXPRESSION_DIVERGENCE");
  }

  const uniqueReasons = [...new Set(reasons)];
  const evidenceReasons = uniqueReasons.filter((reason) =>
    reason !== "DETERMINISTIC_MARGIN_AMBIGUOUS");
  const priority = roundScore(
    Math.max(0, positiveNumber(margin, DEFAULT_ADJUDICATION_MARGIN) - scoreGap) +
    evidenceReasons.length * 10 +
    (uniqueReasons.includes("AUDIENCE_FIT_CONFLICT") ? 5 : 0) +
    (uniqueReasons.includes("OCCASION_FIT_CONFLICT") ? 4 : 0),
  );
  return Object.freeze({
    group_index: index,
    look_id: lookId,
    slot,
    top_candidate_id: candidateId(top),
    second_candidate_id: candidateId(second),
    top_score: topScore,
    second_score: secondScore,
    score_gap: roundScore(scoreGap),
    reasons: Object.freeze(uniqueReasons),
    priority_score: priority,
    ai_adjudication_required: uniqueReasons.length > 0,
    status: uniqueReasons.length > 0
      ? "AI_ADJUDICATION_REQUIRED"
      : "DETERMINISTIC_MARGIN_CLEAR",
  });
}

function acceptanceEvidenceConflict(left, right, field) {
  const leftEvidence = acceptanceEvidence(left, field);
  const rightEvidence = acceptanceEvidence(right, field);
  if (!leftEvidence || !rightEvidence) return false;
  const leftValue = normalizedValue(leftEvidence.value);
  const rightValue = normalizedValue(rightEvidence.value);
  if (!leftValue || !rightValue || leftValue === rightValue) return false;
  return Math.max(
    numericConfidence(leftEvidence),
    numericConfidence(rightEvidence),
  ) >= 0.6;
}

function acceptanceEvidenceUncertain(candidate, field) {
  const item = acceptanceEvidence(candidate, field);
  if (!item) return true;
  const value = normalizedValue(item.value);
  return !value || UNCERTAIN_VALUES.has(value) || numericConfidence(item) < 0.6;
}

function visualStyleEvidenceConflict(candidate = {}) {
  const visual = acceptanceEvidence(candidate, "visual_quality");
  if (!visual) return false;
  const value = normalizedValue(visual.value);
  const styleScore = finiteNumber(
    candidate.style_fit_score ??
    candidate.aesthetic_target_assessment?.style_fit ??
    candidate.style_match_score,
  );
  return ["low", "mismatch"].includes(value) &&
    numericConfidence(visual) >= 0.6 &&
    styleScore != null && styleScore >= 70;
}

function highScoreStyleDivergence(left = {}, right = {}) {
  if (Math.min(deterministicScore(left), deterministicScore(right)) < 70) {
    return false;
  }
  const leftTags = structuredStyleTags(left);
  const rightTags = structuredStyleTags(right);
  if (leftTags.size === 0 || rightTags.size === 0) return false;
  return [...leftTags].every((tag) => !rightTags.has(tag));
}

function structuredStyleTags(candidate = {}) {
  const values = [
    candidate.style,
    candidate.style_tags,
    candidate.aesthetic_tags,
    candidate.silhouette_tags,
  ].flatMap(asValues)
    .map((value) => normalizedValue(value))
    .filter(Boolean);
  return new Set(values);
}

function acceptanceEvidence(candidate, field) {
  const item = candidate?.product_acceptance_evidence?.[field] ||
    candidate?.product_acceptance_trace?.evidence?.[field];
  return item && typeof item === "object" ? item : null;
}

function deterministicScore(candidate = {}) {
  return roundScore(finiteNumber(
    candidate.deterministic_reranker_score ??
    candidate.final_score ??
    candidate.ai_match_score ??
    candidate.relevance_score,
  ) ?? 0);
}

function candidateId(candidate = {}) {
  return String(
    candidate?.candidate_id || candidate?.product_id || candidate?.id || "",
  ).trim();
}

function compareAmbiguityPriority(left, right) {
  return right.priority_score - left.priority_score ||
    left.score_gap - right.score_gap ||
    left.group_index - right.group_index;
}

function asValues(value) {
  if (Array.isArray(value)) return value.flatMap(asValues);
  if (value == null || value === "") return [];
  return String(value).split(/[,+/|，、\s]+/u).filter(Boolean);
}

function normalizedValue(value) {
  return String(value ?? "").trim().toLowerCase();
}

function numericConfidence(item = {}) {
  const value = Number(item.confidence);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function roundScore(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

module.exports = {
  DEFAULT_ADJUDICATION_MARGIN,
  MAX_ADJUDICATION_CALLS,
  buildAmbiguityPlan,
  detectGroupAmbiguity,
  deterministicScore,
};
