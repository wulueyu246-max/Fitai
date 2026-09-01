"use strict";

const TARGET_FIT_ASSESSMENT_VERSION = "target_fit_assessment_v1";
const TARGET_FIT_STATUS = Object.freeze({
  MATCH: "MATCH",
  PARTIAL: "PARTIAL",
  MISMATCH: "MISMATCH",
  UNKNOWN: "UNKNOWN",
  NOT_APPLICABLE: "NOT_APPLICABLE",
});

function buildTargetFitAssessment(product = {}, requirement = {}, context = {}) {
  const target = requirement.aesthetic_target_profile ||
    requirement.aestheticTargetProfile || context.aesthetic_target_profile ||
    context.aestheticTargetProfile || {};
  const enrichment = product.candidate_enrichment || {};
  const desired = desiredImpressions(requirement, context);
  return deepFreeze({
    version: TARGET_FIT_ASSESSMENT_VERSION,
    style_fit: assessStyle(enrichment, target),
    contemporary_fit: assessContemporary(enrichment, target, desired),
    occasion_fit: assessOccasion(enrichment, requirement, target),
    desired_impression_fit: assessDesired(enrichment, desired),
    silhouette_fit: assessSilhouette(enrichment, target),
    color_fit: assessColor(enrichment, target),
    footwear_fit: assessFootwear(enrichment, product, requirement, target),
    quality_fit: assessQuality(enrichment, target),
    audience_fit: assessAudience(enrichment, product, requirement, context),
  });
}

function attachTargetFitAssessment(product = {}, requirement = {}, context = {}) {
  return {
    ...product,
    target_fit_assessment: buildTargetFitAssessment(product, requirement, context),
  };
}

function targetFitScore(product = {}, dimension) {
  const score = Number(product.target_fit_assessment?.[dimension]?.score);
  return Number.isFinite(score) ? bounded(score) : null;
}

function acceptanceEvidenceFromTargetFit(product = {}, dimension) {
  const record = product.target_fit_assessment?.[dimension];
  if (!record || typeof record !== "object") return null;
  return Object.freeze({
    value: record.status === TARGET_FIT_STATUS.MATCH ? "match" :
      record.status === TARGET_FIT_STATUS.MISMATCH && record.score <= 5
        ? "severe_mismatch" : record.status === TARGET_FIT_STATUS.MISMATCH
          ? "mismatch" : record.status === TARGET_FIT_STATUS.PARTIAL
            ? "compatible_or_unknown" : "unknown",
    source: record.source,
    confidence: record.confidence,
    evidence: record.evidence,
    applicability: record.status === TARGET_FIT_STATUS.NOT_APPLICABLE
      ? "NOT_APPLICABLE" : record.status === TARGET_FIT_STATUS.UNKNOWN
        ? "UNKNOWN" : "APPLICABLE",
    target_fit_score: record.score,
    target_fit_status: record.status,
  });
}

function assessStyle(enrichment, target) {
  const styles = values(enrichment.style_evidence);
  const expressions = values(enrichment.style_expression);
  const evidence = mergeEvidence(enrichment.style_evidence, enrichment.style_expression);
  const targets = list(target.style_targets).map((item) => token(
    typeof item === "object" ? item?.id : item,
  ));
  const compatible = new Set(list(target.compatible_styles).map(token));
  const conflicting = new Set(list(target.conflicting_styles).map(token));
  if (targets.length && styles.some((value) => targets.includes(value))) {
    return observed(96, evidence, TARGET_FIT_STATUS.MATCH);
  }
  if (styles.some((value) => compatible.has(value))) {
    return observed(78, evidence, TARGET_FIT_STATUS.PARTIAL);
  }
  if (styles.some((value) => conflicting.has(value))) {
    return observed(12, evidence, TARGET_FIT_STATUS.MISMATCH);
  }
  if (Number(target?.dimensions?.design_interest) >= 0.58 &&
      expressions.includes("design_expression")) {
    return observed(88, evidence, TARGET_FIT_STATUS.MATCH);
  }
  if (styles.length || expressions.length) {
    return observed(64, evidence, TARGET_FIT_STATUS.PARTIAL);
  }
  return unknown();
}

