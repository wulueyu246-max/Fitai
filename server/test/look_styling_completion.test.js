"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  calculateLookStylingCompleteness,
  compileOptionalStylingRequirements,
  completePortfolioStyling,
  diagnoseStylingCompletion,
  selectStylingCompletion,
} = require("../look_styling_completion");
const {runSharedCandidatePipeline} = require("../product_provider");
const {STYLING_COMPLETION_AUTHORITY} = require("../product_relevance");

const OPTIONAL_SLOTS = Object.freeze([
  "bag",
  "socks",
  "hosiery",
  "accessory",
  "belt",
  "outerwear",
  "headwear",
]);
const DIAGNOSIS_DIMENSIONS = Object.freeze([
  "visual_hierarchy",
  "color_echo",
  "styling_depth",
  "focal_point",
  "leg_styling",
  "bag_integration",
  "accessory_need",
  "layering_need",
  "contemporary_expression",
  "over_styling_risk",
]);

function product(id, category, title, overrides = {}) {
  return {
    id,
    product_id: id,
    candidate_id: id,
    look_id: overrides.look_id || "completion-look",
    concept_id: overrides.concept_id || "completion-concept",
    source: "taobao",
    is_mock: false,
    title,
    name: title,
    brand: "Contract Fixture",
    category,
    original_category: category,
    subcategory: overrides.subcategory || "",
    search_subcategory: overrides.search_subcategory || overrides.subcategory || "",
    slot: overrides.slot || overrides.subcategory || category,
    ...(OPTIONAL_SLOTS.includes(overrides.slot)
      ? {styling_completion_slot: overrides.slot}
      : {}),
    gender: overrides.gender || "female",
    original_gender: overrides.gender || "female",
    price: overrides.price ?? 239,
    color: overrides.color || "black",
    color_label: overrides.color || "black",
    material: overrides.material || "cotton blend",
    style: overrides.style || "refined",
    style_tags: overrides.style_tags || ["refined", "contemporary"],
    occasion_tags: overrides.occasion_tags || ["date", "nightlife"],
    silhouette: overrides.silhouette || "balanced",
    fit: overrides.fit || "balanced",
    quality_tier: overrides.quality_tier || "mid",
    image_url: `https://img.example.com/${id}.jpg`,
    detail_url: `https://item.example.com/${id}`,
    product_acceptance_result: overrides.product_acceptance_result || "PASS",
    product_acceptance_penalty: overrides.product_acceptance_penalty ?? 0,
    product_acceptance_evidence: overrides.product_acceptance_evidence || {
      audience_fit: {value: "match", confidence: 0.9, source: "product_text"},
      contemporary_fit: {value: "match", confidence: 0.88, source: "product_text"},
      occasion_fit: {value: "match", confidence: 0.86, source: "product_text"},
      desired_impression_fit: {
        value: "match", confidence: 0.86, source: "product_text",
      },
      visual_quality: {value: "good", confidence: 0.84, source: "image"},
    },
    relevance_score: overrides.relevance_score ?? 88,
    aesthetic_score: overrides.aesthetic_score ?? 84,
    final_score: overrides.final_score ?? 86,
    body_strategy_match_score: overrides.body_strategy_match_score ?? 74,
    ...overrides,
  };
}

function goldenCoreLook(overrides = {}) {
  return {
    look_id: "completion-look",
    concept_id: "completion-concept",
    gender: "female",
    scene: "nightlife",
    style: "",
    selected_products: [
      product("golden-top", "top", "浅色设计感短款方领上衣", {
        color: "ivory",
        style_tags: ["designed", "cropped", "square_neck", "contemporary"],
        silhouette: "cropped_fitted",
      }),
      product("golden-skirt", "bottom", "浅色学院风高腰百褶半身裙", {
        color: "beige",
        subcategory: "skirt",
        slot: "bottom",
        style_tags: ["academy", "high_waist", "pleated", "youthful"],
        silhouette: "high_waist_a_line",
      }),
      product("golden-shoes", "shoes", "黑色厚底乐福鞋", {
        color: "black",
        subcategory: "loafer",
        style_tags: ["chunky", "loafer", "contemporary"],
        silhouette: "chunky_low_cut",
      }),
    ],
    ...overrides,
  };
}

function contract(overrides = {}) {
  return {
    look_id: "completion-look",
    concept_id: "completion-concept",
    gender: "female",
    scene: "nightlife",
    concept_name: "轻量表达",
    concept_summary: "年轻、轻松、有设计感，但不过度正式",
    aesthetic_target_profile: {
      color_intensity: 0.5,
      formality: 0.35,
      quality_tier: 0.64,
      focal_hierarchy: {strength: 0.7, max_focal_points: 2},
      legwear_profile: {
        formality: 0.42,
        opacity: 0.48,
        style_expression: 0.68,
      },
      accessory_profile: {
        statement_strength: 0.62,
        quality: 0.68,
        utility: 0.42,
      },
      layering_profile: {complexity: 0.42, structure: 0.54},
      silhouette_profile: {waist_emphasis: 0.72, verticality: 0.64},
      accessory_targets: {
        statement_strength: 0.62,
        quality: 0.68,
        utility: 0.42,
      },
      layering_targets: {complexity: 0.42, structure: 0.54},
      silhouette_targets: {waist_emphasis: 0.72, verticality: 0.64},
      legwear_targets: {
        formality: 0.42,
        opacity: 0.48,
        style_expression: 0.68,
      },
      dimensions: {
        minimalism: 0.34,
        youthfulness: 0.74,
        structure: 0.58,
        romantic: 0.48,
      },
    },
    ...overrides,
  };
}

