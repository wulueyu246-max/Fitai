const assert = require("node:assert/strict");
const test = require("node:test");

const {
  canonicalizeAttribute,
  categoryForSlotRole,
  compileExecutableProductContract,
  inferProductFamily,
  isConcreteProductType,
  normalizeExecutableProductRequirement,
  normalizeNativeExecutableProductContract,
  splitAttributeValues,
  structuredBlueprintCandidates,
  validateExecutableProductContract,
} = require("../executable_product_requirement");

function compileConstraintCase({
  productType,
  fit = "",
  designElements = [],
  required = [],
  preferred = [],
  avoid = [],
  constraintSources = [],
  category = "bottom",
}) {
  return compileExecutableProductContract({
    slot_role: category,
    product_type: productType,
    style_role: "执行造型核心目标",
    fit,
    colors: [],
    materials: [],
    design_elements: designElements,
    required_attributes: required,
    preferred_attributes: preferred,
    avoid_attributes: avoid,
  }, {
    requestId: "attribute-semantics",
    lookId: "look-1",
    category,
    itemIndex: 0,
    constraintSources,
  });
}
const {
  translateBlueprintSearchRequirement,
} = require("../blueprint_search_translator");

function contract(overrides = {}, options = {}) {
  const requirement = {
    request_id: "request-003",
    look_id: "look-1",
    category: "top",
    slot_key: "request-003:look-1:top:0",
    gender: "female",
    item_name: "短款修身针织衫",
    fit: "短款修身",
    ...overrides,
  };
  return normalizeExecutableProductRequirement(requirement, {
    originalRequirement: options.originalRequirement || requirement,
    blueprint: options.blueprint || {},
  });
}

test("separates product type from styling role", () => {
  const result = contract({
    product_type: "短款修身针织衫",
    product_family: "knitwear",
    item_name: "法式浪漫比例优化风 · 高腰线上衣",
    style_role: "提高腰线、缩短上身视觉长度",
    colors: ["奶油白"],
    materials: ["细针织"],
  }, {
    originalRequirement: {
      request_id: "request-003",
      look_id: "look-1",
      category: "top",
      slot_key: "request-003:look-1:top:0",
      gender: "female",
      product_type: "短款修身针织衫",
      product_family: "knitwear",
      item_name: "法式浪漫比例优化风 · 高腰线上衣",
      style_role: "提高腰线、缩短上身视觉长度",
      fit: "短款修身",
      colors: ["奶油白"],
      materials: ["细针织"],
    },
  });
  const translated = translateBlueprintSearchRequirement(result);

  assert.equal(result.product_type, "短款修身针织衫");
  assert.equal(result.item_name, "短款修身针织衫");
  assert.equal(result.product_family, "knitwear");
  assert.equal(result.style_role, "提高腰线、缩短上身视觉长度");
  assert.doesNotMatch(
    translated.search_keywords.join(" "),
    /提高腰线|缩短上身|视觉长度/u,
  );
});

test("product family keeps skirt and wide-leg-pants Looks isolated", () => {
  const blueprint = {
    must_have_items: {
      bottom: ["高腰A字半身裙 或 高腰垂感阔腿裤"],
    },
  };
  const lookA = contract({
    look_id: "look-a",
    slot_key: "request-003:look-a:bottom:0",
    category: "bottom",
    product_type: "高腰A字半身裙",
    product_family: "skirt",
    item_name: "高腰A字半身裙",
    fit: "高腰A字",
  }, {blueprint});
  const lookB = contract({
    look_id: "look-b",
    slot_key: "request-003:look-b:bottom:0",
    category: "bottom",
    product_type: "高腰垂感阔腿裤",
    product_family: "wide_leg_pants",
    item_name: "高腰垂感阔腿裤",
    fit: "高腰直筒阔腿",
  }, {blueprint});

  assert.equal(lookA.product_family, "skirt");
  assert.equal(lookA.item_name, "高腰A字半身裙");
  assert.equal(lookB.product_family, "wide_leg_pants");
  assert.equal(lookB.item_name, "高腰垂感阔腿裤");
  assert.notEqual(lookA.slot_key, lookB.slot_key);
});

test("Blueprint alternatives become structured product-family candidates", () => {
  const candidates = structuredBlueprintCandidates({
    must_have_items: {
      bottom: ["高腰A字半身裙 或 高腰垂感阔腿裤"],
    },
  });
  assert.deepEqual(
    candidates.map((candidate) => ({
      product_type: candidate.product_type,
      product_family: candidate.product_family,
    })),
    [
      {product_type: "高腰A字半身裙", product_family: "skirt"},
      {product_type: "高腰垂感阔腿裤", product_family: "wide_leg_pants"},
    ],
  );
});

