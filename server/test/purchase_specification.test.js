"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  MATCH_STATE,
  NO_PRODUCT_MEETS_CORE_SPEC,
  SPEC_CONSISTENCY_STATUS,
  compilePurchaseSpecification,
  evaluateCandidateAgainstSpecification,
  procurementResult,
  relaxedSpecification,
} = require("../purchase_specification");

function maryJaneRequirement(overrides = {}) {
  return {
    request_id: "request-1",
    look_id: "look-1",
    slot_key: "request-1:look-1:shoes:0",
    category: "shoes",
    gender: "female",
    product_type: "黑色低跟玛丽珍鞋",
    product_family: "mary_jane",
    item_name: "黑色低跟玛丽珍鞋",
    colors: ["黑色"],
    materials: ["皮质"],
    design_elements: ["细带"],
    required_attributes: ["非明显运动"],
    preferred_attributes: ["低跟"],
    avoid_attributes: ["厚重运动鞋底"],
    style_role: "女性化精致鞋型",
    search_keywords: [],
    negative_keywords: [],
    ...overrides,
  };
}

test("compiles a complete PurchaseSpecification from executable contract", () => {
  const spec = compilePurchaseSpecification(maryJaneRequirement());
  assert.equal(spec.request_id, "request-1");
  assert.equal(spec.look_id, "look-1");
  assert.equal(spec.category, "shoes");
  assert.equal(spec.product_family, "mary_jane");
  assert.ok(spec.must_attributes.includes("玛丽珍结构"));
  assert.ok(spec.must_attributes.includes("非明显运动"));
  assert.ok(spec.should_attributes.includes("细带"));
  assert.ok(spec.preferred_attributes.includes("低跟"));
  assert.ok(spec.avoid_attributes.includes("厚重运动鞋底"));
  assert.deepEqual(spec.style_roles, ["女性化精致鞋型"]);
  assert.ok(spec.search_queries.length >= 2);
});

test("search queries only use procurement product attributes", () => {
  const spec = compilePurchaseSpecification(maryJaneRequirement({
    style_role: "提高腰线的内部策略说明",
    fit: "浅口",
  }));
  assert.ok(spec.search_queries.every((query) => !query.includes("提高腰线")));
  assert.ok(spec.search_queries.every((query) => query.includes("玛丽珍鞋")));
});

test("wrong category and explicit avoid conflict are rejected", () => {
  const spec = compilePurchaseSpecification(maryJaneRequirement());
  assert.equal(evaluateCandidateAgainstSpecification({
    title: "女士真丝衬衫",
    _category_text: "女装上衣",
  }, spec).state, MATCH_STATE.FAIL);
  assert.equal(evaluateCandidateAgainstSpecification({
    title: "女士玛丽珍厚重运动鞋底气垫训练鞋",
    _category_text: "女鞋",
  }, spec).state, MATCH_STATE.FAIL);
});

test("unknown title evidence remains UNKNOWN and requests visual verification", () => {
  const spec = compilePurchaseSpecification(maryJaneRequirement({
    required_attributes: [],
    avoid_attributes: [],
  }));
  const assessment = evaluateCandidateAgainstSpecification({
    title: "玛丽珍女鞋",
    _category_text: "女鞋",
  }, spec);
  assert.equal(assessment.state, MATCH_STATE.PASS);

  const unknownSpec = compilePurchaseSpecification({
    ...maryJaneRequirement(),
    product_type: "尖头浅口低跟单鞋",
    product_family: "heels",
    item_name: "尖头浅口低跟单鞋",
    required_attributes: ["非明显运动"],
    avoid_attributes: [],
  });
  const unknown = evaluateCandidateAgainstSpecification({
    title: "女士尖头鞋",
    _category_text: "女鞋",
  }, unknownSpec);
  assert.equal(unknown.state, MATCH_STATE.UNKNOWN);
  assert.equal(unknown.report.needs_visual_verification, true);
});

test("relaxation never changes must or avoid constraints", () => {
  const spec = compilePurchaseSpecification(maryJaneRequirement());
  const preferredRelaxed = relaxedSpecification(spec, 1);
  const shouldRelaxed = relaxedSpecification(spec, 2);
  assert.deepEqual(preferredRelaxed.must_attributes, spec.must_attributes);
  assert.deepEqual(shouldRelaxed.must_attributes, spec.must_attributes);
  assert.deepEqual(preferredRelaxed.avoid_attributes, spec.avoid_attributes);
  assert.deepEqual(shouldRelaxed.avoid_attributes, spec.avoid_attributes);
  assert.deepEqual(preferredRelaxed.preferred_attributes, []);
  assert.deepEqual(shouldRelaxed.should_attributes, []);
});

test("exhausted candidates return an explicit no-core-match result", () => {
  const spec = compilePurchaseSpecification(maryJaneRequirement());
  const result = procurementResult([{
    title: "男士气垫跑步训练鞋",
    _category_text: "运动鞋",
  }], spec);
  assert.deepEqual(result.products, []);
  assert.equal(result.result_status, "empty");
  assert.equal(result.reason, NO_PRODUCT_MEETS_CORE_SPEC);
});