function decisionContext(overrides = {}) {
  return {
    request_id: "77777777-7777-4777-8777-777777777777",
    raw_user_input: "今晚和朋友出去玩，年轻一点，有点设计感，别太正式",
    user_truth: {
      gender: "female",
      scene: "nightlife",
      explicit_avoid: ["overly_formal"],
      budget: {item: 800, outfit: 1800},
    },
    intent: {
      user_intent_brain: {
        desired_impression: {
          value: ["youthful", "designed", "relaxed"],
          source: "user",
          confidence: 1,
        },
        explicit_avoid: {
          value: ["overly_formal"], source: "user", confidence: 1,
        },
        formality_preference: {
          value: "relaxed", source: "user", confidence: 0.95,
        },
      },
    },
    body_fit_profile: {
      version: "body_fit_intelligence.v1",
      mode: "SOFT_PRODUCTION_SIGNAL",
      silhouette_preferences: ["waist_emphasis", "vertical_continuity"],
      recommendations: {
        waistline: "defined",
        vertical_balance: "elongate",
        bag_scale: "compact",
      },
      optional_styling: {
        leg_line_continuity: {value: 0.7, confidence: 0.72},
        bag_scale: {value: "small_to_medium", confidence: 0.68},
      },
    },
    style_targets: [{
      concept_id: "completion-concept",
      aesthetic_target_profile: contract().aesthetic_target_profile,
    }],
    ...overrides,
  };
}

function assertMetric(metric, name) {
  assert.equal(typeof metric, "object", `${name} must be structured`);
  assert.equal(Number.isFinite(metric.score), true, `${name}.score`);
  assert.equal(metric.score >= 0 && metric.score <= 100, true, `${name}.score range`);
  assert.equal(typeof metric.reason, "string", `${name}.reason`);
  assert.equal(metric.reason.length > 0, true, `${name}.reason nonempty`);
  assert.equal(Number.isFinite(metric.confidence), true, `${name}.confidence`);
  assert.equal(metric.confidence >= 0 && metric.confidence <= 1, true,
    `${name}.confidence range`);
}

function optionalProducts() {
  return [
    product("optional-bag", "bag", "黑色小号结构感单肩包", {
      slot: "bag",
      color: "black",
      material: "leather",
      style_tags: ["compact", "structured", "contemporary"],
      final_score: 91,
    }),
    product("optional-hosiery", "accessory", "轻薄深色连裤袜", {
      slot: "hosiery",
      subcategory: "hosiery",
      search_subcategory: "hosiery",
      color: "charcoal",
      material: "fine knit",
      style_tags: ["fine", "leg_line", "subtle"],
      final_score: 88,
    }),
    product("optional-socks", "accessory", "精细罗纹中筒袜", {
      slot: "socks",
      subcategory: "socks",
      search_subcategory: "socks",
      color: "black",
      style_tags: ["fine", "ribbed", "leg_line"],
      final_score: 84,
    }),
    product("optional-necklace", "accessory", "小体量金属项链", {
      slot: "accessory",
      subcategory: "jewelry",
      color: "silver",
      material: "metal",
      style_tags: ["subtle", "focal_detail", "contemporary"],
      final_score: 82,
    }),
  ];
}

test("Golden core Look gets structured diagnosis and a dynamic completion plan", () => {
  const look = goldenCoreLook();
  const context = decisionContext();
  const lookContract = contract();
  const diagnosis = diagnoseStylingCompletion({
    look,
    decisionContext: context,
    contract: lookContract,
  });

  assert.equal(diagnosis.look_id, look.look_id);
  assert.equal(diagnosis.completion_action, "PLAN");
  for (const dimension of DIAGNOSIS_DIMENSIONS) {
    assertMetric(diagnosis.dimensions[dimension], dimension);
  }
  const partitioned = [
    ...diagnosis.required_optional_slots,
    ...diagnosis.recommended_optional_slots,
    ...diagnosis.unnecessary_slots,
  ];
  assert.deepEqual([...new Set(partitioned)].sort(), [...OPTIONAL_SLOTS].sort());
  assert.equal(diagnosis.dimensions.styling_depth.score < 80, true);
  assert.equal(diagnosis.dimensions.color_echo.score < 80, true);
  assert.equal(diagnosis.dimensions.leg_styling.score < 80, true);

  const requirements = compileOptionalStylingRequirements({
    look,
    diagnosis,
    decisionContext: context,
    contract: lookContract,
  });
  assert.equal(Array.isArray(requirements), true);
  assert.equal(requirements.length > 0, true);
  assert.equal(requirements.every((item) =>
    item.look_id.startsWith(`${look.look_id}:completion:`) &&
      item.styling_completion_parent_look_id === look.look_id &&
      OPTIONAL_SLOTS.includes(item.styling_completion_slot) &&
      (item.styling_completion_required === true ||
        item.styling_completion_recommended === true)), true);
  const plannedSlots = requirements.map((item) =>
    item.styling_completion_slot);
  assert.equal(plannedSlots.some((slot) =>
    ["bag", "hosiery", "socks", "accessory"].includes(slot)), true);
  assert.equal(plannedSlots.length <= diagnosis.max_optional_items + 1, true);
});

