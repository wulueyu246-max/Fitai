"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  canonicalProductIdentity,
  EVIDENCE_APPLICABILITY,
  evaluateProductAcceptance,
} = require("../product_acceptance_gate");
const {
  calibratedProductScore,
  classifyRerankerFailure,
} = require("../product_aesthetic_reranker");
const {composeOutfitCandidates} = require("../outfit_aesthetic_strategy");
const {
  AutoProductProvider,
  ProductProviderError,
  runSharedCandidatePipeline,
} = require("../product_provider");

function context({
  raw = "年轻约会，干净时髦，不要像上班",
  gender = "male",
  scene = "date",
  desired = ["年轻", "干净", "时髦"],
  explicitStyle = null,
} = {}) {
  return {
    gender,
    scene,
    decision_pipeline: "new_decision_pipeline.v1",
    decision_context: {
      raw_user_input: raw,
      user_truth: {gender, scene, explicit_avoid: []},
      intent: {user_intent_brain: {
        desired_impression: {value: desired, source: "user", confidence: 1},
        explicit_avoid: {value: [], source: "user", confidence: 1},
        explicit_style: {value: explicitStyle, source: "user", confidence: 1},
      }},
    },
  };
}

function requirement(category, overrides = {}) {
  return {
    look_id: "look-1",
    concept_id: "concept-1",
    category,
    gender: "male",
    scene: "date",
    ...overrides,
  };
}

function product(title, overrides = {}) {
  return {
    product_id: overrides.product_id || "candidate-1",
    title,
    category: overrides.category || "shoes",
    original_category: overrides.category || "shoes",
    gender: overrides.gender || "male",
    original_gender: overrides.gender || "male",
    price: overrides.price ?? 199,
    image_url: overrides.image_url || "https://img.example.com/item.jpg",
    source: "taobao",
    is_mock: false,
    ...overrides,
  };
}

function optionalRequirement(slot, overrides = {}) {
  const definitions = {
    hosiery: {
      category: "accessory",
      search_subcategory: "socks",
      item_name: "连裤袜",
    },
    bag: {
      category: "bag",
      search_subcategory: "bag",
      item_name: "单肩包",
    },
    accessory: {
      category: "accessory",
      search_subcategory: "jewelry",
      item_name: "项链",
    },
    headwear: {
      category: "hat",
      search_subcategory: "hat",
      item_name: "时尚帽子",
    },
  };
  return requirement(definitions[slot].category, {
    ...definitions[slot],
    gender: "female",
    scene: "nightlife",
    style_role: "styling_completion",
    styling_completion_required: false,
    styling_completion_recommended: true,
    ...overrides,
  });
}

test("Optional A: ordinary hosiery is not Soft Rejected for absent whole-Look expression evidence", () => {
  const ctx = context({
    raw: "今晚出去玩，年轻一点，有设计感，别太正式",
    gender: "female",
    scene: "nightlife",
    desired: ["年轻", "有设计感"],
  });
  const result = evaluateProductAcceptance(
    product("女士轻薄黑色连裤袜", {
      category: "accessory",
      gender: "female",
      price: 39,
    }),
    optionalRequirement("hosiery"),
    ctx,
  );

  assert.equal(result.allowed, true);
  assert.notEqual(result.acceptance.result, "SOFT_REJECT");
  assert.equal(result.acceptance.penalty, 2);
  assert.equal(
    result.acceptance.evidence.contemporary_fit.applicability,
    EVIDENCE_APPLICABILITY.NOT_APPLICABLE,
  );
  assert.equal(
    result.acceptance.evidence.desired_impression_fit.applicability,
    EVIDENCE_APPLICABILITY.NOT_APPLICABLE,
  );
  assert.equal(
    result.acceptance.evidence.visual_quality.applicability,
    EVIDENCE_APPLICABILITY.UNKNOWN,
  );
});

