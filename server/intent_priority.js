const LOOK_INTENT_WEIGHTS = Object.freeze({
  style: 75,
  body: 10,
  scene: 10,
  weather: 5,
});

const PRODUCT_INTENT_WEIGHTS = Object.freeze({
  style: 75,
  body: 8,
  quality: 7,
  brand: 5,
  weather: 5,
});

const HIGH_INTENT_THRESHOLD = 80;
const MIN_LOOK_STYLE_SCORE = 60;
const MIN_PRODUCT_STYLE_SCORE = 50;

function boundedScore(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(0, Math.min(100, number))
    : fallback;
}

function resolveIntentPriorityScore(styleProfile, sourceText = "") {
  const explicit = Number(
    styleProfile?.intent_priority_score ?? styleProfile?.intentPriorityScore,
  );
  if (Number.isFinite(explicit)) return Math.round(boundedScore(explicit));
  const requestedStyle = String(
    styleProfile?.source_text || styleProfile?.sourceText || sourceText || "",
  ).trim();
  return requestedStyle ? 90 : 60;
}

function normalizeToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff]+/gu, "");
}

function uniqueTokens(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(normalizeToken)
    .filter((value) => value.length >= 2))];
}

function constraintFragments(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return [];
  const fragments = [normalizeToken(text)];
  try {
    const segmenter = new Intl.Segmenter("zh-CN", {granularity: "word"});
    for (const segment of segmenter.segment(text)) {
      if (segment.isWordLike) fragments.push(normalizeToken(segment.segment));
    }
  } catch {
    fragments.push(...text.split(/[\s,，、/|;；]+/u).map(normalizeToken));
  }
  return [...new Set(fragments.filter((fragment) => fragment.length >= 2))];
}

function styleGateConstraints(styleProfile = {}) {
  const mustHave = Array.isArray(styleProfile.must_have)
    ? styleProfile.must_have
    : Array.isArray(styleProfile.mustHave)
      ? styleProfile.mustHave
      : styleProfile.positive_keywords || [];
  const mustAvoid = Array.isArray(styleProfile.must_avoid)
    ? styleProfile.must_avoid
    : Array.isArray(styleProfile.mustAvoid)
      ? styleProfile.mustAvoid
      : styleProfile.negative_keywords || [];
  return Object.freeze({
    must_have: Object.freeze([...new Set(mustHave
      .map((value) => String(value || "").trim()).filter(Boolean))]),
    must_avoid: Object.freeze([...new Set(mustAvoid
      .map((value) => String(value || "").trim()).filter(Boolean))]),
  });
}

function evaluateStyleGate(product = {}, styleProfile = {}, intentPriorityScore) {
  const priority = Number.isFinite(Number(intentPriorityScore))
    ? Math.round(boundedScore(intentPriorityScore))
    : resolveIntentPriorityScore(styleProfile);
  const constraints = styleGateConstraints(styleProfile);
  const evidence = normalizeToken([
    product.title,
    product.brand,
    product.shop_name,
    product.material,
    product.style,
    product.color,
  ].filter(Boolean).join(" "));
  const matchedNegativeKeywords = constraints.must_avoid.filter((keyword) =>
    constraintFragments(keyword).some((fragment) => evidence.includes(fragment)));
  const matchedMustHaveKeywords = constraints.must_have.filter((keyword) =>
    constraintFragments(keyword).some((fragment) => evidence.includes(fragment)));
  return Object.freeze({
    allowed: priority < HIGH_INTENT_THRESHOLD || matchedNegativeKeywords.length === 0,
    style_conflict: priority >= HIGH_INTENT_THRESHOLD &&
      matchedNegativeKeywords.length > 0,
    matched_negative_keywords: Object.freeze(matchedNegativeKeywords),
    matched_must_have_keywords: Object.freeze(matchedMustHaveKeywords),
    intent_priority_score: priority,
  });
}

function styleIntentTokens(styleProfile = {}, styleSemantics = {}) {
  return Object.freeze({
    positive: Object.freeze(uniqueTokens([
      styleProfile.primary_style,
      ...(styleProfile.secondary_styles || []),
      styleProfile.silhouette,
      ...(styleProfile.preferred_items || []),
      ...(styleProfile.preferred_colors || []),
      ...(styleProfile.preferred_materials || []),
      ...(styleProfile.positive_keywords || []),
      ...(styleProfile.must_have || styleProfile.mustHave || []),
      ...(styleSemantics.must_express || []),
      ...(styleSemantics.style_atoms || []),
    ])),
    negative: Object.freeze(uniqueTokens([
      ...(styleProfile.negative_keywords || []),
      ...(styleProfile.must_avoid || styleProfile.mustAvoid || []),
      ...(styleSemantics.must_avoid || []),
    ])),
  });
}

