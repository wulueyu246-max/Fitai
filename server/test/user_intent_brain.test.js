"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {createDecisionContext} = require("../decision_context");
const {
  USER_INTENT_BRAIN_VERSION,
  createUserIntentTrace,
  interpretUserIntent,
} = require("../user_intent_brain");

function contextFor(rawUserInput, {
  gender = "female",
  scene = "",
  explicitStyle = "",
  requirements = [],
  avoid = [],
  preferences = [],
} = {}) {
  return createDecisionContext({
    requestId: `intent-${Math.random().toString(16).slice(2)}`,
    rawUserInput,
    timestamp: "2026-08-27T10:00:00.000Z",
    userTruth: {
      gender,
      scene,
      budget: {item: "200-500", outfit: "800-1500"},
      explicitStyle,
      explicitRequirements: requirements,
      explicitAvoid: avoid,
      explicitPreferences: preferences,
    },
    body: {
      height: {value: 160, source: "user", confidence: 1},
      weight: {value: 50, source: "user", confidence: 1},
      structuredMeasurements: {body_type: "petite"},
    },
    market: {status: "NOT_CONNECTED", signals: [], confidence: 0},
    recommendationContext: {provider: "mock"},
  });
}

function assertEvidenceFields(result) {
  for (const field of [
    "primary_goal",
    "explicit_style",
    "explicit_requirements",
    "explicit_avoid",
    "explicit_preferences",
    "desired_impression",
    "scene_intent",
    "formality_preference",
    "trend_preference",
    "mainstream_vs_niche",
    "experimentation_level",
    "creative_freedom",
    "style_constraint",
    "style_flexibility",
    "statement_level",
    "portfolio_diversity_preference",
    "constraints",
    "uncertainty",
  ]) {
    assert.equal(Object.hasOwn(result[field], "value"), true, field);
    assert.equal(typeof result[field].source, "string", field);
    assert.equal(
      result[field].confidence >= 0 && result[field].confidence <= 1,
      true,
      field,
    );
    assert.deepEqual(result.source_map[field], {
      source: result[field].source,
      confidence: result[field].confidence,
    });
  }
}

test("Case A: explicit Cityboy, leather-shoe avoid and date scene stay authoritative", () => {
  const result = interpretUserIntent(contextFor(
    "我想穿Cityboy去约会，不要皮鞋",
    {
      gender: "male",
      scene: "date",
      explicitStyle: "cityboy",
      avoid: ["不要皮鞋"],
    },
  ));

  assert.equal(result.version, USER_INTENT_BRAIN_VERSION);
  assert.deepEqual(result.explicit_style, {
    value: "cityboy",
    source: "user",
    confidence: 1,
  });
  assert.ok(result.explicit_avoid.value.includes("leather_shoes"));
  assert.equal(result.scene_intent.value, "date");
  assert.equal(result.style_constraint.value, "high");
  assert.equal(result.style_resolution.resolution_reason, "EXACT_CANONICAL");
  assert.equal(result.style_resolution.semantic_candidates.length, 0);
  assertEvidenceFields(result);
});

test("Case B: vague nightlife input preserves uncertainty and never invents a canonical style", () => {
  const result = interpretUserIntent(contextFor("今晚去喝酒"));

  assert.equal(result.primary_goal.value, "适合夜生活社交");
  assert.equal(result.explicit_style.value, null);
  assert.equal(result.normalized_style.value, null);
  assert.equal(result.style_resolution.resolution_reason,
    "NO_EXPLICIT_STYLE_SIGNAL");
  assert.ok(result.uncertainty.value.includes("STYLE_DIRECTION_UNSPECIFIED"));
  assert.equal(JSON.stringify(result).includes('"minimal"'), false);
});

test("Case C: an open request for three looks carries creative freedom and diversity", () => {
  const result = interpretUserIntent(contextFor(
    "明天出去玩，随便帮我搭三套",
    {scene: "travel"},
  ));

  assert.equal(result.creative_freedom.value, "high");
  assert.equal(result.style_constraint.value, "low");
  assert.equal(result.portfolio_diversity_preference.value, "high");
  assert.ok(result.constraints.value.some(({type, value}) =>
    type === "look_count" && value === 3));
});

test("Case D: current and mainstream preferences remain explicit user signals", () => {
  const result = interpretUserIntent(contextFor(
    "想穿最近很火的，不要太小众",
  ));

  assert.deepEqual(result.trend_preference, {
    value: "current", source: "user", confidence: 1,
  });
  assert.deepEqual(result.mainstream_vs_niche, {
    value: "mainstream", source: "user", confidence: 1,
  });
  assert.equal(result.explicit_style.value, null);
});

