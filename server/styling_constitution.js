const STYLING_CONSTITUTION_VERSION = "styling_constitution_v1";

const STYLING_DECISION_PRIORITY = Object.freeze([
  "explicit_user_intent",
  "persona_gender_body",
  "aesthetic_direction",
  "body_proportion_strategy",
  "occasion",
  "weather_comfort",
]);

const ALLOWED_LOOK_VARIATION_AXES = Object.freeze([
  "silhouette",
  "color",
  "item_combination",
  "substyle",
]);

const WEATHER_ALLOWED_INFLUENCE = Object.freeze([
  "material",
  "thickness",
  "sleeve_length",
  "breathability",
  "layering",
  "safety",
]);

const WEATHER_PROHIBITED_INFLUENCE = Object.freeze([
  "core_style",
  "persona",
  "overall_aesthetic_identity",
]);

const REQUEST_GRAMMAR_TERMS = Object.freeze([
  "请", "麻烦", "帮我", "给我", "替我", "想要", "希望", "推荐", "生成",
  "设计", "搭配", "穿搭", "造型", "一套", "一个", "一些", "一点", "点的",
  "出去玩", "出门", "约会", "通勤", "正式场合", "参加活动", "今天", "现在",
  "显高", "显瘦", "显腿长", "改善比例", "比例优化", "身材优化", "高温",
  "低温", "天气", "雨天", "下雨", "炎热", "冷", "热", "保暖", "透气",
  "舒适",
]);

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function list(value) {
  const source = Array.isArray(value) ? value : value == null ? [] : [value];
  return [...new Set(source.map(text).filter(Boolean))];
}

function normalize(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/gu, "");
}

function semanticTokens(value) {
  const source = text(value).toLowerCase();
  if (!source) return [];
  const values = new Set();
  const add = (candidate) => {
    const normalized = normalize(candidate);
    if (normalized.length >= 2) values.add(normalized);
  };
  add(source);
  try {
    const segmenter = new Intl.Segmenter("zh-CN", {granularity: "word"});
    for (const segment of segmenter.segment(source)) {
      if (segment.isWordLike) add(segment.segment);
    }
  } catch {
    source.split(/[\s,，、/+|]+/u).forEach(add);
  }
  return [...values];
}

function withoutRequestGrammar(value) {
  let result = normalize(value);
  for (const term of [...REQUEST_GRAMMAR_TERMS]
    .sort((left, right) => right.length - left.length)) {
    result = result.split(normalize(term)).join("");
  }
  return result;
}

function styleCandidates(semanticIntent = {}, styleProfile = {}) {
  return list([
    semanticIntent.selected_aesthetic_direction,
    semanticIntent.selectedAestheticDirection,
    semanticIntent.style_direction,
    semanticIntent.styleDirection,
    semanticIntent.must_express,
    semanticIntent.mustExpress,
    styleProfile.primary_style,
    styleProfile.primaryStyle,
    styleProfile.secondary_styles,
    styleProfile.secondaryStyles,
  ].flat());
}

function explicitStyleEvidence(userInput, semanticIntent = {}, styleProfile = {}) {
  const normalizedInput = normalize(userInput);
  if (!normalizedInput) return [];
  const grammar = new Set(REQUEST_GRAMMAR_TERMS.map(normalize));
  const matches = [];
  for (const candidate of styleCandidates(semanticIntent, styleProfile)) {
    const normalizedCandidate = normalize(candidate);
    if (normalizedCandidate.length >= 2 &&
        normalizedInput.includes(normalizedCandidate) &&
        !grammar.has(normalizedCandidate)) {
      matches.push(candidate);
      continue;
    }
    const matchedToken = semanticTokens(candidate).find((token) =>
      !grammar.has(token) && withoutRequestGrammar(token).length >= 2 &&
      normalizedInput.includes(token));
    if (matchedToken) matches.push(matchedToken);
  }
  const residual = withoutRequestGrammar(userInput)
    .replace(/\d+(?:\.\d+)?(?:cm|kg)?/giu, "");
  if (matches.length === 0 && residual.length >= 2 &&
      /(?:风|风格|穿搭|造型|一点|点的)/u.test(text(userInput))) {
    matches.push(residual);
  }
  return [...new Set(matches)];
}

function normalizeStyleSelectionMode(value) {
  return text(value) === "explicit" ? "explicit" : "stylist_selected";
}

