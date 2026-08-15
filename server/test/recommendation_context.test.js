const assert = require("node:assert/strict");
const test = require("node:test");

const {
  assertContextGender,
  createPersonaContract,
  createRecommendationContext,
  personaConsistencyAssessment,
  resolveStyleExpression,
} = require("../recommendation_context");

test("style expression is derived from the interpreted profile, not style keywords", () => {
  assert.equal(resolveStyleExpression({
    styleProfile: {dimensions: {femininity: 82, masculinity: 15}},
  }), "feminine");
  assert.equal(resolveStyleExpression({
    styleProfile: {dimensions: {femininity: 15, masculinity: 82}},
  }), "masculine");
  assert.equal(resolveStyleExpression({
    explicit: "neutral",
    styleProfile: {dimensions: {femininity: 90, masculinity: 5}},
  }), "neutral");
});

test("recommendation context is immutable and rejects female to unisex drift", () => {
  const context = createRecommendationContext({
    requestId: "request-female-1",
    gender: "female",
    authoritativeGender: "female",
    userInput: "明天约会，想有气质但别太成熟",
    scene: "约会",
    requestedStyle: "轻熟御姐",
    styleProfile: {
      source_text: "轻熟御姐",
      dimensions: {femininity: 80, masculinity: 10},
    },
    bodyProfile: {height: 160},
    budget: {item: "200-500"},
  });
  assert.equal(Object.isFrozen(context), true);
  assert.equal(Object.isFrozen(context.body_profile), true);
  assert.equal(context.gender, "female");
  assert.equal(context.authoritative_gender, "female");
  assert.equal(context.user_input, "明天约会，想有气质但别太成熟");
  assert.deepEqual(context.derived_requested_style, {
    value: "轻熟御姐",
    source: "analysis_style",
  });
  assert.equal(context.style_expression, "feminine");
  assert.equal(assertContextGender(context, "female", "look"), "female");
  assert.throws(
    () => assertContextGender(context, "unisex", "product_requirement"),
    /conflicts with request context/,
  );
});

test("female athleisure remains valid when its structured persona stays female", () => {
  const contract = createPersonaContract({
    gender: "female",
    styleExpression: "neutral",
  });
  const assessment = personaConsistencyAssessment({
    gender: "female",
    style_direction: "女士轻运动休闲",
    look_direction: {name: "轻量户外出行", silhouette: "利落合身"},
    items: [
      {
        gender: "female",
        product_type: "短款运动上衣",
        fit: "合身",
        style_role: "女性轻运动层次",
        design_elements: ["短款"],
      },
      {
        gender: "female",
        product_type: "高腰束脚运动裤",
        fit: "高腰锥形",
        style_role: "轻盈利落",
        design_elements: ["高腰"],
      },
    ],
  }, contract);
  assert.equal(assessment.allowed, true);
  assert.equal(assessment.status, "PASS");
});

test("female persona rejects explicit masculine character drift", () => {
  const assessment = personaConsistencyAssessment({
    gender: "female",
    style_direction: "男性硬朗街头",
    look_direction: {name: "硬汉运动造型", silhouette: "宽大男性化轮廓"},
    items: [{
      gender: "female",
      product_type: "宽大男款运动外套",
      fit: "男士宽松",
      style_role: "masculine menswear",
      design_elements: [],
    }],
  }, createPersonaContract({gender: "female"}));
  assert.equal(assessment.allowed, false);
  assert.ok(assessment.conflicts.includes("MASCULINE_PERSONA_DRIFT"));
});

test("male persona is not forced feminine and unisex stays neutral", () => {
  const male = personaConsistencyAssessment({
    gender: "male",
    style_direction: "男士轻运动",
    items: [{
      gender: "male",
      product_type: "合身运动上衣",
      style_role: "男性利落表达",
      fit: "合身",
      design_elements: [],
    }],
  }, createPersonaContract({gender: "male"}));
  assert.equal(male.allowed, true);
  assert.equal(male.status, "PASS");

  const unisex = personaConsistencyAssessment({
    gender: "unisex",
    style_direction: "中性简洁",
    items: [{
      gender: "unisex",
      product_type: "直筒休闲上衣",
      style_role: "中性层次",
      fit: "直筒",
      design_elements: [],
    }],
  }, createPersonaContract({gender: "unisex"}));
  assert.equal(unisex.allowed, true);
  assert.equal(unisex.status, "NEUTRAL");
});