function assessContemporary(enrichment, target, desired) {
  const actual = values(enrichment.contemporary_expression);
  const evidence = mergeEvidence(enrichment.contemporary_expression);
  const expected = Number(target?.dimensions?.youthfulness) >= 0.58 ||
    Number(target?.dimensions?.design_interest) >= 0.58 ||
    desired.some((value) => ["youthful", "design_led", "fashion_forward"].includes(value));
  if (!expected && !actual.length) return unknown();
  if (actual.includes("traditional") && expected) {
    return observed(20, evidence, TARGET_FIT_STATUS.MISMATCH);
  }
  if (actual.includes("contemporary")) {
    return observed(90, evidence, TARGET_FIT_STATUS.MATCH);
  }
  if (actual.includes("fashion_forward")) {
    return observed(84, evidence, TARGET_FIT_STATUS.MATCH);
  }
  if (actual.includes("trend_mention")) {
    return observed(64, evidence, TARGET_FIT_STATUS.PARTIAL);
  }
  return unknown();
}

function assessOccasion(enrichment, requirement, target) {
  const actual = new Set([
    ...values(enrichment.occasion_expression),
    ...values(enrichment.occasion_evidence),
  ].map(normalizeScene));
  const desired = normalizeScene(requirement.scene || requirement.occasion || target.scene);
  const evidence = mergeEvidence(enrichment.occasion_expression, enrichment.occasion_evidence);
  if (!desired) return notApplicable();
  if (!actual.size) return unknown();
  if (actual.has(desired)) return observed(94, evidence, TARGET_FIT_STATUS.MATCH);
  const compatible = SCENE_COMPATIBILITY[desired] || new Set();
  if ([...actual].some((value) => compatible.has(value))) {
    return observed(72, evidence, TARGET_FIT_STATUS.PARTIAL);
  }
  const conflicts = SCENE_CONFLICTS[desired] || new Set();
  if ([...actual].some((value) => conflicts.has(value))) {
    return observed(18, evidence, TARGET_FIT_STATUS.MISMATCH);
  }
  return observed(55, evidence, TARGET_FIT_STATUS.PARTIAL);
}

function assessDesired(enrichment, desired) {
  if (!desired.length) return notApplicable();
  const actual = new Set([
    ...values(enrichment.desired_impression_evidence),
    ...values(enrichment.style_expression),
    ...values(enrichment.contemporary_expression),
  ]);
  const evidence = mergeEvidence(
    enrichment.desired_impression_evidence,
    enrichment.style_expression,
    enrichment.contemporary_expression,
  );
  if (!actual.size) return unknown();
  const matched = desired.filter((value) => impressionMatches(value, actual));
  if (matched.length === desired.length) {
    return observed(92, evidence, TARGET_FIT_STATUS.MATCH);
  }
  if (matched.length) {
    return observed(62 + (matched.length / desired.length) * 18,
      evidence, TARGET_FIT_STATUS.PARTIAL);
  }
  if (actual.has("traditional") && desired.some((value) =>
    ["youthful", "fashion_forward", "design_led"].includes(value))) {
    return observed(20, evidence, TARGET_FIT_STATUS.MISMATCH);
  }
  return observed(50, evidence, TARGET_FIT_STATUS.PARTIAL);
}

function assessSilhouette(enrichment, target) {
  const actual = values(enrichment.silhouette_evidence);
  const desired = target.silhouette_targets;
  if (!desired || typeof desired !== "object") return notApplicable();
  if (!actual.length) return unknown();
  const vector = silhouetteVector(actual);
  const score = average(["structure", "waist_emphasis", "volume", "verticality"]
    .map((field) => closeness(vector[field], Number(desired[field]))));
  return classified(score, mergeEvidence(enrichment.silhouette_evidence));
}

function assessColor(enrichment, target) {
  const actual = values(enrichment.color_evidence);
  const desired = Number(target?.color_targets?.intensity ??
    target?.dimensions?.color_intensity);
  if (!Number.isFinite(desired)) return notApplicable();
  if (!actual.length) return unknown();
  const score = closeness(average(actual.map(colorIntensity)), desired);
  return classified(score, mergeEvidence(enrichment.color_evidence));
}