test("colors and materials are arrays and generate separate query variants", () => {
  const result = contract({
    category: "shoes",
    slot_key: "request-003:look-1:shoes:0",
    product_type: "尖头浅口低跟鞋",
    product_family: "pointed_flat",
    item_name: "尖头浅口低跟鞋",
    fit: "尖头浅口低跟",
    colors: ["裸色", "米白色"],
    materials: ["醋酸", "缎面"],
  });
  const translated = translateBlueprintSearchRequirement(result);

  assert.deepEqual(result.colors, ["裸色", "米白色"]);
  assert.deepEqual(result.materials, ["醋酸", "缎面"]);
  assert.ok(translated.search_keywords.some((query) => query.includes("裸色")));
  assert.ok(translated.search_keywords.some((query) => query.includes("米白色")));
  assert.ok(translated.search_keywords.some((query) => query.includes("醋酸")));
  assert.ok(translated.search_keywords.some((query) => query.includes("缎面")));
  assert.doesNotMatch(translated.search_keywords.join(" "), /裸色\/米白色|醋酸\/缎面/u);
});

test("abstract item names are rejected and recovered from structural fields", () => {
  assert.equal(
    isConcreteProductType("法式浪漫比例优化风 · 高腰线上衣", "top"),
    false,
  );
  const result = contract({
    product_type: "",
    product_family: "knitwear",
    item_name: "法式浪漫比例优化风 · 高腰线上衣",
    fit: "短款修身",
    material: "细针织",
  }, {
    blueprint: {
      must_have_items: {top: ["短款修身针织衫"]},
    },
  });
  assert.equal(result.product_type, "短款修身针织衫");
  assert.equal(result.item_name, "短款修身针织衫");
  assert.doesNotThrow(() => validateExecutableProductContract(result));
});

test("fit and product family conflicts are strict failures", () => {
  assert.throws(() => validateExecutableProductContract({
    request_id: "request-003",
    look_id: "look-2",
    category: "bottom",
    slot_key: "request-003:look-2:bottom:0",
    product_type: "高腰A字半身裙",
    product_family: "skirt",
    item_name: "高腰A字半身裙",
    style_role: "纵向延伸",
    fit: "高腰直筒阔腿",
    colors: [],
    materials: [],
    design_elements: [],
  }), /fit 与 product_family 冲突/u);
});

test("attribute normalization never keeps slash-joined values", () => {
  assert.deepEqual(splitAttributeValues("裸色/米白色"), ["裸色", "米白色"]);
  assert.deepEqual(splitAttributeValues("醋酸/缎面"), ["醋酸", "缎面"]);
});

test("Contract Compiler derives bottom family and splits color and material values", () => {
  const result = compileExecutableProductContract({
    slot_role: "bottom",
    product_type: "高腰垂感阔腿裤",
    style_role: "纵向延伸腿部线条",
    fit: "高腰垂感阔腿",
    colors: ["奶油白/燕麦色"],
    materials: ["醋酸/缎面"],
    design_elements: ["纵向延伸"],
    required_attributes: ["高腰", "纵向延伸"],
    preferred_attributes: [],
    avoid_attributes: [],
  }, {
    requestId: "compiler-request",
    lookId: "look-1",
    category: "bottom",
    itemIndex: 0,
    gender: "female",
    scene: "约会",
  });

  assert.equal(result.category, "bottom");
  assert.equal(result.product_family, "wide_leg_pants");
  assert.equal(result.item_name, "高腰垂感阔腿裤");
  assert.deepEqual(result.colors, ["奶油白", "燕麦色"]);
  assert.deepEqual(result.materials, ["醋酸", "缎面"]);
});

test("Contract Compiler derives skirt family from the product ontology", () => {
  const result = compileExecutableProductContract({
    slot_role: "bottom",
    product_type: "高腰A字半身裙",
    style_role: "提高腰线",
    fit: "高腰A字",
    colors: [],
    materials: [],
    design_elements: ["高腰"],
    required_attributes: ["高腰"],
    preferred_attributes: [],
    avoid_attributes: [],
  }, {
    requestId: "compiler-request",
    lookId: "look-1",
    category: "bottom",
    itemIndex: 1,
  });
  assert.equal(result.product_family, "skirt");
});

test("Contract Compiler rejects a product type outside its assigned slot", () => {
  assert.throws(() => compileExecutableProductContract({
    slot_role: "bottom",
    product_type: "短款针织衫",
    style_role: "缩短上身",
    fit: "短款修身",
    colors: [],
    materials: [],
    design_elements: ["短款"],
    required_attributes: ["短款"],
    preferred_attributes: [],
    avoid_attributes: [],
  }, {
    requestId: "compiler-request",
    lookId: "look-1",
    category: "bottom",
    itemIndex: 0,
  }), /product_type.*bottom slot/u);
});

