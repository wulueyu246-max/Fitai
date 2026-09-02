"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  config,
  createOutfitDecisionContext,
} = require("../index");
const {
  LookConceptCompileError,
  compileLookConceptPortfolio,
} = require("../look_concept_compiler");
const {
  MockProductProvider,
  ProductProviderError,
} = require("../product_provider");
const {
  NewDecisionPipelineError,
  comparePipelineOutcomes,
  executeNewDecisionPipeline,
  publicProductForResponse,
  validateFinalPortfolio,
} = require("../new_decision_pipeline");

test("public Final Look contract retains only allowlisted real image provenance", () => {
  const output = publicProductForResponse({
    product_id: "real-image-1",
    source: "taobao",
    image_url: "//img.alicdn.com/item.jpg?token=remove-me",
    white_image: "//img.alicdn.com/white.jpg",
    pict_url: "//img.alicdn.com/item.jpg",
    image_provenance: {
      status: "AVAILABLE",
      source: "taobao_raw_product",
      image_url: "//img.alicdn.com/item.jpg?token=remove-me",
      white_image: "//img.alicdn.com/white.jpg",
      pict_url: "//img.alicdn.com/item.jpg",
      selected_field: "white_image",
      confidence: 1,
      evidence: ["raw_product.media.white_image"],
      observed_at: "2026-09-01T00:00:00.000Z",
      secret: "must-not-pass",
    },
  });

  assert.equal(output.image_url, "https://img.alicdn.com/item.jpg");
  assert.equal(output.white_image, "https://img.alicdn.com/white.jpg");
  assert.equal(output.image_provenance.status, "AVAILABLE");
  assert.equal(output.image_provenance.secret, undefined);
  assert.doesNotMatch(JSON.stringify(output), /remove-me|must-not-pass/u);
});

const silentLogger = Object.freeze({info() {}, warn() {}, error() {}});

function productId(item = {}) {
  return String(item.candidate_id || item.product_id || item.id || "");
}

function request(overrides = {}) {
  return {
    requestId: "33333333-3333-4333-8333-333333333333",
    rawUserInput: "今晚喝酒，随便搭3套",
    gender: "female",
    scene: "nightlife",
    itemBudget: "500-1000",
    outfitBudget: "1000-2000",
    explicitStyle: "",
    explicitRequirements: [],
    explicitAvoid: [],
    explicitPreferences: [],
    height: 160,
    weight: 50,
    structuredBodyProfile: {leg_length_relation: "short"},
    ...overrides,
  };
}

function context(overrides = {}) {
  return createOutfitDecisionContext(request(overrides), {
    provider: "mock",
    timestamp: "2026-08-28T00:00:00.000Z",
  });
}

function product(id, category, {
  gender = "female",
  style = "minimal",
  tags = [],
  occasion = "daily",
  color = "black",
  price = 220,
  fit = "balanced",
  subcategory = "",
} = {}) {
  return {
    id,
    product_id: id,
    candidate_id: id,
    source: "mock",
    title: `${style} ${fit} ${category} ${tags.join(" ")}`,
    name: `${style} ${category}`,
    brand: "Contract Fixture",
    category,
    ...(subcategory ? {subcategory} : {}),
    gender,
    original_gender: gender,
    style,
    style_tags: [style, fit, ...tags],
    occasion,
    occasions: [occasion, "daily"],
    occasion_tags: [occasion, "daily"],
    price,
    color,
    image_url: `https://example.com/${id}.jpg`,
    quality_tier: "mid",
    material: "cotton",
    tags: [style, fit, ...tags],
    stock_status: "in_stock",
  };
}

