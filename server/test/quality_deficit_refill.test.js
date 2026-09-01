"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildDeficitRefillQuery,
  diagnoseQualityDeficit,
} = require("../quality_deficit_refill");
const {
  normalizeCommerceSearchSignal,
} = require("../commerce_search_signal_normalizer");
const {
  buildCandidateRefillQueries,
  runSharedCandidatePipeline,
} = require("../product_provider");

function requirement(category, query, signal) {
  return {
    look_id: "quality-look",
    concept_id: "quality-concept",
    category,
    gender: "female",
    scene: "nightlife",
    search_keywords: [query, `${query} ${signal}`],
    commerce_query_plan: {
      version: "concept_search_query_planner.v2",
      query_candidates: [
        {query_id: "Q1", query},
        {query_id: "Q2", query: `${query} ${signal}`,
          aesthetic_signal: signal},
      ],
      fallback_query: {query: `女 ${category}`},
    },
  };
}

function designRequirement(category, query) {
  const item = requirement(category, query, "年轻");
  item.commerce_query_plan.intent = {
    desired_impression: ["年轻", "设计感"],
    formality: "relaxed",
    statement_level: "medium",
  };
  return item;
}

function candidate(id, category, title, color = "") {
  return {
    id,
    product_id: id,
    candidate_id: id,
    look_id: "quality-look",
    concept_id: "quality-concept",
    category,
    original_category: category,
    original_gender: "female",
    gender: "female",
    title,
    color,
    price: 120,
    source: "mock",
    is_mock: true,
  };
}

function withTargetFit(product, {style, silhouette, color}) {
  return {
    ...product,
    target_fit_assessment: {
      style_fit: {score: style},
      silhouette_fit: {score: silhouette},
      color_fit: {score: color},
    },
  };
}

function rawTaobaoRefillCandidate(id, category, title) {
  return {
    id,
    product_id: id,
    candidate_id: id,
    category,
    original_category: category,
    original_gender: "female",
    gender: "female",
    title,
    price: 299,
    image_url: `https://img.alicdn.com/${id}.jpg`,
    shop_name: "真实商品店铺",
    source: "taobao",
    is_mock: false,
  };
}

function rejectedLook() {
  const quality = {
    status: "FAIL",
    overall_score: 56,
    dimension_scores: {
      scene: 35,
      desired_impression: 72,
      contemporary: 70,
      style: 65,
      silhouette: 45,
      color: 40,
      footwear: 68,
      quality: 55,
      body: 60,
      statement: 70,
    },
  };
  return {
    look_id: "quality-look",
    whole_look_quality: quality,
    rejected_combination_traces: [{
      candidate_ids: ["base-top", "base-bottom", "base-shoes"],
      whole_look_quality: quality,
      strategy_trace: {
        slotOccasionFitSummary: {slots: [
          {slot: "top", score: 35},
          {slot: "bottom", score: 65},
          {slot: "shoes", score: 68},
        ]},
        slotColorFitSummary: {slots: [
          {slot: "top", score: 70},
          {slot: "bottom", score: 40},
          {slot: "shoes", score: 65},
        ]},
      },
    }],
  };
}

test("commerce signal normalization removes conversational degree wording", () => {
  const cases = new Map([
    ["有设计感", "设计感"],
    ["设计一点", "设计感"],
    ["更年轻", "年轻"],
    ["年轻一点", "年轻"],
    ["更时髦", "时髦"],
    ["时髦一点", "时髦"],
    ["更宽松", "宽松"],
    ["宽松一点", "宽松"],
  ]);
  for (const [input, expected] of cases) {
    assert.equal(normalizeCommerceSearchSignal(input), expected);
  }
});

