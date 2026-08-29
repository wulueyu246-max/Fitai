"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  MARKET_STATUS_AVAILABLE,
  MARKET_STATUS_INSUFFICIENT,
  MarketSignalProvider,
  MockMarketSignalProvider,
  generateMarketFashionContext,
} = require("../market_fashion_brain");
const {createOutfitDecisionContext} = require("../index");

const NOW = "2026-08-27T00:00:00.000Z";

function request(overrides = {}) {
  return {
    requestId: `market-${overrides.caseId || "case"}`,
    rawUserInput: "帮我搭几套",
    gender: "female",
    scene: "daily",
    itemBudget: "200-500",
    outfitBudget: "800-1500",
    explicitStyle: "",
    explicitRequirements: [],
    explicitAvoid: [],
    explicitPreferences: [],
    height: 160,
    weight: 50,
    structuredBodyProfile: {leg_length_relation: "short"},
    ...overrides,
  };
}

function context(overrides = {}) {
  return createOutfitDecisionContext(request(overrides), {
    provider: "mock",
    timestamp: NOW,
  });
}

function signal(value, trendState, overrides = {}) {
  return {
    value,
    signal_type: overrides.signal_type || "style",
    trend_state: trendState,
    popularity_score: 70,
    velocity_score: 60,
    freshness_score: 95,
    niche_score: 30,
    confidence: 0.8,
    source: "mock_market_fixture",
    source_timestamp: "2026-08-25T00:00:00.000Z",
    evidence_count: 20,
    ...overrides,
  };
}

function snapshot({scope = {}, signals = {}, confidence = 0.8} = {}) {
  return {
    market_scope: {
      country: "any",
      region: "any",
      demographic: "any",
      gender_expression: "any",
      age_band: "any",
      platform: "mock_market_fixture",
      ...scope,
    },
    timestamp: NOW,
    valid_from: "2026-08-01T00:00:00.000Z",
    valid_until: "2026-12-31T23:59:59.000Z",
    confidence,
    signals: {
      style_signals: [],
      silhouette_signals: [],
      category_signals: [],
      color_signals: [],
      footwear_signals: [],
      material_signals: [],
      layering_signals: [],
      ...signals,
    },
  };
}

function run(input, snapshots, options = {}) {
  return generateMarketFashionContext(context(input), {
    provider: new MockMarketSignalProvider({snapshots}),
    now: NOW,
    ...options,
  });
}

test("MarketSignalProvider exposes an honest unconfigured fallback", () => {
  const provider = new MarketSignalProvider();
  const result = provider.fetchSignals({at: NOW});

  assert.equal(result.provider, "unconfigured");
  assert.equal(result.snapshot, null);
  assert.equal(result.failure.code, "MARKET_PROVIDER_NOT_IMPLEMENTED");
});

test("Case A: current preference prioritizes hot and rising evidence", () => {
  const result = run({
    caseId: "current",
    rawUserInput: "我想穿现在流行一点的",
  }, [snapshot({signals: {style_signals: [
    signal("current_hot", "hot", {velocity_score: 82}),
    signal("quiet_stable", "stable", {popularity_score: 82}),
  ]}})]);

  assert.equal(result.status, MARKET_STATUS_AVAILABLE);
  assert.equal(result.normalized_signals[0].value, "current_hot");
  assert.ok(result.normalized_signals[0].user_preference_adjustment.reasons
    .includes("CURRENT_TREND_BOOST"));
});

test("Case B: niche preference beats an extreme mainstream blockbuster", () => {
  const result = run({
    caseId: "niche",
    rawUserInput: "不要烂大街，我想小众一点",
  }, [snapshot({signals: {style_signals: [
    signal("blockbuster", "hot", {
      popularity_score: 100,
      velocity_score: 90,
      niche_score: 5,
    }),
    signal("emerging_niche", "niche_rising", {
      popularity_score: 58,
      velocity_score: 78,
      niche_score: 94,
    }),
  ]}})]);

  assert.equal(result.normalized_signals[0].value, "emerging_niche");
  const blockbuster = result.normalized_signals.find(({value}) =>
    value === "blockbuster");
  assert.ok(blockbuster.user_preference_adjustment.reasons
    .includes("EXTREME_MAINSTREAM_PENALTY"));
});

test("Case C: classic preference prioritizes stable evidence", () => {
  const result = run({
    caseId: "classic",
    rawUserInput: "想要经典一点、耐看的",
  }, [snapshot({signals: {style_signals: [
    signal("short_lived_hot", "hot", {velocity_score: 88}),
    signal("timeless_tailoring", "stable", {velocity_score: 52}),
  ]}})]);

  assert.equal(result.normalized_signals[0].value, "timeless_tailoring");
  assert.ok(result.normalized_signals[0].user_preference_adjustment.reasons
    .includes("CLASSIC_STABILITY_BOOST"));
});