function assessFootwear(enrichment, product, requirement, target) {
  if (token(product.category || requirement.category) !== "shoes") {
    return notApplicable(70);
  }
  const actual = values(enrichment.footwear_evidence);
  const desired = target.footwear_targets;
  if (!desired || typeof desired !== "object") return notApplicable();
  if (!actual.length) return unknown();
  const refined = actual.some((value) =>
    ["mary_jane", "ballet_flat", "loafer", "pump", "heel", "oxford"].includes(value));
  const sporty = actual.includes("sneaker");
  const vector = {
    formality: refined ? 0.68 : sporty ? 0.25 : 0.48,
    sportiness: sporty ? 0.9 : 0.2,
    toe_refinement: refined ? 0.82 : 0.5,
    material_quality: 0.5,
  };
  const score = average(Object.keys(vector).map((field) =>
    closeness(vector[field], Number(desired[field]))));
  return classified(score, mergeEvidence(enrichment.footwear_evidence));
}

function assessQuality(enrichment, target) {
  const desired = Number(target.quality_target ?? target?.dimensions?.quality);
  if (!Number.isFinite(desired)) return notApplicable();
  const facts = mergeEvidence(enrichment.quality_evidence, enrichment.material_evidence);
  if (!facts.evidence.length) return unknown();
  const premium = values(enrichment.material_evidence).some((value) =>
    ["wool_mention", "leather_mention", "silk_mention"].includes(value)) ||
    facts.evidence.some((value) => /立体剪裁|精纺|真皮|羊毛|丝绸|刺绣|提花/u.test(value));
  return classified(closeness(premium ? 0.78 : 0.58, desired), facts);
}

function assessAudience(enrichment, product, requirement, context) {
  const gender = enrichment.gender_evidence;
  const expression = enrichment.audience_expression;
  const evidence = mergeEvidence(gender, expression);
  const requested = token(requirement.gender || context.gender);
  const actual = token(gender?.value || product.original_gender || product.gender);
  const audience = new Set(values(expression));
  const rawInput = String(context?.decision_context?.raw_user_input ||
    context?.raw_user_input || "");
  if (!/child|kid|童/iu.test(rawInput) && audience.has("child")) {
    return observed(0, evidence, TARGET_FIT_STATUS.MISMATCH);
  }
  if (requested && !["unisex", "unknown"].includes(requested) && actual &&
      !["unknown", "unisex", requested].includes(actual)) {
    return observed(0, evidence, TARGET_FIT_STATUS.MISMATCH);
  }
  if (actual === requested || actual === "unisex") {
    return observed(actual === requested ? 98 : 78, evidence, TARGET_FIT_STATUS.MATCH);
  }
  if (audience.has("mature") && desiredImpressions(requirement, context).includes("youthful")) {
    return observed(28, evidence, TARGET_FIT_STATUS.MISMATCH);
  }
  return unknown();
}

function desiredImpressions(requirement, context) {
  const brain = context?.decision_context?.intent?.user_intent_brain ||
    context?.intent?.user_intent_brain || {};
  return [...new Set(list([
    requirement?.commerce_query_plan?.intent?.desired_impression,
    requirement?.desired_impression,
    brain?.desired_impression?.value,
  ]).map(normalizeImpression).filter(Boolean))];
}

function normalizeImpression(value) {
  const text = String(value || "").trim().toLowerCase();
  if (/设计|解构|不规则|特别|小众|design/u.test(text)) return "design_led";
  if (/年轻|青春|少女|少年|减龄|young|youth/u.test(text)) return "youthful";
  if (/时髦|时尚|潮流|fashion|trend/u.test(text)) return "fashion_forward";
  if (/干净|利落|清爽|clean/u.test(text)) return "clean";
  if (/松弛|宽松|休闲|relaxed|casual/u.test(text)) return "relaxed";
  if (/精致|优雅|高级|elegant|refined/u.test(text)) return "polished";
  return token(text);
}

function impressionMatches(target, actual) {
  const groups = {
    design_led: ["design_led", "design_expression", "contemporary"],
    youthful: ["youthful", "fashion_forward", "contemporary"],
    fashion_forward: ["fashion_forward", "contemporary"],
    clean: ["clean", "minimal_expression"],
    relaxed: ["relaxed"],
    polished: ["polished"],
  };
  return (groups[target] || [target]).some((value) => actual.has(value));
}

