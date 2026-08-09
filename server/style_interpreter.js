const crypto = require("node:crypto");

const STYLE_DIMENSIONS = Object.freeze([
  "maturity",
  "femininity",
  "masculinity",
  "structure",
  "minimalism",
  "romantic",
  "sportiness",
  "sexiness",
  "youthfulness",
  "luxury",
  "casualness",
]);

const STYLE_SEMANTIC_LIST_FIELDS = Object.freeze([
  "identity_impression",
  "emotional_tone",
  "visual_personality",
  "social_signal",
  "must_express",
  "must_avoid",
  "style_atoms",
]);

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanList(value, limit = 12) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(cleanText).filter(Boolean))].slice(0, limit);
}

function clampScore(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.round(Math.max(0, Math.min(100, number)));
}

function normalizeStyleSemantics(value) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  const confidence = Number(source.confidence);
  return Object.freeze({
    ...Object.fromEntries(STYLE_SEMANTIC_LIST_FIELDS.map((field) => [
      field,
      Object.freeze(cleanList(source[field])),
    ])),
    confidence: Number.isFinite(confidence)
      ? Math.max(0, Math.min(1, confidence))
      : null,
    interpretation_summary: cleanText(
      source.interpretation_summary || source.interpretationSummary,
    ),
  });
}

function normalizeStyleProfile(value, {sourceText = ""} = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  const dimensionsSource = source.dimensions &&
    typeof source.dimensions === "object" &&
    !Array.isArray(source.dimensions)
    ? source.dimensions
    : {};
  const dimensions = {};
  for (const name of STYLE_DIMENSIONS) {
    const score = clampScore(dimensionsSource[name]);
    if (score !== null) dimensions[name] = score;
  }
  const normalizedSourceText = cleanText(
    source.source_text || source.sourceText || sourceText,
  );
  const explicitIntentPriority = clampScore(
    source.intent_priority_score ?? source.intentPriorityScore,
  );

  return Object.freeze({
    source_text: normalizedSourceText,
    intent_priority_score: explicitIntentPriority ??
      (normalizedSourceText ? 90 : 60),
    interpretation: cleanText(source.interpretation),
    primary_style: cleanText(source.primary_style || source.primaryStyle),
    secondary_styles: Object.freeze(cleanList(
      source.secondary_styles || source.secondaryStyles,
      6,
    )),
    blend_rationale: cleanText(source.blend_rationale || source.blendRationale),
    dimensions: Object.freeze(dimensions),
    silhouette: cleanText(source.silhouette),
    preferred_items: Object.freeze(cleanList(
      source.preferred_items || source.preferredItems,
    )),
    preferred_colors: Object.freeze(cleanList(
      source.preferred_colors || source.preferredColors,
    )),
    preferred_materials: Object.freeze(cleanList(
      source.preferred_materials || source.preferredMaterials,
    )),
    must_have: Object.freeze(cleanList(
      source.must_have || source.mustHave ||
      source.positive_keywords || source.positiveKeywords,
    )),
    must_avoid: Object.freeze(cleanList(
      source.must_avoid || source.mustAvoid ||
      source.negative_keywords || source.negativeKeywords,
    )),
    positive_keywords: Object.freeze(cleanList(
      source.positive_keywords || source.positiveKeywords ||
      source.must_have || source.mustHave,
    )),
    negative_keywords: Object.freeze(cleanList(
      source.negative_keywords || source.negativeKeywords ||
      source.must_avoid || source.mustAvoid,
    )),
  });
}

function dimensionStandardDeviation(profile) {
  const values = STYLE_DIMENSIONS
    .map((name) => Number(profile?.dimensions?.[name]))
    .filter(Number.isFinite);
  if (values.length !== STYLE_DIMENSIONS.length) return null;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce(
    (sum, value) => sum + ((value - average) ** 2),
    0,
  ) / values.length;
  return Math.sqrt(variance);
}

function isGenericStyleProfile(profile, {sourceText = ""} = {}) {
  const normalized = normalizeStyleProfile(profile, {sourceText});
  if (Object.keys(normalized.dimensions).length !== STYLE_DIMENSIONS.length) {
    return true;
  }
  const deviation = dimensionStandardDeviation(normalized);
  return Boolean(cleanText(sourceText || normalized.source_text)) &&
    deviation !== null && deviation < 4;
}

function normalizedSemanticTokens(values) {
  return new Set(values.map((value) => cleanText(value).toLowerCase()));
}

function styleInterpretationIssues({styleSemantics, styleProfile, sourceText = ""}) {
  const semantics = normalizeStyleSemantics(styleSemantics);
  const profile = normalizeStyleProfile(styleProfile, {sourceText});
  const issues = [];
  if (semantics.confidence === null || semantics.confidence < 0.6) {
    issues.push("LOW_CONFIDENCE");
  }
  if (semantics.must_express.length === 0) issues.push("MISSING_MUST_EXPRESS");
  if (semantics.must_avoid.length === 0) issues.push("MISSING_MUST_AVOID");
  if (!semantics.interpretation_summary) issues.push("MISSING_INTERPRETATION_SUMMARY");
  if (Object.keys(profile.dimensions).length !== STYLE_DIMENSIONS.length) {
    issues.push("MISSING_DIMENSIONS");
  } else if (isGenericStyleProfile(profile, {sourceText})) {
    issues.push("GENERIC_DIMENSIONS");
  }
  if (!profile.silhouette || profile.preferred_items.length === 0 ||
      profile.positive_keywords.length === 0 || profile.negative_keywords.length === 0) {
    issues.push("INCOMPLETE_STYLE_PROFILE");
  }
  if (!Number.isFinite(profile.intent_priority_score) ||
      profile.intent_priority_score < 0 || profile.intent_priority_score > 100) {
    issues.push("INVALID_INTENT_PRIORITY");
  }
  const express = normalizedSemanticTokens(semantics.must_express);
  const avoid = normalizedSemanticTokens(semantics.must_avoid);
  if ([...express].some((value) => avoid.has(value))) {
    issues.push("SEMANTIC_CONTRADICTION");
  }
  return Object.freeze(issues);
}

