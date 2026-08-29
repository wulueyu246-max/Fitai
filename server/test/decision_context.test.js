"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  LEGACY_BLUEPRINT_DECISION_ROLE,
  MARKET_STATUS_NOT_CONNECTED,
  appendDecisionContextLineage,
  assertDecisionContextLineage,
  createDecisionContext,
  createDecisionContextTrace,
  deserializeDecisionContext,
  enrichDecisionContext,
  isProductionRuntime,
  resolveAuthoritativeValue,
  serializeDecisionContext,
} = require("../decision_context");

function baseInput(overrides = {}) {
  return {
    requestId: "decision-context-test-1",
    rawUserInput: "今晚去喝酒，我不想太正式",
    timestamp: "2026-08-27T08:00:00.000Z",
    userTruth: {
      gender: "female",
      scene: "date",
      budget: {outfit_max: 1500},
      explicitRequirements: ["适合约会"],
      explicitAvoid: ["过度正式"],
      explicitPreferences: ["轻松"],
    },
    body: {
      height: {value: 160, source: "profile", confidence: 1},
      weight: {value: 50, source: "profile", confidence: 1},
    },
    recommendationContext: {provider: "mock"},
    ...overrides,
  };
}

test("creates a unique deeply immutable DecisionContext with the complete foundation schema", () => {
  const first = createDecisionContext(baseInput());
  const second = createDecisionContext(baseInput({requestId: "decision-context-test-2"}));

  assert.notEqual(first.decision_context_id, second.decision_context_id);
  assert.equal(first.raw_user_input, "今晚去喝酒，我不想太正式");
  assert.equal(first.market.status, MARKET_STATUS_NOT_CONNECTED);
  assert.deepEqual(first.concepts, []);
  assert.deepEqual(first.style_targets, []);
  assert.equal(first.recommendation_context.locale, "zh-CN");
  assert.equal(first.recommendation_context.currency, "CNY");
  assert.equal(first.context_source_map.raw_user_input.source, "user");
  assert.equal(first.context_source_map["body.image_analysis"].source, "system");
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.user_truth), true);
  assert.equal(Object.isFrozen(first.body.body_facts), true);
  assert.equal(Object.isFrozen(first.context_source_map), true);

  const originalScene = first.user_truth.scene;
  assert.throws(() => {
    first.user_truth.scene = "commute";
  }, TypeError);
  assert.equal(first.user_truth.scene, originalScene);
});

test("Render and production runtimes never qualify for raw DecisionContext traces", () => {
  assert.equal(isProductionRuntime({NODE_ENV: "test"}), false);
  assert.equal(isProductionRuntime({NODE_ENV: "production"}), true);
  assert.equal(isProductionRuntime({RENDER: "true"}), true);
  assert.equal(
    isProductionRuntime({NODE_ENV: "staging", RENDER: "true"}),
    true,
  );
});

test("Case A: explicit user avoid survives a business-casual default that prefers leather shoes", () => {
  const context = createDecisionContext(baseInput({
    rawUserInput: "商务休闲，但我不穿皮鞋",
    userTruth: {
      gender: "female",
      scene: "commute",
      explicitStyle: "business_casual",
      explicitAvoid: ["不穿皮鞋"],
    },
    styleDefaults: {
      style: "business_casual",
      intent: {prefer: ["皮鞋", "西装裤"]},
    },
  }));

  assert.deepEqual(context.user_truth.explicit_avoid, ["不穿皮鞋"]);
  assert.ok(context.intent.avoid.includes("不穿皮鞋"));
  assert.equal(context.intent.prefer.includes("皮鞋"), false);
  assert.ok(context.context_conflicts.some((conflict) =>
    conflict.reason === "EXPLICIT_USER_AVOID_WINS" &&
    conflict.rejected === "皮鞋"));
  assert.ok(context.context_overrides.some((override) =>
    override.reason === "EXPLICIT_USER_AVOID_WINS" &&
    override.rejected === "皮鞋"));
});

test("Case B: explicit Cityboy remains authoritative over a future clean-fit market trend", () => {
  const context = createDecisionContext(baseInput({
    rawUserInput: "我想穿Cityboy",
    userTruth: {gender: "male", explicitStyle: "cityboy"},
    market: {
      status: "PLACEHOLDER",
      signals: [{style: "clean_fit", score: 0.9}],
      confidence: 0.9,
    },
  }));

  assert.equal(context.user_truth.explicit_style, "cityboy");
  assert.equal(
    context.context_source_map["user_truth.explicit_style"].source,
    "user",
  );
  assert.ok(context.context_conflicts.some((conflict) =>
    conflict.path === "user_truth.explicit_style" &&
    conflict.rejected === "clean_fit" &&
    conflict.rejected_source === "market"));
});

