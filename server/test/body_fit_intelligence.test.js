"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  BODY_FIT_INTELLIGENCE_VERSION,
  buildBodyFitProfile,
  createBodyFitTrace,
} = require("../body_fit_intelligence");
const {
  createDecisionContext,
  enrichDecisionContext,
} = require("../decision_context");
const {interpretUserIntent} = require("../user_intent_brain");

function contextFor({
  id = `body-fit-${Math.random().toString(16).slice(2)}`,
  raw = "帮我搭一套",
  gender = "unisex",
  scene = "daily",
  style = "",
  height,
  weight,
  structured = {},
  imageAnalysis = {},
} = {}) {
  const base = createDecisionContext({
    requestId: id,
    rawUserInput: raw,
    timestamp: "2026-08-27T12:00:00.000Z",
    userTruth: {
      gender,
      scene,
      explicitStyle: style,
      budget: {item: "200-500", outfit: "800-1500"},
    },
    body: {
      height: {value: height, source: "user", confidence: 1},
      weight: {value: weight, source: "user", confidence: 1},
      structuredMeasurements: structured,
      imageAnalysis,
      source: "profile",
      confidence: 1,
    },
    market: {status: "NOT_CONNECTED", signals: [], confidence: 0},
    recommendationContext: {provider: "mock"},
  });
  return enrichDecisionContext(base, {
    userIntent: interpretUserIntent(base),
    userIntentSource: "system",
    userIntentConfidence: 1,
  });
}

function values(items) {
  return items.map(({value}) => value);
}

test("Case A: short leg relation yields only soft waist and length preferences", () => {
  const profile = buildBodyFitProfile(contextFor({
    raw: "我想穿甜美风去约会",
    gender: "female",
    scene: "date",
    style: "sweet",
    height: 160,
    weight: 50,
    structured: {leg_length_relation: "腿身比偏短"},
  }));

  assert.equal(profile.version, BODY_FIT_INTELLIGENCE_VERSION);
  assert.equal(profile.decision_policy, "SOFT_OPTIMIZATION_ONLY");
  assert.equal(profile.body_facts.height.value, 160);
  assert.equal(profile.body_facts.leg_length_relation.value, "short");
  assert.equal(profile.proportion_goals.waistline_goal.value,
    "raise_visual_waistline");
  assert.equal(profile.garment_preferences.bottom.rise.value, "mid_to_high_rise");
  assert.match(profile.garment_preferences.top.preferred_length.value,
    /waist|short/u);
  assert.ok(profile.fit_prefer.every(({hard_requirement: hard}) => hard === false));
  assert.ok(profile.fit_avoid.every(({hard_gate: hard}) => hard === false));
});

test("Case B: broad shoulders and clean fit avoid tight extremes without forcing oversized", () => {
  const profile = buildBodyFitProfile(contextFor({
    raw: "我想穿clean_fit",
    gender: "male",
    style: "clean_fit",
    height: 178,
    weight: 68,
    structured: {shoulder_relation: "肩相对宽"},
  }));

  assert.equal(profile.body_facts.shoulder_relation.value, "wide");
  assert.equal(profile.garment_preferences.top.preferred_fit.value,
    "relaxed_tailored_not_tight");
  assert.equal(profile.garment_preferences.top.shoulder_structure.value,
    "natural_or_gently_structured_shoulder");
  assert.ok(values(profile.fit_avoid).includes("extreme_narrow_shoulder_line"));
  assert.ok(values(profile.fit_avoid).includes("overly_tight_upper_body"));
  assert.equal(JSON.stringify(profile).includes("forced_oversized"), false);
});

