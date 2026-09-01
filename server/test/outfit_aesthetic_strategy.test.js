const assert = require("node:assert/strict");
const test = require("node:test");

const {
  STRATEGY_VERSION,
  candidateHardGate,
  composeOutfitCandidates,
  scoreOutfitCombination,
} = require("../outfit_aesthetic_strategy");
const {
  resolveAestheticTargetProfile,
} = require("../style_intelligence");

function requirement(lookId, category, overrides = {}) {
  return {
    look_id: lookId,
    category,
    gender: "female",
    item_name: category,
    ...overrides,
  };
}

function product(lookId, category, id, title, overrides = {}) {
  return {
    look_id: lookId,
    category,
    product_id: id,
    title,
    price: 299,
    style_match_score: 70,
    aesthetic_score: 70,
    final_score: 70,
    brand_quality_score: 65,
    body_strategy_match_score: 65,
    ...overrides,
  };
}

function idsFor(result, category) {
  return result.products
    .filter((item) => item.category === category)
    .map((item) => item.product_id);
}

test("female date sweet premium composes pleated skirt with refined date shoes", () => {
  const lookId = "sweet-date-look";
  const requirements = [
    requirement(lookId, "top", {item_name: "精致约会上衣"}),
    requirement(lookId, "bottom", {item_name: "约会下装"}),
    requirement(lookId, "shoes", {item_name: "约会鞋履"}),
  ];
  const products = [
    product(lookId, "top", "top-blouse", "女士方领收腰精致衬衫", {
      final_score: 78,
    }),
    product(lookId, "bottom", "bottom-pleated", "女士高腰百褶A字半身裙", {
      final_score: 72,
      style_match_score: 82,
    }),
    product(lookId, "bottom", "bottom-straight", "女士基础直筒长裤", {
      final_score: 94,
      style_match_score: 62,
    }),
    product(lookId, "bottom", "bottom-shorts", "女士宽松五分裤", {
      final_score: 92,
      style_match_score: 55,
    }),
    product(lookId, "shoes", "shoes-mary-jane", "女士真皮低跟玛丽珍鞋", {
      final_score: 72,
      style_match_score: 84,
    }),
    product(lookId, "shoes", "shoes-sneaker", "女士厚底休闲运动板鞋", {
      final_score: 96,
      style_match_score: 58,
    }),
    product(lookId, "shoes", "shoes-heels", "女士精致尖头中跟高跟鞋", {
      final_score: 75,
      style_match_score: 82,
    }),
  ];
  const result = composeOutfitCandidates({
    requirements,
    products,
    context: {
      gender: "female",
      scene: "约会",
      style: "甜美高级",
      style_expression: "feminine",
      style_profile: {dimensions: {femininity: 88, luxury: 78, sportiness: 8}},
      user_profile: {height: 160},
      outfit_budget: 1800,
    },
  });

  assert.equal(result.applied, true);
  assert.deepEqual(idsFor(result, "bottom"), ["bottom-pleated"]);
  assert.equal(idsFor(result, "shoes").includes("shoes-sneaker"), false);
  assert.ok(["shoes-mary-jane", "shoes-heels"].includes(idsFor(result, "shoes")[0]));
  assert.equal(result.products.length, 3);
  assert.equal(result.products.every((item) =>
    item.outfit_strategy_version === STRATEGY_VERSION), true);
});