test("Case C: structured shoulder fact beats low-confidence image inference", () => {
  const context = createDecisionContext(baseInput({
    body: {
      height: {value: 160, source: "profile", confidence: 1},
      structuredMeasurements: {
        shoulder: {value: "normal", source: "profile", confidence: 1},
      },
      imageAnalysis: {
        body_facts: {
          shoulder: {value: "possibly_broad", source: "image", confidence: 0.55},
        },
      },
    },
  }));

  assert.deepEqual(context.body.body_facts.shoulder, {
    value: "normal",
    source: "profile",
    confidence: 1,
  });
  assert.equal(context.body.structured_measurements.shoulder, "normal");
  assert.equal(
    context.context_source_map["body.image_analysis"].source,
    "image",
  );
  assert.ok(context.context_conflicts.some((conflict) =>
    conflict.path === "body.body_facts.shoulder" &&
    conflict.rejected === "possibly_broad" &&
    conflict.rejected_source === "image"));
});

test("image-only body facts never become structured profile measurements", () => {
  const context = createDecisionContext(baseInput({
    body: {
      imageAnalysis: {
        confidence: 0.8,
        body_facts: {shoulder: "broad"},
      },
    },
  }));

  assert.equal(context.body.body_facts.shoulder.value, "broad");
  assert.equal(context.body.body_facts.shoulder.source, "image");
  assert.equal(
    Object.hasOwn(context.body.structured_measurements, "shoulder"),
    false,
  );
});

test("raw input and explicit truth remain separate from AI interpretation and legacy Blueprint", () => {
  const context = createDecisionContext(baseInput({
    rawUserInput: "想要Cityboy，但不要皮鞋",
    userTruth: {
      gender: "male",
      explicitStyle: "cityboy",
      explicitAvoid: ["皮鞋"],
    },
    aiInference: {
      intent: {
        interpretedGoal: "轻松都市通勤",
        latentPreferences: ["层次感"],
      },
    },
    legacyBlueprint: {
      style_identity: "clean_fit",
      must_have_items: {shoes: ["皮鞋"]},
    },
    styleTargets: [{profile: "clean_fit", source: "ai_inference"}],
  }));
  const trace = createDecisionContextTrace(context);

  assert.equal(context.raw_user_input, "想要Cityboy，但不要皮鞋");
  assert.equal(context.user_truth.explicit_style, "cityboy");
  assert.equal(context.intent.interpreted_goal, "轻松都市通勤");
  assert.equal(
    context.legacy_blueprint.decision_role,
    LEGACY_BLUEPRINT_DECISION_ROLE,
  );
  assert.equal(trace.explicit_user_truth.explicit_style, "cityboy");
  assert.equal(trace.ai_inference.intent.interpretedGoal, "轻松都市通勤");
  assert.equal(
    trace.legacy_blueprint.decision_role,
    LEGACY_BLUEPRINT_DECISION_ROLE,
  );
});

test("AI inference is traceable but cannot be promoted into explicit user truth", () => {
  const context = createDecisionContext(baseInput({
    userTruth: {},
    profile: {},
    history: {},
    aiInference: {
      gender: "female",
      scene: "date",
      budget: {outfit_max: 5000},
      intent: {interpretedGoal: "AI-only interpretation"},
    },
  }));

  assert.equal(context.user_truth.gender, "unisex");
  assert.equal(context.user_truth.scene, "");
  assert.deepEqual(context.user_truth.budget, {});
  assert.equal(context.intent.interpreted_goal, "AI-only interpretation");
  assert.equal(context.ai_inference.gender, "female");
  assert.ok(context.context_conflicts.some((conflict) =>
    conflict.path === "user_truth.gender" &&
    conflict.reason === "SOURCE_NOT_ALLOWED_IN_USER_TRUTH"));
});