test("all seven optional styling slots compile to concrete non-colliding commerce contracts", () => {
  const look = goldenCoreLook();
  const base = diagnoseStylingCompletion({
    look,
    decisionContext: decisionContext(),
    contract: contract(),
  });
  const expected = {
    bag: ["bag", "bag"],
    socks: ["accessory", "socks"],
    hosiery: ["accessory", "socks"],
    accessory: ["accessory", "jewelry"],
    belt: ["accessory", "belt"],
    outerwear: ["outerwear", ""],
    headwear: ["hat", "hat"],
  };

  for (const slot of OPTIONAL_SLOTS) {
    const requirements = compileOptionalStylingRequirements({
      look,
      diagnosis: {
        ...base,
        completion_action: "PLAN",
        required_optional_slots: [],
        recommended_optional_slots: [slot],
        unnecessary_slots: OPTIONAL_SLOTS.filter((item) => item !== slot),
        max_optional_items: 1,
      },
      decisionContext: decisionContext(),
      contract: contract(),
    });
    assert.equal(requirements.length, 1, slot);
    assert.deepEqual(
      [requirements[0].category, requirements[0].search_subcategory],
      expected[slot],
      slot,
    );
    assert.equal(requirements[0].look_id,
      `${look.look_id}:completion:${slot}`);
    assert.equal(requirements[0].styling_completion_slot, slot);
    assert.equal(requirements[0].search_keywords.length, 2);
    assert.equal(requirements[0].search_keywords.every((query) =>
      /^[男女中]/u.test(query) && !/(?:hosiery|headwear|belt)\b/iu.test(query)), true);
  }
});

test("Golden completion raises explainable score without changing core candidates", () => {
  const look = goldenCoreLook();
  const context = decisionContext();
  const diagnosis = diagnoseStylingCompletion({
    look, decisionContext: context, contract: contract(),
  });
  const before = calculateLookStylingCompleteness({
    look, optionalProducts: [], decisionContext: context,
  });
  const result = selectStylingCompletion({
    look,
    diagnosis,
    candidates: optionalProducts(),
    decisionContext: context,
  });

  assert.equal(result.completion_action, "ADD");
  assert.equal(result.core_unchanged, true);
  assert.deepEqual(result.core_candidate_ids_before, {
    top: "golden-top",
    bottom: "golden-skirt",
    shoes: "golden-shoes",
  });
  assert.deepEqual(result.core_candidate_ids_after, result.core_candidate_ids_before);
  assert.equal(result.before_score, before.score);
  assert.equal(result.after_score > result.before_score, true);
  assert.equal(result.score_delta > 0, true);
  assert.equal(result.selected_optional_products.length > 0, true);
  assert.equal(result.selected_optional_products.length <= diagnosis.max_optional_items, true);
  assert.equal(result.selected_optional_products.every((item) =>
    item.source === "taobao" && item.is_mock === false), true);
  assert.equal(result.selected_optional_candidate_ids.includes("golden-top"), false);
});

test("a new color cannot earn an echo bonus by matching itself", () => {
  const look = goldenCoreLook({
    selected_products: [
      product("echo-top", "top", "白色设计感短上衣", {color: "white"}),
      product("echo-skirt", "bottom", "白色高腰百褶裙", {
        color: "white", subcategory: "skirt", slot: "bottom",
      }),
      product("echo-shoes", "shoes", "黑色厚底乐福鞋", {
        color: "black", subcategory: "loafer",
      }),
    ],
  });
  const ctx = decisionContext();
  const baseDiagnosis = diagnoseStylingCompletion({
    look, decisionContext: ctx, contract: contract(),
  });
  const diagnosis = {
    ...baseDiagnosis,
    completion_action: "PLAN",
    required_optional_slots: [],
    recommended_optional_slots: ["bag"],
    unnecessary_slots: OPTIONAL_SLOTS.filter((slot) => slot !== "bag"),
    max_optional_items: 1,
  };
  const red = product("echo-red-bag", "bag", "红色结构感单肩包", {
    slot: "bag", color: "red", final_score: 96,
  });
  const black = product("echo-black-bag", "bag", "黑色结构感单肩包", {
    slot: "bag", color: "black", final_score: 84,
  });
  const before = calculateLookStylingCompleteness({
    look, decisionContext: ctx, contract: contract(),
  });
  const redAfter = calculateLookStylingCompleteness({
    look, optionalProducts: [red], decisionContext: ctx, contract: contract(),
  });
  const result = selectStylingCompletion({
    look,
    diagnosis,
    candidates: [red, black],
    decisionContext: ctx,
    contract: contract(),
  });

  assert.equal(redAfter.dimensions.color_echo <= before.dimensions.color_echo, true);
  assert.deepEqual(result.selected_optional_candidate_ids, ["echo-black-bag"]);
});