test("broader candidate pool lets an outfit-compatible fourth-ranked item win", () => {
  const lookId = "breadth-rank-four-look";
  const requirements = [
    requirement(lookId, "top", {style: "sweet + elegant"}),
    requirement(lookId, "bottom", {style: "sweet + elegant"}),
    requirement(lookId, "shoes", {style: "sweet + elegant"}),
  ];
  const products = [
    product(lookId, "top", "top-sport-1", "女士宽松运动卫衣", {
      final_score: 99, style_match_score: 60,
    }),
    product(lookId, "top", "top-street-2", "女士街头宽松短袖", {
      final_score: 98, style_match_score: 60,
    }),
    product(lookId, "top", "top-sport-3", "女士运动吊带背心", {
      final_score: 97, style_match_score: 60,
    }),
    product(lookId, "top", "top-refined-4", "女士方领收腰蕾丝精致上衣", {
      final_score: 70, style_match_score: 70,
    }),
    product(lookId, "bottom", "bottom-pleated", "女士高腰百褶A字半身裙", {
      final_score: 82, style_match_score: 82,
    }),
    product(lookId, "shoes", "shoes-mary-jane", "女士低跟玛丽珍鞋", {
      final_score: 82, style_match_score: 82,
    }),
  ];
  const context = {
    gender: "female",
    scene: "date",
    style: "sweet + elegant",
    style_expression: "feminine",
  };
  const oldTopThree = composeOutfitCandidates({
    requirements,
    products,
    context,
    topPerRequirement: 3,
  });
  const broader = composeOutfitCandidates({requirements, products, context});

  assert.notEqual(idsFor(oldTopThree, "top")[0], "top-refined-4");
  assert.deepEqual(idsFor(broader, "top"), ["top-refined-4"]);
  assert.ok(broader.looks[0].base_score > oldTopThree.looks[0].base_score);
  assert.deepEqual(broader.looks[0].candidate_breadth.candidate_count_per_slot, {
    top: 4,
    bottom: 1,
    shoes: 1,
  });
  assert.equal(broader.looks[0].candidate_breadth.candidate_pool_limit, 6);
  assert.equal(broader.looks[0].candidate_breadth.beam_width, 72);
});

test("six-wide candidate pools remain bounded by progressive beam pruning", () => {
  const lookId = "bounded-beam-look";
  const requirements = ["top", "bottom", "shoes"]
    .map((category) => requirement(lookId, category, {style: "minimal"}));
  const products = requirements.flatMap((item) =>
    Array.from({length: 6}, (_, index) => product(
      lookId,
      item.category,
      `${item.category}-${index + 1}`,
      `女士简约${item.category}${index + 1}`,
      {final_score: 90 - index, style_match_score: 80 - index},
    )));
  const result = composeOutfitCandidates({
    requirements,
    products,
    context: {gender: "female", scene: "daily", style: "minimal"},
  });
  const breadth = result.looks[0].candidate_breadth;

  assert.deepEqual(breadth.candidate_count_per_slot, {
    top: 6,
    bottom: 6,
    shoes: 6,
  });
  assert.equal(breadth.expanded_combination_count, 258);
  assert.equal(breadth.pruned_combination_count, 144);
  assert.equal(breadth.max_frontier_count, 72);
  assert.equal(breadth.evaluated_complete_combination_count, 72);
});

test("female neutral daily does not force skirts or heels", () => {
  const lookId = "neutral-daily-look";
  const result = composeOutfitCandidates({
    requirements: [
      requirement(lookId, "top", {style: "中性简洁"}),
      requirement(lookId, "bottom", {style: "中性简洁"}),
      requirement(lookId, "shoes", {style: "中性简洁"}),
    ],
    products: [
      product(lookId, "top", "neutral-top", "女士简洁合身针织上衣", {
        style_match_score: 90,
      }),
      product(lookId, "bottom", "neutral-jeans", "女士高腰直筒牛仔裤", {
        style_match_score: 92,
        final_score: 92,
      }),
      product(lookId, "bottom", "feminine-skirt", "女士蕾丝百褶半身裙", {
        style_match_score: 52,
      }),
      product(lookId, "shoes", "neutral-sneaker", "女士简洁低帮休闲板鞋", {
        style_match_score: 92,
        final_score: 92,
      }),
      product(lookId, "shoes", "feminine-heels", "女士蝴蝶结高跟鞋", {
        style_match_score: 50,
      }),
    ],
    context: {
      gender: "female",
      scene: "daily",
      style: "neutral clean",
      style_expression: "neutral",
      style_profile: {dimensions: {femininity: 25, sportiness: 35}},
    },
  });

  assert.deepEqual(idsFor(result, "bottom"), ["neutral-jeans"]);
  assert.deepEqual(idsFor(result, "shoes"), ["neutral-sneaker"]);
  assert.equal(result.looks[0].scores.femininityExpression, null);
});

