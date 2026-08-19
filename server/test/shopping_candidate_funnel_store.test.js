"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ShoppingCandidateFunnelStore,
  buildCandidateFunnelDiagnostic,
} = require("../shopping_candidate_funnel_store");

test("candidate funnel diagnostic derives counts without changing candidate data", () => {
  const result = {
    request_id: "request-1",
    state: "success",
    slot_metrics: [{
      slot_key: "top",
      category: "top",
      raw_candidate_count: 20,
      valid_candidate_count: 15,
      candidate_gate_pass: 8,
      selector_ai_input_count: 8,
      selector_keep: 4,
      final_candidate_pool: ["real-1", "real-2"],
    }],
    final_look_count: 2,
  };
  const before = structuredClone(result);
  const diagnostic = buildCandidateFunnelDiagnostic(result);
  assert.equal(diagnostic.slots[0].final_candidate_count, 2);
  assert.equal(diagnostic.slots[0].candidate_gate_pass, 8);
  assert.deepEqual(result, before);
  assert.equal(JSON.stringify(diagnostic).includes("real-1"), false);
});

test("candidate funnel persistence appends diagnostics and fails open", async () => {
  const calls = [];
  const store = new ShoppingCandidateFunnelStore({
    url: "https://project.supabase.co",
    serviceRoleKey: "server-only-key",
    fetchImpl: async (url, init) => {
      calls.push({url: String(url), init});
      return new Response(null, {status: 201});
    },
  });
  assert.equal(await store.persist({request_id: "request-1", state: "success"}), true);
  assert.match(calls[0].url, /shopping_candidate_funnel_diagnostics$/);
  assert.equal(JSON.parse(calls[0].init.body).request_id, "request-1");

  const warnings = [];
  const failing = new ShoppingCandidateFunnelStore({
    url: "https://project.supabase.co",
    serviceRoleKey: "server-only-key",
    fetchImpl: async () => new Response(null, {status: 503}),
    logger: {warn: (...args) => warnings.push(args)},
  });
  assert.equal(await failing.persist({request_id: "request-2", state: "success"}), false);
  assert.equal(warnings.length, 1);
});