test("Case E: avoiding ubiquitous looks raises niche and experimentation intent", () => {
  const result = interpretUserIntent(contextFor(
    "不要烂大街，我想有点特别",
  ));

  assert.equal(result.mainstream_vs_niche.value, "niche");
  assert.equal(result.experimentation_level.value, "high");
  assert.equal(result.mainstream_vs_niche.source, "user");
  assert.equal(result.experimentation_level.source, "user");
});

test("Case F: elevated formality coexists with explicit anti-office constraints", () => {
  const result = interpretUserIntent(contextFor(
    "我要正式一点，但是不要像上班",
    {avoid: ["但是不要像上班"]},
  ));

  assert.equal(result.formality_preference.value, "elevated");
  assert.ok(result.explicit_avoid.value.includes("overly_corporate"));
  assert.ok(result.explicit_avoid.value.includes("office_like"));
  assert.equal(result.explicit_style.value, null);
});

test("Case G: Korean is a preference while alternate directions remain open", () => {
  const result = interpretUserIntent(contextFor(
    "偏韩系一点，但你也可以帮我试点别的",
  ));

  assert.equal(result.explicit_style.value, null);
  assert.equal(result.normalized_style.value, "korean");
  assert.ok(result.explicit_preferences.value.includes("style:korean"));
  assert.equal(result.style_resolution.role, "preference");
  assert.equal(result.style_constraint.value, "medium");
  assert.equal(result.creative_freedom.value, "medium");
  assert.ok(result.uncertainty.value.includes(
    "ALTERNATIVE_STYLE_DIRECTIONS_ALLOWED",
  ));
});

test("real multi-style intent stays multi-style instead of collapsing to one profile", () => {
  const result = interpretUserIntent(contextFor(
    "我想穿 sweet + elegant 去约会",
    {scene: "date", explicitStyle: "sweet + elegant"},
  ));

  assert.equal(result.explicit_style.value, "sweet + elegant");
  assert.deepEqual(
    result.style_resolution.final_profile_components.map(({id}) => id),
    ["sweet", "elegant"],
  );
  assert.equal(result.style_resolution.resolution_reason,
    "EXPLICIT_MULTI_STYLE_BLEND");
});

test("an explicit unknown style stays as user truth without a fabricated profile", () => {
  const result = interpretUserIntent(contextFor(
    "我想要赛博禅意风格",
    {explicitStyle: "赛博禅意"},
  ));

  assert.equal(result.explicit_style.value, "赛博禅意");
  assert.equal(result.explicit_style.source, "user");
  assert.equal(result.normalized_style.value, null);
  assert.equal(result.style_constraint.value, "high");
  assert.equal(result.style_resolution.resolution_reason,
    "EXPLICIT_STYLE_UNNORMALIZED");
  assert.ok(result.uncertainty.value.includes("STYLE_NORMALIZATION_UNRESOLVED"));
  assert.equal(JSON.stringify(result).includes('"minimal"'), false);
});

test("style preference qualifiers are scoped to the style phrase", () => {
  const result = interpretUserIntent(contextFor(
    "我想穿Cityboy去约会，正式一点",
    {gender: "male", scene: "date", explicitStyle: "cityboy"},
  ));

  assert.equal(result.explicit_style.value, "cityboy");
  assert.equal(result.style_resolution.role, "lock");
  assert.equal(result.style_constraint.value, "high");
  assert.equal(result.formality_preference.value, "elevated");
});

test("opening one product choice does not weaken an explicit style lock", () => {
  for (const raw of [
    "我想穿Cityboy，包可以换别的",
    "我想穿Cityboy，鞋子可以换其他款",
    "我想穿Cityboy，鞋子可以试试别的",
    "我想穿Cityboy，包可以尝试其他款",
  ]) {
    const result = interpretUserIntent(contextFor(raw, {
      gender: "male",
      explicitStyle: "cityboy",
    }));
    assert.equal(result.explicit_style.value, "cityboy", raw);
    assert.equal(result.style_resolution.role, "lock", raw);
    assert.equal(result.style_constraint.value, "high", raw);
    assert.equal(result.uncertainty.value.includes(
      "ALTERNATIVE_STYLE_DIRECTIONS_ALLOWED",
    ), false, raw);
  }
});

test("creative freedom does not erase an explicit style boundary", () => {
  const result = interpretUserIntent(contextFor(
    "我想穿Cityboy，随便帮我搭三套",
    {gender: "male", explicitStyle: "cityboy"},
  ));

  assert.equal(result.explicit_style.value, "cityboy");
  assert.equal(result.style_resolution.role, "lock");
  assert.equal(result.creative_freedom.value, "high");
  assert.equal(result.portfolio_diversity_preference.value, "high");
  assert.equal(result.style_constraint.value, "high");
});