test("sporty daily keeps sports shoes available and preferred", () => {
  const lookId = "sporty-daily-look";
  const result = composeOutfitCandidates({
    requirements: [
      requirement(lookId, "top", {style: "sporty"}),
      requirement(lookId, "bottom", {style: "sporty"}),
      requirement(lookId, "shoes", {style: "sporty"}),
    ],
    products: [
      product(lookId, "top", "sport-top", "女士运动短款上衣"),
      product(lookId, "bottom", "sport-bottom", "女士运动束脚长裤"),
      product(lookId, "shoes", "running-shoes", "女士轻量跑步运动鞋", {
        style_match_score: 88,
      }),
      product(lookId, "shoes", "date-pumps", "女士尖头细跟高跟鞋", {
        style_match_score: 60,
      }),
    ],
    context: {
      gender: "female",
      scene: "daily",
      style: "sporty",
      style_expression: "neutral",
      style_profile: {dimensions: {sportiness: 92, femininity: 30}},
    },
  });

  assert.deepEqual(idsFor(result, "shoes"), ["running-shoes"]);
  assert.ok(result.looks[0].scores.footwearCompatibility >= 90);
});

test("dark sweet date scores black Mary Jane and black legwear as a compatible set", () => {
  const lookId = "dark-sweet-look";
  const requirements = [
    requirement(lookId, "top", {style: "dark_sweet"}),
    requirement(lookId, "bottom", {style: "dark_sweet", item_name: "半身裙"}),
    requirement(lookId, "shoes", {style: "dark_sweet"}),
    requirement(lookId, "socks", {style: "dark_sweet", item_name: "袜装"}),
  ];
  const products = [
    product(lookId, "top", "dark-top", "黑色蕾丝方领修身上衣"),
    product(lookId, "bottom", "dark-skirt", "黑色高腰百褶半身裙"),
    product(lookId, "bottom", "blue-jeans", "蓝色基础直筒牛仔裤", {final_score: 88}),
    product(lookId, "shoes", "black-mary-jane", "黑色低跟玛丽珍鞋"),
    product(lookId, "shoes", "white-sneaker", "白色运动板鞋", {final_score: 90}),
    product(lookId, "socks", "black-tights", "黑色半透丝袜连裤袜"),
    product(lookId, "socks", "sport-socks", "白色运动短袜", {final_score: 88}),
  ];
  const result = composeOutfitCandidates({
    requirements,
    products,
    context: {
      gender: "female",
      scene: "date",
      style: "dark_sweet 暗黑甜",
      style_expression: "feminine",
      style_profile: {dimensions: {femininity: 82, romantic: 72, sportiness: 5}},
    },
  });

  assert.deepEqual(idsFor(result, "bottom"), ["dark-skirt"]);
  assert.deepEqual(idsFor(result, "shoes"), ["black-mary-jane"]);
  assert.deepEqual(idsFor(result, "socks"), ["black-tights"]);
  assert.ok(result.looks[0].scores.legwearCompatibility >= 90);

  const alternative = scoreOutfitCombination([
    {product: products[0], requirement: requirements[0]},
    {product: products[2], requirement: requirements[1]},
    {product: products[4], requirement: requirements[2]},
    {product: products[6], requirement: requirements[3]},
  ], {
    scene: "date",
    style: "dark_sweet",
    style_expression: "feminine",
    style_profile: {dimensions: {femininity: 82}},
  });
  assert.ok(result.looks[0].base_score > alternative.finalScore);
});

