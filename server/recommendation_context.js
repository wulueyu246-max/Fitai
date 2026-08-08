const {normalizeGender} = require("./product_relevance");

const STYLE_EXPRESSIONS = new Set(["feminine", "neutral", "masculine", "auto"]);
const FEMININE_TERMS = [
  "御姐", "轻熟", "法式女", "女性约会", "优雅", "性感但得体", "甜酷女", "女人味",
];
const NEUTRAL_TERMS = ["中性", "工装", "无性别", "boyish"];

function resolveStyleExpression({gender, requestedStyle, scene, userInput, explicit} = {}) {
  const normalizedExplicit = String(explicit || "").trim().toLowerCase();
  if (STYLE_EXPRESSIONS.has(normalizedExplicit)) return normalizedExplicit;
  const normalizedGender = normalizeGender(gender);
  const evidence = [requestedStyle, scene, userInput]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
  if (NEUTRAL_TERMS.some((term) => evidence.includes(term))) {
    return evidence.includes("boyish") || evidence.includes("工装")
      ? "masculine"
      : "neutral";
  }
  if (normalizedGender === "female" &&
      FEMININE_TERMS.some((term) => evidence.includes(term))) {
    return "feminine";
  }
  return "auto";
}

function createRecommendationContext({
  requestId,
  gender,
  scene,
  requestedStyle,
  styleExpression,
  bodyProfile,
  weather,
  budget,
  userInput,
} = {}) {
  const normalizedGender = normalizeGender(gender);
  const value = {
    request_id: String(requestId || "").trim(),
    gender: normalizedGender,
    scene: String(scene || "").trim(),
    requested_style: String(requestedStyle || userInput || "").trim(),
    style_expression: resolveStyleExpression({
      gender: normalizedGender,
      requestedStyle,
      scene,
      userInput,
      explicit: styleExpression,
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