test("diagnosis selects one weakest dimension per round and affected slots", () => {
  const groups = [
    {requirement: requirement("top", "女 短袖上衣", "年轻"),
      candidates: [withTargetFit(
        candidate("base-top", "top", "白色短袖", "white"),
        {style: 45, silhouette: 70, color: 70},
      )]},
    {requirement: requirement("bottom", "女 半身裙", "年轻"),
      candidates: [withTargetFit(
        candidate("base-bottom", "bottom", "高腰半身裙"),
        {style: 70, silhouette: 70, color: 40},
      )]},
    {requirement: requirement("shoes", "女 单鞋", "设计感"),
      candidates: [withTargetFit(
        candidate("base-shoes", "shoes", "黑色单鞋", "black"),
        {style: 70, silhouette: 45, color: 70},
      )]},
  ];
  const context = {intent: {user_intent_brain: {desired_impression: {
    value: ["年轻", "有设计感"],
  }}}};
  const first = diagnoseQualityDeficit({
    rejectedLook: rejectedLook(), groups, round: 1, context,
  });
  assert.deepEqual(first.weakest_dimensions.slice(0, 3), [
    {dimension: "scene", score: 35},
    {dimension: "color", score: 40},
    {dimension: "silhouette", score: 45},
  ]);
  assert.deepEqual(first.quality_dimension_gaps.map((entry) => ({
    slot: entry.slot,
    style_gap: entry.style_gap,
    silhouette_gap: entry.silhouette_gap,
    color_gap: entry.color_gap,
  })), [
    {slot: "top", style_gap: 15, silhouette_gap: 0, color_gap: 0},
    {slot: "bottom", style_gap: 0, silhouette_gap: 0, color_gap: 20},
    {slot: "shoes", style_gap: 0, silhouette_gap: 15, color_gap: 0},
  ]);
  assert.deepEqual(first.targeted_quality_gaps, [
    {dimension: "color", slot: "bottom", score: 40, gap: 20},
    {dimension: "style", slot: "top", score: 45, gap: 15},
  ]);
  assert.equal(first.focus_dimension, "color");
  assert.deepEqual(first.failing_slots, ["bottom"]);
  assert.equal(first.signal_by_slot.bottom, "白色");
  assert.equal(first.refill_reason,
    "FINAL_QUALITY_SUPPLY_DEFICIT:COLOR:BOTTOM");

  const second = diagnoseQualityDeficit({
    rejectedLook: rejectedLook(), groups, round: 2, context,
  });
  assert.equal(second.focus_dimension, "style");
  assert.deepEqual(second.failing_slots, ["top"]);
  assert.equal(second.signal_by_slot.top, "设计感");
});

test("deficit query keeps the Q1 category and adds exactly one gap signal", () => {
  const item = requirement("top", "女 短袖上衣", "年轻");
  const diagnosis = {
    focus_dimension: "scene",
    focus_score: 35,
    failing_slots: ["top"],
    signal_by_slot: {top: "聚会"},
  };
  const query = buildDeficitRefillQuery(item, diagnosis, 1);
  assert.equal(query.query, "女 短袖上衣 聚会");
  assert.equal(query.query_type, "DEFICIT_SCENE");
  assert.equal(query.searchable_signal_budget.aesthetic_terms, 1);
  assert.equal(query.searchable_signal_budget.max_aesthetic_terms, 1);
  assert.equal(buildDeficitRefillQuery(
    requirement("bottom", "女 半身裙", "年轻"),
    diagnosis,
    1,
  ), null);
});

test("quality refill reuses a concrete bottom subtype with one intent signal", () => {
  const diagnosis = {
    focus_dimension: "scene",
    focus_score: 35,
    failing_slots: ["bottom"],
    signal_by_slot: {bottom: "聚会"},
  };
  const query = buildDeficitRefillQuery(
    designRequirement("bottom", "女 直筒裤"),
    diagnosis,
    1,
  );
  assert.equal(query.query, "女 半身裙 设计感");
  assert.equal(query.quality_query_reuse, true);
  assert.equal(query.quality_query_reuse_reason,
    "VALIDATED_SPECIFIC_BOTTOM_SUBCATEGORY");
  assert.equal(query.searchable_signal_budget.aesthetic_terms, 1);
});

test("quality refill reuses concrete footwear without a long query", () => {
  const diagnosis = {
    focus_dimension: "desired_impression",
    focus_score: 40,
    failing_slots: ["shoes"],
    signal_by_slot: {shoes: "设计感"},
  };
  const query = buildDeficitRefillQuery(
    designRequirement("shoes", "女 单鞋"),
    diagnosis,
    1,
  );
  assert.equal(query.query, "女 乐福鞋 设计感");
  assert.equal(query.quality_query_reuse, true);
  assert.equal(query.searchable_signal_budget.max_aesthetic_terms, 1);
  assert.equal(query.query.split(/\s+/u).length, 3);
});

test("neutral intent does not force the validated female subtype", () => {
  const diagnosis = {
    focus_dimension: "scene",
    focus_score: 35,
    failing_slots: ["bottom"],
    signal_by_slot: {bottom: "日常"},
  };
  const query = buildDeficitRefillQuery(
    requirement("bottom", "女 直筒裤", "简约"),
    diagnosis,
    1,
  );
  assert.equal(query.query, "女 直筒裤 日常");
  assert.equal(query.quality_query_reuse, false);
});