test("cross-look selection avoids repeating the same bag when an alternative exists", () => {
  const requirements = ["look-1", "look-2"].flatMap((lookId) => [
    requirement(lookId, "dress", {item_name: "精致连衣裙"}),
    requirement(lookId, "shoes", {item_name: "约会鞋履"}),
    requirement(lookId, "bag", {item_name: "约会小包"}),
  ]);
  const products = [
    product("look-1", "dress", "dress-1", "法式收腰连衣裙"),
    product("look-1", "shoes", "shoes-1", "女士低跟玛丽珍鞋"),
    product("look-1", "bag", "shared-bag", "黑色精致腋下包", {
      brand_quality_score: 90,
    }),
    product("look-2", "dress", "dress-2", "方领剪裁连衣裙"),
    product("look-2", "shoes", "shoes-2", "女士尖头低跟鞋"),
    product("look-2", "bag", "shared-bag", "黑色精致腋下包", {
      brand_quality_score: 90,
    }),
    product("look-2", "bag", "alternative-bag", "米白色精致手提小包", {
      brand_quality_score: 62,
      final_score: 62,
    }),
  ];
  const result = composeOutfitCandidates({
    requirements,
    products,
    context: {
      gender: "female",
      scene: "date",
      style: "甜美高级",
      style_expression: "feminine",
      style_profile: {dimensions: {femininity: 85, luxury: 72}},
    },
  });

  assert.equal(result.looks.length, 2);
  const bags = idsFor(result, "bag");
  assert.deepEqual(bags, ["shared-bag", "alternative-bag"]);
  assert.equal(new Set(bags).size, 2);
});

test("hard gates reject utility accessories, explicit gender conflicts and budget violations", () => {
  const context = {gender: "female", item_budget: 300};
  assert.deepEqual(
    candidateHardGate(
      product("look", "accessory", "mask", "户外防晒面罩功能用品"),
      requirement("look", "accessory"),
      context,
    ),
    {allowed: false, reason: "NON_FASHION_UTILITY_PRODUCT"},
  );
  assert.equal(candidateHardGate(
    product("look", "bottom", "men-bottom", "男款直筒五分裤"),
    requirement("look", "bottom"),
    context,
  ).reason, "EXPLICIT_GENDER_CONFLICT");
  assert.equal(candidateHardGate(
    product("look", "shoes", "sport-shoes", "女士运动板鞋"),
    requirement("look", "shoes", {avoid_attributes: ["运动鞋"]}),
    context,
  ).reason, "BLUEPRINT_AVOID_CONFLICT");
  assert.equal(candidateHardGate(
    product("look", "dress", "expensive", "女士收腰连衣裙", {price: 399}),
    requirement("look", "dress"),
    context,
  ).reason, "ITEM_BUDGET_EXCEEDED");
});

test("dress mixed with top and bottom is rejected as an invalid structure", () => {
  const lookId = "invalid-mixed-look";
  const requirements = ["dress", "top", "bottom", "shoes"]
    .map((category) => requirement(lookId, category));
  const products = requirements.map((item) =>
    product(lookId, item.category, `product-${item.category}`, `女士${item.category}`));
  const result = composeOutfitCandidates({requirements, products, context: {gender: "female"}});

  assert.equal(result.applied, true);
  assert.deepEqual(result.products, []);
  assert.deepEqual(result.looks, []);
});

test("explicit outfit budget is a hard combination ceiling", () => {
  const lookId = "budget-look";
  const requirements = ["top", "bottom", "shoes"]
    .map((category) => requirement(lookId, category));
  const products = [
    product(lookId, "top", "budget-top", "女士合身上衣", {price: 200}),
    product(lookId, "bottom", "budget-bottom", "女士高腰半身裙", {price: 220}),
    product(lookId, "shoes", "budget-shoes", "女士低跟单鞋", {price: 180}),
  ];
  const result = composeOutfitCandidates({
    requirements,
    products,
    context: {gender: "female", outfit_budget: 500},
  });

  assert.equal(result.applied, true);
  assert.deepEqual(result.products, []);
});

test("Outfit Strategy consumes an explicit AestheticTargetProfile", () => {
  const lookId = "profile-driven-look";
  const target = resolveAestheticTargetProfile({
    gender: "female",
    style: "运动休闲",
    scene: "daily",
  });
  const result = composeOutfitCandidates({
    requirements: [
      requirement(lookId, "top"),
      requirement(lookId, "bottom"),
      requirement(lookId, "shoes"),
    ],
    products: [
      product(lookId, "top", "sport-top-v2", "轻量运动上衣"),
      product(lookId, "bottom", "sport-bottom-v2", "高腰运动长裤"),
      product(lookId, "shoes", "running-v2", "轻量跑步运动鞋"),
      product(lookId, "shoes", "pumps-v2", "尖头细跟高跟鞋"),
    ],
    context: {
      gender: "female",
      style: "这段原始文字不参与重新解释",
      aesthetic_target_profile: target,
    },
  });
  assert.deepEqual(idsFor(result, "shoes"), ["running-v2"]);
  assert.equal(result.looks[0].aesthetic_target_profile.version,
    "aesthetic_target_profile_v1");
  assert.equal(Object.hasOwn(result.products[0].outfit_strategy_breakdown,
    "focal_hierarchy"), true);
});

