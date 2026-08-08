const assert = require("node:assert/strict");
const test = require("node:test");

const {
  assertContextGender,
  createRecommendationContext,
  resolveStyleExpression,
} = require("../recommendation_context");

test("female mature and French requests resolve to feminine expression", () => {
  assert.equal(resolveStyleExpression({gender: "female", requestedStyle: "御姐轻熟"}), "feminine");
  assert.equal(resolveStyleExpression({gender: "female", scene: "法式女性约会"}), "feminine");
  assert.equal(resolveStyleExpression({gender: "female", requestedStyle: "工装"}), "masculine");
});

test("recommendation context is immutable and rejects female to unisex drift", () => {
  const context = createRecommendationContext({
    requestId: "request-female-1",
    gender: "female",
    scene: "约会",
    requestedStyle: "轻熟御姐",
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