test("a complete restrained Look may choose NONE and never exceeds one optional item", () => {
  const look = goldenCoreLook({
    look_id: "minimal-complete",
    concept_id: "minimal-complete-concept",
    selected_products: [
      product("minimal-top", "top", "结构清晰的黑色合身针织上衣", {
        look_id: "minimal-complete", concept_id: "minimal-complete-concept",
        color: "black", style_tags: ["minimal", "structured", "focal"],
      }),
      product("minimal-bottom", "bottom", "象牙白高腰直筒长裤", {
        look_id: "minimal-complete", concept_id: "minimal-complete-concept",
        color: "ivory", style_tags: ["minimal", "high_waist", "tailored"],
      }),
      product("minimal-shoes", "shoes", "黑色极简低帮乐福鞋", {
        look_id: "minimal-complete", concept_id: "minimal-complete-concept",
        color: "black", style_tags: ["minimal", "refined", "low_cut"],
      }),
    ],
  });
  const minimalContract = contract({
    look_id: look.look_id,
    concept_id: look.concept_id,
    aesthetic_target_profile: {
      ...contract().aesthetic_target_profile,
      focal_hierarchy: {strength: 0.32, max_focal_points: 1},
      accessory_profile: {statement_strength: 0.18, utility: 0.3, quality: 0.62},
      layering_profile: {complexity: 0.18, structure: 0.7},
      accessory_targets: {statement_strength: 0.18, utility: 0.3, quality: 0.62},
      layering_targets: {complexity: 0.18, structure: 0.7},
      dimensions: {minimalism: 0.94, structure: 0.75, youthfulness: 0.45},
    },
  });
  const diagnosis = diagnoseStylingCompletion({
    look,
    decisionContext: decisionContext({
      style_targets: [{
        concept_id: look.concept_id,
        aesthetic_target_profile: minimalContract.aesthetic_target_profile,
      }],
    }),
    contract: minimalContract,
  });

  assert.equal(diagnosis.completion_action === "NONE" ||
    diagnosis.max_optional_items <= 1, true);
  assert.equal(diagnosis.required_optional_slots.length, 0);
  const result = selectStylingCompletion({
    look,
    diagnosis,
    candidates: [product("minimal-noisy-chain", "accessory", "夸张多层彩色大项链", {
      look_id: look.look_id,
      concept_id: look.concept_id,
      slot: "accessory",
      subcategory: "jewelry",
      color: "multicolor",
      style_tags: ["maximal", "oversized", "multi_layer", "statement"],
    })],
    decisionContext: decisionContext(),
  });
  assert.equal(result.selected_optional_products.length <= 1, true);
});

test("formal completion does not inject a street headwear candidate", () => {
  const look = goldenCoreLook({
    look_id: "formal-look",
    concept_id: "formal-concept",
    gender: "male",
    scene: "formal_event",
    selected_products: [
      product("formal-top", "top", "男士精纺正式衬衫", {
        look_id: "formal-look", concept_id: "formal-concept", gender: "male",
        color: "white", style_tags: ["formal", "tailored", "refined"],
      }),
      product("formal-bottom", "bottom", "男士深色精裁西裤", {
        look_id: "formal-look", concept_id: "formal-concept", gender: "male",
        color: "navy", style_tags: ["formal", "tailored", "structured"],
      }),
      product("formal-shoes", "shoes", "男士黑色牛津正装鞋", {
        look_id: "formal-look", concept_id: "formal-concept", gender: "male",
        color: "black", style_tags: ["formal", "oxford", "refined"],
      }),
    ],
  });
  const formalTarget = {
    ...contract().aesthetic_target_profile,
    formality: 0.95,
    focal_hierarchy: {strength: 0.35, max_focal_points: 1},
    accessory_profile: {statement_strength: 0.24, quality: 0.88, utility: 0.25},
    accessory_targets: {statement_strength: 0.24, quality: 0.88, utility: 0.25},
    layering_targets: {complexity: 0.2, structure: 0.9},
    dimensions: {minimalism: 0.72, structure: 0.9, maturity: 0.72},
  };
  const ctx = decisionContext({
    user_truth: {gender: "male", scene: "formal_event", budget: {}},
    style_targets: [{concept_id: look.concept_id, aesthetic_target_profile: formalTarget}],
  });
  const diagnosis = diagnoseStylingCompletion({
    look,
    decisionContext: ctx,
    contract: contract({
      look_id: look.look_id,
      concept_id: look.concept_id,
      gender: "male",
      scene: "formal_event",
      aesthetic_target_profile: formalTarget,
    }),
  });
  const forcedDiagnosis = {
    ...diagnosis,
    completion_action: "PLAN",
    required_optional_slots: [],
    recommended_optional_slots: ["headwear", "bag"],
    unnecessary_slots: OPTIONAL_SLOTS.filter((slot) =>
      !["headwear", "bag"].includes(slot)),
    max_optional_items: 2,
  };
  const result = selectStylingCompletion({
    look,
    diagnosis: forcedDiagnosis,
    candidates: [
      product("formal-street-cap", "hat", "宽檐街头涂鸦棒球帽", {
        look_id: look.look_id, concept_id: look.concept_id, gender: "male",
        slot: "headwear", subcategory: "cap", color: "red",
        style_tags: ["street", "sporty", "graffiti", "oversized"],
      }),
      product("formal-bag", "bag", "深色小号结构公文包", {
        look_id: look.look_id, concept_id: look.concept_id, gender: "male",
        slot: "bag", color: "navy", style_tags: ["formal", "structured", "refined"],
      }),
    ],
    decisionContext: ctx,
  });
  assert.equal(result.selected_optional_candidate_ids.includes("formal-street-cap"), false);
  assert.equal(result.rejected_candidates.some((entry) =>
    entry.candidate_id === "formal-street-cap" &&
      entry.reason === "OPTIONAL_CANDIDATE_NOT_QUALITY_VALID"), true);
});

