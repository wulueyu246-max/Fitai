"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const express = require("express");
const {ShoppingCandidateFunnelStore} = require("../shopping_candidate_funnel_store");
const {registerShoppingAgentDiagnosticsRoutes} =
  require("../shopping_agent_diagnostics_routes");
const {exportDiagnostic} = require("../tools/export_shopping_agent_diagnostics");

const TOKEN = "diagnostics-test-token-with-at-least-32-chars";

test("diagnostics V2 persists, reads, and exports the full sanitized trace", async () => {
  const database = fakeSupabase();
  const store = createStore(database.fetch);
  const result = diagnosticResult("request-e2e");
  assert.equal(await store.persist(result), true);

  const server = await startServer(store, TOKEN);
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "fitai-diagnostics-"));
  try {
    const byId = await fetch(`${server.baseUrl}/internal/shopping-agent-diagnostics/request-e2e`, {
      headers: {authorization: `Bearer ${TOKEN}`},
    });
    assert.equal(byId.status, 200);
    const trace = (await byId.json()).diagnostic;
    assert.equal(trace.slots[0].search.query, "女 短款 上衣");
    assert.equal(trace.slots[0].candidate_gate.decisions[0].status, "PASS");
    assert.equal(trace.slots[0].selector.assessments[0].scores.aesthetic_fit, 84);
    assert.equal(trace.composer.looks[0].top_candidate_id, "top-1");

    const latest = await fetch(`${server.baseUrl}/internal/shopping-agent-diagnostics/latest`, {
      headers: {authorization: `Bearer ${TOKEN}`},
    });
    assert.equal(latest.status, 200);
    assert.equal((await latest.json()).diagnostic.request_id, "request-e2e");

    const exported = await exportDiagnostic({
      baseUrl: server.baseUrl,
      requestId: "request-e2e",
      token: TOKEN,
      outputDirectory,
    });
    const source = JSON.parse(fs.readFileSync(exported.sourcePath, "utf8"));
    const candidates = JSON.parse(fs.readFileSync(exported.candidatesPath, "utf8"));
    assert.deepEqual(source.slots[0].selector.assessments,
      trace.slots[0].selector.assessments);
    assert.deepEqual(source.composer, trace.composer);
    assert.equal(candidates.top[0].candidate_id, "top-1");
    assert.equal(candidates.top[0].candidate_gate.status, "PASS");
    assert.equal(candidates.top[0].selector.status, "KEEP");
    const serialized = JSON.stringify(source);
    assert.equal(serialized.includes("purchase_url"), false);
    assert.equal(serialized.includes("private-token"), false);
    assert.equal(serialized.includes("buyer@example.com"), false);
    assert.equal(source.slots[0].recall.candidates[0].image_url,
      "https://img.example.com/top.jpg");
  } finally {
    await server.close();
    fs.rmSync(outputDirectory, {recursive: true, force: true});
  }
});

test("diagnostics keeps only the newest 20 traces", async () => {
  const database = fakeSupabase();
  const store = createStore(database.fetch);
  for (let index = 1; index <= 22; index += 1) {
    assert.equal(await store.persist(diagnosticResult(`request-${index}`)), true);
  }
  assert.equal(database.rows.length, 20);
  assert.equal(await store.readByRequestId("request-1"), null);
  assert.equal((await store.latest()).request_id, "request-22");
});

test("diagnostics reads require a configured matching token and return explicit 404", async () => {
  const database = fakeSupabase();
  const store = createStore(database.fetch);
  await store.persist(diagnosticResult("request-protected"));
  const withoutTokenServer = await startServer(store, "");
  try {
    const unavailable = await fetch(
      `${withoutTokenServer.baseUrl}/internal/shopping-agent-diagnostics/latest`,
    );
    assert.equal(unavailable.status, 503);
  } finally {
    await withoutTokenServer.close();
  }
  const server = await startServer(store, TOKEN);
  try {
    const denied = await fetch(
      `${server.baseUrl}/internal/shopping-agent-diagnostics/request-protected`,
      {headers: {authorization: "Bearer wrong-token"}},
    );
    assert.equal(denied.status, 403);
    const missing = await fetch(
      `${server.baseUrl}/internal/shopping-agent-diagnostics/not-found`,
      {headers: {authorization: `Bearer ${TOKEN}`}},
    );
    assert.equal(missing.status, 404);
  } finally {
    await server.close();
  }
});

function createStore(fetchImpl) {
  return new ShoppingCandidateFunnelStore({
    url: "https://project.supabase.co",
    serviceRoleKey: "service-role-key",
    enabled: true,
    fetchImpl,
    logger: {warn() {}},
  });
}

async function startServer(store, token) {
  const app = express();
  registerShoppingAgentDiagnosticsRoutes({app, store, token, enabled: true});
  const listener = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  return {
    baseUrl: `http://127.0.0.1:${listener.address().port}`,
    close: () => new Promise((resolve, reject) => {
      listener.closeAllConnections?.();
      listener.close((error) => error ? reject(error) : resolve());
    }),
  };
}