class StyleProfileInvalidError extends Error {
  constructor(issues) {
    super(`StyleProfile invalid: ${issues.join(", ")}`);
    this.name = "StyleProfileInvalidError";
    this.code = "STYLE_PROFILE_INVALID";
    this.issues = [...issues];
  }
}

function assertValidStyleInterpretation(value, {sourceText = ""} = {}) {
  const styleSemantics = normalizeStyleSemantics(
    value?.style_semantics || value?.styleSemantics,
  );
  const styleProfile = normalizeStyleProfile(
    value?.style_profile || value?.styleProfile,
    {sourceText},
  );
  const issues = styleInterpretationIssues({
    styleSemantics,
    styleProfile,
    sourceText,
  });
  if (issues.length > 0) throw new StyleProfileInvalidError(issues);
  return Object.freeze({style_semantics: styleSemantics, style_profile: styleProfile});
}

function resolveExpressionFromStyleProfile(profile) {
  const normalized = normalizeStyleProfile(profile);
  const femininity = normalized.dimensions.femininity;
  const masculinity = normalized.dimensions.masculinity;
  if (!Number.isFinite(femininity) || !Number.isFinite(masculinity)) return "auto";
  if (femininity >= 65 && femininity - masculinity >= 15) return "feminine";
  if (masculinity >= 65 && masculinity - femininity >= 15) return "masculine";
  if (Math.max(femininity, masculinity) >= 55 &&
      Math.abs(femininity - masculinity) <= 12) {
    return "neutral";
  }
  return "auto";
}

function buildStyleInterpreterPrompt() {
  return `
User Intent Priority System（必须执行）：
style_profile 必须包含 intent_priority_score（0-100）。只要用户明确提出本次穿搭风格或审美愿景，该值必须不低于 85，并作为后续阶段不可覆盖的统一优先级。
style_profile 必须同时输出 must_have[] 和 must_avoid[]，内容来自本次语义解释，必须是可用于商品标题与属性核对的具体约束；不得查询或新增任何人工风格词映射。
Look 决策固定使用：用户风格意图 60%、身材 20%、场景 15%、天气 5%。天气只能改变面料、防水、透气和鞋底等功能属性，不能改变用户风格。
后续 Look 修复、商品关键词、候选过滤和最终排序只能消费同一个 style_profile，不得重新解释原始风格文字。
Style Semantic Reasoner（必须先执行）：
把用户的任意风格词、复合表达或完整自然语言愿景进行语义推理。不得查询、匹配或依赖任何人工风格词典、白名单、关键词映射或预设风格分支；未知、虚构和未来出现的表达都是正常输入，不得回退为普通休闲风。
先输出 style_semantics：identity_impression[]、emotional_tone[]、visual_personality[]、social_signal[]、must_express[]、must_avoid[]、style_atoms[]、confidence（0-1）和 interpretation_summary。
否定、限制和“不想要”的含义必须进入 must_avoid；复合表达必须根据完整语义融合主次与张力，不能只保留一个词。
再仅依据 style_semantics 推导 style_profile。11 个连续维度都必须根据语义形成有区分度的 0-100 数值，禁止缺失，禁止用全 50 或近似全 50 代替推理：${STYLE_DIMENSIONS.join(", ")}。
style_profile 还必须包含 source_text、interpretation、primary_style、secondary_styles、blend_rationale、silhouette、preferred_items、preferred_colors、preferred_materials、positive_keywords、negative_keywords。
style_semantics 与 style_profile 是后续 Styling Strategy、Look 设计、商品搜索和商品审美复选的唯一风格事实来源；后续阶段不得重新解释原始风格文字。
`;
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stableObject(value[key])]),
  );
}

function styleInterpretationCacheKey(context) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(stableObject(context || {})))
    .digest("hex");
}

class StyleInterpretationCache {
  constructor({ttlMs = 30 * 60 * 1000, maxEntries = 200} = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.entries = new Map();
  }

  get(context) {
    const key = styleInterpretationCacheKey(context);
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  set(context, value) {
    const key = styleInterpretationCacheKey(context);
    if (this.entries.size >= this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value);
    }
    this.entries.set(key, {createdAt: Date.now(), value});
    return value;
  }
}

module.exports = {
  STYLE_DIMENSIONS,
  STYLE_SEMANTIC_LIST_FIELDS,
  StyleInterpretationCache,
  StyleProfileInvalidError,
  assertValidStyleInterpretation,
  buildStyleInterpreterPrompt,
  dimensionStandardDeviation,
  isGenericStyleProfile,
  normalizeStyleProfile,
  normalizeStyleSemantics,
  resolveExpressionFromStyleProfile,
  styleInterpretationCacheKey,
  styleInterpretationIssues,
};
