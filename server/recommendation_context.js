const {normalizeGender} = require("./product_relevance");
const {
  normalizeStyleProfile,
  normalizeStyleSemantics,
  resolveExpressionFromStyleProfile,
} = require("./style_interpreter");
const {
  LOOK_INTENT_WEIGHTS,
  PRODUCT_INTENT_WEIGHTS,
  resolveIntentPriorityScore,
} = require("./intent_priority");
const {
  blueprintHasCoreItems,
  normalizeOutfitBlueprint,
} = require("./outfit_blueprint");

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
  outfitBlueprint,
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
    outfit_blueprint: normalizeOutfitBlueprint(outfitBlueprint, {
      styleProfile: normalizedStyleProfile,
      styleSemantics: normalizeStyleSemantics(styleSemantics),
    }),
    intent_priority_score: resolveIntentPriorityScore(normalizedStyleProfile),
    intent_weights: Object.freeze({
      look: LOOK_INTENT_WEIGHTS,
      product: PRODUCT_INTENT_WEIGHTS,
    }),
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
    outfit_blueprint_configured: Boolean(
      blueprintHasCoreItems(context?.outfit_blueprint),
    ),
    requested_style: context?.style_profile?.source_text || undefined,
    intent_priority_score: context?.intent_priority_score,
    style_weight: context?.intent_weights?.product?.style,
    weather_weight: context?.intent_weights?.product?.weather,
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