function normalizeStylingConstitution(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  const mode = normalizeStyleSelectionMode(
    source.style_selection_mode || source.styleSelectionMode,
  );
  const selectedDirection = text(
    source.selected_aesthetic_direction || source.selectedAestheticDirection,
  );
  return Object.freeze({
    version: STYLING_CONSTITUTION_VERSION,
    decision_priority: STYLING_DECISION_PRIORITY,
    style_selection_mode: mode,
    explicit_user_style_evidence: Object.freeze(list(
      source.explicit_user_style_evidence || source.explicitUserStyleEvidence,
    )),
    selected_aesthetic_direction: selectedDirection,
    selection_reason: text(source.selection_reason || source.selectionReason),
    selection_basis: Object.freeze(list(source.selection_basis || [
      "persona",
      "body",
      "occasion",
      "current_styling_context",
    ])),
    shared_look_aesthetic: selectedDirection,
    look_diversity_policy: Object.freeze({
      allowed_axes: ALLOWED_LOOK_VARIATION_AXES,
      cross_aesthetic_drift_allowed: false,
    }),
    weather_scope: Object.freeze({
      role: "auxiliary",
      allowed_influence: WEATHER_ALLOWED_INFLUENCE,
      prohibited_influence: WEATHER_PROHIBITED_INFLUENCE,
      may_select_core_style: false,
    }),
  });
}

function buildStylingConstitution({
  userInput = "",
  semanticIntent = {},
  styleProfile = {},
} = {}) {
  const explicitEvidence = explicitStyleEvidence(
    userInput,
    semanticIntent,
    styleProfile,
  );
  const declaredMode = text(
    semanticIntent.style_selection_mode || semanticIntent.styleSelectionMode,
  );
  const mode = declaredMode === "explicit" && explicitEvidence.length > 0
    ? "explicit"
    : explicitEvidence.length > 0 ? "explicit" : "stylist_selected";
  const selectedDirection = text(
    semanticIntent.selected_aesthetic_direction ||
    semanticIntent.selectedAestheticDirection ||
    semanticIntent.style_direction || semanticIntent.styleDirection ||
    styleProfile.primary_style || styleProfile.primaryStyle,
  );
  if (!selectedDirection) {
    throw new Error("Styling Constitution 缺少 selected_aesthetic_direction");
  }
  const selectionReason = text(
    semanticIntent.selection_reason || semanticIntent.selectionReason ||
    styleProfile.blend_rationale || styleProfile.blendRationale ||
    styleProfile.interpretation,
  );
  if (mode === "stylist_selected" && !selectionReason) {
    throw new Error("Styling Constitution 的主动审美选择缺少 selection_reason");
  }
  return normalizeStylingConstitution({
    style_selection_mode: mode,
    explicit_user_style_evidence: explicitEvidence,
    selected_aesthetic_direction: selectedDirection,
    selection_reason: selectionReason,
  });
}

function sameSemanticDirection(left, right) {
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft.includes(normalizedRight) ||
      normalizedRight.includes(normalizedLeft)) return true;
  const leftTokens = semanticTokens(left);
  const rightTokens = semanticTokens(right);
  return leftTokens.some((token) => rightTokens.includes(token));
}

function assessLookAgainstStylingConstitution(
  look = {},
  constitution = {},
  {styleAnchorAssessment = {status: "NEUTRAL", allowed: true}} = {},
) {
  const normalized = normalizeStylingConstitution(constitution);
  const direction = look.look_direction || look.lookDirection || {};
  const evidence = list([
    look.style,
    look.style_direction,
    look.styleDirection,
    typeof direction === "string" ? direction : direction.name,
    look.styling_goal,
    look.stylingGoal,
  ]).join(" ");
  const anchorState = text(styleAnchorAssessment.status) || "NEUTRAL";
  const status = anchorState === "DRIFT"
    ? "DRIFT"
    : sameSemanticDirection(
      evidence,
      normalized.selected_aesthetic_direction,
    ) || anchorState === "MATCH" ? "MATCH" : "NEUTRAL";
  return Object.freeze({
    allowed: status !== "DRIFT",
    status,
    selected_aesthetic_direction: normalized.selected_aesthetic_direction,
    shared_aesthetic_preserved: status !== "DRIFT",
    reason: status === "DRIFT"
      ? "STYLE_CONSTITUTION_AESTHETIC_DRIFT"
      : status === "MATCH"
        ? "STYLE_CONSTITUTION_MATCH"
        : "STYLE_CONSTITUTION_NEUTRAL",
  });
}

