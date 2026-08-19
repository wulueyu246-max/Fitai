"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ShoppingCandidateFunnelStore,
  buildCandidateFunnelDiagnostic,
} = require("../shopping_candidate_funnel_store");

test("candidate funnel diagnostic includes a sanitized V2 trace without mutating result", () => {
  const result = sampleResult("request-1");
  const before = structuredClone(result);
  const diagnostic = buildCandidateFunnelDiagnostic(result);
  assert.equal(diagnostic.trace_version, 2);
  assert.equal(diagnostic.slots[0].final_candidate_count, 1);
  assert.equal(diagnostic.trace.slots[0].search.query, "女 短款 上衣");
  assert.equal(diagnostic.trace.slots[0].candidate_gate.decisions.length, 2);
  assert.equal(diagnostic.trace.slots[0].selector.assessments[0].status, "KEEP");
  assert.equal(diagnostic.trace.composer.looks.length, 2);
  assert.equal(JSON.stringify(diagnostic).includes("secret-query"), false);
  assert.equal(JSON.stringify(diagnostic).includes("buyer@example.com"), false);
  assert.deepEqual(result, before);
});

test("candidate funnel persistence is disabled by default and fails open", async () => {
  const calls = [];
  const disabled = new ShoppingCandidateFunnelStore({
    url: "https://project.supabase.co",
    serviceRoleKey: "server-only-key",
    fetchImpl: async (...args) => {
      calls.push(args);
      return new Response(null, {status: 201});
    },
  });
  assert.equal(await disabled.persist(sampleResult("request-disabled")), false);
  assert.equal(calls.length, 0);

  const warnings = [];
  const failing = new ShoppingCandidateFunnelStore({
    url: "https://project.supabase.co",
    serviceRoleKey: "server-only-key",
    enabled: true,
    fetchImpl: async () => new Response(null, {status: 503}),
    logger: {warn: (...args) => warnings.push(args)},
  });
  assert.equal(await failing.persist(sampleResult("request-failure")), false);
  assert.equal(warnings.length, 1);
});

function sampleResult(requestId) {
  const slots = [
    slotSelection("top", "女 短款 上衣", "candidate_top", "短款针织上衣"),
    slotSelection("bottom", "女 高腰 裤", "candidate_bottom", "高腰直筒裤"),
    slotSelection("shoes", "女 低帮 鞋", "candidate_shoes", "简洁低帮鞋"),
  ];
  const result = {
    request_id: requestId,
    state: "success",
    authoritative_gender: "female",
    shopping_intent: {
      gender: "female",
      persona: {expression: "feminine_or_neutral_feminine"},
      overall_aesthetic: {core_direction: "clean_fit", traits: ["轻盈"]},
      body_strategy: {proportion: "leg_elongation"},
      occasion: {primary: "daily"},
      budget: {},
      slots: slots.map((selection) => selection.slot),
    },
    slot_metrics: slots.map((selection) => ({
      slot_key: selection.slot_key,
      category: selection.slot.category,
      query: selection.query,
      raw_candidate_count: 2,
      valid_candidate_count: 2,
      candidate_gate_pass: 1,
      candidate_gate_fail: 1,
      selector_keep: 1,
      selector_reject: 0,
      selector_uncertain: 0,
      final_candidate_pool: selection.final_candidate_pool.map((item) =>
        item.candidate_id),
    })),
    looks: [],
    final_look_count: 2,
    ai_call_count: 5,
    taobao_call_count: 3,
    timings: {total_ms: 1234},
  };
  Object.defineProperty(result, "diagnostic_source", {
    enumerable: false,
    value: {
      shopping_intent: result.shopping_intent,
      selections: slots,
      validated_looks: {
        looks: [
          composedLook("look-1", "candidate_top", "candidate_bottom", "candidate_shoes", 82),
          composedLook("look-2", "candidate_top", "candidate_bottom", "candidate_shoes", 78),
        ],
        candidate_reference_audit: [{look_id: "look-1", top_id_valid: true,
          bottom_id_valid: true, shoes_id_valid: true}],
        look_diversity_status: "LIMITED",
        structural_duplicate_detected: true,
        exact_duplicate_detected: false,
      },
    },
  });
  return result;
}

function slotSelection(category, query, candidateId, title) {
  const candidate = {
    candidate_id: candidateId,
    product_id: candidateId,
    title,
    price: 129,
    brand: "测试品牌",
    category,
    image_url: `https://img.example.com/${category}.jpg?secret-query=1`,
    purchase_url: "https://buy.example.com/item?token=secret",
    aesthetic_tags: ["clean"],
    silhouette_tags: ["fitted"],
    detail_tags: ["buyer@example.com"],
    variation_axes: {expression: "feminine"},
  };
  const failed = {...candidate, candidate_id: null, product_id: `${candidateId}_failed`,
    title: "错类目商品"};
  const slot = {category, gender: "female", role: `${category} role`,
    hard_constraints: ["female"], soft_preferences: ["轻盈"], avoid: ["厚重"],
    search_query: query};
  return {
    slot,
    slot_key: `request:${category}`,
    query,
    round: 1,
    raw_count: 2,
    valid_count: 2,
    candidate_gate_pass: 1,
    candidate_gate_fail: 1,
    candidates: [candidate],
    diagnostic_gate_assessments: [
      {product: candidate, candidate_id: candidateId,
        gate: {status: "PASS", reason_codes: []}},
      {product: failed, candidate_id: null,
        gate: {status: "FAIL", reason_codes: ["CATEGORY_MISMATCH"]}},
    ],
    selector_status: "SUCCESS",
    selector_ai_status: "SUCCESS",
    selector_ai_candidate_ids: [candidateId],
    selector_keep: 1,
    selector_reject: 0,
    selector_uncertain: 0,
    assessments: [{candidate_id: candidateId, status: "KEEP",
      selection_tier: "HIGH", scores: {aesthetic_fit: 82},
      reason_codes: ["STRONG_AESTHETIC_FIT"]}],
    final_candidate_pool: [candidate],
    refinement: {refinement_attempted: false, refinement_status: "NOT_NEEDED"},
  };
}

function composedLook(lookId, top, bottom, shoes, finalScore) {
  return {look_id: lookId, candidate_ids: {top, bottom, shoes},
    scores: {final_score: finalScore}, structural_diversity_status: "LIMITED"};
}

module.exports = {sampleResult};
