"use strict";

const mockSnapshots = require("./fashion_brain/market/mock_market_signals_v1.json");

const MARKET_FASHION_BRAIN_VERSION = "market_fashion_brain.v1";
const MARKET_SIGNAL_PROVIDER_VERSION = "market_signal_provider.v1";
const MARKET_SOURCE_MOCK_FIXTURE = "mock_market_fixture";
const MARKET_STATUS_AVAILABLE = "AVAILABLE";
const MARKET_STATUS_INSUFFICIENT = "INSUFFICIENT_DATA";

const SIGNAL_GROUPS = Object.freeze([
  "style_signals",
  "silhouette_signals",
  "category_signals",
  "color_signals",
  "footwear_signals",
  "material_signals",
  "layering_signals",
]);

const TREND_STATES = new Set([
  "rising",
  "hot",
  "stable",
  "declining",
  "niche_rising",
  "niche_stable",
]);

const SIGNAL_TYPE_BY_GROUP = Object.freeze({
  style_signals: "style",
  silhouette_signals: "silhouette",
  category_signals: "category",
  color_signals: "color",
  footwear_signals: "footwear",
  material_signals: "material",
  layering_signals: "layering",
});

const HALF_LIFE_DAYS = Object.freeze({
  hot: 21,
  rising: 30,
  niche_rising: 45,
  niche_stable: 90,
  stable: 180,
  declining: 21,
});

function deepClone(value) {
  return value == null ? value : structuredClone(value);
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function clamp(value, minimum = 0, maximum = 100) {
  const number = Number(value);
  if (!Number.isFinite(number)) return minimum;
  return Math.max(minimum, Math.min(maximum, number));
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function evidenceValue(item, fallback = null) {
  return item && typeof item === "object" && Object.hasOwn(item, "value")
    ? item.value
    : typeof item === "undefined" ? fallback : item;
}

function normalizedText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s\-+/]+/gu, "_")
    .replace(/[^\p{L}\p{N}_]+/gu, "");
}