function portfolioCatalog({gender = "female", style = "minimal", extras = []} = {}) {
  const values = [];
  for (const category of ["top", "bottom", "shoes"]) {
    for (let index = 0; index < 4; index += 1) {
      values.push(product(`${style}-${category}-${index + 1}`, category, {
        gender,
        style,
        occasion: "date",
        color: ["black", "white", "beige", "blue"][index],
        fit: ["polished", "relaxed", "expressive", "balanced"][index],
        tags: category === "shoes" ? ["sneaker", "non_leather"] : [],
        price: 180 + index * 20,
      }));
    }
  }
  for (let index = 0; index < 4; index += 1) {
    values.push(product(`${style}-skirt-${index + 1}`, "bottom", {
      gender,
      style,
      occasion: "date",
      color: ["black", "white", "beige", "blue"][index],
      fit: ["polished", "relaxed", "expressive", "balanced"][index],
      subcategory: "skirt",
      tags: ["skirt"],
      price: 180 + index * 20,
    }));
  }
  values.push(...extras);
  return {
    async recommend(filters = {}) {
      return values.filter((entry) => entry.category === filters.category)
        .slice(0, filters.limit || 12).map((entry) => ({...entry}));
    },
  };
}

function bodySensitiveCatalog({gender = "female", style = "minimal"} = {}) {
  const tagsBySlot = {
    top: ["短款 修身", "合身", "短款", "盖臀 长款 宽松"],
    bottom: ["高腰 直筒", "中高腰 九分", "高腰 A字", "低腰"],
    shoes: ["浅口 低跟", "尖头", "浅口", "高帮 厚重"],
  };
  const values = [];
  for (const category of ["top", "bottom", "shoes"]) {
    for (let index = 0; index < 4; index += 1) {
      values.push(product(`${style}-body-${category}-${index + 1}`, category, {
        gender,
        style,
        occasion: "daily",
        color: ["black", "white", "beige", "blue"][index],
        fit: tagsBySlot[category][index],
        subcategory: category === "bottom" ? "skirt" : "",
        tags: [
          ...(index === 2 ? ["expressive"] : []),
          ...(category === "shoes" ? ["non_leather"] : []),
        ],
      }));
    }
  }
  return {
    async recommend(filters = {}) {
      return values.filter((entry) => entry.category === filters.category)
        .slice(0, filters.limit || 12).map((entry) => ({...entry}));
    },
  };
}

function marketContrastCatalog() {
  const values = [];
  for (const category of ["top", "bottom", "shoes"]) {
    for (let index = 0; index < 3; index += 1) {
      values.push(product(`current-${category}-${index + 1}`, category, {
        style: "minimal",
        subcategory: category === "bottom" ? "skirt" : "",
        tags: ["soft_warm_neutrals", "relaxed_tailored_balance",
          ...(index === 2 ? ["expressive"] : []),
          ...(category === "shoes" ? ["slim_profile_loafer"] : [])],
        price: 220 + index,
      }));
      values.push(product(`niche-${category}-${index + 1}`, category, {
        style: "minimal",
        subcategory: category === "bottom" ? "skirt" : "",
        tags: ["deep_oxblood_accent", "refined_individuality",
          ...(index === 2 ? ["expressive"] : [])],
        price: 220 + index,
      }));
    }
  }
  return {
    async recommend(filters = {}) {
      return values.filter((entry) => entry.category === filters.category)
        .slice(0, filters.limit || 12).map((entry) => ({...entry}));
    },
  };
}

function qualityPassingTestPostProcessor({requirements, products}) {
  const quality = Object.freeze({status: "PASS", overall_score: 80,
    reason_codes: Object.freeze([])});
  const selected = [];
  const looks = [];
  const used = new Set();
  for (const lookId of [...new Set(requirements.map((item) => item.look_id))]) {
    const lookProducts = [];
    for (const requirement of requirements.filter((item) =>
      item.look_id === lookId)) {
      const candidate = products.filter((item) => item.look_id === lookId &&
        item.category === requirement.category &&
        !used.has(productId(item))).sort((left, right) =>
        Number(right.market_soft_match_score || 0) -
        Number(left.market_soft_match_score || 0))[0];
      if (!candidate) break;
      lookProducts.push(candidate);
      used.add(productId(candidate));
    }
    if (lookProducts.length !== requirements.filter((item) =>
      item.look_id === lookId).length) continue;
    selected.push(...lookProducts.map((item) => ({...item,
      outfit_strategy_score: 80,
      outfit_occasion_formality_score: 80,
      outfit_target_profile_match_score: 80,
      outfit_strategy_breakdown: {occasion_fit: 80, style_coherence: 80},
      whole_look_quality_status: "PASS",
      whole_look_quality: quality,
    })));
    looks.push({look_id: lookId, whole_look_quality: quality,
      selected_candidate_ids: lookProducts.map(productId)});
  }
  return {applied: true, products: selected, looks, rejected_looks: []};
}

