"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  MAX_PROMPT_BYTES,
  WholeLookAIAdjudicator,
} = require("../whole_look_ai_adjudicator");

function look(id, score, overrides = {}) {
  return {
    look_candidate_id: id,
    deterministic_quality_status: "PASS",
    deterministic_quality_score: score,
    scene: "date",
    style: "clean contemporary",
    selected_products: [
      {category: "top", title: `${id} fine-knit top`, color: "ivory"},
      {category: "bottom", title: `${id} tailored trousers`, color: "navy"},
      {category: "shoes", title: `${id} low-profile shoes`, color: "black"},
    ],
    ...overrides,
  };
}

function fakeClient(handler) {
  const calls = [];
  return {
    calls,
    chat: {completions: {create: async (...args) => {
      calls.push(args);
      return handler(...args);
    }}},
  };
}

function response(payload) {
  return {choices: [{message: {content: JSON.stringify(payload)}}]};
}

test("88 vs 60 stays deterministic and does not call AI", async () => {
  const client = fakeClient(() => {
    throw new Error("must not be called");
  });
  const adjudicator = new WholeLookAIAdjudicator({client});
  const result = await adjudicator.adjudicate([look("look-a", 88), look("look-b", 60)]);

  assert.equal(result.winner_look_candidate_id, "look-a");
  assert.equal(result.source, "DETERMINISTIC");
  assert.equal(result.trace.status, "DETERMINISTIC_MARGIN_CLEAR");
  assert.equal(result.trace.score_gap, 28);
  assert.equal(client.calls.length, 0);
});

test("84 vs 83 invokes qwen3.7-plus with bounded low-variance request", async () => {
  const client = fakeClient(() => response({
    winner_look_candidate_id: "look-b",
    confidence: 0.78,
    short_reason: "整体比例和约会场景更协调",
  }));
  const adjudicator = new WholeLookAIAdjudicator({client});
  const result = await adjudicator.adjudicate({
    candidates: [look("look-a", 84), look("look-b", 83)],
    context: {
      decision_context: {
        user_truth: {gender: "female", scene: "nightlife"},
        intent: {user_intent_brain: {
          desired_impression: {value: ["年轻", "有设计感"]},
          explicit_avoid: {value: ["太正式"]},
        }},
      },
    },
  });

  assert.equal(result.winner_look_candidate_id, "look-b");
  assert.equal(result.source, "AI");
  assert.equal(result.trace.request_id, null);
  assert.equal(client.calls.length, 1);
  const [payload, requestOptions] = client.calls[0];
  assert.equal(payload.model, "qwen3.7-plus");
  assert.equal(payload.max_tokens, 192);
  assert.ok(payload.temperature <= 0.2);
  assert.equal(requestOptions.maxRetries, 0);
  assert.ok(requestOptions.timeout <= 6_000);
  assert.ok(result.trace.prompt_bytes < MAX_PROMPT_BYTES);
  const prompt = JSON.parse(payload.messages[1].content);
  assert.deepEqual(prompt.intent.desired_impression, ["年轻", "有设计感"]);
  assert.deepEqual(prompt.intent.avoid, ["太正式"]);
  assert.equal(prompt.intent.scene, "nightlife");
});

test("quality floor failures and hard rejects never enter the AI payload", async () => {
  const client = fakeClient(() => response({
    winner_look_candidate_id: "good-b",
    confidence: 0.7,
    short_reason: "配色更完整",
  }));
  const candidates = [
    look("floor-fail-secret", 99, {deterministic_quality_status: "FAIL"}),
    look("hard-reject-secret", 98, {hard_reject: true}),
    look("good-a", 84),
    look("good-b", 83),
  ];
  const result = await new WholeLookAIAdjudicator({client}).adjudicate(candidates);
  const prompt = JSON.stringify(client.calls[0][0].messages);

  assert.equal(prompt.includes("floor-fail-secret"), false);
  assert.equal(prompt.includes("hard-reject-secret"), false);
  assert.deepEqual(result.trace.considered_candidate_ids, ["good-a", "good-b"]);
  assert.equal(result.trace.excluded_candidates.length, 2);
});

