const assert = require("node:assert/strict");
const test = require("node:test");

const benchmarkCases = require(
  "../evaluation/styling_constitution_v1_cases.json"
);
const {
  ALLOWED_LOOK_VARIATION_AXES,
  STYLING_DECISION_PRIORITY,
  WEATHER_ALLOWED_INFLUENCE,
  WEATHER_PROHIBITED_INFLUENCE,
  assessLookAgainstStylingConstitution,
  buildStylingConstitution,
  evaluateStylingConstitutionBenchmark,
  evaluateStylingConstitutionCase,
} = require("../styling_constitution");

function explicitCuteConstitution() {
  return buildStylingConstitution({
    userInput: "想要可爱一点的穿搭",
    semanticIntent: {
      style_direction: "可爱",
      must_express: ["可爱", "轻盈"],
      must_avoid: ["成熟商务"],
      style_selection_mode: "explicit",
      selected_aesthetic_direction: "可爱",
      selection_reason: "执行用户明确可爱风格",
    },
    styleProfile: {
      primary_style: "可爱",
      blend_rationale: "用户明确指定",
    },
  });
}

test("Styling Constitution fixes decision priority and context boundaries", () => {
  const constitution = explicitCuteConstitution();
  assert.deepEqual(constitution.decision_priority, STYLING_DECISION_PRIORITY);
  assert.deepEqual(
    constitution.look_diversity_policy.allowed_axes,
    ALLOWED_LOOK_VARIATION_AXES,
  );
  assert.equal(
    constitution.look_diversity_policy.cross_aesthetic_drift_allowed,
    false,
  );
  assert.deepEqual(
    constitution.weather_scope.allowed_influence,
    WEATHER_ALLOWED_INFLUENCE,
  );
  assert.deepEqual(
    constitution.weather_scope.prohibited_influence,
    WEATHER_PROHIBITED_INFLUENCE,
  );
  assert.equal(constitution.weather_scope.may_select_core_style, false);
});

test("explicit style remains the selected aesthetic direction", () => {
  const constitution = explicitCuteConstitution();
  assert.equal(constitution.style_selection_mode, "explicit");
  assert.equal(constitution.selected_aesthetic_direction, "可爱");
  assert.ok(constitution.explicit_user_style_evidence.includes("可爱"));
});

test("style-free requests require a deliberate stylist-selected aesthetic", () => {
  const constitution = buildStylingConstitution({
    userInput: "我想出去玩，帮我搭一套",
    semanticIntent: {
      style_direction: "清爽女性休闲",
      must_express: ["女性人物表达", "轻松精致"],
      must_avoid: ["训练感"],
      style_selection_mode: "stylist_selected",
      selected_aesthetic_direction: "清爽女性休闲",
      selection_reason: "结合女性人物表达与日常出游场景",
    },
    styleProfile: {
      primary_style: "清爽女性休闲",
      blend_rationale: "适合日常出游",
    },
  });
  assert.equal(constitution.style_selection_mode, "stylist_selected");
  assert.equal(
    constitution.selected_aesthetic_direction,
    "清爽女性休闲",
  );
  assert.match(constitution.selection_reason, /女性|出游/u);
  assert.equal(constitution.selection_basis.includes("weather"), false);
});

test("three Looks may vary while sharing one aesthetic parent", () => {
  const constitution = explicitCuteConstitution();
  for (const direction of ["学院可爱", "法式可爱", "轻熟可爱"]) {
    const assessment = assessLookAgainstStylingConstitution({
      style_direction: direction,
      look_direction: {name: direction},
    }, constitution, {
      styleAnchorAssessment: {status: "MATCH", allowed: true},
    });
    assert.equal(assessment.allowed, true);
    assert.equal(assessment.status, "MATCH");
  }
});

test("only a typed Style Anchor drift can constitutionally drop a Look", () => {
  const constitution = explicitCuteConstitution();
  const neutral = assessLookAgainstStylingConstitution({
    look_direction: {name: "轻盈短外套组合"},
  }, constitution, {
    styleAnchorAssessment: {status: "NEUTRAL", allowed: true},
  });
  const drift = assessLookAgainstStylingConstitution({
    look_direction: {name: "成熟商务"},
  }, constitution, {
    styleAnchorAssessment: {status: "DRIFT", allowed: false},
  });
  assert.equal(neutral.status, "NEUTRAL");
  assert.equal(neutral.allowed, true);
  assert.equal(drift.status, "DRIFT");
  assert.equal(drift.allowed, false);
});

test("Styling Constitution V1 benchmark has at least 20 fixed cases", () => {
  assert.ok(benchmarkCases.length >= 20);
  const ids = new Set(benchmarkCases.map((entry) => entry.id));
  assert.equal(ids.size, benchmarkCases.length);
});

test("Styling Constitution V1 benchmark clears the first-stage target", () => {
  const report = evaluateStylingConstitutionBenchmark(benchmarkCases);
  assert.equal(report.case_count, benchmarkCases.length);
  assert.equal(report.hard_fail_count, 0);
  assert.ok(report.average_score >= 85);
  assert.ok(report.results.every((result) => result.scores.total >= 85));
});

test("benchmark evaluator detects the five constitutional hard failures", () => {
  const base = structuredClone(benchmarkCases[1]);

  const explicitOverride = structuredClone(base);
  explicitOverride.semantic_intent.selected_aesthetic_direction = "成熟商务";
  assert.ok(evaluateStylingConstitutionCase(explicitOverride).hard_fails
    .includes("EXPLICIT_USER_STYLE_OVERRIDDEN"));

  const weatherOverride = structuredClone(base);
  weatherOverride.weather_selects_core_style = true;
  assert.ok(evaluateStylingConstitutionCase(weatherOverride).hard_fails
    .includes("WEATHER_OVERRIDES_CORE_AESTHETIC"));

  const personaMismatch = structuredClone(base);
  personaMismatch.looks[0].gender = "male";
  assert.ok(evaluateStylingConstitutionCase(personaMismatch).hard_fails
    .some((value) => value.startsWith("PERSONA_MISMATCH:")));

  const crossDrift = structuredClone(base);
  crossDrift.looks[1].aesthetic_parent = "成熟商务";
  assert.ok(evaluateStylingConstitutionCase(crossDrift).hard_fails
    .some((value) => value.startsWith("CROSS_AESTHETIC_DRIFT:")));

  const unwearable = structuredClone(base);
  unwearable.looks[2].core_structure = "top_only";
  assert.ok(evaluateStylingConstitutionCase(unwearable).hard_fails
    .some((value) => value.startsWith("CORE_STRUCTURE_UNWEARABLE:")));
});