function isValidCoreStructure(value) {
  return [
    "top_bottom_shoes",
    "dress_shoes",
    "outerwear_bottom_shoes",
  ].includes(text(value));
}

function evaluateStylingConstitutionCase(testCase = {}) {
  const input = testCase.input || {};
  const constitution = buildStylingConstitution({
    userInput: input.user_input,
    semanticIntent: testCase.semantic_intent,
    styleProfile: testCase.style_profile,
  });
  const hardFails = [];
  const looks = Array.isArray(testCase.looks) ? testCase.looks : [];
  const blueprint = testCase.blueprint || {};
  const expectedGender = text(input.gender);
  const explicitDirection = text(testCase.expected_explicit_direction);
  if (constitution.style_selection_mode === "explicit" && explicitDirection &&
      !sameSemanticDirection(
        constitution.selected_aesthetic_direction,
        explicitDirection,
      )) {
    hardFails.push("EXPLICIT_USER_STYLE_OVERRIDDEN");
  }
  if (testCase.weather_selects_core_style === true) {
    hardFails.push("WEATHER_OVERRIDES_CORE_AESTHETIC");
  }
  for (const look of looks) {
    if (["female", "male"].includes(expectedGender) &&
        text(look.gender) !== expectedGender) {
      hardFails.push(`PERSONA_MISMATCH:${text(look.look_id)}`);
    }
    if (!isValidCoreStructure(look.core_structure)) {
      hardFails.push(`CORE_STRUCTURE_UNWEARABLE:${text(look.look_id)}`);
    }
    if (!sameSemanticDirection(
      look.aesthetic_parent,
      constitution.selected_aesthetic_direction,
    )) {
      hardFails.push(`CROSS_AESTHETIC_DRIFT:${text(look.look_id)}`);
    }
  }

  const intentAlignment = constitution.selected_aesthetic_direction &&
      (constitution.style_selection_mode !== "explicit" || explicitDirection)
    ? 20 : 10;
  const aestheticCoherence = looks.length === 3 &&
      looks.every((look) => sameSemanticDirection(
        look.aesthetic_parent,
        constitution.selected_aesthetic_direction,
      )) ? 20 : 10;
  const personaFit = looks.length > 0 && looks.every((look) =>
    expectedGender === "unisex" || text(look.gender) === expectedGender)
    ? 20 : 10;
  const bodyProportion = list(
    blueprint.silhouette_strategy || blueprint.silhouetteStrategy,
  ).length > 0 && looks.every((look) => text(look.proportion_strategy))
    ? 20 : 10;
  const occasionWeatherFit = text(input.occasion) &&
      Array.isArray(testCase.weather_adjustments) &&
      testCase.weather_adjustments.every((field) =>
        WEATHER_ALLOWED_INFLUENCE.includes(field)) &&
      testCase.weather_selects_core_style !== true ? 20 : 10;
  const score = intentAlignment + aestheticCoherence + personaFit +
    bodyProportion + occasionWeatherFit;

  return Object.freeze({
    id: text(testCase.id),
    constitution,
    scores: Object.freeze({
      intent_alignment: intentAlignment,
      aesthetic_coherence: aestheticCoherence,
      persona_fit: personaFit,
      body_proportion: bodyProportion,
      occasion_weather_fit: occasionWeatherFit,
      total: score,
    }),
    hard_fails: Object.freeze([...new Set(hardFails)]),
  });
}

function evaluateStylingConstitutionBenchmark(cases = []) {
  const results = cases.map(evaluateStylingConstitutionCase);
  const hardFailCount = results.reduce(
    (sum, result) => sum + result.hard_fails.length,
    0,
  );
  const averageScore = results.length > 0
    ? results.reduce((sum, result) => sum + result.scores.total, 0) /
      results.length
    : 0;
  return Object.freeze({
    case_count: results.length,
    hard_fail_count: hardFailCount,
    average_score: Math.round(averageScore * 100) / 100,
    results: Object.freeze(results),
  });
}

module.exports = {
  ALLOWED_LOOK_VARIATION_AXES,
  STYLING_CONSTITUTION_VERSION,
  STYLING_DECISION_PRIORITY,
  WEATHER_ALLOWED_INFLUENCE,
  WEATHER_PROHIBITED_INFLUENCE,
  assessLookAgainstStylingConstitution,
  buildStylingConstitution,
  evaluateStylingConstitutionBenchmark,
  evaluateStylingConstitutionCase,
  normalizeStylingConstitution,
};