function styleMatchScore({
  evidence,
  relevanceScore,
  styleProfile = {},
  styleSemantics = {},
} = {}) {
  const normalizedEvidence = normalizeToken(evidence);
  const tokens = styleIntentTokens(styleProfile, styleSemantics);
  if (tokens.negative.some((token) => normalizedEvidence.includes(token))) return 0;
  const positiveMatches = tokens.positive.filter((token) =>
    normalizedEvidence.includes(token)).length;
  const highIntent = resolveIntentPriorityScore(styleProfile) >=
    HIGH_INTENT_THRESHOLD;
  const expectedEvidenceCount = highIntent ? 2 : 4;
  const coverage = tokens.positive.length > 0
    ? Math.min(
      1,
      positiveMatches / Math.min(tokens.positive.length, expectedEvidenceCount),
    )
    : 0;
  const relevance = Number.isFinite(Number(relevanceScore))
    ? boundedScore(relevanceScore)
    : 50;
  const styleEvidenceWeight = highIntent ? 0.75 : 0.25;
  const relevanceWeight = 1 - styleEvidenceWeight;
  return Math.round((
    relevance * relevanceWeight + coverage * 100 * styleEvidenceWeight
  ) * 10) / 10;
}

function hasStyleViolation(evidence, styleProfile = {}, styleSemantics = {}) {
  const normalizedEvidence = normalizeToken(evidence);
  return styleIntentTokens(styleProfile, styleSemantics).negative
    .some((token) => normalizedEvidence.includes(token));
}

function shouldRejectForStyle({intentPriorityScore, styleMatch}) {
  return boundedScore(intentPriorityScore) >= HIGH_INTENT_THRESHOLD &&
    boundedScore(styleMatch) < MIN_PRODUCT_STYLE_SCORE;
}

function productIntentScore({
  styleMatch,
  bodyMatch,
  quality,
  brand,
  weather,
  diversityScore = 100,
} = {}) {
  const base =
    boundedScore(styleMatch) * (PRODUCT_INTENT_WEIGHTS.style / 100) +
    boundedScore(bodyMatch) * (PRODUCT_INTENT_WEIGHTS.body / 100) +
    boundedScore(quality) * (PRODUCT_INTENT_WEIGHTS.quality / 100) +
    boundedScore(brand) * (PRODUCT_INTENT_WEIGHTS.brand / 100) +
    boundedScore(weather, 70) * (PRODUCT_INTENT_WEIGHTS.weather / 100);
  const diversityPenalty = (100 - boundedScore(diversityScore, 100)) * 0.02;
  return Math.round(Math.max(0, base - diversityPenalty) * 10) / 10;
}

function lookIntentScore({styleMatch, bodyMatch, sceneMatch, weatherMatch} = {}) {
  return Math.round((
    boundedScore(styleMatch) * (LOOK_INTENT_WEIGHTS.style / 100) +
    boundedScore(bodyMatch) * (LOOK_INTENT_WEIGHTS.body / 100) +
    boundedScore(sceneMatch) * (LOOK_INTENT_WEIGHTS.scene / 100) +
    boundedScore(weatherMatch, 70) * (LOOK_INTENT_WEIGHTS.weather / 100)
  ) * 10) / 10;
}

function intentDebugSummary({styleProfile = {}, finalStyleScore = 0} = {}) {
  return Object.freeze({
    requested_style: String(styleProfile.source_text || "").trim(),
    intent_priority_score: resolveIntentPriorityScore(styleProfile),
    style_weight: PRODUCT_INTENT_WEIGHTS.style,
    weather_weight: PRODUCT_INTENT_WEIGHTS.weather,
    final_style_score: Math.round(boundedScore(finalStyleScore) * 10) / 10,
  });
}

module.exports = {
  HIGH_INTENT_THRESHOLD,
  LOOK_INTENT_WEIGHTS,
  MIN_LOOK_STYLE_SCORE,
  MIN_PRODUCT_STYLE_SCORE,
  PRODUCT_INTENT_WEIGHTS,
  evaluateStyleGate,
  hasStyleViolation,
  intentDebugSummary,
  lookIntentScore,
  productIntentScore,
  resolveIntentPriorityScore,
  shouldRejectForStyle,
  styleIntentTokens,
  styleGateConstraints,
  styleMatchScore,
};