function provider(catalog, options = {}) {
  return new MockProductProvider({catalog, logger: silentLogger, ...options});
}

test("feature flag defaults to the legacy path", () => {
  assert.equal(config.newDecisionPipelineEnabled, false);
});

test("LookConceptCompiler creates an independent immutable contract per concept", () => {
  const decisionContext = context();
  const compiled = compileLookConceptPortfolio(decisionContext);
  assert.equal(compiled.looks.length, 3);
  assert.equal(compiled.trace.legacy_blueprint_consumed, false);
  assert.equal(new Set(compiled.looks.map((look) => look.look_id)).size, 3);
  assert.equal(new Set(compiled.trace.independent_contracts
    .map((entry) => entry.contract_identity)).size, 3);
  assert.equal(compiled.looks.every((look) => look.items.length === 3), true);
  assert.equal(compiled.looks.every((look) =>
    look.items.every((item) => item.decision_authority.body_fit === "soft" &&
      item.decision_authority.market === "soft_capped")), true);
});

test("A: open nightlife request produces three distinct candidate-backed concepts", async () => {
  const result = await executeNewDecisionPipeline({
    decisionContext: context(),
    productProvider: provider(portfolioCatalog()),
    logger: silentLogger,
  });
  assert.equal(result.looks.length, 3);
  assert.equal(new Set(result.looks.map((look) => look.concept_id)).size, 3);
  assert.equal(new Set(result.looks.flatMap((look) =>
    look.selected_candidate_ids)).size, 9);
  assert.equal(result.decision_pipeline.portfolio_validation.status, "PASS");
  assert.equal(result.decision_pipeline.legacy_blueprint_calls, 0);
});

test("B: explicit Cityboy lock and no-leather-shoes survive every final Look", async () => {
  const decisionContext = context({
    requestId: "44444444-4444-4444-8444-444444444444",
    rawUserInput: "我想穿Cityboy去约会，不要皮鞋",
    gender: "male",
    scene: "date",
    explicitStyle: "cityboy",
    explicitAvoid: ["leather_shoes"],
  });
  const result = await executeNewDecisionPipeline({
    decisionContext,
    productProvider: provider(portfolioCatalog({gender: "male", style: "cityboy"})),
    logger: silentLogger,
  });
  assert.equal(result.looks.length >= 2, true);
  assert.equal(result.looks.every((look) => look.style === "cityboy"), true);
  assert.equal(result.looks.flatMap((look) => look.selected_products)
    .every((item) => Number(item.style_fit_score) >= 50), true);
  assert.equal(result.looks.flatMap((look) => look.selected_products)
    .filter((item) => item.category === "shoes")
    .some((item) => /(?:^|[^a-z_])leather(?:$|[^a-z_])|皮鞋|皮革|oxford|derby|loafer|乐福/iu
      .test(`${item.title} ${(item.style_tags || []).join(" ")}`)), false);
  assert.equal(result.decision_pipeline.portfolio_validation.checks.style_lock, true);
  assert.equal(result.decision_pipeline.portfolio_validation.checks.avoid_compliance, true);
});