test("a black leather Mary Jane passes a feminine non-sport specification", () => {
  const spec = compilePurchaseSpecification(maryJaneRequirement());
  const assessment = evaluateCandidateAgainstSpecification({
    title: "女士黑色皮质低跟玛丽珍单鞋",
    _category_text: "女士单鞋",
  }, spec);
  assert.equal(assessment.state, MATCH_STATE.PASS);
  assert.equal(assessment.report.status, MATCH_STATE.PASS);
  assert.deepEqual(assessment.report.matched_conflict, []);
});

test("a thick sport Mary Jane is rejected with an explainable avoid conflict", () => {
  const spec = compilePurchaseSpecification(maryJaneRequirement({
    avoid_attributes: ["运动感", "厚底运动鞋", "老爹鞋"],
  }));
  const assessment = evaluateCandidateAgainstSpecification({
    title: "Skechers女士气垫厚底运动玛丽珍休闲鞋",
    _category_text: "女士运动休闲鞋",
  }, spec);
  assert.equal(assessment.state, MATCH_STATE.FAIL);
  assert.equal(assessment.report.status, MATCH_STATE.FAIL);
  assert.equal(assessment.report.reason, "avoid_conflict");
  assert.ok(assessment.report.matched_conflict.includes("厚底运动鞋"));
  assert.ok(assessment.report.matched_conflict.includes("气垫"));
});

test("a mature pointed heel is not mistaken for a sport conflict", () => {
  const spec = compilePurchaseSpecification({
    ...maryJaneRequirement(),
    product_type: "尖头细高跟鞋",
    product_family: "heels",
    item_name: "尖头细高跟鞋",
    required_attributes: [],
    avoid_attributes: ["运动感"],
  });
  const assessment = evaluateCandidateAgainstSpecification({
    title: "女士真皮尖头细高跟鞋成熟通勤单鞋",
    _category_text: "女士高跟鞋",
  }, spec);
  assert.notEqual(assessment.state, MATCH_STATE.FAIL);
  assert.deepEqual(assessment.report.matched_conflict, []);
});

test("an explicit sneaker specification does not reject sport shoes", () => {
  const spec = compilePurchaseSpecification({
    ...maryJaneRequirement(),
    product_type: "轻量跑步运动鞋",
    product_family: "sneakers",
    item_name: "轻量跑步运动鞋",
    required_attributes: [],
    avoid_attributes: [],
  });
  const assessment = evaluateCandidateAgainstSpecification({
    title: "女士网面轻量气垫跑步运动鞋",
    _category_text: "女士运动鞋",
  }, spec);
  assert.notEqual(assessment.state, MATCH_STATE.FAIL);
  assert.deepEqual(assessment.report.matched_conflict, []);
});

test("old-dad sneakers conflict with pointed low-vamp hard requirements", () => {
  const spec = compilePurchaseSpecification({
    ...maryJaneRequirement(),
    product_type: "白色透气老爹鞋",
    product_family: "sneakers",
    item_name: "白色透气老爹鞋",
    required_attributes: ["尖头", "浅口"],
    constraint_sources: [
      {value: "尖头", level: "required", source: "body_strategy"},
      {value: "浅口", level: "required", source: "body_strategy"},
    ],
  });
  assert.equal(spec.spec_consistency_status, SPEC_CONSISTENCY_STATUS.FAIL);
  assert.deepEqual(spec.search_queries, []);
  assert.ok(spec.spec_conflicts.some((conflict) =>
    conflict.code === "PRODUCT_TYPE_MUST_CONFLICT" &&
      conflict.attribute === "尖头"));
  assert.ok(spec.spec_conflicts.some((conflict) =>
    conflict.code === "PRODUCT_TYPE_MUST_CONFLICT" &&
      conflict.attribute === "浅口"));
});

test("pointed low-vamp shoes pass compatible hard requirements", () => {
  const spec = compilePurchaseSpecification({
    ...maryJaneRequirement(),
    product_type: "尖头浅口低跟单鞋",
    product_family: "pointed_flat",
    item_name: "尖头浅口低跟单鞋",
    required_attributes: ["尖头", "浅口"],
  });
  assert.equal(spec.spec_consistency_status, SPEC_CONSISTENCY_STATUS.PASS);
  assert.deepEqual(spec.spec_conflicts, []);
  assert.ok(spec.search_queries.length > 0);
});

test("a high-waist jogger contract is internally consistent", () => {
  const spec = compilePurchaseSpecification({
    ...maryJaneRequirement(),
    category: "bottom",
    product_type: "高腰束脚运动裤",
    product_family: "pants",
    item_name: "高腰束脚运动裤",
    fit: "高腰锥形束脚",
    required_attributes: ["高腰"],
    preferred_attributes: ["九分"],
    avoid_attributes: ["低腰"],
  });
  assert.equal(spec.spec_consistency_status, SPEC_CONSISTENCY_STATUS.PASS);
  assert.deepEqual(spec.spec_conflicts, []);
});