test("Case C: a long torso adjusts proportion while preserving minimal intent", () => {
  const profile = buildBodyFitProfile(contextFor({
    raw: "日常极简穿搭",
    gender: "female",
    style: "minimal",
    height: 165,
    weight: 52,
    structured: {torso_length: "上半身相对长"},
  }));

  assert.equal(profile.body_facts.torso_length.value, "long");
  assert.equal(profile.proportion_goals.upper_lower_balance.value,
    "reduce_visual_torso_dominance");
  assert.equal(profile.garment_preferences.top.preferred_fit.value,
    "clean_relaxed_or_tailored_not_skin_tight");
  assert.ok(profile.trace.intent_adjustments.includes(
    "CLEAN_STRUCTURE_PRESERVED",
  ));
});

test("Case D: height alone never bans relaxed street trousers", () => {
  const profile = buildBodyFitProfile(contextFor({
    raw: "我想穿street风格",
    gender: "male",
    style: "street",
    height: 170,
    weight: 65,
  }));

  assert.equal(profile.body_facts.leg_length_relation.value, "unknown");
  assert.equal(profile.garment_preferences.bottom.leg_shape.value,
    "relaxed_or_wide_with_controlled_drape");
  assert.equal(profile.garment_preferences.bottom.length.value,
    "clean_break_or_full_length_without_dragging");
  assert.equal(values(profile.fit_avoid).some((value) =>
    /wide|relaxed|oversized/u.test(value)), false);
});

test("Case E: structured shoulder fact remains authoritative over low-confidence image", () => {
  const context = contextFor({
    raw: "我想穿clean_fit",
    gender: "male",
    style: "clean_fit",
    height: 178,
    structured: {shoulder_relation: "normal"},
    imageAnalysis: {
      confidence: 0.55,
      body_facts: {
        shoulder_relation: {value: "wide", source: "image", confidence: 0.55},
      },
    },
  });
  const profile = buildBodyFitProfile(context);

  assert.equal(profile.body_facts.shoulder_relation.value, "balanced");
  assert.equal(profile.body_facts.shoulder_relation.source, "profile");
  assert.ok(profile.trace.rejected_conflicts.some(({path, rejected_source: source}) =>
    path === "body.body_facts.shoulder_relation" && source === "image"));
});

test("canonical body fact authority wins even when sources use different aliases", () => {
  const context = contextFor({
    raw: "我想穿clean_fit",
    gender: "male",
    style: "clean_fit",
    structured: {shoulder: "normal"},
    imageAnalysis: {
      confidence: 0.9,
      body_facts: {
        shoulder_relation: {value: "wide", source: "image", confidence: 0.9},
      },
    },
  });
  const profile = buildBodyFitProfile(context);

  assert.deepEqual(profile.body_facts.shoulder_relation, {
    value: "balanced",
    source: "profile",
    confidence: 1,
  });
  assert.ok(profile.trace.rejected_conflicts.some((conflict) =>
    conflict.path === "body.body_facts.shoulder_relation" &&
    conflict.kept_source === "profile" &&
    conflict.rejected_source === "image"));
});

test("structured image facts remain authoritative over summary extraction in trace", () => {
  const profile = buildBodyFitProfile(contextFor({
    imageAnalysis: {
      confidence: 0.62,
      summary: "肩相对宽",
      body_facts: {
        shoulder_relation: {
          value: "narrow",
          source: "image",
          confidence: 0.7,
        },
      },
    },
  }));

  assert.equal(profile.trace.image_body_facts.shoulder_relation.value, "narrow");
});

test("negated and garment-strategy prose never becomes a body fact", () => {
  for (const [field, statement] of [
    ["shoulder_relation", "不是宽肩"],
    ["shoulder_relation", "肩不窄"],
    ["leg_length_relation", "腿身比并不偏短"],
    ["frame", "不是小骨架"],
    ["body_shape", "她不是梨形"],
    ["shoulder_relation", "非宽肩"],
    ["frame", "非小骨架"],
    ["body_shape", "非梨形"],
    ["shoulder_relation", "不要宽肩效果"],
    ["shoulder_relation", "肩宽不突出"],
    ["body_shape", "身材非梨形"],
    ["shoulder_relation", "肩部非宽肩"],
    ["frame", "骨架非小骨架"],
    ["body_shape", "身材不像梨形"],
    ["body_shape", "身材不太像梨形"],
    ["body_shape", "身材不完全是梨形"],
    ["body_shape", "not pear"],
  ]) {
    const profile = buildBodyFitProfile(contextFor({
      structured: {[field]: statement},
    }));
    assert.equal(profile.body_facts[field].value, "unknown", statement);
  }
  for (const summary of ["避免宽肩设计", "宽肩设计可改善视觉比例"]) {
    const profile = buildBodyFitProfile(contextFor({
      imageAnalysis: {confidence: 0.7, summary},
    }));
    assert.equal(profile.body_facts.shoulder_relation.value, "unknown", summary);
  }
});