test("Case D: a hotter clean-fit signal cannot replace explicit Cityboy", () => {
  const result = run({
    caseId: "cityboy",
    gender: "male",
    scene: "date",
    rawUserInput: "我要Cityboy去约会",
    explicitStyle: "cityboy",
  }, [snapshot({signals: {style_signals: [
    signal("clean_fit", "hot", {popularity_score: 95}),
    signal("cityboy", "stable", {popularity_score: 65}),
  ]}})]);

  assert.equal(result.concept_enrichment.every((concept) =>
    concept.style_anchor.value === "cityboy"), true);
  assert.ok(result.intent_conflicts.some((item) =>
    item.signal_value === "clean_fit" &&
      item.resolution === "EXPLICIT_STYLE_ANCHOR_PRESERVED"));
  assert.equal(result.concept_enrichment.some((concept) =>
    concept.recommended_market_adjustments.some(({dimension}) =>
      dimension === "style_anchor")), false);
});

test("Case E: stale evidence receives strong time decay", () => {
  const result = run({caseId: "freshness"}, [snapshot({signals: {
    color_signals: [
      signal("fresh_color", "rising", {
        signal_type: "color",
        source_timestamp: "2026-08-25T00:00:00.000Z",
      }),
      signal("old_color", "rising", {
        signal_type: "color",
        popularity_score: 100,
        velocity_score: 100,
        source_timestamp: "2024-08-25T00:00:00.000Z",
      }),
    ],
  }})]);
  const fresh = result.normalized_signals.find(({value}) =>
    value === "fresh_color");
  const old = result.normalized_signals.find(({value}) =>
    value === "old_color");

  assert.ok(old.freshness_adjustment.freshness_multiplier < 0.01);
  assert.ok(old.effective_score < fresh.effective_score);
});

test("Case F: insufficient data never falls back to style profiles", () => {
  const result = run({caseId: "empty"}, []);

  assert.equal(result.status, MARKET_STATUS_INSUFFICIENT);
  assert.deepEqual(result.normalized_signals, []);
  assert.deepEqual(result.concept_enrichment, []);
  assert.equal(result.fallback, "NO_MARKET_ADJUSTMENT");
});

test("Case G: the same signal can differ between independent scopes", () => {
  const scopedSnapshots = [
    snapshot({
      scope: {country: "CN", demographic: "young_urban"},
      signals: {silhouette_signals: [signal(
        "relaxed_tailoring",
        "rising",
        {signal_type: "silhouette", velocity_score: 86},
      )]},
    }),
    snapshot({
      scope: {country: "US", demographic: "young_urban"},
      signals: {silhouette_signals: [signal(
        "relaxed_tailoring",
        "declining",
        {signal_type: "silhouette", velocity_score: 22},
      )]},
    }),
  ];
  const provider = new MockMarketSignalProvider({snapshots: scopedSnapshots});
  const base = context({caseId: "scope"});
  const cn = generateMarketFashionContext(base, {
    provider,
    now: NOW,
    scope: {
      country: "CN", region: "national", demographic: "young_urban",
      gender_expression: "female", age_band: "unspecified",
    },
  });
  const us = generateMarketFashionContext(base, {
    provider,
    now: NOW,
    scope: {
      country: "US", region: "national", demographic: "young_urban",
      gender_expression: "female", age_band: "unspecified",
    },
  });

  assert.equal(cn.normalized_signals[0].trend_state, "rising");
  assert.equal(us.normalized_signals[0].trend_state, "declining");
  assert.notEqual(cn.normalized_signals[0].effective_score,
    us.normalized_signals[0].effective_score);
});

test("Case H: BodyFit conflict is recorded and never applied", () => {
  const result = run({
    caseId: "body-conflict",
    rawUserInput: "给我搭一套利落穿搭",
    explicitStyle: "clean_fit",
  }, [snapshot({signals: {footwear_signals: [signal(
    "heavy_chunky_platform_footwear",
    "hot",
    {signal_type: "footwear", popularity_score: 96},
  )]}})]);

  assert.ok(result.body_conflicts.length > 0);
  assert.equal(result.concept_enrichment.some((concept) =>
    concept.recommended_market_adjustments.some(({value}) =>
      value === "heavy_chunky_platform_footwear")), false);
});

test("Case I: explicit footwear avoid defeats a hot market signal", () => {
  const result = run({
    caseId: "avoid",
    rawUserInput: "不要platform_shoes，帮我搭一套",
    explicitAvoid: ["platform_shoes"],
  }, [snapshot({signals: {footwear_signals: [signal(
    "platform_shoes",
    "hot",
    {signal_type: "footwear", popularity_score: 99},
  )]}})]);

  assert.ok(result.intent_conflicts.some((item) =>
    item.signal_value === "platform_shoes" &&
      item.resolution === "USER_AVOID_REMAINS_AUTHORITATIVE"));
  assert.equal(result.concept_enrichment.some((concept) =>
    concept.recommended_market_adjustments.some(({value}) =>
      value === "platform_shoes")), false);
});