function calibratedProduct(lookId, category, id, style, score, overrides = {}) {
  const gender = overrides.gender || "male";
  return product(
    lookId,
    category,
    id,
    `${gender === "female" ? "女士" : "男士"}${category} ${style}`,
    {
      gender,
      original_gender: gender,
      style,
      style_tags: [style],
      occasion_tags: ["date", "daily", "commute", "formal_event"],
      quality_tier: "premium",
      color: "black",
      price: 300,
      final_score: score,
      style_match_score: score,
      style_fit_score: score,
      occasion_fit_score: 90,
      quality_fit_score: 90,
      color_fit_score: 90,
      silhouette_fit_score: 86,
      footwear_fit_score: category === "shoes" ? 86 : 70,
      gender_fit_score: 100,
      brand_quality_score: 72,
      body_strategy_match_score: 72,
      aesthetic_score: 72,
      ...overrides,
    },
  );
}

function calibratedEntries(products, requirements) {
  return products.map((item, index) => ({
    product: item,
    requirement: requirements[index],
  }));
}

const PAIRWISE_CONTRACTS = Object.freeze([
  {
    name: "clean_fit",
    gender: "male",
    scene: "date",
    exact: ["clean_fit", "clean_fit", "clean_fit"],
    alternative: ["business_casual", "cityboy", "american_vintage"],
    alternativeScores: [78, 78, 45],
  },
  {
    name: "formal",
    gender: "male",
    scene: "formal_event",
    exact: ["formal", "formal", "formal"],
    alternative: ["business_casual", "formal", "clean_fit"],
    alternativeScores: [78, 100, 78],
  },
  {
    name: "american_vintage",
    gender: "male",
    scene: "daily",
    exact: ["american_vintage", "american_vintage", "american_vintage"],
    alternative: ["sporty", "street", "sporty"],
    alternativeScores: [45, 45, 45],
  },
  {
    name: "cityboy",
    gender: "male",
    scene: "daily",
    exact: ["cityboy", "cityboy", "cityboy"],
    alternative: ["basic", "generic", "sporty"],
    alternativeScores: [45, 45, 45],
  },
  {
    name: "business_casual",
    gender: "male",
    scene: "commute",
    exact: ["business_casual", "business_casual", "business_casual"],
    alternative: ["business_casual", "cityboy", "clean_fit"],
    alternativeScores: [100, 78, 78],
  },
  {
    name: "minimal",
    gender: "female",
    scene: "daily",
    exact: ["minimal", "minimal", "minimal"],
    alternative: ["sweet", "korean", "korean"],
    alternativeScores: [45, 78, 78],
  },
]);

for (const contract of PAIRWISE_CONTRACTS) {
  test(`${contract.name} target-aligned full look beats the mixed-style contract`, () => {
    const lookId = `pairwise-${contract.name}`;
    const categories = ["top", "bottom", "shoes"];
    const requirements = categories.map((category) => requirement(lookId, category, {
      gender: contract.gender,
      style: contract.name,
      scene: contract.scene,
    }));
    const exact = categories.map((category, index) => calibratedProduct(
      lookId,
      category,
      `${contract.name}-exact-${category}`,
      contract.exact[index],
      100,
      {gender: contract.gender},
    ));
    const alternative = categories.map((category, index) => calibratedProduct(
      lookId,
      category,
      `${contract.name}-alternative-${category}`,
      contract.alternative[index],
      contract.alternativeScores[index],
      {gender: contract.gender},
    ));
    const target = resolveAestheticTargetProfile({
      gender: contract.gender,
      scene: contract.scene,
      style: contract.name,
    });
    const context = {
      gender: contract.gender,
      scene: contract.scene,
      style: contract.name,
      aesthetic_target_profile: target,
    };
    const exactScore = scoreOutfitCombination(
      calibratedEntries(exact, requirements),
      context,
    );
    const alternativeScore = scoreOutfitCombination(
      calibratedEntries(alternative, requirements),
      context,
    );
    const result = composeOutfitCandidates({
      requirements,
      products: [...exact, ...alternative],
      context,
    });

    assert.ok(exactScore.finalScore > alternativeScore.finalScore,
      `${exactScore.finalScore} must exceed ${alternativeScore.finalScore}`);
    const candidatesById = new Map([...exact, ...alternative]
      .map((item) => [item.product_id, item]));
    assert.deepEqual(result.looks[0].selected_candidate_ids.map((id) =>
      candidatesById.get(id).style), contract.exact);
    assert.equal(result.looks[0].combination_traces.length, 8);
  });
}