test("serialization and lineage preserve the same context id across stages", () => {
  const outfit = createDecisionContext(baseInput());
  const restored = deserializeDecisionContext(serializeDecisionContext(outfit));
  const products = appendDecisionContextLineage(restored, {
    requestId: "products-request-1",
    stage: "products_recommend",
    timestamp: "2026-08-27T08:01:00.000Z",
  });

  assert.equal(products.decision_context_id, outfit.decision_context_id);
  assert.equal(products.raw_user_input, outfit.raw_user_input);
  assert.deepEqual(products.user_truth, outfit.user_truth);
  assert.equal(assertDecisionContextLineage(outfit, products), true);
  assert.deepEqual(products.lineage.request_ids, [
    "decision-context-test-1",
    "products-request-1",
  ]);
  assert.equal(Object.isFrozen(products.lineage.stages), true);
});

test("lineage rejects a separately-created target context", () => {
  const first = createDecisionContext(baseInput());
  const unrelated = createDecisionContext(baseInput({
    requestId: "unrelated-request",
  }));

  assert.throws(
    () => assertDecisionContextLineage(first, unrelated),
    (error) => error.code === "DECISION_CONTEXT_LINEAGE_MISMATCH",
  );
});

test("nested body evidence preserves its original profile source", () => {
  const resolved = resolveAuthoritativeValue({
    path: "body.height",
    candidates: [{
      value: {value: 160, source: "profile", confidence: 0.9},
    }],
  });

  assert.equal(resolved.value, 160);
  assert.equal(resolved.source, "profile");
  assert.equal(resolved.confidence, 0.9);
});

test("incremental enrichment preserves profile provenance and existing conflicts", () => {
  const context = createDecisionContext(baseInput({
    userTruth: {},
    profile: {gender: "female", scene: "date"},
    aiInference: {gender: "male"},
  }));
  const previousConflicts = structuredClone(context.context_conflicts);

  assert.equal(enrichDecisionContext(context), context);
  const enriched = enrichDecisionContext(context, {
    aiInference: {
      gender: "male",
      intent: {interpretedGoal: "更利落的比例"},
    },
    aiSource: "ai_inference",
  });

  assert.equal(enriched.user_truth.gender, "female");
  assert.equal(
    enriched.context_source_map["user_truth.gender"].source,
    "profile",
  );
  assert.ok(previousConflicts.every((record) =>
    enriched.context_conflicts.some((candidate) =>
      JSON.stringify(candidate) === JSON.stringify(record))));
  assert.equal(enriched.context_conflicts.some((record) =>
    record.path === "user_truth.gender" && record.kept_source === "user"), false);
  assert.equal(Object.isFrozen(enriched.ai_inference), true);
});

test("mock/system enrichment is field-sourced and does not invent image evidence", () => {
  const context = createDecisionContext(baseInput());
  const enriched = enrichDecisionContext(context, {
    aiInference: {
      intent: {interpretedGoal: "本地确定性解释", prefer: ["轻盈"]},
      style_profile: {profile_id: "sweet"},
    },
    aiSource: "system",
    legacyBlueprint: {style_identity: "sweet"},
    legacyBlueprintSource: "system",
    styleTargets: [{style: "sweet"}],
    styleTargetSource: "system",
  });

  assert.equal(
    enriched.context_source_map["intent.interpreted_goal"].source,
    "system",
  );
  assert.equal(
    enriched.context_source_map["ai_inference.style_profile"].source,
    "system",
  );
  assert.equal(enriched.context_source_map.legacy_blueprint.source, "system");
  assert.equal(enriched.context_source_map.style_targets.source, "system");
  assert.equal(enriched.context_source_map["body.image_analysis"].source, "system");
  assert.deepEqual(enriched.body.image_analysis, {});
});

test("image enrichment resolves facts without overriding higher-authority structured facts", () => {
  const context = createDecisionContext(baseInput({
    body: {
      structuredMeasurements: {
        shoulder: {value: "normal", source: "profile", confidence: 1},
      },
    },
  }));
  const enriched = enrichDecisionContext(context, {
    bodyImageAnalysis: {
      summary: "可能肩宽",
      body_facts: {
        shoulder: {value: "possibly_broad", source: "image", confidence: 0.55},
      },
    },
    bodyImageConfidence: 0.55,
  });

  assert.equal(enriched.body.body_facts.shoulder.value, "normal");
  assert.equal(enriched.body.body_facts.shoulder.source, "profile");
  assert.equal(enriched.context_source_map["body.image_analysis"].source, "image");
  assert.ok(enriched.context_conflicts.some((record) =>
    record.path === "body.body_facts.shoulder" &&
    record.rejected_source === "image"));
});