test("Contract Compiler owns unique slot keys and ignores AI engineering fields", () => {
  const semantic = {
    slot_role: "bottom",
    category: "top",
    product_family: "knitwear",
    request_id: "ai-request",
    look_id: "ai-look",
    slot_key: "ai-slot",
    item_name: "AI item name",
    product_type: "高腰A字半身裙",
    style_role: "提高腰线",
    fit: "高腰A字",
    colors: [],
    materials: [],
    design_elements: ["高腰"],
    required_attributes: ["高腰"],
    preferred_attributes: [],
    avoid_attributes: [],
  };
  const first = compileExecutableProductContract(semantic, {
    requestId: "compiler-request",
    lookId: "look-1",
    category: "bottom",
    itemIndex: 0,
  });
  const second = compileExecutableProductContract(semantic, {
    requestId: "compiler-request",
    lookId: "look-1",
    category: "bottom",
    itemIndex: 1,
  });

  assert.equal(categoryForSlotRole("bottom"), "bottom");
  assert.equal(first.request_id, "compiler-request");
  assert.equal(first.look_id, "look-1");
  assert.equal(first.category, "bottom");
  assert.equal(first.product_family, "skirt");
  assert.equal(first.item_name, first.product_type);
  assert.equal(first.slot_key, "compiler-request:look-1:bottom:0");
  assert.equal(second.slot_key, "compiler-request:look-1:bottom:1");
  assert.notEqual(first.slot_key, second.slot_key);
});

test("Contract Compiler keeps skirt, wide-leg pants and dress Looks isolated", () => {
  const compile = (lookId, category, productType, fit) =>
    compileExecutableProductContract({
      slot_role: category,
      product_type: productType,
      style_role: "执行当前造型方向",
      fit,
      colors: [],
      materials: [],
      design_elements: [],
      required_attributes: [],
      preferred_attributes: [],
      avoid_attributes: [],
    }, {
      requestId: "compiler-three-looks",
      lookId,
      category,
      itemIndex: 0,
    });

  const skirt = compile("look-1", "bottom", "高腰A字半身裙", "高腰A字");
  const pants = compile("look-2", "bottom", "高腰垂感阔腿裤", "高腰阔腿");
  const dress = compile("look-3", "dress", "收腰A字连衣裙", "收腰A字");
  assert.deepEqual(
    [skirt.product_family, pants.product_family, dress.product_family],
    ["skirt", "wide_leg_pants", "dress"],
  );
  assert.deepEqual(
    [skirt.look_id, pants.look_id, dress.look_id],
    ["look-1", "look-2", "look-3"],
  );
});

test("Golden 003 body strategy remains metadata, not a product name", () => {
  const result = contract({
    product_type: "短款修身针织衫",
    product_family: "knitwear",
    item_name: "短款修身针织衫",
    fit: "短款不过胯",
    style_role: "提高腰线并缩短上身视觉长度",
    body_strategy: "纵向延伸腿部线条",
  });
  assert.equal(result.item_name, "短款修身针织衫");
  assert.equal(result.fit, "短款不过胯");
  assert.equal(result.body_strategy, "纵向延伸腿部线条");
});

test("family inference covers the executable contract examples", () => {
  assert.equal(inferProductFamily("bottom", "高腰A字半身裙"), "skirt");
  assert.equal(inferProductFamily("bottom", "高腰垂感阔腿裤"), "wide_leg_pants");
  assert.equal(inferProductFamily("shoes", "尖头浅口低跟鞋"), "pointed_flat");
});

test("Native Look requires body attributes to be executable, not explanatory", () => {
  const base = {
    request_id: "native-request",
    look_id: "native-look-1",
    category: "top",
    slot_key: "native-request:native-look-1:top:0",
    product_type: "修身针织衫",
    product_family: "knitwear",
    item_name: "修身针织衫",
    style_role: "缩短上半身视觉长度",
    fit: "常规长度修身",
    colors: ["奶油白"],
    materials: ["细针织"],
    design_elements: [],
    required_attributes: ["短款或不过胯"],
    preferred_attributes: [],
    avoid_attributes: [],
  };
  assert.throws(
    () => normalizeNativeExecutableProductContract(base, {
      expectedRequestId: "native-request",
      expectedLookId: "native-look-1",
      expectedCategory: "top",
    }),
    /required_attributes/u,
  );

  const result = normalizeNativeExecutableProductContract({
    ...base,
    product_type: "短款修身针织衫",
    item_name: "短款修身针织衫",
    fit: "短款修身不过胯",
  }, {
    expectedRequestId: "native-request",
    expectedLookId: "native-look-1",
    expectedCategory: "top",
  });
  assert.equal(result.contract.product_type, "短款修身针织衫");
  assert.equal(result.contract.item_name, result.contract.product_type);
  assert.equal(result.repaired, false);
});

