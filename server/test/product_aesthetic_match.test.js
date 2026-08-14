"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  assessProductAesthetic,
  scoreAndSortProducts,
} = require("../product_aesthetic_match");

function specification(overrides = {}) {
  return {
    category: "shoes",
    gender: "female",
    product_type: "黑色低跟玛丽珍鞋",
    product_family: "mary_jane",
    must_attributes: ["玛丽珍结构", "非明显运动"],
    should_attributes: ["女性化", "精致", "复古"],
    preferred_attributes: ["低跟", "皮质"],
    avoid_attributes: ["运动感", "厚底运动鞋", "跑鞋结构"],
    style_roles: ["甜美女性化约会鞋型"],
    ...overrides,
  };
}

test("sweet Mary Jane ranks above a thick sport Mary Jane", () => {
  const products = scoreAndSortProducts([{
    product_id: "sport",
    title: "女士厚底气垫运动玛丽珍休闲鞋",
    _category_text: "女鞋",
    candidate_gate_state: "UNKNOWN",
    sales: "9999",
  }, {
    product_id: "sweet",
    title: "女士黑色皮质复古低跟细带玛丽珍单鞋",
    _category_text: "女鞋",
    candidate_gate_state: "PASS",
    sales: "10",
  }], specification());
  assert.equal(products[0].product_id, "sweet");
  assert.ok(products[0].product_aesthetic_score > products[1].product_aesthetic_score);
  assert.ok(products[1].product_aesthetic_match.conflict_tags.includes("运动"));
});

test("mature pointed heel ranks above running shoes", () => {
  const mature = specification({
    product_type: "真丝约会造型尖头细高跟鞋",
    product_family: "heels",
    must_attributes: ["非明显运动"],
    should_attributes: ["女性化", "精致", "结构感", "尖头"],
    preferred_attributes: ["高跟", "真皮"],
    avoid_attributes: ["运动感", "松垮", "学生感"],
    style_roles: ["成熟女性化约会"],
  });
  const products = scoreAndSortProducts([{
    product_id: "runner",
    title: "女士网面气垫跑步训练鞋",
    candidate_gate_state: "UNKNOWN",
    sales: "3万",
  }, {
    product_id: "heel",
    title: "女士真皮尖头细高跟精致约会单鞋",
    candidate_gate_state: "PASS",
    sales: "5",
  }], mature);
  assert.equal(products[0].product_id, "heel");
  assert.ok(products[0].product_aesthetic_match.matched_tags.includes("尖头"));
});

test("an explicit sports specification does not penalize sport shoes", () => {
  const sport = specification({
    product_type: "轻量跑步运动鞋",
    product_family: "sneakers",
    must_attributes: ["运动", "跑鞋"],
    should_attributes: ["轻量", "透气"],
    preferred_attributes: ["网面", "气垫"],
    avoid_attributes: [],
    style_roles: ["运动训练"],
  });
  const assessment = assessProductAesthetic({
    title: "女士轻量网面气垫跑步运动鞋",
    _category_text: "运动鞋",
  }, sport);
  assert.equal(assessment.conflict_tags.includes("运动"), false);
  assert.ok(assessment.score >= 65);
});

test("purchase state outranks aesthetics and aesthetics outrank sales", () => {
  const products = scoreAndSortProducts([{
    product_id: "unknown-pretty",
    title: "女士黑色复古低跟玛丽珍鞋",
    candidate_gate_state: "UNKNOWN",
    sales: "10万",
  }, {
    product_id: "pass-weak",
    title: "女士黑色皮质玛丽珍单鞋",
    candidate_gate_state: "PASS",
    sales: "1",
  }, {
    product_id: "pass-strong",
    title: "女士黑色皮质复古精致低跟玛丽珍单鞋",
    candidate_gate_state: "PASS",
    sales: "0",
  }], specification());
  assert.deepEqual(products.map((product) => product.product_id), [
    "pass-strong", "pass-weak", "unknown-pretty",
  ]);
});