test("legwear need is inferred from the actual silhouette gap, not female gender or a style name", () => {
  const skirtLook = goldenCoreLook({style: ""});
  const skirtDiagnosis = diagnoseStylingCompletion({
    look: skirtLook,
    decisionContext: decisionContext(),
    contract: contract({style: ""}),
  });
  const skirtLegSlots = [
    ...skirtDiagnosis.required_optional_slots,
    ...skirtDiagnosis.recommended_optional_slots,
  ].filter((slot) => ["socks", "hosiery"].includes(slot));
  assert.equal(skirtLegSlots.length > 0, true);

  const pantsLook = goldenCoreLook({
    style: "",
    selected_products: [
      product("pants-top", "top", "浅色短款结构上衣", {color: "ivory"}),
      product("pants-bottom", "bottom", "黑色高腰及地直筒长裤", {
        color: "black", subcategory: "pants", silhouette: "full_length_straight",
      }),
      product("pants-shoes", "shoes", "黑色低帮乐福鞋", {
        color: "black", subcategory: "loafer",
      }),
    ],
  });
  const pantsDiagnosis = diagnoseStylingCompletion({
    look: pantsLook,
    decisionContext: decisionContext(),
    contract: contract({style: ""}),
  });
  const pantsLegSlots = [
    ...pantsDiagnosis.required_optional_slots,
    ...pantsDiagnosis.recommended_optional_slots,
  ].filter((slot) => ["socks", "hosiery"].includes(slot));
  assert.equal(pantsLegSlots.length < skirtLegSlots.length, true);
});

test("waist and utility dimensions can recommend belt or bag without a canonical style conditional", () => {
  const look = goldenCoreLook({
    look_id: "dimension-led-look",
    concept_id: "dimension-led-concept",
    gender: "male",
    style: "",
    selected_products: [
      product("dimension-top", "top", "男士有纹理短夹克", {
        look_id: "dimension-led-look", concept_id: "dimension-led-concept",
        gender: "male", color: "brown", style_tags: ["textured", "workwear"],
      }),
      product("dimension-bottom", "bottom", "男士高腰直筒丹宁裤", {
        look_id: "dimension-led-look", concept_id: "dimension-led-concept",
        gender: "male", color: "indigo", style_tags: ["high_waist", "denim"],
      }),
      product("dimension-shoes", "shoes", "男士棕色皮革短靴", {
        look_id: "dimension-led-look", concept_id: "dimension-led-concept",
        gender: "male", color: "brown", style_tags: ["boots", "textured"],
      }),
    ],
  });
  const dimensionTarget = {
    ...contract().aesthetic_target_profile,
    accessory_profile: {statement_strength: 0.48, quality: 0.66, utility: 0.86},
    silhouette_profile: {waist_emphasis: 0.86, verticality: 0.5},
    accessory_targets: {statement_strength: 0.48, quality: 0.66, utility: 0.86},
    silhouette_targets: {waist_emphasis: 0.86, verticality: 0.7},
    focal_hierarchy: {strength: 0.56, max_focal_points: 2},
    dimensions: {minimalism: 0.42, structure: 0.62, masculinity: 0.76},
  };
  const ctx = decisionContext({
    user_truth: {gender: "male", scene: "daily", budget: {}},
    style_targets: [{
      concept_id: look.concept_id,
      aesthetic_target_profile: dimensionTarget,
    }],
  });
  const diagnosis = diagnoseStylingCompletion({
    look,
    decisionContext: ctx,
    contract: contract({
      look_id: look.look_id,
      concept_id: look.concept_id,
      gender: "male",
      scene: "daily",
      style: "",
      aesthetic_target_profile: dimensionTarget,
    }),
  });
  const planned = [
    ...diagnosis.required_optional_slots,
    ...diagnosis.recommended_optional_slots,
  ];
  assert.equal(planned.some((slot) => ["belt", "bag"].includes(slot)), true);
});

