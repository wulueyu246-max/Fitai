const assert = require("node:assert/strict");
const test = require("node:test");

const {
  STYLE_DIMENSIONS,
  buildStyleInterpreterPrompt,
  normalizeStyleProfile,
  resolveExpressionFromStyleProfile,
} = require("../style_interpreter");

function profile(overrides = {}) {
  return normalizeStyleProfile({
    source_text: "财阀千金",
    interpretation: "克制、精致且带有年轻感的高质感女性风格",
    primary_style: "精致轻奢",
    secondary_styles: ["年轻感", "都市感"],
    blend_rationale: "以精致轻奢为主，年轻都市感为辅",
    dimensions: {
      maturity: 72,
      femininity: 84,
      masculinity: 12,
      structure: 70,
      minimalism: 68,
      romantic: 45,
      sportiness: 8,
      sexiness: 30,
      youthfulness: 58,
      luxury: 88,
      casualness: 22,
    },
    silhouette: "利落收腰并保持轻盈",
    preferred_items: ["短款外套", "高腰下装"],
    preferred_colors: ["奶油白", "深海军蓝"],
    preferred_materials: ["羊毛", "真丝"],
    positive_keywords: ["精致", "克制"],
    negative_keywords: ["廉价印花", "松垮"],
    ...overrides,
  });
}

test("unknown style terms are accepted as an AI-interpreted StyleProfile", () => {
  const result = profile();
  assert.equal(result.source_text, "财阀千金");
  assert.equal(result.primary_style, "精致轻奢");
  assert.equal(result.dimensions.luxury, 88);
  assert.equal(resolveExpressionFromStyleProfile(result), "feminine");
  assert.equal(STYLE_DIMENSIONS.length, 11);
});

test("combined styles preserve primary, secondary, and blend rationale", () => {
  const result = profile({
    source_text: "Clean Fit 御姐",
    primary_style: "Clean Fit",
    secondary_styles: ["御姐", "利落女性感"],
    blend_rationale: "以极简干净为主，以成熟利落的女性表达为辅",
  });
  assert.equal(result.primary_style, "Clean Fit");
  assert.deepEqual(result.secondary_styles, ["御姐", "利落女性感"]);
  assert.match(result.blend_rationale, /为主/);
});

test("full natural-language descriptions remain the source of interpretation", () => {
  const source = "像一个有钱姐姐在巴黎下班以后去喝酒，成熟一点，但不要显老";
  const result = profile({
    source_text: source,
    interpretation: "成熟精致的巴黎下班后酒会氛围，同时保持轻盈年轻",
  });
  assert.equal(result.source_text, source);
  assert.match(result.interpretation, /成熟精致/);
});

test("unknown input never falls back to an ordinary casual style dictionary entry", () => {
  const result = normalizeStyleProfile(null, {sourceText: "冷淡感御姐"});
  assert.equal(result.source_text, "冷淡感御姐");
  assert.equal(result.interpretation, "冷淡感御姐");
  assert.equal(result.primary_style, "");
  assert.equal(result.dimensions.casualness, 50);
  assert.doesNotMatch(JSON.stringify(result), /普通休闲/);
});

test("style interpreter prompt declares examples as calibration, not a whitelist", () => {
  const prompt = buildStyleInterpreterPrompt();
  assert.match(prompt, /不是白名单/);
  assert.match(prompt, /未知风格是正常输入/);
  assert.match(prompt, /组合风格必须识别主次并融合/);
});