test("invented winner safely falls back to deterministic quality-valid top", async () => {
  const client = fakeClient(() => response({
    winner_look_candidate_id: "invented-look",
    confidence: 0.99,
    short_reason: "虚构候选",
  }));
  const result = await new WholeLookAIAdjudicator({client}).adjudicate([
    look("safe-top", 84),
    look("safe-second", 83),
  ]);

  assert.equal(result.winner_look_candidate_id, "safe-top");
  assert.equal(result.fallback, true);
  assert.equal(result.fallback_reason, "AI_WINNER_NOT_ALLOWED");
});

test("timeout falls back without retrying", async () => {
  const client = fakeClient(() => new Promise(() => {}));
  const adjudicator = new WholeLookAIAdjudicator({client, timeoutMs: 20});
  const result = await adjudicator.adjudicate([
    look("safe-top", 84),
    look("safe-second", 83),
  ]);

  assert.equal(result.winner_look_candidate_id, "safe-top");
  assert.equal(result.fallback_reason, "AI_ADJUDICATION_TIMEOUT");
  assert.equal(client.calls.length, 1);
});

test("only the top three eligible candidates are sent and prompt stays bounded", async () => {
  const client = fakeClient(() => response({
    winner_look_candidate_id: "look-1",
    confidence: 0.6,
    short_reason: "完整度略高",
  }));
  const verbose = "很长的造型证据".repeat(2_000);
  const candidates = [
    look("look-1", 84, {quality_evidence: verbose}),
    look("look-2", 83, {quality_evidence: verbose}),
    look("look-3", 82, {quality_evidence: verbose}),
    look("look-4", 81, {quality_evidence: verbose}),
  ];
  const result = await new WholeLookAIAdjudicator({client}).adjudicate({
    candidates,
    context: {body_notes: verbose, avoid: verbose},
  });
  const prompt = JSON.stringify(client.calls[0][0].messages);

  assert.equal(result.trace.considered_candidate_count, 3);
  assert.equal(result.trace.truncated_candidate_count, 1);
  assert.equal(prompt.includes("look-4"), false);
  assert.ok(Buffer.byteLength(prompt, "utf8") < MAX_PROMPT_BYTES);
});

test("one session permits at most two AI calls", async () => {
  const client = fakeClient(() => response({
    winner_look_candidate_id: "look-a",
    confidence: 0.6,
    short_reason: "整体略优",
  }));
  const adjudicator = new WholeLookAIAdjudicator({client});
  const session = adjudicator.createSession();
  const input = {candidates: [look("look-a", 84), look("look-b", 83)], session};

  await adjudicator.adjudicate(input);
  await adjudicator.adjudicate(input);
  const third = await adjudicator.adjudicate(input);

  assert.equal(client.calls.length, 2);
  assert.equal(third.fallback_reason, "AI_CALL_BUDGET_EXHAUSTED");
  assert.equal(third.winner_look_candidate_id, "look-a");
});

test("accepts whole-look quality strategy alternatives directly", async () => {
  const client = fakeClient(() => response({
    winner_look_candidate_id: "combo-b",
    confidence: 0.66,
    short_reason: "轮廓维度更协调",
  }));
  const alternatives = [
    {
      look_candidate_id: "combo-a",
      adjusted_score: 84,
      candidate_ids: ["top-a", "bottom-a", "shoes-a"],
      whole_look_quality: {status: "PASS", overall_score: 84},
    },
    {
      look_candidate_id: "combo-b",
      adjusted_score: 83,
      candidate_ids: ["top-b", "bottom-b", "shoes-b"],
      whole_look_quality: {status: "PASS", overall_score: 83},
    },
  ];
  const result = await new WholeLookAIAdjudicator({client}).adjudicate({
    requestId: "request-1",
    lookId: "look-1",
    candidates: alternatives,
  });

  assert.equal(result.winner_look_candidate_id, "combo-b");
  assert.equal(result.trace.request_id, "request-1");
  assert.equal(result.trace.look_id, "look-1");
});