test("an over-styling candidate is rejected when it does not improve completeness", () => {
  const look = goldenCoreLook({
    look_id: "already-layered-look",
    concept_id: "already-layered-concept",
    selected_products: [
      product("layered-top", "top", "立体褶裥金属扣设计上衣", {
        look_id: "already-layered-look", concept_id: "already-layered-concept",
        color: "black", style_tags: ["statement", "draped", "metal_detail", "focal"],
      }),
      product("layered-bottom", "bottom", "拼接不对称百褶裙", {
        look_id: "already-layered-look", concept_id: "already-layered-concept",
        color: "black", subcategory: "skirt",
        style_tags: ["statement", "asymmetric", "pleated", "focal"],
      }),
      product("layered-shoes", "shoes", "金属装饰厚底乐福鞋", {
        look_id: "already-layered-look", concept_id: "already-layered-concept",
        color: "black", style_tags: ["metal_detail", "chunky", "focal"],
      }),
    ],
  });
  const ctx = decisionContext();
  const overContract = contract({
    look_id: look.look_id,
    concept_id: look.concept_id,
    aesthetic_target_profile: {
      ...contract().aesthetic_target_profile,
      focal_hierarchy: {strength: 0.7, max_focal_points: 1},
    },
  });
  const diagnosis = diagnoseStylingCompletion({
    look, decisionContext: ctx, contract: overContract,
  });
  const forcedDiagnosis = {
    ...diagnosis,
    completion_action: "PLAN",
    required_optional_slots: [],
    recommended_optional_slots: ["accessory"],
    unnecessary_slots: OPTIONAL_SLOTS.filter((slot) => slot !== "accessory"),
    max_optional_items: 1,
  };
  const result = selectStylingCompletion({
    look,
    diagnosis: forcedDiagnosis,
    candidates: [product("layered-extra", "accessory", "超大多彩叠戴装饰项链", {
      look_id: look.look_id,
      concept_id: look.concept_id,
      slot: "accessory",
      subcategory: "jewelry",
      color: "multicolor",
      style_tags: ["oversized", "maximal", "multi_layer", "statement", "focal"],
      final_score: 95,
    })],
    decisionContext: ctx,
    contract: overContract,
  });
  assert.equal(result.selected_optional_candidate_ids.includes("layered-extra"), false);
  assert.equal(result.rejected_candidates.some((entry) =>
    entry.candidate_id === "layered-extra" &&
      entry.reason === "OVER_STYLING_RISK"), true);
  assert.equal(result.after_score >= result.before_score, true);
  assert.equal(result.core_unchanged, true);
});

test("BodyFit optional styling evidence softly changes completion scoring", () => {
  const look = goldenCoreLook();
  const hosiery = optionalProducts().find((item) =>
    item.styling_completion_slot === "hosiery");
  const withBody = decisionContext();
  const withoutBody = decisionContext({
    body_fit_profile: {
      version: "body_fit_intelligence.v1",
      mode: "SOFT_PRODUCTION_SIGNAL",
      recommendations: {},
      optional_styling: {},
    },
  });
  const supported = calculateLookStylingCompleteness({
    look,
    optionalProducts: [hosiery],
    decisionContext: withBody,
    contract: contract(),
  });
  const neutral = calculateLookStylingCompleteness({
    look,
    optionalProducts: [hosiery],
    decisionContext: withoutBody,
    contract: contract(),
  });

  assert.equal(
    supported.dimensions.body_integration > neutral.dimensions.body_integration,
    true,
  );
});

test("low-quality optional products never displace or contaminate the accepted core Look", () => {
  const look = goldenCoreLook();
  const coreIds = {
    top: "golden-top",
    bottom: "golden-skirt",
    shoes: "golden-shoes",
  };
  const ctx = decisionContext();
  const diagnosis = diagnoseStylingCompletion({
    look, decisionContext: ctx, contract: contract(),
  });
  const result = selectStylingCompletion({
    look,
    diagnosis,
    candidates: [
      product("bad-mask", "accessory", "户外功能防晒面罩", {
        slot: "accessory",
        product_acceptance_result: "HARD_REJECT",
        product_acceptance_penalty: 100,
        product_acceptance_evidence: {
          product_identity_confidence: {
            value: "non_fashion_functional", confidence: 0.99, source: "title",
          },
        },
      }),
      product("bad-bag", "bag", "低清无品类说明杂物袋", {
        slot: "bag",
        product_acceptance_result: "SOFT_REJECT",
        product_acceptance_penalty: 65,
        relevance_score: 38,
        aesthetic_score: 20,
        final_score: 22,
        product_acceptance_evidence: {
          visual_quality: {value: "low", confidence: 0.96, source: "image"},
        },
      }),
    ],
    decisionContext: ctx,
  });
  assert.equal(result.completion_action, "NONE");
  assert.deepEqual(result.selected_optional_products, []);
  assert.deepEqual(result.core_candidate_ids_before, coreIds);
  assert.deepEqual(result.core_candidate_ids_after, coreIds);
  assert.equal(result.core_unchanged, true);
  assert.equal(result.after_score, result.before_score);
});