test("C: current-trend market evidence is consumed as a capped soft score", async () => {
  const result = await executeNewDecisionPipeline({
    decisionContext: context({
      requestId: "55555555-5555-4555-8555-555555555555",
      rawUserInput: "我最近想穿流行一点",
      scene: "daily",
    }),
    productProvider: provider(portfolioCatalog({
      extras: [
        product("market-hot-top", "top", {
          tags: ["soft_warm_neutrals", "relaxed_tailored_balance"],
        }),
        product("market-hot-bottom", "bottom", {
          tags: ["soft_warm_neutrals", "relaxed_tailored_balance"],
        }),
        product("market-hot-shoes", "shoes", {
          tags: ["slim_profile_loafer", "retro_low_profile_trainer"],
        }),
      ],
    })),
    logger: silentLogger,
  });
  const selected = result.looks.flatMap((look) => look.selected_products);
  assert.equal(selected.every((item) => Number.isFinite(item.market_soft_match_score)), true);
  assert.equal(selected.some((item) => item.market_soft_match_score > 60), true);
  assert.equal(selected.some((item) => productId(item).startsWith("market-hot-")), true);
  assert.equal(result.looks.every((look) =>
    Number.isFinite(look.outfit_strategy_breakdown.market_alignment)), true);
  assert.equal(selected.every((item) => item.market_influence_cap == null), true);
});

test("BodyFit is a production soft score and does not become a hard aesthetic gate", async () => {
  const result = await executeNewDecisionPipeline({
    decisionContext: context({
      requestId: "56565656-5656-4565-8565-565656565656",
      rawUserInput: "日常穿搭",
      scene: "daily",
      height: 160,
      structuredBodyProfile: {leg_length_relation: "short"},
    }),
    productProvider: provider(bodySensitiveCatalog()),
    logger: silentLogger,
  });
  const selected = result.looks.flatMap((look) => look.selected_products);
  assert.equal(selected.every((item) => item.body_strategy_configured === true), true);
  assert.equal(selected.some((item) => item.body_strategy_match_score > 60), true);
  assert.equal(selected.some((item) => /低腰/u.test(item.title)), false);
  assert.equal(result.looks.every((look) =>
    Number.isFinite(look.outfit_strategy_breakdown.body_proportion)), true);
});

test("D: niche preference changes market evidence and final product selection", async () => {
  const current = context({
    requestId: "66666666-6666-4666-8666-666666666666",
    rawUserInput: "我最近想穿流行一点",
  });
  const niche = context({
    requestId: "77777777-7777-4777-8777-777777777777",
    rawUserInput: "不要烂大街，小众一点",
  });
  const currentRequirements = compileLookConceptPortfolio(current).requirements;
  const nicheRequirements = compileLookConceptPortfolio(niche).requirements;
  const currentSignals = new Set(currentRequirements.flatMap((item) =>
    item.market_soft_signals));
  const nicheSignals = new Set(nicheRequirements.flatMap((item) =>
    item.market_soft_signals));
  assert.equal(niche.intent.user_intent_brain.mainstream_vs_niche.value, "niche");
  assert.notDeepEqual([...nicheSignals].sort(), [...currentSignals].sort());
  assert.equal(nicheRequirements.every((item) => item.market_influence_cap <= 0.08), true);
  const catalog = marketContrastCatalog();
  const currentResult = await executeNewDecisionPipeline({
    decisionContext: current,
    productProvider: provider(catalog, {
      outfitPostProcessor: qualityPassingTestPostProcessor,
    }),
    logger: silentLogger,
  });
  const nicheResult = await executeNewDecisionPipeline({
    decisionContext: niche,
    productProvider: provider(catalog, {
      outfitPostProcessor: qualityPassingTestPostProcessor,
    }),
    logger: silentLogger,
  });
  const currentIds = currentResult.looks.flatMap((look) =>
    look.selected_candidate_ids);
  const nicheIds = nicheResult.looks.flatMap((look) =>
    look.selected_candidate_ids);
  assert.equal(currentIds.every((id) => id.startsWith("current-")), true);
  assert.equal(nicheIds.every((id) => id.startsWith("niche-")), true);
});

