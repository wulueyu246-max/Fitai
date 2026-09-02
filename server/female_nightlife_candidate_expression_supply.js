"use strict";

const CONTRACT_ID = "female_nightlife_candidate_expression_supply.v1";
const MIN_EXPRESSION_CANDIDATES = 4;

function resolveFemaleNightlifeCandidateExpression({
  gender,
  scene,
  slot,
  direction,
  availableSignals = [],
} = {}) {
  const normalizedGender = canonical(gender);
  const normalizedScene = canonicalScene(scene);
  if (normalizedGender !== "female" || normalizedScene !== "nightlife") {
    return frozen({
      enabled: false,
      contract_id: null,
      signal: null,
      target_dimension: null,
      reason: "SCENE_PENDING_CALIBRATION",
      pool_policy: "UNCHANGED",
      minimum_expression_candidates: null,
      downstream_derived_dimensions: [],
    });
  }

  const normalizedSlot = canonical(slot);
  const normalizedDirection = canonical(direction);
  const signals = unique(availableSignals.map(canonicalSignal));
  const resolved = expressionDirection({
    slot: normalizedSlot,
    direction: normalizedDirection,
    signals,
  });
  return frozen({
    enabled: true,
    contract_id: CONTRACT_ID,
    signal: resolved.signal,
    target_dimension: resolved.dimension,
    reason: resolved.reason,
    pool_policy: "PREFER_INTENT_BATCH_WHEN_SUFFICIENT",
    minimum_expression_candidates: MIN_EXPRESSION_CANDIDATES,
    downstream_derived_dimensions: ["styling_distinction"],
  });
}

function selectExpressionCandidateSupply({
  contract,
  highRecallCandidates = [],
  intentCandidates = [],
} = {}) {
  const highRecall = Array.isArray(highRecallCandidates)
    ? highRecallCandidates : [];
  const intent = Array.isArray(intentCandidates) ? intentCandidates : [];
  const minimum = Number(contract?.minimum_expression_candidates) ||
    MIN_EXPRESSION_CANDIDATES;
  const preferIntent = contract?.enabled === true && intent.length >= minimum;
  return frozenSupply({
    candidates: preferIntent ? intent : [...intent, ...highRecall],
    applied: preferIntent,
    high_recall_count: highRecall.length,
    intent_count: intent.length,
    reason: preferIntent
      ? "EXPRESSION_SUPPLY_SUFFICIENT"
      : contract?.enabled === true
        ? "EXPRESSION_SUPPLY_BELOW_MINIMUM"
        : "SCENE_POLICY_INACTIVE",
  });
}

function expressionDirection({slot, direction, signals}) {
  if (slot === "shoes") {
    if (/design|focal|statement/iu.test(direction)) {
      return choice("设计感", "footwear_statement", "DESIGN_LED_FOOTWEAR");
    }
    if (/relaxed|lightweight|easy/iu.test(direction)) {
      return choice("设计感", "footwear_statement", "RELAXED_SOCIAL_FOOTWEAR");
    }
    return choice(
      signals.includes("精致") ? "精致" : "时髦",
      "footwear_statement",
      "REFINED_SOCIAL_FOOTWEAR",
    );
  }
  if (slot === "bottom") {
    if (/relaxed|easy|wide|volume/iu.test(direction)) {
      return choice("垂感", "silhouette_interest", "RELAXED_SHAPED_BOTTOM");
    }
    if (/structured|clear|supporting|focal|defined/iu.test(direction)) {
      return choice("高腰", "silhouette_interest", "DEFINED_PROPORTION_BOTTOM");
    }
  }
  if (slot === "top") {
    if (/relaxed|easy|visible_structure/iu.test(direction)) {
      return choice("设计感", "design_interest", "RELAXED_FOCAL_TOP");
    }
    if (/defined|focal|design|structured|clean/iu.test(direction)) {
      return choice("设计感", "design_interest", "DEFINED_FOCAL_TOP");
    }
  }
  const signal = ["设计感", "时髦", "年轻", "精致"]
    .find((entry) => signals.includes(entry)) || "设计感";
  return choice(signal, signal === "设计感" ? "design_interest" :
    "contemporary_expression", "INTENT_EXPRESSION_FALLBACK");
}

function choice(signal, dimension, reason) {
  return {signal, dimension, reason};
}

function canonicalSignal(value) {
  const text = canonical(value);
  if (/设计感|辨识度|独特|特别/u.test(text)) return "设计感";
  if (/时髦|时尚|潮流/u.test(text)) return "时髦";
  if (/年轻|减龄|青春/u.test(text)) return "年轻";
  if (/精致|高级/u.test(text)) return "精致";
  return text;
}

function canonicalScene(value) {
  const scene = canonical(value);
  return scene === "nightlife_social" ? "nightlife" : scene;
}

function canonical(value) {
  return String(value || "").trim().toLowerCase();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function frozen(value) {
  Object.freeze(value.downstream_derived_dimensions);
  return Object.freeze(value);
}

function frozenSupply(value) {
  Object.freeze(value.candidates);
  return Object.freeze(value);
}

module.exports = {
  CONTRACT_ID,
  MIN_EXPRESSION_CANDIDATES,
  resolveFemaleNightlifeCandidateExpression,
  selectExpressionCandidateSupply,
};