test("optional requirements still execute shared relevance, acceptance gate, and reranker", async () => {
  const requirement = {
    look_id: "optional-pipeline-look",
    concept_id: "optional-pipeline-concept",
    category: "bag",
    styling_slot: "bag",
    optional_styling: true,
    gender: "female",
    scene: "nightlife",
    item_name: "年轻有设计感的小号包",
    search_keywords: ["女 小包 设计感"],
  };
  let rerankerCalls = 0;
  let rerankerCandidateIds = [];
  const good = product("pipeline-good-bag", "bag", "女士年轻设计感小号单肩包", {
    look_id: requirement.look_id,
    concept_id: requirement.concept_id,
    slot: "bag",
    style_tags: ["youthful", "designed", "contemporary"],
  });
  const rejected = product("pipeline-functional-mask", "bag", "孕妇户外防风功能面罩", {
    look_id: requirement.look_id,
    concept_id: requirement.concept_id,
    slot: "bag",
    style_tags: ["functional", "outdoor", "protective"],
  });
  const result = await runSharedCandidatePipeline({
    requirements: [requirement],
    groups: [{requirement, candidates: [good, rejected]}],
    context: {
      requestId: "optional-pipeline-request",
      gender: "female",
      scene: "nightlife",
      decision_pipeline: "new_decision_pipeline.v1",
      user_requirements: {
        gender: "female",
        scene: "nightlife",
        explicit_avoid: ["functional_products"],
      },
    },
    provider: "taobao",
    environment: {NODE_ENV: "test"},
    reranker: {
      async rerank({groups}) {
        rerankerCalls += 1;
        rerankerCandidateIds = groups.flatMap((group) =>
          group.candidates.map((item) => item.candidate_id));
        return groups.flatMap((group) => group.candidates);
      },
      getTraceForRequest() { return null; },
    },
    logger: {info() {}, warn() {}, error() {}},
  });

  assert.equal(result.trace.relevance_executed, true);
  assert.equal(result.trace.reranker_executed, true);
  assert.equal(rerankerCalls, 1);
  assert.equal(rerankerCandidateIds.includes("pipeline-good-bag"), true);
  assert.equal(rerankerCandidateIds.includes("pipeline-functional-mask"), false);
  assert.equal(result.trace.gate_pass.some((entry) =>
    entry.candidate_id === "pipeline-good-bag"), true);
  assert.equal(result.trace.raw_candidates.some((entry) =>
    entry.candidate_id === "pipeline-functional-mask"), true);
  assert.equal(result.trace.reranker_keep.some((entry) =>
    entry.candidate_id === "pipeline-functional-mask"), false);
  assert.equal(result.products.every((item) =>
    item.source === "taobao" && item.is_mock === false), true);
});

test("a diagnosed hosiery requirement remains distinct and survives the shared pipeline", async () => {
  const requirement = {
    look_id: "optional-hosiery-look:completion:hosiery",
    concept_id: "optional-hosiery-concept",
    category: "accessory",
    search_subcategory: "socks",
    style_role: "styling_completion",
    styling_completion_slot: "hosiery",
    styling_completion_recommended: true,
    blueprint_required: false,
    explicit_user_search: false,
    gender: "female",
    scene: "nightlife",
    item_name: "连裤袜",
    search_keywords: ["女 连裤袜", "女 连裤袜 精致"],
  };
  const candidate = product(
    "pipeline-hosiery",
    "accessory",
    "女士轻薄黑色连裤袜",
    {
      look_id: requirement.look_id,
      concept_id: requirement.concept_id,
      slot: "hosiery",
      subcategory: "socks",
      search_subcategory: "socks",
      color: "black",
      style_tags: ["refined", "leg_line", "contemporary"],
    },
  );
  let rerankerCalls = 0;
  const result = await runSharedCandidatePipeline({
    requirements: [requirement],
    groups: [{requirement, candidates: [candidate]}],
    context: {
      requestId: "optional-hosiery-request",
      gender: "female",
      scene: "nightlife",
      decision_pipeline: "new_decision_pipeline.v1",
      [STYLING_COMPLETION_AUTHORITY]: true,
      user_requirements: {gender: "female", scene: "nightlife"},
    },
    provider: "taobao",
    environment: {NODE_ENV: "test"},
    reranker: {
      async rerank({groups}) {
        rerankerCalls += 1;
        return groups.flatMap((group) => group.candidates);
      },
      getTraceForRequest() { return null; },
    },
    logger: {info() {}, warn() {}, error() {}},
  });

  assert.equal(rerankerCalls, 1);
  assert.equal(result.trace.relevance_executed, true);
  assert.equal(result.trace.gate_pass.some((entry) =>
    entry.candidate_id === candidate.candidate_id), true);
  assert.equal(result.products.some((item) =>
    item.candidate_id === candidate.candidate_id), true);
});