test("a structured avoid remains authoritative even without a negative word", () => {
  const result = interpretUserIntent(contextFor(
    "我想穿Cityboy去约会",
    {gender: "male", scene: "date", explicitStyle: "cityboy", avoid: ["皮鞋"]},
  ));

  assert.deepEqual(result.explicit_avoid.value, ["leather_shoes"]);
  assert.equal(result.explicit_avoid.source, "user");
  assert.equal(result.explicit_avoid.confidence, 1);
});

test("profile style evidence stays a preference with profile provenance", () => {
  const context = createDecisionContext({
    requestId: "profile-style-intent",
    rawUserInput: "帮我搭一套",
    userTruth: {gender: "male", scene: "daily"},
    profile: {explicit_style: "cityboy"},
    market: {status: "NOT_CONNECTED", signals: [], confidence: 0},
    recommendationContext: {provider: "mock"},
  });
  const result = interpretUserIntent(context);

  assert.equal(result.explicit_style.value, null);
  assert.equal(result.normalized_style.value, "cityboy");
  assert.equal(result.normalized_style.source, "profile");
  assert.equal(result.style_resolution.role, "preference");
  assert.equal(result.style_constraint.source, "profile");
  assert.ok(result.explicit_preferences.value.includes("style:cityboy"));
  assert.equal(result.explicit_preferences.source, "profile");
});

test("generic outfit wording and negated sweetness do not become style locks", () => {
  for (const raw of [
    "给我搭一套适合约会的穿搭",
    "帮我搭一个通勤造型",
    "我想穿不太甜美的风格",
    "我不想穿甜美风",
    "我不喜欢Cityboy风格",
  ]) {
    const result = interpretUserIntent(contextFor(raw, {explicitStyle: raw}));
    assert.equal(result.explicit_style.value, null, raw);
    assert.equal(result.normalized_style.value, null, raw);
    assert.ok(result.uncertainty.value.includes("STYLE_DIRECTION_UNSPECIFIED"), raw);
  }
});

test("an unrecognized but explicitly scoped style is preserved without normalization", () => {
  for (const raw of ["我想穿老钱风", "我想穿老钱风去约会"]) {
    const result = interpretUserIntent(contextFor(raw, {
      explicitStyle: raw.endsWith("风") ? raw : "",
    }));
    assert.equal(result.explicit_style.value, "老钱", raw);
    assert.equal(result.normalized_style.value, null, raw);
    assert.equal(result.style_resolution.resolution_reason,
      "EXPLICIT_STYLE_UNNORMALIZED", raw);
  }
});

test("intent trace is immutable and exposes explicit and inferred provenance", () => {
  const result = interpretUserIntent(contextFor("今晚去喝酒"));
  const trace = createUserIntentTrace(result);

  assert.equal(trace.raw_user_input, "今晚去喝酒");
  assert.ok(trace.inferred_signals.some(({kind}) => kind === "uncertainty"));
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.source_map), true);
  assert.equal(Object.isFrozen(trace), true);
  assert.throws(() => {
    result.uncertainty.value.push("MUTATION");
  }, TypeError);
});

test("retrieval-facing impressions preserve youth, design, relaxed formality and statement", () => {
  const result = interpretUserIntent(contextFor(
    "今晚和朋友出去玩，帮我搭3套，年轻一点，有点设计感，别太正式。",
    {scene: "nightlife"},
  ));

  assert.deepEqual(result.desired_impression.value, ["年轻", "有设计感"]);
  assert.equal(result.formality_preference.value, "relaxed");
  assert.equal(result.statement_level.value, "medium");
  assert.equal(result.style_flexibility.value, "high");
  assert.ok(result.trace.explicit_signals.some(({kind, normalized}) =>
    kind === "desired_impression" && normalized === "年轻"));
  assert.ok(result.trace.explicit_signals.some(({kind, normalized}) =>
    kind === "desired_impression" && normalized === "有设计感"));
});

test("clean fashionable anti-office intent stays separated by authority and role", () => {
  const result = interpretUserIntent(contextFor(
    "周末约会，帮我搭3套，干净时髦一点，不要像上班。",
    {gender: "male", scene: "date"},
  ));

  assert.deepEqual(result.desired_impression.value, ["干净利落", "时髦"]);
  assert.ok(result.explicit_avoid.value.includes("overly_corporate"));
  assert.ok(result.explicit_avoid.value.includes("office_like"));
  assert.equal(result.statement_level.value, "medium");
  assert.equal(result.formality_preference.value, null);
  assert.equal(result.style_flexibility.value, "high");
});