test("Optional B: confirmed child hosiery remains a Hard Reject for an adult request", () => {
  const result = evaluateProductAcceptance(
    product("女童儿童舞蹈连裤袜", {
      category: "accessory",
      gender: "female",
    }),
    optionalRequirement("hosiery"),
    context({gender: "female", scene: "nightlife"}),
  );

  assert.equal(result.allowed, false);
  assert.equal(result.acceptance.result, "HARD_REJECT");
  assert.deepEqual(result.acceptance.hard_reasons, [
    "AUDIENCE_SEVERE_MISMATCH",
  ]);
  assert.equal(
    result.acceptance.evidence.audience_fit.applicability,
    EVIDENCE_APPLICABILITY.APPLICABLE,
  );
});

test("Optional C: a valid bag is not rejected for missing clothing-level expression evidence", () => {
  const result = evaluateProductAcceptance(
    product("女士黑色小号单肩包", {
      category: "bag",
      gender: "female",
      price: 159,
    }),
    optionalRequirement("bag"),
    context({
      raw: "今晚出去玩，年轻一点，有设计感，别太正式",
      gender: "female",
      scene: "nightlife",
      desired: ["年轻", "有设计感"],
    }),
  );

  assert.equal(result.allowed, true);
  assert.notEqual(result.acceptance.result, "SOFT_REJECT");
  assert.equal(
    result.acceptance.evidence.contemporary_fit.applicability,
    EVIDENCE_APPLICABILITY.NOT_APPLICABLE,
  );
  assert.equal(
    result.acceptance.evidence.desired_impression_fit.applicability,
    EVIDENCE_APPLICABILITY.NOT_APPLICABLE,
  );
});

test("Optional D: a formal Look may reject an explicitly exaggerated street hat", () => {
  const result = evaluateProductAcceptance(
    product("女士夸张街头涂鸦超大棒球帽", {
      category: "hat",
      gender: "female",
      price: 129,
    }),
    optionalRequirement("headwear", {
      scene: "formal_event",
      style: "formal",
    }),
    context({
      raw: "正式晚宴，保持克制优雅",
      gender: "female",
      scene: "formal_event",
      desired: ["正式", "优雅"],
      explicitStyle: "formal",
    }),
  );

  assert.equal(result.allowed, true);
  assert.equal(result.acceptance.result, "SOFT_REJECT");
  assert.equal(result.acceptance.evidence.occasion_fit.value, "mismatch");
  assert.equal(
    result.acceptance.evidence.occasion_fit.applicability,
    EVIDENCE_APPLICABILITY.APPLICABLE,
  );
});

test("Optional E: ordinary jewelry need not independently carry the whole-Look impression", () => {
  const result = evaluateProductAcceptance(
    product("女士淡水珍珠项链", {
      category: "accessory",
      gender: "female",
      price: 99,
    }),
    optionalRequirement("accessory"),
    context({
      raw: "今晚出去玩，年轻一点，有设计感，别太正式",
      gender: "female",
      scene: "nightlife",
      desired: ["年轻", "有设计感"],
    }),
  );

  assert.equal(result.allowed, true);
  assert.notEqual(result.acceptance.result, "SOFT_REJECT");
  assert.equal(
    result.acceptance.evidence.desired_impression_fit.applicability,
    EVIDENCE_APPLICABILITY.NOT_APPLICABLE,
  );
});

test("core top/bottom/shoes acceptance decisions remain unchanged by Optional applicability", () => {
  const ctx = context({
    raw: "今晚出去玩，年轻一点，有设计感，别太正式",
    gender: "female",
    scene: "nightlife",
    desired: ["年轻", "有设计感"],
  });
  const cases = [
    ["top", "女士纯色短袖上衣"],
    ["bottom", "女士纯色直筒裤"],
    ["shoes", "女士纯色休闲鞋"],
  ];

  for (const [category, title] of cases) {
    const coreRequirement = requirement(category, {
      gender: "female",
      scene: "nightlife",
    });
    const baseline = evaluateProductAcceptance(
      product(title, {category, gender: "female"}),
      coreRequirement,
      ctx,
    );
    const untrustedCompletionMarkers = evaluateProductAcceptance(
      product(title, {category, gender: "female"}),
      {
        ...coreRequirement,
        style_role: "styling_completion",
        styling_completion_required: false,
        styling_completion_recommended: false,
      },
      ctx,
    );

    assert.equal(baseline.acceptance.result, "SOFT_REJECT");
    assert.equal(baseline.acceptance.penalty, 18);
    assert.deepEqual(untrustedCompletionMarkers, baseline);
    assert.equal(
      baseline.acceptance.evidence.contemporary_fit.applicability,
      EVIDENCE_APPLICABILITY.APPLICABLE,
    );
  }
});