function isoTime(value, fallback) {
  const date = new Date(value || fallback);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function scopeValueMatches(snapshotValue, requestedValue) {
  const snapshot = normalizedText(snapshotValue);
  const requested = normalizedText(requestedValue);
  return !snapshot || ["all", "any", "unspecified"].includes(snapshot) ||
    snapshot === requested;
}

function scopeMatches(snapshotScope = {}, requestedScope = {}) {
  return [
    "country",
    "region",
    "demographic",
    "gender_expression",
    "age_band",
  ].every((field) => scopeValueMatches(
    snapshotScope[field],
    requestedScope[field],
  ));
}

function normalizeMarketScope(scope = {}, provider = "unconfigured") {
  return deepFreeze({
    country: String(scope.country || "UNSPECIFIED").toUpperCase(),
    region: String(scope.region || "national"),
    demographic: String(scope.demographic || "general"),
    gender_expression: String(scope.gender_expression || "unisex"),
    age_band: String(scope.age_band || "unspecified"),
    platform: String(scope.platform || provider),
  });
}

function deriveMarketScope(context = {}, provider = "unconfigured") {
  const locale = String(context?.recommendation_context?.locale || "");
  const country = locale.includes("-")
    ? locale.split("-").at(-1).toUpperCase()
    : "UNSPECIFIED";
  return normalizeMarketScope({
    country,
    region: "national",
    demographic: "general",
    gender_expression: context?.user_truth?.gender || "unisex",
    age_band: "unspecified",
    platform: provider,
  }, provider);
}

class MarketSignalProvider {
  constructor({provider = "unconfigured"} = {}) {
    this.provider = String(provider);
    this.version = MARKET_SIGNAL_PROVIDER_VERSION;
  }

  fetchSignals({scope, at} = {}) {
    return {
      provider: this.provider,
      fetch_time: isoTime(at, new Date().toISOString()),
      scope: normalizeMarketScope(scope, this.provider),
      snapshot: null,
      confidence: 0,
      failure: {code: "MARKET_PROVIDER_NOT_IMPLEMENTED"},
    };
  }
}

class MockMarketSignalProvider extends MarketSignalProvider {
  constructor({snapshots = mockSnapshots} = {}) {
    super({provider: MARKET_SOURCE_MOCK_FIXTURE});
    this.snapshots = deepFreeze(deepClone(snapshots));
  }

  fetchSignals({scope, at} = {}) {
    const normalizedScope = normalizeMarketScope(scope, this.provider);
    const snapshot = this.snapshots.find((item) =>
      scopeMatches(item.market_scope, normalizedScope)) || null;
    return deepFreeze({
      provider: this.provider,
      fetch_time: isoTime(at, new Date().toISOString()),
      scope: normalizedScope,
      snapshot: deepClone(snapshot),
      confidence: snapshot ? clamp(snapshot.confidence, 0, 1) : 0,
      failure: snapshot ? null : {code: "MARKET_SCOPE_NOT_COVERED"},
    });
  }
}

function freshnessForSignal(signal, snapshot, asOf) {
  const nowMs = new Date(asOf).getTime();
  const sourceMs = new Date(signal.source_timestamp).getTime();
  const validFromMs = new Date(snapshot.valid_from).getTime();
  const validUntilMs = new Date(snapshot.valid_until).getTime();
  const ageDays = Number.isFinite(sourceMs)
    ? Math.max(0, (nowMs - sourceMs) / 86400000)
    : Number.POSITIVE_INFINITY;
  const halfLife = HALF_LIFE_DAYS[signal.trend_state] || 45;
  const timeDecay = Number.isFinite(ageDays)
    ? 0.5 ** (ageDays / halfLife)
    : 0;
  const validityMultiplier = Number.isFinite(validFromMs) && nowMs < validFromMs
    ? 0
    : Number.isFinite(validUntilMs) && nowMs > validUntilMs ? 0.1 : 1;
  const declaredFreshness = clamp(signal.freshness_score) / 100;
  const multiplier = declaredFreshness * timeDecay * validityMultiplier;
  return deepFreeze({
    source_timestamp: signal.source_timestamp,
    age_days: Number.isFinite(ageDays) ? round(ageDays) : null,
    half_life_days: halfLife,
    declared_freshness_score: clamp(signal.freshness_score),
    time_decay: round(timeDecay, 4),
    validity_multiplier: validityMultiplier,
    freshness_multiplier: round(multiplier, 4),
    effective_freshness_score: round(100 * multiplier),
  });
}

function preferenceMultiplier(signal, brain) {
  const trendPreference = evidenceValue(brain?.trend_preference);
  const mainstream = evidenceValue(brain?.mainstream_vs_niche);
  let multiplier = 1;
  const reasons = [];
  if (trendPreference === "current") {
    if (["hot", "rising", "niche_rising"].includes(signal.trend_state)) {
      multiplier *= 1.25;
      reasons.push("CURRENT_TREND_BOOST");
    } else if (signal.trend_state === "declining") {
      multiplier *= 0.55;
      reasons.push("DECLINING_TREND_PENALTY");
    }
  }
  if (trendPreference === "classic") {
    if (signal.trend_state === "stable") {
      multiplier *= 1.35;
      reasons.push("CLASSIC_STABILITY_BOOST");
    } else if (["hot", "rising", "niche_rising"].includes(signal.trend_state)) {
      multiplier *= 0.72;
      reasons.push("CLASSIC_VOLATILITY_PENALTY");
    }
  }
  if (mainstream === "mainstream") {
    if (["hot", "rising", "stable"].includes(signal.trend_state)) {
      multiplier *= 1.18;
      reasons.push("MAINSTREAM_ALIGNMENT_BOOST");
    } else if (signal.trend_state.startsWith("niche_")) {
      multiplier *= 0.75;
      reasons.push("NICHE_MISMATCH_PENALTY");
    }
  }
  if (mainstream === "niche") {
    if (signal.trend_state.startsWith("niche_")) {
      multiplier *= 1.4;
      reasons.push("NICHE_ALIGNMENT_BOOST");
    }
    if (signal.popularity_score >= 90 &&
        !signal.trend_state.startsWith("niche_")) {
      multiplier *= 0.42;
      reasons.push("EXTREME_MAINSTREAM_PENALTY");
    }
  }
  return deepFreeze({
    trend_preference: trendPreference,
    mainstream_vs_niche: mainstream,
    multiplier: round(multiplier, 4),
    reasons,
  });
}

function normalizeSignal(rawSignal, group, snapshot, asOf, brain) {
  const sourceTimestamp = isoTime(
    rawSignal?.source_timestamp,
    snapshot.timestamp,
  );
  const value = String(rawSignal?.value || "").trim();
  const trendState = String(rawSignal?.trend_state || "").trim();
  const source = String(rawSignal?.source || "").trim();
  if (!value || !TREND_STATES.has(trendState) || !sourceTimestamp ||
      source !== MARKET_SOURCE_MOCK_FIXTURE) {
    return null;
  }
  const signal = {
    value,
    signal_type: String(
      rawSignal.signal_type || SIGNAL_TYPE_BY_GROUP[group],
    ),
    signal_group: group,
    trend_state: trendState,
    popularity_score: clamp(rawSignal.popularity_score),
    velocity_score: clamp(rawSignal.velocity_score),
    freshness_score: clamp(rawSignal.freshness_score),
    niche_score: clamp(rawSignal.niche_score),
    confidence: clamp(rawSignal.confidence, 0, 1),
    source,
    source_timestamp: sourceTimestamp,
    evidence_count: Math.max(0, Math.trunc(Number(rawSignal.evidence_count) || 0)),
  };
  const freshness = freshnessForSignal(signal, snapshot, asOf);
  const preference = preferenceMultiplier(signal, brain);
  const baseScore = signal.popularity_score * 0.3 +
    signal.velocity_score * 0.25 +
    freshness.effective_freshness_score * 0.3 +
    signal.niche_score * 0.15;
  return deepFreeze({
    ...signal,
    freshness_adjustment: freshness,
    user_preference_adjustment: preference,
    effective_score: round(baseScore * preference.multiplier),
  });
}

function normalizeSignals(snapshot, asOf, brain) {
  if (!snapshot || typeof snapshot !== "object") return [];
  const normalized = [];
  for (const group of SIGNAL_GROUPS) {
    for (const signal of snapshot.signals?.[group] || []) {
      const item = normalizeSignal(signal, group, snapshot, asOf, brain);
      if (item) normalized.push(item);
    }
  }
  return deepFreeze(normalized.sort((left, right) =>
    right.effective_score - left.effective_score));
}

function intentAvoids(brain) {
  const value = evidenceValue(brain?.explicit_avoid, []);
  return Array.isArray(value) ? value.map(String) : value ? [String(value)] : [];
}

function signalConflictsWithAvoid(signal, avoids) {
  const signalText = normalizedText(signal.value);
  return avoids.find((avoid) => {
    const avoidText = normalizedText(avoid)
      .replace(/^(?:不要|避免|拒绝|不穿|不想要)_?/u, "");
    return avoidText && (signalText.includes(avoidText) ||
      avoidText.includes(signalText));
  }) || null;
}

function bodyFootwearConflict(signal, bodyFitProfile) {
  if (signal.signal_type !== "footwear") return null;
  const preferredWeight = normalizedText(evidenceValue(
    bodyFitProfile?.garment_preferences?.shoes?.visual_weight,
  ));
  const signalValue = normalizedText(signal.value);
  const bodyWantsLight = /(?:low|light|轻|低)/u.test(preferredWeight);
  const marketWantsHeavy = /(?:heavy|chunky|platform|厚重|厚底|大体量)/u
    .test(signalValue);
  if (!bodyWantsLight || !marketWantsHeavy) return null;
  return deepFreeze({
    signal_value: signal.value,
    body_preference: preferredWeight,
    resolution: "BODY_FIT_REMAINS_AUTHORITATIVE",
    market_action: "RECORDED_NOT_APPLIED",
  });
}

function styleAnchorConflict(signal, concept) {
  const anchor = concept?.style_anchor?.value;
  if (signal.signal_type !== "style" || !anchor) return null;
  if (normalizedText(signal.value) === normalizedText(anchor)) return null;
  return deepFreeze({
    concept_id: concept.concept_id,
    signal_value: signal.value,
    kept_style_anchor: anchor,
    resolution: "EXPLICIT_STYLE_ANCHOR_PRESERVED",
    market_action: "RECORDED_NOT_APPLIED",
  });
}

function adjustmentDimension(signal) {
  return {
    silhouette: "silhouette_direction",
    color: "color_direction",
    footwear: "footwear_direction",
    layering: "layering_direction",
    category: "statement_level",
    material: "quality_direction",
  }[signal.signal_type] || null;
}

function enrichConcept(concept, signals, brain, bodyFitProfile) {
  const opportunities = [];
  const risks = [];
  const bodyConflicts = [];
  const intentConflicts = [];
  const adjustments = [];
  const avoids = intentAvoids(brain);
  const usedDimensions = new Set();
  for (const signal of signals) {
    const avoidedBy = signalConflictsWithAvoid(signal, avoids);
    if (avoidedBy) {
      intentConflicts.push({
        concept_id: concept.concept_id,
        signal_value: signal.value,
        user_avoid: avoidedBy,
        resolution: "USER_AVOID_REMAINS_AUTHORITATIVE",
        market_action: "RECORDED_NOT_APPLIED",
      });
      continue;
    }
    const anchorConflict = styleAnchorConflict(signal, concept);
    if (anchorConflict) {
      intentConflicts.push(anchorConflict);
      continue;
    }
    const bodyConflict = bodyFootwearConflict(signal, bodyFitProfile);
    if (bodyConflict) {
      bodyConflicts.push({concept_id: concept.concept_id, ...bodyConflict});
      continue;
    }
    if (signal.trend_state === "declining" ||
        signal.freshness_adjustment.freshness_multiplier < 0.2) {
      risks.push({
        value: signal.value,
        signal_type: signal.signal_type,
        reason: signal.trend_state === "declining"
          ? "DECLINING_SIGNAL" : "STALE_SIGNAL",
        effective_score: signal.effective_score,
      });
      continue;
    }
    opportunities.push({
      value: signal.value,
      signal_type: signal.signal_type,
      trend_state: signal.trend_state,
      effective_score: signal.effective_score,
      source: signal.source,
      confidence: signal.confidence,
    });
    const dimension = adjustmentDimension(signal);
    if (dimension && !usedDimensions.has(dimension) && adjustments.length < 5) {
      usedDimensions.add(dimension);
      adjustments.push({
        dimension,
        value: signal.value,
        strength: "soft_evidence",
        status: "PROPOSED_NOT_APPLIED",
        preserves_style_anchor: true,
        source: signal.source,
        confidence: signal.confidence,
      });
    }
  }
  const usable = opportunities.slice(0, 7);
  const anchor = normalizedText(concept?.style_anchor?.value);
  const matchingStyle = signals.find((signal) =>
    signal.signal_type === "style" && normalizedText(signal.value) === anchor);
  const averageFreshness = signals.length > 0
    ? signals.reduce((total, signal) => total +
      signal.freshness_adjustment.effective_freshness_score, 0) / signals.length
    : 0;
  const nichePreference = evidenceValue(brain?.mainstream_vs_niche);
  const nicheSignals = usable.filter((item) =>
    item.trend_state.startsWith("niche_"));
  return deepFreeze({
    ...deepClone(concept),
    market_enrichment_version: MARKET_FASHION_BRAIN_VERSION,
    market_opportunities: usable,
    market_risks: risks.slice(0, 5),
    trend_alignment: {
      score: matchingStyle?.effective_score || usable[0]?.effective_score || 0,
      matching_style_signal: matchingStyle?.value || null,
      style_anchor_preserved: true,
    },
    niche_alignment: {
      preference: nichePreference,
      matching_signal_count: nicheSignals.length,
      top_signal: nicheSignals[0]?.value || null,
    },
    freshness: round(averageFreshness),
    recommended_market_adjustments: adjustments,
    body_conflicts: bodyConflicts,
    intent_conflicts: intentConflicts,
    market_source: MARKET_SOURCE_MOCK_FIXTURE,
    market_confidence: round(Math.min(
      Number(concept.confidence || 0),
      usable[0]?.confidence || 0,
    ), 3),
  });
}

function emptyMarketResult({scope, providerResult, reason}) {
  return deepFreeze({
    version: MARKET_FASHION_BRAIN_VERSION,
    mode: "SHADOW_ONLY",
    status: MARKET_STATUS_INSUFFICIENT,
    provider: providerResult?.provider || "unconfigured",
    fetch_time: providerResult?.fetch_time || null,
    market_scope: scope,
    timestamp: providerResult?.snapshot?.timestamp || null,
    valid_from: providerResult?.snapshot?.valid_from || null,
    valid_until: providerResult?.snapshot?.valid_until || null,
    raw_market_signals: [],
    normalized_signals: [],
    freshness_adjustment: [],
    user_preference_adjustment: [],
    body_conflicts: [],
    intent_conflicts: [],
    concept_enrichment: [],
    confidence: 0,
    source: providerResult?.provider || "unconfigured",
    source_map: {
      signals: {source: providerResult?.provider || "unconfigured", confidence: 0},
      concepts: {source: "ai_inference", confidence: 0},
    },
    failure: providerResult?.failure || {code: reason},
    fallback: "NO_MARKET_ADJUSTMENT",
  });
}

function generateMarketFashionContext(context = {}, {
  provider = new MockMarketSignalProvider(),
  scope,
  now,
} = {}) {
  const concepts = Array.isArray(context.concepts) ? context.concepts : [];
  const brain = context?.intent?.user_intent_brain || {};
  const marketScope = normalizeMarketScope(
    scope || deriveMarketScope(context, provider.provider),
    provider.provider,
  );
  const asOf = isoTime(
    now,
    context?.recommendation_context?.timestamp || new Date().toISOString(),
  );
  let providerResult;
  try {
    providerResult = provider.fetchSignals({scope: marketScope, at: asOf});
    if (providerResult && typeof providerResult.then === "function") {
      const error = new Error("Async providers are not available in V1 shadow mode");
      error.code = "MARKET_ASYNC_PROVIDER_UNSUPPORTED";
      throw error;
    }
  } catch (error) {
    providerResult = {
      provider: provider.provider || "unconfigured",
      fetch_time: asOf,
      snapshot: null,
      confidence: 0,
      failure: {code: error.code || "MARKET_PROVIDER_FAILED"},
    };
  }
  const normalized = normalizeSignals(
    providerResult?.snapshot,
    asOf,
    brain,
  );
  if (normalized.length === 0 || concepts.length === 0) {
    return emptyMarketResult({
      scope: marketScope,
      providerResult,
      reason: normalized.length === 0
        ? "NO_VALID_MARKET_SIGNALS" : "NO_LOOK_CONCEPTS",
    });
  }
  const enrichedConcepts = concepts.map((concept) =>
    enrichConcept(concept, normalized, brain, context.body_fit_profile));
  const bodyConflicts = enrichedConcepts.flatMap((concept) =>
    concept.body_conflicts);
  const intentConflicts = enrichedConcepts.flatMap((concept) =>
    concept.intent_conflicts);
  return deepFreeze({
    version: MARKET_FASHION_BRAIN_VERSION,
    mode: "SHADOW_ONLY",
    status: MARKET_STATUS_AVAILABLE,
    provider: providerResult.provider,
    fetch_time: providerResult.fetch_time,
    market_scope: marketScope,
    timestamp: providerResult.snapshot.timestamp,
    valid_from: providerResult.snapshot.valid_from,
    valid_until: providerResult.snapshot.valid_until,
    raw_market_signals: deepClone(providerResult.snapshot.signals),
    normalized_signals: normalized,
    signals: normalized,
    freshness_adjustment: normalized.map((signal) => ({
      value: signal.value,
      ...signal.freshness_adjustment,
    })),
    user_preference_adjustment: normalized.map((signal) => ({
      value: signal.value,
      ...signal.user_preference_adjustment,
      effective_score: signal.effective_score,
    })),
    body_conflicts: bodyConflicts,
    intent_conflicts: intentConflicts,
    concept_enrichment: enrichedConcepts,
    confidence: round(clamp(providerResult.confidence, 0, 1), 3),
    source: providerResult.provider,
    source_map: {
      market_scope: {source: "system", confidence: 1},
      signals: {
        source: providerResult.provider,
        confidence: round(clamp(providerResult.confidence, 0, 1), 3),
      },
      concepts: {source: "ai_inference", confidence: 0.7},
      body_conflicts: {source: "body_fit_profile", confidence: 1},
      intent_conflicts: {source: "user", confidence: 1},
    },
    failure: null,
    fallback: null,
  });
}

class MarketFashionBrain {
  constructor({provider = new MockMarketSignalProvider()} = {}) {
    this.provider = provider;
  }

  generate(context, options = {}) {
    return generateMarketFashionContext(context, {
      ...options,
      provider: options.provider || this.provider,
    });
  }
}

module.exports = {
  MARKET_FASHION_BRAIN_VERSION,
  MARKET_SIGNAL_PROVIDER_VERSION,
  MARKET_SOURCE_MOCK_FIXTURE,
  MARKET_STATUS_AVAILABLE,
  MARKET_STATUS_INSUFFICIENT,
  MarketFashionBrain,
  MarketSignalProvider,
  MockMarketSignalProvider,
  deriveMarketScope,
  freshnessForSignal,
  generateMarketFashionContext,
  normalizeMarketScope,
};