test("strategy trace decomposes every evaluated outfit into internal and target scores", () => {
  const lookId = "strategy-trace-look";
  const categories = ["top", "bottom", "shoes"];
  const requirements = categories.map((category) => requirement(lookId, category, {
    gender: "male",
    style: "clean_fit",
  }));
  const products = categories.flatMap((category) => [
    calibratedProduct(lookId, category, `exact-${category}`, "clean_fit", 100),
    calibratedProduct(lookId, category, `near-${category}`, "business_casual", 78),
  ]);
  const result = composeOutfitCandidates({
    requirements,
    products,
    context: {gender: "male", scene: "date", style: "clean_fit"},
  });
  const report = result.looks[0];

  assert.equal(report.combination_traces.length, 8);
  for (const evaluated of report.combination_traces) {
    const trace = evaluated.strategy_trace;
    assert.equal(trace.candidate_ids.length, 3);
    for (const field of [
      "styleCoherence",
      "occasionFormalityFit",
      "silhouetteCoherence",
      "colorHarmony",
      "colorIntensityFit",
      "footwearCompatibility",
      "brandQualityValueCoherence",
      "targetProfileMatch",
      "internalCoherence",
      "crossStyleConflictPenalty",
      "targetMissPenalty",
      "finalOutfitScore",
    ]) assert.equal(Number.isFinite(trace[field]), true, field);
    assert.equal(trace.slotStyleFitSummary.slots.length, 3);
    assert.equal(trace.slotOccasionFitSummary.slots.length, 3);
    assert.equal(trace.slotQualityFitSummary.slots.length, 3);
    assert.ok(trace.ranking_reason.length >= 2);
  }
});

test("a compatible near-miss can win when it materially improves outfit coherence", () => {
  const lookId = "compatible-near-miss-look";
  const requirements = ["top", "bottom", "shoes"].map((category) =>
    requirement(lookId, category, {style: "minimal"}));
  const top = calibratedProduct(lookId, "top", "minimal-top", "minimal", 100, {
    gender: "female", color: "white",
  });
  const bottom = calibratedProduct(lookId, "bottom", "minimal-bottom", "minimal", 100, {
    gender: "female", color: "black",
  });
  const exactShoe = calibratedProduct(
    lookId,
    "shoes",
    "minimal-exact-heavy-shoe",
    "minimal",
    100,
    {
      gender: "female",
      title: "女士荧光红超厚底笨重运动鞋",
      color: "red",
      color_fit_score: 30,
      footwear_fit_score: 25,
    },
  );
  const nearShoe = calibratedProduct(
    lookId,
    "shoes",
    "clean-near-light-shoe",
    "clean_fit",
    78,
    {
      gender: "female",
      title: "女士黑色轻量极简皮革乐福鞋",
      color: "black",
      color_fit_score: 96,
      footwear_fit_score: 96,
    },
  );
  const result = composeOutfitCandidates({
    requirements,
    products: [top, bottom, exactShoe, nearShoe],
    context: {gender: "female", scene: "daily", style: "minimal"},
  });

  assert.deepEqual(idsFor(result, "shoes"), ["clean-near-light-shoe"]);
  assert.equal(result.looks[0].strategy_trace.slotStyleFitSummary.slots
    .find((slot) => slot.slot === "shoes").score, 78);
});