test("field-scoped wording is not overwritten by generic balance prose", () => {
  const profile = buildBodyFitProfile(contextFor({
    structured: {shoulder_relation: "肩偏宽，但整体比例适中"},
  }));
  assert.equal(profile.body_facts.shoulder_relation.value, "wide");
});

test("explicit user avoid overrides conflicting soft body advice", () => {
  const profile = buildBodyFitProfile(contextFor({
    raw: "腿短但不要短款上衣，帮我搭clean_fit",
    style: "clean_fit",
    structured: {leg_length_relation: "short"},
  }));
  assert.equal(profile.garment_preferences.top.preferred_length.value,
    "non_cropped_user_compatible_length");
  assert.equal(profile.garment_preferences.top.preferred_length.source, "user");
  assert.ok(values(profile.fit_avoid).includes("cropped_or_short_top"));
  assert.ok(profile.trace.intent_adjustments.includes(
    "EXPLICIT_AVOID_SHORT_TOP_PRESERVED",
  ));
});

test("concise explicit fit constraints override common conflicting dimensions", () => {
  const noCrop = buildBodyFitProfile(contextFor({
    raw: "腿身比偏短，不要露腰",
    structured: {leg_length_relation: "short"},
  }));
  assert.equal(noCrop.garment_preferences.top.preferred_length.value,
    "non_cropped_user_compatible_length");

  const lowRise = buildBodyFitProfile(contextFor({
    raw: "腿身比偏短，必须低腰",
    structured: {leg_length_relation: "short"},
  }));
  assert.equal(lowRise.garment_preferences.bottom.rise.value,
    "low_rise_as_explicitly_requested");
  assert.equal(lowRise.garment_preferences.bottom.rise.source, "user");

  const noWide = buildBodyFitProfile(contextFor({
    raw: "我想穿street，但不要宽松裤",
    style: "street",
  }));
  assert.equal(noWide.garment_preferences.bottom.leg_shape.value,
    "non_wide_user_compatible_leg_shape");
  assert.equal(noWide.garment_preferences.bottom.leg_shape.source, "user");

  const noWaistEmphasis = buildBodyFitProfile(contextFor({
    raw: "腿身比偏短，不要强调腰线",
    structured: {leg_length_relation: "short"},
  }));
  assert.equal(noWaistEmphasis.proportion_goals.waistline_goal.value,
    "do_not_emphasize_waistline_as_requested");
  assert.equal(noWaistEmphasis.proportion_goals.waistline_goal.source, "user");
  assert.equal(values(noWaistEmphasis.fit_prefer).includes(
    "visible_or_supported_waistline",
  ), false);
  assert.ok(values(noWaistEmphasis.fit_avoid).includes(
    "explicit_waistline_emphasis",
  ));
  assert.equal(noWaistEmphasis.source_map.fit_avoid.source, "user");
});

