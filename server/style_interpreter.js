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

// These examples calibrate the model. They are deliberately not used for
// runtime matching, validation, or allow-listing.
const STYLE_REFERENCE_EXAMPLES = Object.freeze([
  Object.freeze({
    input: "Clean Fit 御姐",
    interpretation: "以利落极简为骨架，融合成熟、有力量的女性表达",
  }),
  Object.freeze({
    input: "老钱辣妹",
    interpretation: "克制质感为主，适度加入性感和年轻化细节",
  }),
  Object.freeze({
    input: "像一个有钱姐姐在巴黎下班以后去喝酒，成熟一点，但不要显老",
    interpretation: "精致成熟、都市夜间氛围，同时保持轻盈和年龄感平衡",
  }),
]);

function clampScore(value, fallback = 50) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.round(Math.max(0, Math.min(100, number)));
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanList(value, limit = 12) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(cleanText).filter(Boolean))].slice(0, limit);
}

function normalizeStyleProfile(value, {sourceText = ""} = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  const dimensionsSource = source.dimensions &&
    typeof source.dimensions === "object" &&
    !Array.isArray(source.dimensions)
    ? source.dimensions
    : source;
  const dimensions = Object.fromEntries(
    STYLE_DIMENSIONS.map((name) => [name, clampScore(dimensionsSource[name])]),
  );
  const normalizedSourceText = cleanText(
    source.source_text || source.sourceText || sourceText,
  );

  return Object.freeze({
    source_text: normalizedSourceText,
    interpretation: cleanText(source.interpretation) || normalizedSourceText,
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
    positive_keywords: Object.freeze(cleanList(
      source.positive_keywords || source.positiveKeywords,
    )),
    negative_keywords: Object.freeze(cleanList(
      source.negative_keywords || source.negativeKeywords,
    )),
  });
}

function resolveExpressionFromStyleProfile(profile) {
  const normalized = normalizeStyleProfile(profile);
  const {femininity, masculinity} = normalized.dimensions;
  if (femininity >= 65 && femininity - masculinity >= 15) return "feminine";
  if (masculinity >= 65 && masculinity - femininity >= 15) return "masculine";
  if (Math.max(femininity, masculinity) >= 55 &&
      Math.abs(femininity - masculinity) <= 12) {
    return "neutral";
  }
  return "auto";
}

function buildStyleInterpreterPrompt() {
  const examples = STYLE_REFERENCE_EXAMPLES
    .map((example) => `- ${example.input} → ${example.interpretation}`)
    .join("\n");
  return `
Style Interpreter（必须先执行）：
把用户的任意风格词、多个风格组合或完整自然语言描述解释为统一 style_profile，再据此生成造型。未知风格是正常输入，禁止因为不在示例中而回退为普通休闲风，也禁止要求代码预先枚举新词。
已知示例只用于 few-shot 校准，不是白名单：
${examples}
组合风格必须识别主次并融合，不能只保留其中一个。style_profile.dimensions 的每个值必须是 0-100：${STYLE_DIMENSIONS.join(", ")}。
style_profile 还必须包含 source_text、interpretation、primary_style、secondary_styles、blend_rationale、silhouette、preferred_items、preferred_colors、preferred_materials、positive_keywords、negative_keywords。
`;
}

module.exports = {
  STYLE_DIMENSIONS,
  STYLE_REFERENCE_EXAMPLES,
  buildStyleInterpreterPrompt,
  normalizeStyleProfile,
  resolveExpressionFromStyleProfile,
};