test("strategy skips a rank-one critical failure and selects the first quality PASS", () => {
  const lookId = "quality-rank-fallback";
  const requirements = ["top", "bottom", "shoes"].map((category) =>
    requirement(lookId, category, {style: "minimal"}));
  const products = [
    calibratedProduct(lookId, "top", "quality-top", "minimal", 94, {
      gender: "female", color: "white",
    }),
    calibratedProduct(lookId, "bottom", "quality-bottom", "minimal", 94, {
      gender: "female", color: "black",
    }),
    calibratedProduct(lookId, "shoes", "rank-one-severe-shoe", "minimal", 100, {
      gender: "female",
      title: "女士黑色轻量极简乐福鞋",
      footwear_fit_score: 35,
    }),
    calibratedProduct(lookId, "shoes", "rank-two-safe-shoe", "clean_fit", 78, {
      gender: "female",
      title: "女士黑色轻量简洁乐福鞋",
      footwear_fit_score: 82,
    }),
  ];
  const result = composeOutfitCandidates({
    requirements,
    products,
    context: {gender: "female", scene: "daily", style: "minimal"},
  });
  const report = result.looks[0];

  assert.equal(report.combination_traces[0].whole_look_quality.status, "FAIL");
  assert.ok(report.combination_traces[0].whole_look_quality.reason_codes
    .includes("CRITICAL_DIMENSION_BELOW_FLOOR:FOOTWEAR"));
  assert.deepEqual(idsFor(result, "shoes"), ["rank-two-safe-shoe"]);
  assert.equal(report.whole_look_quality.status, "PASS");
  assert.equal(report.quality_valid_alternatives[0].look_candidate_id,
    report.look_candidate_id);
  assert.ok(report.quality_valid_alternatives.length <= 3);
});

test("an all-failing look selects no products and reports LOW_QUALITY_LOOK", () => {
  const lookId = "all-low-quality-look";
  const requirements = ["top", "bottom", "shoes"].map((category) =>
    requirement(lookId, category, {style: "minimal"}));
  const products = requirements.map((item) => product(
    lookId,
    item.category,
    `low-${item.category}`,
    `女士简洁${item.category}`,
    {
      final_score: 36,
      style_match_score: 36,
      occasion_fit_score: 36,
      quality_fit_score: 36,
    },
  ));
  const result = composeOutfitCandidates({
    requirements,
    products,
    context: {gender: "female", scene: "daily", style: "minimal"},
  });

  assert.deepEqual(result.products, []);
  assert.deepEqual(result.looks, []);
  assert.equal(result.rejected_looks.length, 1);
  assert.equal(result.rejected_looks[0].look_id, lookId);
  assert.ok(result.rejected_looks[0].reason_codes.includes("LOW_QUALITY_LOOK"));
  assert.equal(result.rejected_looks[0].selected_candidate_ids.length, 0);
  assert.equal(result.rejected_looks[0].rejected_combination_traces[0]
    .whole_look_quality.status, "FAIL");
});

test("high-confidence acceptance mismatch cannot be hidden by a high aggregate score", () => {
  const lookId = "acceptance-evidence-mismatch";
  const requirements = ["top", "bottom", "shoes"].map((category) =>
    requirement(lookId, category, {scene: "nightlife"}));
  const products = requirements.map((item) => product(
    lookId,
    item.category,
    `mismatch-${item.category}`,
    `女士年轻时髦${item.category}`,
    {
      final_score: 95,
      style_match_score: 95,
      aesthetic_score: 95,
      product_acceptance_evidence: item.category === "shoes" ? {
        desired_impression_fit: {
          value: "mismatch",
          confidence: 0.95,
          source: "product_text",
          evidence: ["traditional mature expression"],
        },
      } : {},
    },
  ));
  const result = composeOutfitCandidates({
    requirements,
    products,
    context: {
      gender: "female",
      scene: "nightlife",
      desired_impression: ["年轻", "有设计感"],
    },
  });

  assert.equal(result.looks.length, 0);
  assert.equal(result.rejected_looks.length, 1);
  assert.equal(result.rejected_looks[0].whole_look_quality.reason_codes.some(
    (reason) => reason ===
      "CRITICAL_DIMENSION_BELOW_FLOOR:DESIRED_IMPRESSION"), true);
});