test("derived advice never amplifies low-confidence body evidence", () => {
  const profile = buildBodyFitProfile(contextFor({
    imageAnalysis: {
      confidence: 0.1,
      body_facts: {
        leg_length_relation: {value: "short", confidence: 0.1},
      },
    },
  }));
  assert.equal(profile.body_facts.leg_length_relation.confidence, 0.1);
  assert.ok(profile.proportion_goals.waistline_goal.confidence <= 0.1);

  const zeroConfidence = buildBodyFitProfile(contextFor({
    imageAnalysis: {
      confidence: 0,
      body_facts: {leg_length_relation: {value: "short", confidence: 0}},
    },
  }));
  assert.deepEqual(zeroConfidence.body_facts.leg_length_relation, {
    value: "unknown",
    source: "system",
    confidence: 0,
  });
  assert.ok(zeroConfidence.uncertainty.some(({field}) =>
    field === "leg_length_relation"));
});

test("free-text image conflicts are recorded against structured authority", () => {
  const profile = buildBodyFitProfile(contextFor({
    structured: {shoulder: "normal"},
    imageAnalysis: {confidence: 0.6, summary: "肩相对宽"},
  }));
  assert.equal(profile.body_facts.shoulder_relation.value, "balanced");
  assert.ok(profile.trace.rejected_conflicts.some((conflict) =>
    conflict.path === "body.body_facts.shoulder_relation" &&
    conflict.kept_source === "profile" &&
    conflict.rejected_source === "image"));
});

test("Case F: insufficient image evidence remains unknown without fabricated facts", () => {
  const profile = buildBodyFitProfile(contextFor({
    raw: "帮我搭一套",
    gender: "female",
    imageAnalysis: {
      confidence: 0.4,
      summary: "照片信息不足，建议选择高腰并通过版型拉长腿线",
    },
  }));

  for (const field of [
    "shoulder_relation", "torso_length", "leg_length_relation",
    "waist_position", "hip_relation", "frame", "body_shape",
  ]) {
    assert.deepEqual(profile.body_facts[field], {
      value: "unknown",
      source: "system",
      confidence: 0,
    });
    assert.ok(profile.uncertainty.some(({field: unknownField}) =>
      unknownField === field));
  }
  assert.deepEqual(profile.trace.image_body_facts, {});
  assert.equal(JSON.stringify(profile).includes("waist_cm"), false);
});

test("Case G: stable body facts support different clean-fit and street strategies", () => {
  const shared = {
    gender: "male",
    height: 176,
    weight: 67,
    structured: {
      shoulder_relation: "normal",
      leg_length_relation: "short",
    },
  };
  const clean = buildBodyFitProfile(contextFor({
    ...shared,
    raw: "clean_fit穿搭",
    style: "clean_fit",
  }));
  const street = buildBodyFitProfile(contextFor({
    ...shared,
    raw: "street穿搭",
    style: "street",
  }));

  assert.deepEqual(clean.body_facts, street.body_facts);
  assert.notDeepEqual(clean.garment_preferences, street.garment_preferences);
  assert.equal(clean.garment_preferences.bottom.leg_shape.value,
    "clean_straight_or_gently_tapered");
  assert.equal(street.garment_preferences.bottom.leg_shape.value,
    "relaxed_or_wide_with_controlled_drape");
});

test("reliable relational photo text is structured conservatively", () => {
  const profile = buildBodyFitProfile(contextFor({
    raw: "帮我搭一套",
    gender: "female",
    imageAnalysis: {
      confidence: 0.62,
      summary: "肩相对宽，腿身比偏短，小骨架",
    },
  }));

  assert.deepEqual(profile.body_facts.shoulder_relation, {
    value: "wide",
    source: "image",
    confidence: 0.62,
  });
  assert.equal(profile.body_facts.leg_length_relation.value, "short");
  assert.equal(profile.body_facts.frame.value, "small");
  assert.equal(profile.trace.image_body_facts.shoulder_relation.value, "wide");
});

test("factual visual-proportion language remains extractable", () => {
  const profile = buildBodyFitProfile(contextFor({
    imageAnalysis: {
      confidence: 0.64,
      summary: "肩部视觉比例偏宽，上半身视觉相对长，腿部视觉比例偏短",
    },
  }));

  assert.equal(profile.body_facts.shoulder_relation.value, "wide");
  assert.equal(profile.body_facts.torso_length.value, "long");
  assert.equal(profile.body_facts.leg_length_relation.value, "short");
});