test("E: identical body facts preserve different clean_fit and street silhouettes", async () => {
  const run = async (style, id) => executeNewDecisionPipeline({
    decisionContext: context({
      requestId: id,
      rawUserInput: style,
      gender: "male",
      scene: "daily",
      explicitStyle: style,
      height: 172,
      weight: 66,
      structuredBodyProfile: {
        shoulder_relation: "normal",
        leg_length_relation: "short",
      },
    }),
    productProvider: provider(portfolioCatalog({gender: "male", style})),
    logger: silentLogger,
  });
  const clean = await run("clean_fit", "88888888-8888-4888-8888-888888888888");
  const street = await run("street", "99999999-9999-4999-8999-999999999999");
  const cleanStyles = new Set(clean.looks.flatMap((look) =>
    look.selected_products.flatMap((item) => item.style_tags)));
  const streetStyles = new Set(street.looks.flatMap((look) =>
    look.selected_products.flatMap((item) => item.style_tags)));
  assert.equal(cleanStyles.has("clean_fit"), true);
  assert.equal(streetStyles.has("street"), true);
  assert.equal(cleanStyles.has("street"), false);
  assert.equal(streetStyles.has("clean_fit"), false);
  assert.notDeepEqual(
    clean.decision_context.concepts[0].body_fit_strategy,
    street.decision_context.concepts[0].body_fit_strategy,
  );
  assert.equal(clean.looks.flatMap((look) => look.selected_products)
    .every((item) => Number.isFinite(item.body_strategy_match_score)), true);
});

test("requested three Looks returns two quality-valid native Looks without forcing a third", async () => {
  const decisionContext = context({
    requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    rawUserInput: "今晚出去玩，帮我搭3套",
  });
  const compiled = compileLookConceptPortfolio(decisionContext);
  const acceptedLookIds = new Set(compiled.looks.slice(0, 2)
    .map((look) => look.look_id));
  const baseProvider = provider(portfolioCatalog());
  const partialProvider = {
    async recommendForQueries(requirements, providerInput) {
      const products = await baseProvider.recommendForQueries(
        requirements,
        providerInput,
      );
      return products.filter((item) => acceptedLookIds.has(item.look_id));
    },
    get lastPipelineTrace() {
      return baseProvider.lastPipelineTrace;
    },
  };

  const result = await executeNewDecisionPipeline({
    decisionContext,
    productProvider: partialProvider,
    logger: silentLogger,
  });

  assert.equal(result.looks.length, 2);
  assert.equal(result.decision_pipeline.fallback_used, false);
  assert.equal(
    result.decision_pipeline.portfolio_validation.fulfillment_status,
    "PARTIAL",
  );
  assert.equal(
    result.decision_pipeline.portfolio_validation.fulfillment_reason,
    "INSUFFICIENT_QUALITY_LOOKS",
  );
  assert.equal(
    result.decision_pipeline.portfolio_validation.requested_look_count,
    3,
  );
  assert.equal(
    result.decision_pipeline.portfolio_validation.quality_valid_look_count,
    2,
  );
  assert.equal(
    result.decision_pipeline.portfolio_validation.unfulfilled_look_ids.length,
    1,
  );
});

test("requested three Looks returns one quality-valid native Look instead of lower-quality filler", async () => {
  const decisionContext = context({
    requestId: "abababab-abab-4bab-8bab-abababababab",
    rawUserInput: "今晚出去玩，帮我搭3套",
  });
  const compiled = compileLookConceptPortfolio(decisionContext);
  const acceptedLookId = compiled.looks[0].look_id;
  const baseProvider = provider(portfolioCatalog());
  const partialProvider = {
    async recommendForQueries(requirements, providerInput) {
      const products = await baseProvider.recommendForQueries(
        requirements,
        providerInput,
      );
      return products.filter((item) => item.look_id === acceptedLookId);
    },
    get lastPipelineTrace() {
      return baseProvider.lastPipelineTrace;
    },
  };

  const result = await executeNewDecisionPipeline({
    decisionContext,
    productProvider: partialProvider,
    logger: silentLogger,
  });

  assert.equal(result.looks.length, 1);
  assert.equal(result.decision_pipeline.fallback_used, false);
  assert.equal(
    result.decision_pipeline.portfolio_validation.fulfillment_status,
    "PARTIAL",
  );
  assert.equal(
    result.decision_pipeline.portfolio_validation.fulfillment_reason,
    "INSUFFICIENT_QUALITY_LOOKS",
  );
  assert.equal(
    result.decision_pipeline.portfolio_validation.quality_valid_look_count,
    1,
  );
  assert.equal(
    result.decision_pipeline.portfolio_validation.unfulfilled_look_ids.length,
    2,
  );
  assert.equal(result.looks.every((look) => look.selected_products.every((item) =>
    item.whole_look_quality_status === "PASS")), true);
});