test("portfolio completion uses one real-Taobao optional retrieval without replacing the Core Look", async () => {
  const look = goldenCoreLook();
  const lookContract = contract();
  const coreTrace = Object.freeze({provider: "taobao", strategy_executed: true});
  const calls = [];
  const provider = {
    name: "taobao",
    lastPipelineTrace: coreTrace,
    async recommendForQueries(requirements, providerContext) {
      calls.push({requirements, providerContext});
      this.lastPipelineTrace = Object.freeze({
        provider: "taobao",
        relevance_executed: true,
        reranker_executed: true,
        strategy_executed: false,
        raw_candidates: Object.freeze([]),
        relevance_pass: Object.freeze([]),
        gate_pass: Object.freeze([]),
        gate_reject: Object.freeze([]),
        reranker_keep: Object.freeze([]),
        query_plans: Object.freeze([]),
      });
      return requirements.map((requirement, index) => {
        const slot = requirement.styling_completion_slot;
        const fixture = slot === "bag"
          ? optionalProducts().find((item) => item.styling_completion_slot === "bag")
          : optionalProducts().find((item) =>
            item.styling_completion_slot === slot) ||
              optionalProducts().find((item) => item.styling_completion_slot === "hosiery");
        return {
          ...fixture,
          candidate_id: `${fixture.candidate_id}-${index}`,
          product_id: `${fixture.product_id}-${index}`,
          id: `${fixture.id}-${index}`,
          look_id: requirement.look_id,
          concept_id: requirement.concept_id,
          styling_completion_slot: slot,
        };
      });
    },
  };
  const result = await completePortfolioStyling({
    decisionContext: decisionContext(),
    compiled: {looks: [lookContract]},
    coreValidation: {status: "PASS", looks: [look]},
    coreProducts: look.selected_products,
    productProvider: provider,
    providerContext: {decision_pipeline: "new_decision_pipeline.v1"},
    coreTrace,
    logger: {info() {}, warn() {}, error() {}},
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].requirements.every((requirement) =>
    requirement.look_id.startsWith(`${look.look_id}:completion:`)), true);
  assert.equal(calls[0].providerContext.core_look_immutable, true);
  assert.equal(result.trace.core_pipeline_trace, coreTrace);
  assert.equal(result.trace.optional_retrieval_attempted, true);
  assert.equal(result.trace.optional_retrieval_provider, "taobao");
  assert.equal(result.trace.core_unchanged, true);
  assert.equal(result.products.filter((item) =>
    ["top", "bottom", "shoes"].includes(item.category)).map((item) =>
    item.candidate_id).join("|"), "golden-top|golden-skirt|golden-shoes");
  assert.equal(result.products.some((item) => item.styling_completion_selected), true);
});

test("Auto provider completion calls only its real Taobao provider and never Mock fallback", async () => {
  const look = goldenCoreLook();
  let taobaoCalls = 0;
  let autoCalls = 0;
  const taobao = {
    name: "taobao",
    lastPipelineTrace: null,
    async recommendForQueries(requirements, providerContext) {
      taobaoCalls += 1;
      assert.equal(providerContext[STYLING_COMPLETION_AUTHORITY], true);
      this.lastPipelineTrace = Object.freeze({
        provider: "taobao",
        relevance_executed: true,
        reranker_executed: true,
        strategy_executed: false,
        raw_candidates: Object.freeze([]),
        relevance_pass: Object.freeze([]),
        gate_pass: Object.freeze([]),
        gate_reject: Object.freeze([]),
        reranker_keep: Object.freeze([]),
        query_plans: Object.freeze([]),
      });
      return requirements.map((requirement, index) => {
        const slot = requirement.styling_completion_slot;
        const fixture = optionalProducts().find((item) =>
          item.styling_completion_slot === slot) || optionalProducts()[0];
        return {
          ...fixture,
          candidate_id: `auto-real-${slot}-${index}`,
          product_id: `auto-real-${slot}-${index}`,
          id: `auto-real-${slot}-${index}`,
          look_id: requirement.look_id,
          concept_id: requirement.concept_id,
          styling_completion_slot: slot,
          source: "taobao",
          is_mock: false,
        };
      });
    },
  };
  const auto = {
    name: "auto",
    taobao,
    async recommendForQueries() {
      autoCalls += 1;
      throw new Error("Auto wrapper must not be used for optional retrieval");
    },
  };
  const result = await completePortfolioStyling({
    decisionContext: decisionContext(),
    compiled: {looks: [contract()]},
    coreValidation: {status: "PASS", looks: [look]},
    coreProducts: look.selected_products,
    productProvider: auto,
    providerContext: {decision_pipeline: "new_decision_pipeline.v1"},
    logger: {info() {}, warn() {}, error() {}},
  });

  assert.equal(taobaoCalls, 1);
  assert.equal(autoCalls, 0);
  assert.equal(result.trace.optional_retrieval_attempted, true);
  assert.equal(result.trace.optional_retrieval_provider, "taobao");
  assert.equal(result.products.some((item) => item.is_mock === true), false);
});