test("A: young male date prefers contemporary casual footwear evidence", () => {
  const ctx = context();
  const req = requirement("shoes");
  const modern = evaluateProductAcceptance(
    product("男士简约时髦休闲鞋新款"),
    req,
    ctx,
  );
  const traditional = evaluateProductAcceptance(
    product("男士传统布鞋一脚蹬"),
    req,
    ctx,
  );
  assert.equal(modern.allowed, true);
  assert.equal(traditional.allowed, true);
  assert.ok(modern.acceptance.penalty < traditional.acceptance.penalty);
  assert.equal(
    traditional.acceptance.evidence.contemporary_fit.value,
    "mismatch",
  );
});

test("B: young female nightlife penalizes mature commuter expression", () => {
  const ctx = context({
    raw: "今晚出去玩，年轻一点，有设计感，别太正式",
    gender: "female",
    scene: "nightlife",
    desired: ["年轻", "有设计感"],
  });
  const req = requirement("shoes", {gender: "female", scene: "nightlife"});
  const modern = evaluateProductAcceptance(
    product("女款设计感轻量浅口鞋", {gender: "female"}),
    req,
    ctx,
  );
  const mature = evaluateProductAcceptance(
    product("女士成熟通勤妈妈款单鞋", {gender: "female"}),
    req,
    ctx,
  );
  assert.ok(modern.acceptance.penalty < mature.acceptance.penalty);
  assert.equal(mature.acceptance.evidence.audience_fit.value, "mismatch");
});

test("C: confirmed child product is a hard reject for an adult request", () => {
  const result = evaluateProductAcceptance(
    product("品牌男童短袖T恤", {category: "top"}),
    requirement("top"),
    context(),
  );
  assert.equal(result.allowed, false);
  assert.equal(result.acceptance.result, "HARD_REJECT");
  assert.deepEqual(result.acceptance.hard_reasons, [
    "AUDIENCE_SEVERE_MISMATCH",
  ]);
});

test("D: explicit business/formal intent does not reject mature business shoes", () => {
  const ctx = context({
    raw: "正式商务活动，需要稳重的正装",
    scene: "formal_event",
    desired: ["正式", "稳重"],
    explicitStyle: "formal",
  });
  const result = evaluateProductAcceptance(
    product("男士商务正装牛津皮鞋"),
    requirement("shoes", {scene: "formal_event", style: "formal"}),
    ctx,
  );
  assert.equal(result.allowed, true);
  assert.notEqual(result.acceptance.evidence.contemporary_fit.value, "mismatch");
  assert.notEqual(result.acceptance.evidence.occasion_fit.value, "mismatch");
});

test("E: explicit vintage/traditional intent allows traditional footwear", () => {
  const ctx = context({
    raw: "想要复古传统风格的日常穿搭",
    scene: "daily",
    desired: ["复古", "传统"],
    explicitStyle: "american_vintage",
  });
  const result = evaluateProductAcceptance(
    product("男士传统布鞋复古款"),
    requirement("shoes", {scene: "daily", style: "american_vintage"}),
    ctx,
  );
  assert.equal(result.allowed, true);
  assert.notEqual(result.acceptance.evidence.contemporary_fit.value, "mismatch");
});

