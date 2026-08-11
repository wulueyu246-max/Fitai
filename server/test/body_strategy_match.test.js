const assert = require("node:assert/strict");
const test = require("node:test");

const {bodyStrategyMatchAssessment} = require("../body_strategy_match");

const blueprint = {
  core_elements: ["提高腰线", "高腰", "纵向延伸"],
  silhouette_strategy: ["短款上衣搭配高腰下装"],
  must_have_items: {
    top: ["短款合身上衣"],
    bottom: ["高腰垂坠直筒裤"],
    shoes: ["浅口尖头低跟鞋"],
  },
};

function assess(title, category) {
  return bodyStrategyMatchAssessment(
    {title, category},
    {item_name: title, category},
    blueprint,
  );
}

test("raised-waist strategy rewards cropped tops, high-waist bottoms and leg-line shoes", () => {
  const top = assess("女士短款合身上衣显腰线", "top");
  const bottom = assess("女士高腰垂坠直筒裤显腿长", "bottom");
  const shoes = assess("女士浅口尖头低跟鞋", "shoes");

  assert.ok(top.score >= 90);
  assert.ok(bottom.score >= 90);
  assert.ok(shoes.score >= 90);
  assert.ok(top.matched_elements.includes("短款上衣"));
  assert.ok(bottom.matched_elements.includes("高腰"));
  assert.ok(shoes.matched_elements.includes("浅口"));
});

test("raised-waist strategy strongly lowers low-waist, dragging and heavy high-top items", () => {
  const lowWaist = assess("女士低腰宽松拖地裤", "bottom");
  const heavyHighTop = assess("女士厚重厚底高帮鞋", "shoes");
  const longTop = assess("女士宽松长款遮臀上衣", "top");

  assert.ok(lowWaist.score < 40);
  assert.ok(heavyHighTop.score < 40);
  assert.ok(longTop.score < 40);
  assert.ok(lowWaist.conflict_elements.includes("低腰"));
  assert.ok(heavyHighTop.conflict_elements.includes("厚重高帮鞋"));
});

test("unrelated style blueprints remain neutral", () => {
  const result = bodyStrategyMatchAssessment(
    {title: "女士真丝衬衫", category: "top"},
    {category: "top"},
    {core_elements: ["结构感", "经典材质"]},
  );
  assert.equal(result.configured, false);
  assert.equal(result.score, 60);
});