test("Native Look only normalizes missing empty arrays and preserves legal core items", () => {
  const result = normalizeNativeExecutableProductContract({
    request_id: "native-request",
    look_id: "native-look-2",
    category: "shoes",
    slot_key: "native-request:native-look-2:shoes:2",
    product_type: "尖头浅口低跟鞋",
    product_family: "pointed_flat",
    item_name: "尖头浅口低跟鞋",
    style_role: "延长腿部线条",
    fit: "尖头浅口低跟",
    required_attributes: [],
    preferred_attributes: ["浅口", "尖头", "低跟"],
    avoid_attributes: ["厚重高帮"],
  }, {
    expectedRequestId: "native-request",
    expectedLookId: "native-look-2",
    expectedCategory: "shoes",
  });
  assert.equal(result.repaired, true);
  assert.equal(result.contract.product_type, "尖头浅口低跟鞋");
  assert.deepEqual(result.contract.colors, []);
  assert.deepEqual(result.contract.materials, []);
  assert.deepEqual(result.contract.design_elements, []);
});

test("Attribute Semantics accepts an evidenced high-waist hard constraint", () => {
  const result = compileConstraintCase({
    productType: "高腰直筒裤",
    fit: "高腰直筒",
    required: ["高腰"],
    constraintSources: [
      {value: "高腰", level: "required", source: "body_strategy"},
    ],
  });
  assert.deepEqual(result.required_attributes, ["高腰"]);
  assert.equal(result.constraint_sources[0].source, "body_strategy");
});

test("Attribute Semantics rejects a low-waist item when high waist is required", () => {
  assert.throws(() => compileConstraintCase({
    productType: "低腰阔腿裤",
    fit: "低腰阔腿",
    required: ["高腰"],
    constraintSources: [
      {value: "高腰", level: "required", source: "body_strategy"},
    ],
  }), /required_attributes/u);
});

test("Attribute Semantics records missing preferred attributes without rejecting", () => {
  const result = compileConstraintCase({
    productType: "高腰直筒裤",
    fit: "高腰直筒",
    preferred: ["纵向垂感"],
    constraintSources: [
      {value: "纵向垂感", level: "preferred", source: "body_strategy"},
    ],
  });
  assert.deepEqual(result.missing_preferred_attributes, ["纵向垂感"]);
  assert.equal(result.preferred_match_score, 0);
});

test("Attribute Semantics downgrades an AI-only high-elasticity hard constraint", () => {
  const result = compileConstraintCase({
    productType: "高腰直筒裤",
    fit: "高腰直筒",
    required: ["高弹"],
  });
  assert.deepEqual(result.required_attributes, []);
  assert.deepEqual(result.preferred_attributes, ["高弹"]);
  assert.deepEqual(result.missing_preferred_attributes, ["高弹"]);
  assert.equal(result.preferred_match_score, 0);
  assert.ok(result.constraint_sources.some((entry) =>
    entry.value === "高弹" && entry.level === "preferred" &&
    entry.source === "look_ai"));
});

test("Attribute Semantics rejects a regular-length top when short is required", () => {
  assert.throws(() => compileConstraintCase({
    category: "top",
    productType: "法式方领修身针织衫",
    fit: "常规长度修身",
    required: ["短款"],
    constraintSources: [
      {value: "短款", level: "required", source: "body_strategy"},
    ],
  }), /required_attributes/u);
});

test("Attribute Semantics accepts a short top and canonicalizes stable synonyms", () => {
  const result = compileConstraintCase({
    category: "top",
    productType: "法式方领短款修身针织衫",
    fit: "不过胯修身",
    required: ["短款或不过胯"],
    constraintSources: [
      {value: "短款或不过胯", level: "required", source: "body_strategy"},
    ],
  });
  assert.equal(canonicalizeAttribute("cropped"), "short_length");
  assert.equal(canonicalizeAttribute("不过胯"), "short_length");
  assert.deepEqual(result.missing_preferred_attributes, []);
  assert.deepEqual(result.required_attribute_constraints, [{
    key: "top_length",
    mode: "any_of",
    values: ["短款", "不过胯"],
    level: "required",
  }]);
});

test("Attribute Semantics warns when hard evidence is absent but not contradicted", () => {
  const result = compileConstraintCase({
    category: "top",
    productType: "法式方领修身针织衫",
    fit: "修身",
    required: ["短款"],
    constraintSources: [
      {value: "短款", level: "required", source: "body_strategy"},
    ],
  });
  assert.deepEqual(result.missing_required_attributes, ["短款"]);
  assert.ok(result.warnings.some((warning) => warning.includes("短款")));
});