test("new decision pipeline uses human-grounded whole-look scoring", () => {
  const lookId = "human-grounded-production-look";
  const requirements = ["top", "bottom", "shoes"].map((category) =>
    requirement(lookId, category, {style: "minimal"}));
  const targetFit = () => ({
    audience_fit: {score: 98, status: "MATCH", source: "product_fact",
      confidence: 0.95, evidence: ["adult female"]},
    occasion_fit: {score: 88, status: "MATCH", source: "product_fact",
      confidence: 0.88, evidence: ["social scene"]},
    desired_impression_fit: {score: 86, status: "MATCH", source: "product_fact",
      confidence: 0.88, evidence: ["young design expression"]},
    contemporary_fit: {score: 84, status: "MATCH", source: "product_fact",
      confidence: 0.84, evidence: ["contemporary expression"]},
    quality_fit: {score: 74, status: "PARTIAL", source: "product_fact",
      confidence: 0.72, evidence: ["consistent quality"]},
  });
  const enriched = (category) => ({
    style_expression: {value: "design_expression", source: "title",
      confidence: 0.9, evidence: ["design detail"]},
    desired_impression_evidence: {value: ["design_led", "youthful"],
      source: "title", confidence: 0.88, evidence: ["young design"]},
    contemporary_expression: {value: "contemporary", source: "title",
      confidence: 0.84, evidence: ["contemporary"]},
    occasion_expression: {value: "nightlife_social", source: "title",
      confidence: 0.86, evidence: ["social"]},
    silhouette_evidence: {value: category === "top" ? "cropped" :
      category === "bottom" ? "a_line" : "fitted", source: "title",
      confidence: 0.86, evidence: ["shape"]},
    color_evidence: {value: category === "shoes" ? "black" : "white",
      source: "title", confidence: 0.9, evidence: ["color"]},
    ...(category === "shoes" ? {footwear_evidence: {value: "loafer",
      source: "title", confidence: 0.9, evidence: ["loafer"]}} : {}),
  });
  const products = [
    calibratedProduct(lookId, "top", "hg-top", "minimal", 90, {
      gender: "female", title: "浅色短款设计感上衣",
      candidate_enrichment: enriched("top"), target_fit_assessment: targetFit(),
    }),
    calibratedProduct(lookId, "bottom", "hg-bottom", "minimal", 90, {
      gender: "female", title: "浅色百褶A字裙",
      candidate_enrichment: enriched("bottom"), target_fit_assessment: targetFit(),
    }),
    calibratedProduct(lookId, "shoes", "hg-shoes", "minimal", 90, {
      gender: "female", title: "黑色厚底乐福鞋",
      candidate_enrichment: enriched("shoes"), target_fit_assessment: targetFit(),
    }),
  ];
  const result = composeOutfitCandidates({
    requirements,
    products,
    context: {
      decision_pipeline: "new_decision_pipeline.v1",
      gender: "female",
      scene: "nightlife",
      aesthetic_target_profile: resolveAestheticTargetProfile({
        gender: "female", scene: "daily", style: "minimal",
      }),
      decision_context: {
        user_truth: {gender: "female", scene: "nightlife"},
        intent: {user_intent_brain: {
          scene_intent: {value: "nightlife", source: "user", confidence: 1},
          desired_impression: {value: ["年轻", "有设计感"], source: "user",
            confidence: 1},
          formality_preference: {value: "relaxed", source: "user", confidence: 1},
          statement_level: {value: "medium", source: "user", confidence: 1},
          explicit_avoid: {value: [], source: "user", confidence: 1},
        }},
      },
    },
  });

  assert.equal(result.looks.length, 1);
  assert.equal(result.looks[0].whole_look_quality.version,
    "whole_look_human_grounded_score.v1");
  assert.equal(result.looks[0].whole_look_quality.status, "PASS");
  assert.ok(result.looks[0].whole_look_quality.intent_expression_score >= 60);
  assert.equal(result.looks[0].whole_look_quality.defaulted_dimensions.length, 0);
});
