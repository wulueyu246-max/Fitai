const assert = require("node:assert/strict");
const test = require("node:test");

const {
  LOOK_INTENT_WEIGHTS,
  PRODUCT_INTENT_WEIGHTS,
  evaluateStyleGate,
  hasActionableStyleConstraints,
  productIntentScore,
  lookIntentScore,
  resolveIntentPriorityScore,
  shouldRejectForStyle,
  styleMatchScore,
} = require("../intent_priority");
const {normalizeStyleProfile} = require("../style_interpreter");
const {createRecommendationContext} = require("../recommendation_context");
const {ProductAestheticReranker} = require("../product_aesthetic_reranker");

function highPriorityProfile() {
  return {
    source_text: "甜妹穿搭",
    intent_priority_score: 92,
    primary_style: "柔和甜美",
    secondary_styles: ["轻盈精致"],
    silhouette: "柔和收腰轮廓",
    preferred_items: ["轻盈上衣", "柔和裙装"],
    preferred_colors: ["柔粉色"],
    preferred_materials: ["细腻针织"],
    positive_keywords: ["甜美", "轻盈", "精致"],
    negative_keywords: ["跑鞋", "运动训练鞋", "工装裤", "运动外套"],
    must_have: ["甜美", "轻盈", "精致"],
    must_avoid: ["运动鞋", "跑步鞋", "训练鞋", "篮球鞋", "工装", "户外机能"],
  };
}

test("an explicit user style receives high priority without a style-name mapping", () => {
  const normalized = normalizeStyleProfile({source_text: "甜妹穿搭"});
  assert.ok(normalized.intent_priority_score >= 85);
  assert.equal(resolveIntentPriorityScore(normalized), 90);
});

test("an uninterpreted timeout style does not hard-reject every real product", () => {
  const fallbackProfile = normalizeStyleProfile({
    source_text: "甜美穿搭",
    intent_priority_score: 90,
    primary_style: "甜美穿搭",
    must_have: ["甜美穿搭"],
    positive_keywords: ["甜美穿搭"],
  });
  const styleMatch = styleMatchScore({
    evidence: "女士甜美短袖上衣",
    relevanceScore: 80,
    styleProfile: fallbackProfile,
  });

  assert.equal(hasActionableStyleConstraints(fallbackProfile), false);
  assert.ok(styleMatch < 50);
  assert.equal(shouldRejectForStyle({
    intentPriorityScore: fallbackProfile.intent_priority_score,
    styleMatch,
    enforce: hasActionableStyleConstraints(fallbackProfile),
  }), false);
});

test("the same immutable weights flow through recommendation context", () => {
  const context = createRecommendationContext({
    requestId: "intent-request",
    requestedStyle: "甜妹穿搭",
    styleProfile: highPriorityProfile(),
  });
  assert.equal(context.intent_priority_score, 92);
  assert.deepEqual(context.intent_weights.look, LOOK_INTENT_WEIGHTS);
  assert.deepEqual(context.intent_weights.product, PRODUCT_INTENT_WEIGHTS);
  assert.equal(context.intent_weights.look.weather, 5);
  assert.equal(context.intent_weights.product.style, 75);
});

test("style dominates product score while weather remains a weak constraint", () => {
  const highStyle = productIntentScore({
    styleMatch: 95, bodyMatch: 70, quality: 70, brand: 70, weather: 10,
  });
  const highWeather = productIntentScore({
    styleMatch: 40, bodyMatch: 70, quality: 70, brand: 70, weather: 100,
  });
  assert.ok(highStyle > highWeather);
  assert.equal(PRODUCT_INTENT_WEIGHTS.style, 75);
  assert.equal(PRODUCT_INTENT_WEIGHTS.weather, 5);
  assert.ok(
    lookIntentScore({styleMatch: 95, bodyMatch: 70, sceneMatch: 70, weatherMatch: 0}) >
    lookIntentScore({styleMatch: 40, bodyMatch: 70, sceneMatch: 70, weatherMatch: 100}),
  );
});

test("high relevance alone cannot pass a high-priority style match", () => {
  const profile = {
    ...highPriorityProfile(),
    must_avoid: [],
    negative_keywords: [],
  };
  const score = styleMatchScore({
    evidence: "361白色网面休闲运动鞋",
    relevanceScore: 100,
    styleProfile: profile,
  });
  assert.ok(score < 50);
  assert.equal(shouldRejectForStyle({
    intentPriorityScore: profile.intent_priority_score,
    styleMatch: score,
  }), true);
});

