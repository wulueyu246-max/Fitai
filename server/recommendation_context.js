const {normalizeGender} = require("./product_relevance");
const {
  normalizeStyleProfile,
  normalizeStyleSemantics,
  resolveExpressionFromStyleProfile,
} = require("./style_interpreter");

const STYLE_EXPRESSIONS = new Set(["feminine", "neutral", "masculine", "auto"]);

function resolveStyleExpression({explicit, styleProfile} = {}) {
  const normalizedExplicit = String(explicit || "").trim().toLowerCase();
  if (STYLE_EXPRESSIONS.has(normalizedExplicit) && normalizedExplicit !== "auto") {
    return normalizedExplicit;
  }
  return resolveExpressionFromStyleProfile(styleProfile);
}

function createRecommendationContext({
  requestId,
  gender,
  scene,
  requestedStyle,
  styleExpression,
  styleSemantics,
  styleProfile,
  bodyProfile,
  weather,
  budget,
  userInput,
} = {}) {
  const normalizedGender = normalizeGender(gender);
  const normalizedStyleProfile = normalizeStyleProfile(styleProfile, {
    sourceText: requestedStyle || userInput,
  });
  const value = {
    request_id: String(requestId || "").trim(),
    gender: normalizedGender,
    scene: String(scene || "").trim(),
    style_expression: resolveStyleExpression({
      explicit: styleExpression,
      styleProfile: normalizedStyleProfile,
    }),
    style_semantics: normalizeStyleSemantics(styleSemantics),
    style_profile: normalizedStyleProfile,
    body_profile: Object.freeze({...bodyProfile}),
    weather: Object.freeze({...weather}),
    budget: Object.freeze({...budget}),
  };
  return Object.freeze(value);
}

function assertContextGender(context, value, stage) {
  const expected = normalizeGender(context?.gender);
  const actual = normalizeGender(value);
  if (expected !== "unisex" && actual !== expected) {
    const error = new Error(`${stage || "downstream"} gender conflicts with request context`);
    error.code = "REQUEST_CONTEXT_GENDER_CONFLICT";
    throw error;
  }
  return expected === "unisex" ? actual : expected;
}

function logRecommendationStage(logger, stage, context, details = {}) {
  logger.info?.("RecommendationContext stage", {
    stage,
    request_id: context?.request_id || undefined,
    gender: context?.gender || "unisex",
    style_expression: context?.style_expression || "auto",
    style_profile_configured: Boolean(context?.style_profile?.source_text),
    style_semantics_configured: Boolean(
      context?.style_semantics?.interpretation_summary,
    ),
    ...details,
  });
}

module.exports = {
  STYLE_EXPRESSIONS,
  assertContextGender,
  createRecommendationContext,
  logRecommendationStage,
  resolveStyleExpression,
};