test("zero whole-look quality PASS fails closed without entering Optional", async () => {
  const decisionContext = context({
    requestId: "acacacac-acac-4cac-8cac-acacacacacac",
  });
  const baseProvider = provider(portfolioCatalog());
  let providerCalls = 0;
  const unprovenProvider = {
    async recommendForQueries(requirements, providerInput) {
      providerCalls += 1;
      const products = await baseProvider.recommendForQueries(
        requirements,
        providerInput,
      );
      return products.map(({whole_look_quality: _quality,
        whole_look_quality_status: _status, ...item}) => item);
    },
    get lastPipelineTrace() {
      return baseProvider.lastPipelineTrace;
    },
  };

  await assert.rejects(
    executeNewDecisionPipeline({
      decisionContext,
      productProvider: unprovenProvider,
      logger: silentLogger,
    }),
    (error) => error instanceof NewDecisionPipelineError &&
      error.code === "INSUFFICIENT_QUALITY_LOOKS" &&
      error.stage === "PORTFOLIO_VALIDATOR" &&
      error.fallbackAllowed === false,
  );
  assert.equal(providerCalls, 1);
});

test("Portfolio rejects a complete Look that lacks whole-look quality proof", async () => {
  const decisionContext = context({
    requestId: "adadadad-adad-4dad-8dad-adadadadadad",
  });
  const compiled = compileLookConceptPortfolio(decisionContext);
  const baseProvider = provider(portfolioCatalog());
  const products = await baseProvider.recommendForQueries(
    compiled.requirements,
    {gender: "female", scene: "nightlife"},
  );
  const unproven = products.map(({whole_look_quality: _quality,
    whole_look_quality_status: _status, ...item}) => item);

  const validation = validateFinalPortfolio({
    decisionContext,
    compiled,
    products: unproven,
  });

  assert.equal(validation.status, "FAIL");
  assert.equal(validation.quality_valid_look_count, 0);
  assert.equal(validation.looks.length, 0);
  assert.equal(validation.unfulfilled_look_ids.length, compiled.looks.length);
  assert.equal(validation.validation_trace.validator_input_look_count,
    compiled.looks.length);
  assert.equal(validation.validation_trace.quality_valid_look_count, 0);
  assert.equal(validation.validation_trace.reject_count, compiled.looks.length);
  assert.equal(validation.validation_trace.looks.every((look) =>
    look.final_quality.status === "FAIL" &&
      look.coreValidation.errors.includes(`QUALITY_INVALID:${look.look_id}`) &&
      look.validator_rules.FINAL_QUALITY.status === "FAIL" &&
      typeof look.concept_id === "string"), true);
  assert.equal(validation.validation_trace.portfolio_rules.LOOK_COUNT.status,
    "FAIL");
  assert.equal(validation.validation_trace.final_portfolio_failure_reason,
    "LOOK_COUNT_OUT_OF_RANGE");
});