function classified(score, evidence) {
  return observed(score, evidence, score >= 75 ? TARGET_FIT_STATUS.MATCH :
    score < 40 ? TARGET_FIT_STATUS.MISMATCH : TARGET_FIT_STATUS.PARTIAL);
}

function observed(score, facts, status) {
  return record(score, facts.source, facts.confidence, facts.evidence, status);
}

function unknown() {
  return record(50, "unknown_product_evidence", 0, [], TARGET_FIT_STATUS.UNKNOWN);
}

function notApplicable(score = 50) {
  return record(score, "not_applicable", 1, [], TARGET_FIT_STATUS.NOT_APPLICABLE);
}

function record(score, source, confidence, evidence, status) {
  return Object.freeze({
    score: Math.round(bounded(score) * 100) / 100,
    source: String(source || "unknown_product_evidence"),
    confidence: clamp01(confidence),
    evidence: Object.freeze([...new Set(list(evidence))]),
    status,
  });
}

function mergeEvidence(...items) {
  const active = items.filter((item) => item && typeof item === "object" &&
    (values(item).length || list(item.evidence).length) && Number(item.confidence) > 0);
  if (!active.length) {
    return {source: "unknown_product_evidence", confidence: 0, evidence: []};
  }
  return {
    source: [...new Set(active.map((item) => item.source || "product_evidence"))].join("+"),
    confidence: Math.max(...active.map((item) => Number(item.confidence) || 0)),
    evidence: [...new Set(active.flatMap((item) => list(item.evidence)))],
  };
}

function values(item) {
  return list(item?.value).map(token).filter((value) => value && value !== "unknown");
}

function list(value) {
  return (Array.isArray(value) ? value : [value]).flat(Infinity)
    .filter((item) => item !== undefined && item !== null && item !== "");
}

function token(value) {
  return String(value || "").trim().toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
}

function normalizeScene(value) {
  const scene = token(value);
  if (["nightlife", "nightlife_social", "party", "ktv", "酒吧", "夜生活", "聚会"].includes(scene)) return "nightlife";
  if (["work", "commute", "office", "通勤", "工作"].includes(scene)) return "work";
  if (["sport", "sport_outdoor", "outdoor", "户外", "运动"].includes(scene)) return "outdoor";
  if (["daily", "casual", "日常", "休闲"].includes(scene)) return "daily";
  if (["date", "约会"].includes(scene)) return "date";
  return scene;
}

const SCENE_COMPATIBILITY = Object.freeze({
  nightlife: new Set(["date", "daily"]),
  date: new Set(["nightlife", "daily"]),
  daily: new Set(["date"]),
  work: new Set(["daily"]),
  outdoor: new Set(["daily"]),
});
const SCENE_CONFLICTS = Object.freeze({
  nightlife: new Set(["work", "outdoor"]),
  date: new Set(["work", "outdoor"]),
  work: new Set(["nightlife", "outdoor"]),
  daily: new Set(["work"]),
});

function silhouetteVector(actual) {
  const values = new Set(actual);
  return {
    structure: values.has("straight") ? 0.72 : values.has("oversized") ? 0.36 : 0.55,
    waist_emphasis: values.has("cropped") || values.has("fitted") || values.has("a_line") ? 0.8 : 0.5,
    volume: values.has("oversized") || values.has("wide_leg") ? 0.82 : values.has("fitted") ? 0.32 : 0.5,
    verticality: values.has("straight") || values.has("longline") ? 0.8 : values.has("cropped") ? 0.66 : 0.5,
  };
}

function colorIntensity(value) {
  if (["black", "white", "beige", "gray", "brown"].includes(value)) return 0.22;
  if (["pink", "blue", "green"].includes(value)) return 0.5;
  if (value === "red") return 0.72;
  return 0.5;
}

function closeness(actual, target) {
  if (!Number.isFinite(actual) || !Number.isFinite(target)) return 50;
  return bounded(100 - Math.abs(actual - target) * 100);
}

function average(items) {
  const finite = items.map(Number).filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : 50;
}

function bounded(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 50;
}

function clamp01(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

module.exports = {
  TARGET_FIT_ASSESSMENT_VERSION,
  TARGET_FIT_STATUS,
  acceptanceEvidenceFromTargetFit,
  attachTargetFitAssessment,
  buildTargetFitAssessment,
  targetFitScore,
};