test("F: a low-priced but supported fashionable product is not price-rejected", () => {
  const ctx = context({gender: "female", desired: ["有设计感", "时髦"]});
  const result = evaluateProductAcceptance(
    product("女款不对称拼接设计感上衣", {
      category: "top",
      gender: "female",
      price: 5,
      candidate_enrichment: {
        quality_evidence: {
          value: "evidence_available",
          source: "api_and_text",
          confidence: 0.8,
          evidence: ["title:立体剪裁"],
        },
      },
    }),
    requirement("top", {gender: "female"}),
    ctx,
  );
  assert.equal(result.allowed, true);
  assert.equal(
    result.acceptance.evidence.commerce_quality.value,
    "low_price_but_supported",
  );
});

test("G: a high price cannot overturn a severe aesthetic mismatch", () => {
  const ctx = context();
  const req = requirement("shoes");
  const suitable = evaluateProductAcceptance(
    product("男士简约时髦休闲鞋", {price: 129}),
    req,
    ctx,
  ).product;
  const expensiveMismatch = evaluateProductAcceptance(
    product("男士传统成熟布鞋一脚蹬", {price: 1299}),
    req,
    ctx,
  ).product;
  const assessment = {
    style_fit: 80,
    occasion_fit: 80,
    silhouette_fit: 75,
    color_fit: 75,
    footwear_fit: 80,
    quality_fit: 80,
    gender_fit: 100,
    style_classification: "TEST",
    occasion_classification: "TEST",
    metadata_missing: [],
  };
  const score = (item) => calibratedProductScore({
    assessment,
    relevanceScore: 80,
    blueprintMatchScore: 80,
    aestheticScore: 80,
    visualQualityScore: 70,
    bodyStrategyScore: 70,
    brandQualityScore: 90,
    product: item,
  }).finalScore;
  assert.ok(score(suitable) > score(expensiveMismatch));
});

function strategyProduct(lookId, category, id, title, overrides = {}) {
  return product(title, {
    look_id: lookId,
    category,
    original_category: category,
    product_id: id,
    image_url: `https://img.example.com/${id}.jpg`,
    style_match_score: 80,
    aesthetic_score: 80,
    final_score: 80,
    brand_quality_score: 60,
    body_strategy_match_score: 70,
    product_acceptance_penalty: 0,
    ...overrides,
  });
}

test("H: three distinct looks strongly penalize the same underlying core product", () => {
  const requirements = [];
  const products = [];
  for (let index = 1; index <= 3; index += 1) {
    const lookId = `look-${index}`;
    requirements.push(
      requirement("top", {look_id: lookId}),
      requirement("bottom", {look_id: lookId}),
      requirement("shoes", {look_id: lookId}),
    );
    products.push(
      strategyProduct(lookId, "top", `top-${index}`, `简约上衣${index}`),
      strategyProduct(lookId, "bottom", `bottom-${index}`, `直筒裤${index}`),
      strategyProduct(lookId, "shoes", `shared-listing-${index}`, "同一款简约休闲鞋", {
        final_score: 95,
        image_url: "https://img.example.com/shared-shoe.jpg?tracking=ignored",
      }),
    );
    if (index > 1) {
      products.push(strategyProduct(
        lookId,
        "shoes",
        `alternate-${index}`,
        `替代休闲鞋${index}`,
        {final_score: 84},
      ));
    }
  }
  const result = composeOutfitCandidates({
    requirements,
    products,
    context: context(),
  });
  const selectedShoes = result.products.filter((item) => item.category === "shoes");
  assert.equal(selectedShoes.length, 3);
  assert.equal(new Set(selectedShoes.map(canonicalProductIdentity)).size, 3);
  assert.equal(
    selectedShoes.filter((item) => item.title === "同一款简约休闲鞋").length,
    1,
  );
});

test("reranker fallback classification distinguishes timeout and parser errors", () => {
  assert.equal(
    classifyRerankerFailure({code: "AI_RERANK_TIMEOUT"}).category,
    "TIMEOUT",
  );
  assert.equal(
    classifyRerankerFailure({name: "SyntaxError", message: "invalid JSON"}).category,
    "SCHEMA_OR_RESPONSE_VALIDATION",
  );
});

