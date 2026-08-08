const assert = require("node:assert/strict");
const test = require("node:test");

const {
  assertContextGender,
  createRecommendationContext,
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
  assert.equal(context.style_expression, "feminine");
  assert.equal(assertContextGender(context, "female", "look"), "female");
  assert.throws(
    () => assertContextGender(context, "unisex", "product_requirement"),
    /conflicts with request context/,
  );
});
