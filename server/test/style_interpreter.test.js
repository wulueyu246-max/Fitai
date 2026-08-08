const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  STYLE_DIMENSIONS,
  StyleInterpretationCache,
  StyleProfileInvalidError,
  assertValidStyleInterpretation,
  buildStyleInterpreterPrompt,
  isGenericStyleProfile,
  normalizeStyleProfile,
  normalizeStyleSemantics,
  styleInterpretationCacheKey,
} = require("../style_interpreter");

function validSemantics(overrides = {}) {
  return {
    identity_impression: ["冷静的未来感策展人"],
    emotional_tone: ["克制", "敏锐"],
    visual_personality: ["清晰结构", "轻盈层次"],
    social_signal: ["专业", "独立"],
    must_express: ["雨后反光般的清透质感", "策展式秩序"],
    must_avoid: ["普通休闲", "杂乱堆叠"],
    style_atoms: ["未来感", "轻结构", "冷色光泽"],
    confidence: 0.88,
    interpretation_summary: "用轻结构和冷色微光表达虚构的雨后未来策展人气质。",
    ...overrides,
  };
}

function validProfile(overrides = {}) {
  return {
    source_text: "雨后未来主义图书馆策展人",
    interpretation: "轻结构、冷色微光与知识氛围的未来感造型。",
    primary_style: "未来策展气质",
    secondary_styles: ["轻结构", "冷色微光"],
    blend_rationale: "以专业秩序为主，融合雨后清透和未来材质感。",
    dimensions: {
      maturity: 72,
      femininity: 48,
      masculinity: 38,
      structure: 82,
      minimalism: 76,
      romantic: 34,
      sportiness: 16,
      sexiness: 18,
      youthfulness: 56,
      luxury: 64,
      casualness: 24,
    },
    silhouette: "纵向轻结构与局部不对称层次",
    preferred_items: ["短结构外套", "垂顺直筒下装"],
    preferred_colors: ["雨灰", "冷蓝"],
    preferred_materials: ["细密羊毛", "微光泽科技面料"],
    positive_keywords: ["轻结构", "冷色微光", "克制"],
    negative_keywords: ["大面积印花", "松垮无结构", "普通休闲"],
    ...overrides,
  };
}

function interpretation(semantics = validSemantics(), profile = validProfile()) {
  return {style_semantics: semantics, style_profile: profile};
}

test("a completely unknown fictional style keeps meaningful semantics and profile", () => {
  const result = assertValidStyleInterpretation(interpretation(), {
    sourceText: "雨后未来主义图书馆策展人",
  });
  assert.equal(result.style_semantics.confidence, 0.88);
  assert.equal(result.style_profile.dimensions.structure, 82);
  assert.ok(result.style_profile.preferred_items.length >= 2);
  assert.equal(STYLE_DIMENSIONS.length, 11);
});

test("normalization is stable for the same semantic input", () => {
  const first = assertValidStyleInterpretation(interpretation(), {
    sourceText: "雨后未来主义图书馆策展人",
  });
  const second = assertValidStyleInterpretation(interpretation(), {
    sourceText: "雨后未来主义图书馆策展人",
  });
  assert.deepEqual(first, second);
});

test("semantically different profiles have meaningful continuous distance", () => {
  const first = normalizeStyleProfile(validProfile());
  const second = normalizeStyleProfile(validProfile({
    dimensions: {
      maturity: 38, femininity: 78, masculinity: 12, structure: 24,
      minimalism: 20, romantic: 88, sportiness: 42, sexiness: 64,
      youthfulness: 86, luxury: 32, casualness: 72,
    },
  }));
  const distance = STYLE_DIMENSIONS.reduce(
    (sum, field) => sum + Math.abs(
      first.dimensions[field] - second.dimensions[field],
    ),
    0,
  ) / STYLE_DIMENSIONS.length;
  assert.ok(distance > 25);
});

test("composite styles are represented as a semantic fusion", () => {
  const result = assertValidStyleInterpretation(interpretation(
    validSemantics({
      style_atoms: ["干净留白", "成熟气场", "利落女性化"],
      must_express: ["极简整洁", "成熟气场"],
    }),
    validProfile({
      source_text: "两种风格融合输入",
      primary_style: "干净极简",
      secondary_styles: ["成熟气场"],
      blend_rationale: "用干净留白承载成熟而利落的表达，两者同时保留。",
    }),
  ), {sourceText: "两种风格融合输入"});
  assert.equal(result.style_profile.secondary_styles.length, 1);
  assert.match(result.style_profile.blend_rationale, /同时保留/);
});

test("negation constraints remain in must_avoid", () => {
  const semantics = normalizeStyleSemantics(validSemantics({
    must_express: ["成熟"],
    must_avoid: ["显老", "夜店感"],
  }));
  assert.deepEqual(semantics.must_avoid, ["显老", "夜店感"]);
});

test("all-50 or near-all-50 dimensions are rejected instead of silently succeeding", () => {
  const generic = validProfile({
    dimensions: Object.fromEntries(STYLE_DIMENSIONS.map((field) => [field, 50])),
  });
  assert.equal(isGenericStyleProfile(generic, {sourceText: generic.source_text}), true);
  assert.throws(
    () => assertValidStyleInterpretation(
      interpretation(validSemantics(), generic),
      {sourceText: generic.source_text},
    ),
    (error) => error instanceof StyleProfileInvalidError &&
      error.code === "STYLE_PROFILE_INVALID" &&
      error.issues.includes("GENERIC_DIMENSIONS"),
  );
});

test("missing dimensions cannot be normalized into hidden neutral defaults", () => {
  const result = normalizeStyleProfile({
    source_text: "未知输入",
    dimensions: {maturity: 70},
  });
  assert.deepEqual(result.dimensions, {maturity: 70});
  assert.equal(result.dimensions.casualness, undefined);
  assert.throws(
    () => assertValidStyleInterpretation(
      interpretation(validSemantics(), result),
      {sourceText: "未知输入"},
    ),
    /MISSING_DIMENSIONS/,
  );
});

test("cache key uses the complete semantic context rather than a style-name table", () => {
  const base = {
    requested_style: "虚构描述",
    scene: "展览开幕",
    gender: "female",
    body_information: {height: 165, weight: 52},
    weather: {condition: "rain"},
  };
  assert.notEqual(
    styleInterpretationCacheKey(base),
    styleInterpretationCacheKey({...base, scene: "周末徒步"}),
  );
  const cache = new StyleInterpretationCache();
  cache.set(base, interpretation());
  assert.deepEqual(cache.get(base), interpretation());
});

test("runtime Style Interpreter contains no concrete style vocabulary mapping", () => {
  const runtimeFiles = [
    path.join(__dirname, "..", "style_interpreter.js"),
    path.join(__dirname, "..", "recommendation_context.js"),
  ];
  const source = runtimeFiles.map((file) => fs.readFileSync(file, "utf8")).join("\n");
  const forbiddenExamples = ["御姐", "财阀千金", "老钱风", "知识分子风", "Y2K"];
  for (const term of forbiddenExamples) assert.doesNotMatch(source, new RegExp(term));
  assert.doesNotMatch(source, /STYLE_REFERENCE|StyleKnowledgeBase/);
  assert.doesNotMatch(source, /includes\([^)]*(?:style|requested)/i);
});

test("prompt describes semantic reasoning, not a whitelist", () => {
  const prompt = buildStyleInterpreterPrompt();
  assert.match(prompt, /Style Semantic Reasoner/);
  assert.match(prompt, /不得查询、匹配或依赖任何人工风格词典/);
  assert.match(prompt, /禁止用全 50 或近似全 50/);
});