test("ordinary photos cannot assert precise centimeter measurements", () => {
  const profile = buildBodyFitProfile(contextFor({
    imageAnalysis: {
      confidence: 0.95,
      body_facts: {
        shoulder_width: {value: "38cm", confidence: 0.95},
        waist: {value: "62厘米", confidence: 0.95},
        hip: {value: "90cm", confidence: 0.95},
      },
    },
  }));

  assert.equal(profile.body_facts.shoulder_relation.value, "unknown");
  assert.equal(profile.body_facts.hip_relation.value, "unknown");
  assert.deepEqual(profile.trace.image_body_facts, {});
  assert.equal(JSON.stringify(profile.trace).includes("38cm"), false);
  assert.equal(JSON.stringify(profile.trace).includes("62"), false);
  assert.equal(JSON.stringify(profile.trace).includes("90cm"), false);
  assert.equal(profile.trace.rejected_conflicts.filter(({reason}) =>
    reason === "UNRELIABLE_PRECISE_IMAGE_MEASUREMENT").length, 3);
});

test("ordinary photo measurement aliases and Chinese units stay redacted", () => {
  const profile = buildBodyFitProfile(contextFor({
    imageAnalysis: {
      confidence: 0.96,
      body_facts: {
        waist_cm: 62,
        hip_mm: 900,
        shoulderWidth: 38,
        waist: "62公分",
      },
    },
  }));

  assert.deepEqual(profile.trace.image_body_facts, {});
  const rejections = profile.trace.rejected_conflicts.filter(({reason}) =>
    reason === "UNRELIABLE_PRECISE_IMAGE_MEASUREMENT");
  assert.equal(rejections.length, 4);
  assert.equal(rejections.every(({rejected}) =>
    rejected === "[REDACTED_PRECISE_MEASUREMENT]"), true);
  assert.equal(JSON.stringify(profile.trace).includes("62公分"), false);
  assert.equal(JSON.stringify(profile.trace).includes('"rejected":62'), false);
  assert.equal(JSON.stringify(profile.trace).includes('"rejected":900'), false);
  assert.equal(JSON.stringify(profile.trace).includes('"rejected":38'), false);
});

test("approximate numeric image measurements are still precise-data claims", () => {
  const profile = buildBodyFitProfile(contextFor({
    imageAnalysis: {
      confidence: 0.93,
      body_facts: {
        waist_cm: "约62",
        hip_mm: "900左右",
        waist: "62±2",
      },
    },
  }));

  assert.deepEqual(profile.trace.image_body_facts, {});
  const rejections = profile.trace.rejected_conflicts.filter(({reason}) =>
    reason === "UNRELIABLE_PRECISE_IMAGE_MEASUREMENT");
  assert.equal(rejections.length, 3);
  assert.equal(rejections.every(({rejected}) =>
    rejected === "[REDACTED_PRECISE_MEASUREMENT]"), true);
  const serialized = JSON.stringify(profile.trace);
  assert.equal(serialized.includes("约62"), false);
  assert.equal(serialized.includes("900左右"), false);
  assert.equal(serialized.includes("62±2"), false);
});

test("Body Fit output is immutable and contains no body-value judgments", () => {
  const profile = buildBodyFitProfile(contextFor({
    raw: "clean_fit穿搭",
    gender: "male",
    style: "clean_fit",
    height: 178,
    structured: {shoulder_relation: "wide"},
  }));
  const trace = createBodyFitTrace(profile);

  assert.equal(Object.isFrozen(profile), true);
  assert.equal(Object.isFrozen(profile.body_facts), true);
  assert.equal(Object.isFrozen(trace), true);
  assert.doesNotMatch(JSON.stringify(profile), /胖|丑|缺陷|身材不好/u);
  assert.throws(() => {
    profile.fit_prefer.push({value: "mutation"});
  }, TypeError);
});