test("shared pipeline records acceptance evidence from gate through Strategy", async () => {
  const lookId = "acceptance-trace-look";
  const requirements = [
    requirement("top", {look_id: lookId}),
    requirement("bottom", {look_id: lookId}),
    requirement("shoes", {look_id: lookId}),
  ];
  const candidates = {
    top: [
      product("品牌男童短袖T恤", {
        look_id: lookId,
        product_id: "child-top",
        category: "top",
      }),
      product("男士简约干净短袖T恤", {
        look_id: lookId,
        product_id: "adult-top",
        category: "top",
      }),
    ],
    bottom: [product("男士简约直筒长裤", {
      look_id: lookId,
      product_id: "adult-bottom",
      category: "bottom",
    })],
    shoes: [product("男士简约时髦休闲鞋", {
      look_id: lookId,
      product_id: "adult-shoes",
      category: "shoes",
    })],
  };
  const result = await runSharedCandidatePipeline({
    requirements,
    groups: requirements.map((item) => ({
      requirement: item,
      candidates: candidates[item.category],
    })),
    context: context(),
    provider: "taobao",
    logger: {info() {}, warn() {}},
    reranker: {
      async rerank({groups}) {
        return groups.flatMap((group) => group.candidates.map((item) => ({
          ...item,
          final_score: 80,
          ai_match_score: 80,
          ai_rerank_fallback: false,
        })));
      },
    },
  });
  const child = result.trace.gate_reject.find((item) =>
    item.candidate_id === "child-top");
  assert.equal(child.reason, "PRODUCT_ACCEPTANCE_AUDIENCE_SEVERE_MISMATCH");
  assert.equal(child.product_acceptance_result, "HARD_REJECT");
  assert.equal(
    child.product_acceptance_evidence.audience_fit.source,
    "explicit_product_text",
  );
  assert.equal(result.trace.reranker_executed, true);
  assert.equal(result.trace.strategy_executed, true);
  assert.equal(result.trace.strategy_selected.length, 3);
  assert.equal(result.trace.strategy_selected.every((item) =>
    item.product_acceptance_result !== null &&
    item.underlying_product_key.length === 24), true);
});

function slotCandidates(lookId, category, count, {gender = "female"} = {}) {
  const label = category === "top" ? "设计感上衣"
    : category === "bottom" ? "年轻时髦设计感休闲直筒裤"
      : "年轻时髦设计感现代轻量休闲鞋";
  return Array.from({length: count}, (_, index) => product(
    `${gender === "female" ? "女" : "男"}款${label}${index + 1}`,
    {
      look_id: lookId,
      product_id: `${lookId}-${category}-${index + 1}`,
      category,
      gender,
      relevance_score: 80 - index,
    },
  ));
}

test("Gate-pass underflow triggers bounded refill and new candidates cross the same Gate", async () => {
  const lookId = "refill-look";
  const requirements = ["top", "bottom", "shoes"].map((category) =>
    requirement(category, {look_id: lookId, gender: "female", scene: "nightlife"}));
  const refillCalls = [];
  let rerankerGroupCounts = null;
  const result = await runSharedCandidatePipeline({
    requirements,
    groups: requirements.map((item) => ({
      requirement: item,
      candidates: slotCandidates(
        lookId,
        item.category,
        item.category === "top" ? 1 : 4,
      ),
    })),
    context: context({
      gender: "female",
      scene: "nightlife",
      desired: ["年轻", "有设计感"],
    }),
    provider: "taobao",
    logger: {info() {}, warn() {}},
    refillCandidates: async ({requirement: item, round}) => {
      refillCalls.push({slot: item.category, round});
      return {
        queries: [{query: "女 上衣 设计感", page_no: 2}],
        candidates: [
          product("女童设计感短袖", {
            look_id: lookId,
            product_id: "refill-child-top",
            category: "top",
            gender: "female",
          }),
          ...slotCandidates(lookId, "top", 3).map((item, index) => ({
            ...item,
            product_id: `refill-adult-top-${index + 1}`,
            image_url: `https://img.example.com/refill-adult-top-${index + 1}.jpg`,
          })),
        ],
      };
    },
    reranker: {
      async rerank({groups}) {
        rerankerGroupCounts = Object.fromEntries(groups.map((group) => [
          group.requirement.category,
          group.candidates.length,
        ]));
        return groups.flatMap((group) => group.candidates.map((item) => ({
          ...item,
          final_score: 80,
          ai_match_score: 80,
          ai_rerank_fallback: false,
        })));
      },
    },
  });
  assert.deepEqual(refillCalls, [{slot: "top", round: 1}]);
  assert.equal(rerankerGroupCounts.top, 4);
  assert.equal(result.trace.refill_trigger_count, 1);
  assert.equal(result.trace.refill_rounds[0].accepted_count, 3);
  assert.equal(result.trace.refill_rounds[0].after_count, 4);
  assert.equal(result.trace.gate_reject.some((entry) =>
    entry.candidate_id === "refill-child-top"), true);
  assert.equal(result.products.some((item) =>
    item.product_id === "refill-child-top"), false);
});