test("high-priority intent hard-rejects low style matches", () => {
  const profile = highPriorityProfile();
  const score = styleMatchScore({
    evidence: "普通运动外套 跑鞋",
    relevanceScore: 95,
    styleProfile: profile,
  });
  assert.equal(score, 0);
  assert.equal(shouldRejectForStyle({
    intentPriorityScore: profile.intent_priority_score,
    styleMatch: score,
  }), true);
});

test("Style Gate rejects a conflicting 361 sports shoe before ranking", () => {
  const profile = highPriorityProfile();
  const result = evaluateStyleGate({
    title: "361女子运动鞋跑步训练鞋",
    category: "shoes",
  }, profile, profile.intent_priority_score);
  assert.equal(result.allowed, false);
  assert.equal(result.style_conflict, true);
  assert.ok(result.matched_negative_keywords.includes("运动鞋"));
  assert.equal(result.intent_priority_score, 92);
});

test("Style Gate does not reduce a compound long-top constraint to the word top", () => {
  const profile = {
    intent_priority_score: 95,
    must_avoid: ["盖臀长上衣"],
  };
  const cropped = evaluateStyleGate({
    title: "女士短款合身上衣显腰线",
    category: "top",
  }, profile, 95);
  const longLoose = evaluateStyleGate({
    title: "女士宽松长款遮臀上衣",
    category: "top",
  }, profile, 95);

  assert.equal(cropped.allowed, true);
  assert.deepEqual(cropped.matched_negative_keywords, []);
  assert.equal(longLoose.allowed, false);
  assert.deepEqual(longLoose.matched_negative_keywords, ["盖臀长上衣"]);
});

test("Style Gate records safe conflict diagnostics", async () => {
  const entries = [];
  const profile = highPriorityProfile();
  const reranker = new ProductAestheticReranker({
    visualEvaluationEnabled: false,
    logger: {info: (...args) => entries.push(args), warn() {}},
  });
  await reranker.rerank({
    context: {style_profile: profile},
    groups: [{
      requirement: {category: "shoes", gender: "female"},
      candidates: [{
        product_id: "sports-361",
        category: "shoes",
        title: "361女子运动鞋跑步训练鞋",
        source: "taobao",
        platform: "taobao",
        is_mock: false,
        image_url: "https://img.example.com/361.jpg",
        purchase_url: "https://s.click.taobao.com/361",
        price: 199,
        relevance_score: 95,
      }],
    }],
  });
  const diagnostic = entries.find(([message]) =>
    message === "Style Gate rejected candidate")?.[1];
  assert.equal(diagnostic.title, "361女子运动鞋跑步训练鞋");
  assert.equal(diagnostic.category, "shoes");
  assert.equal(diagnostic.style_conflict, true);
  assert.ok(diagnostic.matched_negative_keywords.length > 0);
  assert.equal(diagnostic.intent_priority_score, 92);
});

test("ten high-priority generations never surface canonical style violations", async () => {
  const profile = highPriorityProfile();
  const allowed = ["甜美玛丽珍鞋", "轻盈芭蕾鞋", "精致低跟单鞋", "柔粉玛丽珍鞋"];
  const blocked = ["361运动鞋", "361跑步鞋", "训练鞋", "篮球鞋"];
  const candidates = [...allowed, ...blocked].map((title, index) => ({
    product_id: `product-${index}`,
    source: "taobao",
    platform: "taobao",
    is_mock: false,
    category: "shoes",
    title,
    price: 100,
    image_url: `https://img.example.com/${index}.jpg`,
    purchase_url: `https://s.click.taobao.com/${index}`,
    relevance_score: 90,
  }));
  const reranker = new ProductAestheticReranker({
    visualEvaluationEnabled: false,
    logger: {info() {}, warn() {}},
  });
  for (let index = 0; index < 10; index += 1) {
    const products = await reranker.rerank({
      requestId: `intent-${index}`,
      context: {
        style_profile: profile,
        style_semantics: {must_avoid: profile.negative_keywords},
      },
      groups: [{
        requirement: {
          category: "shoes",
          gender: "female",
          item_name: "轻盈甜美单鞋",
          style: "柔和甜美",
        },
        candidates,
      }],
    });
    assert.ok(products.length > 0);
    assert.equal(products.some((product) =>
      blocked.some((term) => product.title.includes(term))), false);
    assert.ok(products.every((product) => product.style_match_score >= 50));
  }
});
