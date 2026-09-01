"use strict";

const {
  normalizeCommerceSearchSignal,
} = require("./commerce_search_signal_normalizer");

const QUALITY_FLOOR = 60;
const CORE_SLOTS = new Set(["top", "bottom", "dress", "shoes"]);
const TARGETED_SUPPLY_DIMENSIONS = Object.freeze([
  "style",
  "silhouette",
  "color",
]);
const SLOT_ORDER = Object.freeze(["top", "bottom", "dress", "shoes"]);
const DIMENSION_ORDER = Object.freeze([
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

const SUMMARY_BY_DIMENSION = Object.freeze({
  scene: "slotOccasionFitSummary",
  desired_impression: "slotDesiredImpressionFitSummary",
  contemporary: "slotContemporaryFitSummary",
  style: "slotStyleFitSummary",
  silhouette: "slotSilhouetteFitSummary",
  color: "slotColorFitSummary",
  footwear: "slotFootwearFitSummary",
  quality: "slotQualityFitSummary",
  statement: "slotStatementFitSummary",
});

const COLOR_TERMS = Object.freeze([
  ["黑色", /黑|black/iu],
  ["白色", /白|ivory|cream|white/iu],
  ["灰色", /灰|gray|grey/iu],
  ["米色", /米色|米白|杏色|燕麦|beige/iu],
  ["棕色", /棕|咖|brown|camel/iu],
  ["蓝色", /蓝|blue|navy/iu],
  ["粉色", /粉|pink/iu],
  ["红色", /红|red|burgundy/iu],
]);

function diagnoseQualityDeficit({
  rejectedLook = {},
  groups = [],
  round = 1,
  context = {},
} = {}) {
  const quality = rejectedLook.whole_look_quality ||
    rejectedLook.quality || rejectedLook.rejected_combination_traces?.[0]
      ?.whole_look_quality || {};
  const scores = quality.dimension_scores || {};
  const weakestDimensions = DIMENSION_ORDER
    .map((dimension, priority) => ({
      dimension,
      score: finiteScore(scores[dimension]),
      priority,
    }))
    .filter(({score}) => score != null && score < QUALITY_FLOOR)
    .sort((left, right) => left.score - right.score ||
      left.priority - right.priority)
    .map(({dimension, score}) => Object.freeze({dimension, score}));
  const normalizedRound = Math.max(1, Math.min(2, Number(round) || 1));
  const qualityDimensionGaps = qualityDimensionGapMatrix(groups);
  const targetedGaps = qualityDimensionGaps
    .flatMap((entry) => TARGETED_SUPPLY_DIMENSIONS.map((dimension) => ({
      dimension,
      slot: entry.slot,
      score: entry[`${dimension}_best_score`],
      gap: entry[`${dimension}_gap`],
    })))
    .filter(({gap}) => gap > 0)
    .sort((left, right) => right.gap - left.gap ||
      TARGETED_SUPPLY_DIMENSIONS.indexOf(left.dimension) -
        TARGETED_SUPPLY_DIMENSIONS.indexOf(right.dimension) ||
      SLOT_ORDER.indexOf(left.slot) - SLOT_ORDER.indexOf(right.slot))
    .slice(0, 2)
    .map((entry) => Object.freeze(entry));
  const focus = targetedGaps[normalizedRound - 1] || targetedGaps[0] || null;
  const bestTrace = rejectedLook.rejected_combination_traces?.[0] ||
    rejectedLook.combination_traces?.[0] || {};
  const strategyTrace = bestTrace.strategy_trace || {};
  const failingSlots = focus?.slot
    ? [focus.slot]
    : focus
      ? failingSlotsForDimension(focus.dimension, strategyTrace, groups)
    : coreSlots(groups);
  const candidateIds = Array.isArray(bestTrace.candidate_ids)
    ? bestTrace.candidate_ids : [];
  const intentSignals = qualityIntentSignals(context, groups);
  const signalBySlot = Object.freeze(Object.fromEntries(failingSlots.map((slot) => [
    slot,
    deficitSignal({
      dimension: focus?.dimension,
      slot,
      groups,
      candidateIds,
      intentSignals,
    }),
  ])));
  return Object.freeze({
    look_id: rejectedLook.look_id || null,
    round: normalizedRound,
    weakest_dimensions: Object.freeze(weakestDimensions),
    focus_dimension: focus?.dimension || null,
    focus_score: focus?.score ?? null,
    failing_slots: Object.freeze(failingSlots),
    signal_by_slot: signalBySlot,
    quality_dimension_gaps: Object.freeze(qualityDimensionGaps),
    targeted_quality_gaps: Object.freeze(targetedGaps),
    quality_intent_signals: Object.freeze(intentSignals),
    refill_reason: focus
      ? `FINAL_QUALITY_SUPPLY_DEFICIT:${focus.dimension.toUpperCase()}:` +
        focus.slot.toUpperCase()
      : "FINAL_QUALITY_DEFICIT:UNKNOWN",
  });
}

function qualityDimensionGapMatrix(groups) {
  return (Array.isArray(groups) ? groups : [])
    .filter((group) => CORE_SLOTS.has(String(
      group?.requirement?.category || group?.requirement?.slot || "",
    )))
    .map((group) => {
      const slot = String(group.requirement.category || group.requirement.slot);
      const candidates = Array.isArray(group.candidates) ? group.candidates : [];
      const scores = Object.fromEntries(TARGETED_SUPPLY_DIMENSIONS.map((dimension) => {
        const observed = candidates.map((product) => candidateDimensionScore(
          product,
          dimension,
        )).filter((score) => score != null);
        return [dimension, observed.length > 0 ? Math.max(...observed) : 0];
      }));
      return Object.freeze({
        look_id: group.requirement.look_id || null,
        concept_id: group.requirement.concept_id || null,
        slot,
        style_best_score: scores.style,
        silhouette_best_score: scores.silhouette,
        color_best_score: scores.color,
        style_gap: Math.max(0, QUALITY_FLOOR - scores.style),
        silhouette_gap: Math.max(0, QUALITY_FLOOR - scores.silhouette),
        color_gap: Math.max(0, QUALITY_FLOOR - scores.color),
      });
    });
}

function candidateDimensionScore(product, dimension) {
  const canonical = Number(
    product?.target_fit_assessment?.[`${dimension}_fit`]?.score,
  );
  if (Number.isFinite(canonical)) return canonical;
  const aesthetic = Number(
    product?.aesthetic_target_assessment?.[`${dimension}_fit`],
  );
  if (Number.isFinite(aesthetic)) return aesthetic;
  const direct = Number(product?.[`${dimension}_fit_score`]);
  return Number.isFinite(direct) ? direct : null;
}

function failingSlotsForDimension(dimension, strategyTrace, groups) {
  if (dimension === "body") return coreSlots(groups);
  if (dimension === "footwear") {
    return coreSlots(groups).filter((slot) => slot === "shoes");
  }
  const summary = strategyTrace?.[SUMMARY_BY_DIMENSION[dimension]];
  const slots = (Array.isArray(summary?.slots) ? summary.slots : [])
    .filter((entry) => CORE_SLOTS.has(String(entry?.slot || "")))
    .filter((entry) => finiteScore(entry?.score) != null &&
      finiteScore(entry.score) < QUALITY_FLOOR)
    .sort((left, right) => finiteScore(left.score) - finiteScore(right.score))
    .map((entry) => String(entry.slot));
  return slots.length > 0 ? [...new Set(slots)] : coreSlots(groups);
}

function coreSlots(groups) {
  return [...new Set((Array.isArray(groups) ? groups : [])
    .map((group) => String(group?.requirement?.category ||
      group?.requirement?.slot || ""))
    .filter((slot) => CORE_SLOTS.has(slot)))];
}

function deficitSignal({dimension, slot, groups, candidateIds, intentSignals}) {
  const requirement = groups.find((group) =>
    String(group?.requirement?.category || group?.requirement?.slot || "") === slot)
    ?.requirement || {};
  if (dimension === "scene") return sceneCommerceSignal(
    requirement.scene || requirement.occasion,
  );
  if (dimension === "color") return colorEchoSignal(groups, candidateIds, slot) ||
    targetColorCommerceSignal(requirement);
  if (dimension === "silhouette") return silhouetteCommerceSignal(
    requirement.fit || requirement.silhouette,
  ) || targetSilhouetteCommerceSignal(requirement, slot);
  if (dimension === "footwear") return existingAestheticSignal(requirement) || "百搭";
  if (dimension === "quality") return "质感";
  if (dimension === "contemporary") return "时髦";
  if (dimension === "desired_impression" || dimension === "statement") {
    return existingAestheticSignal(requirement) || "设计感";
  }
  if (dimension === "style") return styleCommerceSignal(
    requirement,
    intentSignals,
  );
  return "";
}

function styleCommerceSignal(requirement, intentSignals = []) {
  const signals = [
    ...(Array.isArray(intentSignals) ? intentSignals : []),
    existingAestheticSignal(requirement),
  ].map(normalizeCommerceSearchSignal).filter(Boolean);
  return signals.find((value) => /设计感|小众|时髦|个性|潮流/iu.test(value)) ||
    signals[0] || "";
}

function existingAestheticSignal(requirement = {}) {
  const candidates = requirement?.commerce_query_plan?.query_candidates;
  const q2 = (Array.isArray(candidates) ? candidates : []).find((entry) =>
    String(entry?.query_id || "") === "Q2");
  return String(q2?.aesthetic_signal || "").trim();
}

function sceneCommerceSignal(value) {
  const scene = String(value || "").trim().toLowerCase();
  if (/date|约会/u.test(scene)) return "约会";
  if (/party|nightlife|night life|ktv|聚会|派对|夜生活|夜间社交/u.test(scene)) {
    return "聚会";
  }
  if (/commute|work|office|通勤|职场|工作/u.test(scene)) return "通勤";
  if (/travel|旅行|出游/u.test(scene)) return "旅行";
  if (/formal|ceremony|正式|典礼/u.test(scene)) return "正式";
  if (/daily|日常/u.test(scene)) return "日常";
  return "";
}

function silhouetteCommerceSignal(value) {
  const text = String(value || "");
  if (/relaxed|wide|loose|oversize|宽松|阔腿/iu.test(text)) return "宽松";
  if (/fitted|slim|defined|修身|合身/iu.test(text)) return "修身";
  if (/short|cropped|短款/iu.test(text)) return "短款";
  if (/high.?rise|high.?waist|高腰/iu.test(text)) return "高腰";
  return "";
}

function targetSilhouetteCommerceSignal(requirement, slot) {
  const target = requirement?.aesthetic_target_profile || {};
  const silhouette = target.silhouette_targets || {};
  const fit = target.fit_targets || {};
  const footwear = target.footwear_targets || {};
  if (slot === "shoes") {
    if (Number(footwear.visual_weight) <= 0.45) return "浅口";
    if (Number(footwear.visual_weight) >= 0.65) return "厚底";
    return "轻量";
  }
  if (slot === "dress" && Number(silhouette.waist_emphasis) >= 0.65) {
    return "收腰";
  }
  if (slot === "bottom" && Number(silhouette.waist_emphasis) >= 0.65) {
    return "高腰";
  }
  if (slot === "bottom" && Number(silhouette.volume) >= 0.62) return "阔腿";
  if (Number(fit.tailoring) >= 0.66 || Number(silhouette.volume) <= 0.42) {
    return "修身";
  }
  if (Number(fit.relaxation) >= 0.62 || Number(silhouette.volume) >= 0.62) {
    return "宽松";
  }
  return "";
}

function targetColorCommerceSignal(requirement) {
  const intensity = Number(
    requirement?.aesthetic_target_profile?.color_targets?.intensity ??
    requirement?.aesthetic_target_profile?.dimensions?.color_intensity,
  );
  if (!Number.isFinite(intensity)) return "";
  if (intensity >= 0.66) return "亮色";
  if (intensity <= 0.38) return "浅色";
  return "柔和色";
}

function colorEchoSignal(groups, candidateIds, failingSlot) {
  const selected = new Set((Array.isArray(candidateIds) ? candidateIds : [])
    .map(String));
  const counts = new Map();
  for (const group of Array.isArray(groups) ? groups : []) {
    const slot = String(group?.requirement?.category || "");
    if (slot === failingSlot) continue;
    for (const product of Array.isArray(group?.candidates) ? group.candidates : []) {
      const id = String(product?.candidate_id || product?.product_id || product?.id || "");
      if (!selected.has(id)) continue;
      const text = [
        product.color,
        product.title,
        product?.candidate_enrichment?.color_evidence?.value,
      ].flat(Infinity).filter(Boolean).join(" ");
      for (const [term, pattern] of COLOR_TERMS) {
        if (!pattern.test(text)) continue;
        counts.set(term, (counts.get(term) || 0) + 1);
        break;
      }
    }
  }
  return [...counts.entries()].sort((left, right) =>
    right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] || "";
}

function buildDeficitRefillQuery(requirement = {}, diagnosis = null, round = 1) {
  if (!diagnosis || !diagnosis.focus_dimension) return null;
  const slot = String(requirement.category || requirement.slot || "");
  if (!diagnosis.failing_slots.includes(slot)) return null;
  const deficitSignalValue = String(
    diagnosis.signal_by_slot?.[slot] || "",
  ).trim();
  const reuse = qualityQueryReuse(requirement, slot, diagnosis);
  const targetsSupplyDimension = TARGETED_SUPPLY_DIMENSIONS.includes(
    diagnosis.focus_dimension,
  );
  const signal = normalizeCommerceSearchSignal(
    targetsSupplyDimension
      ? deficitSignalValue || reuse.signal
      : reuse.signal || deficitSignalValue,
  );
  if (!signal) return null;
  const candidates = requirement?.commerce_query_plan?.query_candidates;
  const q1 = (Array.isArray(candidates) ? candidates : []).find((entry) =>
    String(entry?.query_id || "") === "Q1") || candidates?.[0];
  const base = reuse.base || String(
    q1?.query || requirement.search_keywords?.[0] || "",
  ).trim();
  if (!base) return null;
  const query = [...new Set([...base.split(/\s+/u), signal])]
    .filter(Boolean).join(" ").slice(0, 80);
  return Object.freeze({
    query,
    query_type: `DEFICIT_${diagnosis.focus_dimension.toUpperCase()}`,
    page_no: Math.max(1, Math.min(2, Number(round) || 1)),
    fallback_level: Math.max(1, Math.min(2, Number(round) || 1)),
    deficit_dimension: diagnosis.focus_dimension,
    deficit_score: diagnosis.focus_score,
    aesthetic_signal: signal,
    quality_query_reuse: reuse.applied,
    quality_query_reuse_reason: reuse.reason,
    searchable_signal_budget: Object.freeze({
      core_category_required: true,
      aesthetic_terms: 1,
      max_aesthetic_terms: 1,
    }),
  });
}

// A quality refill may explore a more concrete commerce subtype than the
// original broad slot query, but only when the structured intent already asks
// for an expressive/design signal. This is deliberately independent of raw
// user prose and keeps one aesthetic term per query.
function qualityQueryReuse(requirement, slot, diagnosis = {}) {
  const plan = requirement?.commerce_query_plan || {};
  const intent = plan.intent || {};
  const desired = [
    ...(Array.isArray(intent.desired_impression)
      ? intent.desired_impression : [intent.desired_impression]),
    ...(Array.isArray(diagnosis.quality_intent_signals)
      ? diagnosis.quality_intent_signals : []),
  ]
    .map(normalizeCommerceSearchSignal)
    .filter(Boolean);
  const signal = desired.find((value) =>
    /设计感|小众|时髦|个性|潮流/iu.test(value));
  if (!signal) return {applied: false, base: "", signal: "", reason: null};
  const gender = String(requirement.gender || plan.gender || "").toLowerCase();
  const genderToken = gender === "female" ? "女" : gender === "male" ? "男" : "";
  const q1 = (Array.isArray(plan.query_candidates)
    ? plan.query_candidates : []).find((entry) => entry?.query_id === "Q1");
  const originalBase = String(
    q1?.query || requirement.search_keywords?.[0] || "",
  ).trim();
  const formality = String(intent.formality || "").toLowerCase();
  const nonFormal = !/formal|business|正式|商务/iu.test(formality);
  if (slot === "bottom" && gender === "female" && nonFormal) {
    const subtype = /半身裙|百褶裙|a字裙/iu.test(originalBase)
      ? originalBase.replace(/^女\s*/u, "").trim()
      : "半身裙";
    return {
      applied: true,
      base: [genderToken, subtype].filter(Boolean).join(" "),
      signal,
      reason: "VALIDATED_SPECIFIC_BOTTOM_SUBCATEGORY",
    };
  }
  if (slot === "shoes" && nonFormal) {
    const subtype = /乐福鞋|玛丽珍鞋|芭蕾鞋/iu.test(originalBase)
      ? originalBase.replace(/^[男女]\s*/u, "").trim()
      : "乐福鞋";
    return {
      applied: true,
      base: [genderToken, subtype].filter(Boolean).join(" "),
      signal,
      reason: "VALIDATED_SPECIFIC_FOOTWEAR_SUBCATEGORY",
    };
  }
  return {
    applied: true,
    base: originalBase,
    signal,
    reason: "REUSE_STRUCTURED_SINGLE_AESTHETIC_SIGNAL",
  };
}

function qualityIntentSignals(context = {}, groups = []) {
  const brains = [
    context?.intent?.user_intent_brain,
    context?.decision_context?.intent?.user_intent_brain,
  ].filter(Boolean);
  const values = brains.flatMap((brain) => evidenceValues(
    brain?.desired_impression,
  ));
  for (const group of Array.isArray(groups) ? groups : []) {
    values.push(...evidenceValues(
      group?.requirement?.commerce_query_plan?.intent?.desired_impression,
    ));
  }
  return [...new Set(values.map((value) => String(value || "").trim())
    .filter(Boolean))];
}

function evidenceValues(value) {
  const raw = value && typeof value === "object" && !Array.isArray(value) &&
    Object.prototype.hasOwnProperty.call(value, "value")
    ? value.value : value;
  return (Array.isArray(raw) ? raw : [raw]).flat(Infinity).filter((entry) =>
    entry != null && String(entry).trim());
}

function finiteScore(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

module.exports = {
  buildDeficitRefillQuery,
  diagnoseQualityDeficit,
};