test("refill exhaustion reports INSUFFICIENT_QUALITY_CANDIDATES without reviving rejects", async () => {
  const requirements = [];
  const groups = [];
  for (const lookId of ["complete-look", "insufficient-look"]) {
    for (const category of ["top", "bottom", "shoes"]) {
      const item = requirement(category, {
        look_id: lookId,
        gender: "female",
        scene: "nightlife",
      });
      requirements.push(item);
      groups.push({
        requirement: item,
        candidates: lookId === "insufficient-look" && category === "top"
          ? [] : slotCandidates(lookId, category, 4),
      });
    }
  }
  await assert.rejects(() => runSharedCandidatePipeline({
    requirements,
    groups,
    context: context({gender: "female", scene: "nightlife"}),
    provider: "taobao",
    minimumCompleteLooks: 2,
    logger: {info() {}, warn() {}},
    refillCandidates: async ({requirement: item}) => ({
      candidates: item.look_id === "insufficient-look" && item.category === "top"
        ? [product("男童工作装上衣", {
          look_id: item.look_id,
          product_id: "rejected-refill-child",
          category: "top",
          gender: "male",
        })] : [],
    }),
    reranker: {async rerank() { throw new Error("must not reach reranker"); }},
  }), (error) => {
    assert.equal(error.code, "INSUFFICIENT_QUALITY_CANDIDATES");
    const trace = error.details.trace;
    const outcome = trace.slot_outcomes.find((entry) =>
      entry.look_id === "insufficient-look" && entry.slot === "top");
    assert.equal(outcome.status, "INSUFFICIENT_QUALITY_CANDIDATES");
    assert.equal(trace.refill_rounds.length, 2);
    assert.equal(trace.gate_reject.some((entry) =>
      entry.candidate_id === "rejected-refill-child"), true);
    assert.equal(trace.gate_pass.some((entry) =>
      entry.candidate_id === "rejected-refill-child"), false);
    return true;
  });
});

test("Auto provider forwards the child provider candidate trace", async () => {
  const childTrace = {request_id: "trace-id", strategy_selected: []};
  const auto = new AutoProductProvider({
    taobao: {
      lastPipelineTrace: childTrace,
      async recommendForQueries() { return []; },
    },
    allowMockFallback: false,
    logger: {warn() {}},
  });
  await auto.recommendForQueries([], {});
  assert.equal(auto.lastPipelineTrace, childTrace);
});

test("Auto provider never disguises insufficient quality as Mock success", async () => {
  let mockCalls = 0;
  const auto = new AutoProductProvider({
    taobao: {
      async recommendForQueries() {
        throw new ProductProviderError("insufficient", {
          code: "INSUFFICIENT_QUALITY_CANDIDATES",
          status: 422,
        });
      },
    },
    mock: {
      async recommendForQueries() {
        mockCalls += 1;
        return [];
      },
    },
    allowMockFallback: true,
    logger: {warn() {}},
  });
  await assert.rejects(
    auto.recommendForQueries([], {}),
    (error) => error.code === "INSUFFICIENT_QUALITY_CANDIDATES",
  );
  assert.equal(mockCalls, 0);
});