test("quality failure refills only its diagnosed slot and re-enters the pipeline", async () => {
  const requirements = [
    requirement("top", "女 短袖上衣", "年轻"),
    requirement("bottom", "女 半身裙", "年轻"),
    requirement("shoes", "女 单鞋", "设计感"),
  ];
  const groups = requirements.map((item) => ({
    requirement: item,
    candidates: [candidate(`base-${item.category}`, item.category,
      `女 ${item.category} 基础候选`)],
  }));
  const calls = [];
  const quality = {
    status: "PASS",
    overall_score: 68,
    dimension_scores: {
      scene: 60, desired_impression: 65, contemporary: 65, style: 65,
      silhouette: 60, color: 60, footwear: 65, quality: 60,
      body: 60, statement: 60,
    },
  };
  const result = await runSharedCandidatePipeline({
    requirements,
    groups,
    provider: "mock",
    context: {
      gender: "female",
      scene: "nightlife",
      intent: {user_intent_brain: {desired_impression: {
        value: ["年轻", "有设计感"],
        source: "user",
        confidence: 1,
      }}},
    },
    reranker: {rerank: async ({groups: rerankGroups}) =>
      rerankGroups.flatMap((group) => group.candidates)},
    refillCandidates: async ({requirement: item, round, qualityDeficit}) => {
      const query = buildCandidateRefillQueries(
        item,
        round,
        qualityDeficit,
      )[0];
      calls.push({slot: item.category, round, qualityDeficit, query});
      return {
        queries: [{query: "女 短袖上衣 聚会"}],
        returned_count: 1,
        candidates: [rawTaobaoRefillCandidate(
          "refill-scene-top",
          "top",
          "女士白色短款方领设计感派对短袖上衣",
        )],
      };
    },
    outfitPostProcessor: ({products}) => {
      const hasRefill = products.some((item) =>
        item.product_id === "refill-scene-top");
      if (!hasRefill) {
        return {applied: true, products: [], looks: [],
          rejected_looks: [rejectedLook()]};
      }
      const selected = products.filter((item) => [
        "refill-scene-top", "base-bottom", "base-shoes",
      ].includes(item.product_id)).map((item) => ({
        ...item,
        whole_look_quality_status: "PASS",
        whole_look_quality: quality,
      }));
      return {applied: true, products: selected, looks: [{
        look_id: "quality-look",
        selected_candidate_ids: selected.map((item) => item.product_id),
        whole_look_quality: quality,
      }], rejected_looks: []};
    },
  });
  assert.equal(result.looks.length, 1);
  assert.equal(result.looks[0].whole_look_quality.status, "PASS");
  assert.deepEqual(calls.map((entry) => [entry.slot, entry.round]), [["top", 1]]);
  assert.equal(calls[0].qualityDeficit.focus_dimension, "style");
  assert.deepEqual(calls[0].qualityDeficit.quality_intent_signals,
    ["年轻", "有设计感"]);
  assert.equal(calls[0].query.query, "女 短袖上衣 设计感");
  assert.equal(calls[0].query.searchable_signal_budget.aesthetic_terms, 1);
  assert.equal(result.trace.quality_deficit_diagnoses.length, 1);
  assert.equal(result.trace.refill_rounds[0].accepted_count, 1);
  const refillRaw = result.trace.raw_candidates.find((entry) =>
    entry.candidate_id === "refill-scene-top");
  assert.equal(refillRaw.source, "taobao");
  assert.equal(refillRaw.candidate_enrichment.schema_version,
    "enriched_candidate_v1");
  assert.ok(refillRaw.candidate_enrichment.style_expression.value
    .includes("design_expression"));
  assert.ok(refillRaw.candidate_enrichment.occasion_expression.value
    .includes("nightlife_social"));
  assert.ok(refillRaw.candidate_enrichment.desired_impression_evidence.value
    .includes("design_led"));
  assert.equal(refillRaw.candidate_enrichment.raw_product_ref.source, "taobao");
  assert.equal(refillRaw.candidate_enrichment.raw_product_ref.item_id,
    "refill-scene-top");
  assert.ok(refillRaw.candidate_enrichment.silhouette_evidence.value
    .includes("cropped"));
  assert.equal(refillRaw.candidate_enrichment.occasion_evidence.value[0],
    "party");
  assert.equal(result.trace.gate_reject.some((entry) =>
    entry.candidate_id === "refill-scene-top"), false);
});