test("Portfolio consumes the Strategy scene-fit value from its final Look contract", () => {
  const decisionContext = context({
    requestId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    itemBudget: "100-150",
  });
  const compiled = compileLookConceptPortfolio(decisionContext);
  const contract = compiled.looks[0];
  const quality = Object.freeze({
    version: "whole_look_human_grounded_score.v1",
    status: "PASS",
    overall_score: 72,
    final_score: 72,
    baseline_integrity_score: 79,
    intent_expression: {
      dimensions: {
        scene_expression_strength: {score: 68},
        desired_impression_coverage: {score: 71},
        design_interest: {score: 74},
      },
    },
  });
  const products = contract.items.map((requirement, index) => ({
    ...product(`trace-${requirement.category}-${index}`, requirement.category, {
      price: 220,
    }),
    look_id: contract.look_id,
    concept_id: contract.concept_id,
    candidate_id: `trace-${requirement.category}-${index}`,
    body_strategy_match_score: 70,
    outfit_strategy_breakdown: {occasion_fit: 70},
    outfit_strategy_trace: {occasionFormalityFit: 70},
    whole_look_quality_status: "PASS",
    whole_look_quality: quality,
  }));
  const validation = validateFinalPortfolio({
    decisionContext,
    compiled: Object.freeze({...compiled, looks: Object.freeze([contract])}),
    products,
  });

  assert.equal(validation.status, "FAIL");
  assert.equal(validation.validation_trace.validator_input_look_count, 1);
  assert.equal(validation.validation_trace.looks[0].final_quality.score, 72);
  assert.equal(validation.validation_trace.looks[0].final_quality.status, "PASS");
  assert.equal(validation.validation_trace.looks[0].human_grounded_score, 72);
  assert.equal(validation.validation_trace.looks[0].baseline_score, 79);
  assert.equal(validation.validation_trace.looks[0].scene_score, 68);
  assert.equal(validation.validation_trace.looks[0]
    .intent_scores.design_interest, 74);
  assert.equal(validation.validation_trace.looks[0]
    .validator_rules.ITEM_BUDGET.status, "FAIL");
  assert.equal(validation.validation_trace.looks[0]
    .validator_rules.SCENE_FIT_SIGNAL.status, "PASS");
  assert.equal(validation.validation_trace.looks[0]
    .validator_rules.SCENE_FIT_SIGNAL.actual, 3);
  assert.equal(validation.errors.some((error) =>
    error.startsWith("SCENE_FIT_SIGNAL_MISSING:")), false);
  assert.match(validation.validation_trace.looks[0].first_reject_reason,
    /^ITEM_BUDGET_CONFLICT:/u);
  assert.equal(validation.validation_trace.first_reject_reason,
    validation.errors[0]);
  assert.equal(validation.validation_trace.final_portfolio_failure_reason,
    validation.errors[0]);

  const missingSceneProducts = products.map(({
    outfit_strategy_breakdown: _breakdown,
    outfit_strategy_trace: _trace,
    ...product
  }) => product);
  const missingSceneValidation = validateFinalPortfolio({
    decisionContext,
    compiled: Object.freeze({...compiled, looks: Object.freeze([contract])}),
    products: missingSceneProducts,
  });
  assert.equal(missingSceneValidation.errors.some((error) =>
    error.startsWith("SCENE_FIT_SIGNAL_MISSING:")), true);
});

test("provider/contract failure is explicit and eligible for visible legacy fallback", async () => {
  const brokenProvider = {
    async recommendForQueries() {
      throw new ProductProviderError("contract unavailable", {
        code: "PRODUCT_CONTRACT_UNAVAILABLE",
      });
    },
  };
  await assert.rejects(
    executeNewDecisionPipeline({
      decisionContext: context(),
      productProvider: brokenProvider,
      logger: silentLogger,
    }),
    (error) => error instanceof NewDecisionPipelineError &&
      error.fallbackAllowed === true &&
      error.stage === "PRODUCT_PROVIDER_CONTRACT" &&
      error.code === "PRODUCT_CONTRACT_UNAVAILABLE",
  );
});

test("invalid contexts fail compilation instead of silently using legacy Blueprint", () => {
  assert.throws(
    () => compileLookConceptPortfolio({concepts: []}),
    (error) => error instanceof LookConceptCompileError &&
      error.code === "LOOK_CONCEPT_PORTFOLIO_NOT_COMPILABLE",
  );
});

test("Legacy vs New comparison reports all takeover metrics", () => {
  const comparison = comparePipelineOutcomes({
    legacy: {user_intent_retention: 0.6, product_duplicate_rate: 0.5},
    next: {user_intent_retention: 1, product_duplicate_rate: 0},
  });
  assert.equal(comparison.user_intent_retention.new, 1);
  assert.equal(comparison.product_duplicate_rate.new, 0);
  assert.deepEqual(Object.keys(comparison), [
    "user_intent_retention",
    "body_fit_usage",
    "concept_diversity",
    "style_accuracy",
    "scene_fit",
    "budget_compliance",
    "avoid_compliance",
    "product_duplicate_rate",
  ]);
});