function fakeSupabase() {
  const rows = [];
  let sequence = 0;
  return {
    rows,
    fetch: async (input, init = {}) => {
      const url = new URL(String(input));
      const method = String(init.method || "GET").toUpperCase();
      if (method === "POST") {
        const body = JSON.parse(init.body);
        sequence += 1;
        rows.push({...body,
          id: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
          created_at: new Date(1_700_000_000_000 + sequence).toISOString()});
        return new Response(null, {status: 201});
      }
      if (method === "DELETE") {
        const ids = String(url.searchParams.get("id") || "")
          .replace(/^in\.\(/, "").replace(/\)$/, "").split(",");
        for (let index = rows.length - 1; index >= 0; index -= 1) {
          if (ids.includes(rows[index].id)) rows.splice(index, 1);
        }
        return new Response(null, {status: 204});
      }
      let selected = [...rows].sort((left, right) =>
        right.created_at.localeCompare(left.created_at));
      const requestFilter = url.searchParams.get("request_id");
      if (requestFilter?.startsWith("eq.")) {
        selected = selected.filter((row) => row.request_id === requestFilter.slice(3));
      }
      const offset = Number(url.searchParams.get("offset") || 0);
      const limit = Number(url.searchParams.get("limit") || selected.length);
      selected = selected.slice(offset, offset + limit);
      if (url.searchParams.get("select") === "id") {
        selected = selected.map(({id}) => ({id}));
      }
      return Response.json(selected);
    },
  };
}

function diagnosticResult(requestId) {
  const selections = [
    selection("top", "女 短款 上衣", "top-1"),
    selection("bottom", "女 高腰 裤", "bottom-1"),
    selection("shoes", "女 低帮 鞋", "shoes-1"),
  ];
  const shoppingIntent = {
    gender: "female",
    persona: {expression: "feminine_or_neutral_feminine"},
    overall_aesthetic: {core_direction: "clean_fit", traits: ["轻盈"]},
    body_strategy: {proportion: "leg_elongation"},
    occasion: {primary: "daily"},
    budget: {},
    slots: selections.map((item) => item.slot),
  };
  const result = {
    request_id: requestId,
    state: "success",
    authoritative_gender: "female",
    shopping_intent: shoppingIntent,
    slot_metrics: selections.map((item) => ({slot_key: item.slot_key,
      category: item.slot.category, query: item.query, raw_candidate_count: 2,
      valid_candidate_count: 2, candidate_gate_pass: 1, candidate_gate_fail: 1,
      selector_keep: 1, selector_reject: 0, selector_uncertain: 0,
      final_candidate_pool: [item.final_candidate_pool[0].candidate_id]})),
    final_look_count: 2,
    ai_call_count: 5,
    taobao_call_count: 3,
    timings: {total_ms: 2345},
  };
  Object.defineProperty(result, "diagnostic_source", {enumerable: false, value: {
    shopping_intent: shoppingIntent,
    selections,
    validated_looks: {looks: [
      look("look-1", 84), look("look-2", 79),
    ], candidate_reference_audit: [{look_id: "look-1", top_id_valid: true,
      bottom_id_valid: true, shoes_id_valid: true}], look_diversity_status: "PASS"},
  }});
  return result;
}

function selection(category, query, candidateId) {
  const candidate = {candidate_id: candidateId, product_id: candidateId,
    title: `${category} buyer@example.com`, price: 128, brand: "测试品牌",
    category, image_url: `https://img.example.com/${category}.jpg?token=private-token`,
    purchase_url: "https://buy.example.com/item?token=private-token",
    aesthetic_tags: ["clean"], silhouette_tags: ["fitted"],
    detail_tags: ["refined"], variation_axes: {expression: "feminine"}};
  const failed = {...candidate, candidate_id: null, product_id: `${candidateId}-fail`,
    title: `wrong-${category}`};
  return {slot: {category, gender: "female", role: `${category} foundation`,
    hard_constraints: ["female"], soft_preferences: ["轻盈"], avoid: ["厚重"],
    search_query: query}, slot_key: `${category}-slot`, query, round: 1,
    raw_count: 2, valid_count: 2, candidate_gate_pass: 1, candidate_gate_fail: 1,
    candidates: [candidate], diagnostic_gate_assessments: [
      {product: candidate, candidate_id: candidateId,
        gate: {status: "PASS", reason_codes: []}},
      {product: failed, candidate_id: null,
        gate: {status: "FAIL", reason_codes: ["CATEGORY_MISMATCH"]}},
    ], selector_status: "SUCCESS", selector_ai_status: "SUCCESS",
    selector_ai_candidate_ids: [candidateId], selector_keep: 1,
    selector_reject: 0, selector_uncertain: 0,
    assessments: [{candidate_id: candidateId, status: "KEEP",
      selection_tier: "HIGH", scores: {aesthetic_fit: 84},
      reason_codes: ["STRONG_AESTHETIC_FIT"]}],
    final_candidate_pool: [candidate],
    refinement: {refinement_attempted: false, refinement_status: "NOT_NEEDED"}};
}

function look(lookId, score) {
  return {look_id: lookId, candidate_ids: {top: "top-1", bottom: "bottom-1",
    shoes: "shoes-1"}, scores: {final_score: score},
    structural_diversity_status: "PASS"};
}
