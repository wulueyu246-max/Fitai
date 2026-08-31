"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildAmbiguityPlan,
  detectGroupAmbiguity,
  deterministicScore,
} = require("../product_reranker_ambiguity");
const {
  ProductAestheticReranker,
} = require("../product_aesthetic_reranker");
const {
  runSharedCandidatePipeline,
} = require("../product_provider");

const silentLogger = Object.freeze({info() {}, warn() {}, error() {}});

function evidence(value = "match", confidence = 0.9, facts = ["fixture"]) {
  return Object.freeze({
    value,
    source: "contract_fixture",
    confidence,
    evidence: Object.freeze([...facts]),
  });
}

function acceptanceEvidence(overrides = {}) {
  return Object.freeze({
    audience_fit: evidence(),
    contemporary_fit: evidence(),
    occasion_fit: evidence(),
    desired_impression_fit: evidence(),
    visual_quality: evidence("high"),
    commerce_quality: evidence("supported"),
    product_identity_confidence: evidence("high"),
    ...overrides,
  });
}

function productionRealisticTitle(slot) {
  if (slot === "bottom") return "男士简约时髦直筒长裤";
  if (slot === "shoes") return "男士简约时髦低帮休闲鞋";
  return "男士简约干净短袖T恤";
}

function candidate(id, score, {
  lookId = "look-1",
  slot = "top",
  title = productionRealisticTitle(slot),
  gender = "male",
  styleTags = ["modern"],
  acceptanceResult = "PASS",
  acceptance = acceptanceEvidence(),
} = {}) {
  return {
    product_id: id,
    candidate_id: id,
    look_id: lookId,
    source: "taobao",
    is_mock: false,
    title,
    category: slot,
    original_category: slot,
    gender,
    original_gender: gender,
    price: 199,
    image_url: `https://img.example.com/${id}.jpg`,
    style: styleTags[0] || "modern",
    style_tags: [...styleTags],
    occasion_tags: ["date", "daily"],
    relevance_score: score,
    final_score: score,
    deterministic_reranker_score: score,
    product_acceptance_result: acceptanceResult,
    product_acceptance_penalty: acceptanceResult === "PASS" ? 0 : 5,
    product_acceptance_evidence: acceptance,
  };
}

function group(lookId, slot, candidates, overrides = {}) {
  return {
    requirement: {
      look_id: lookId,
      concept_id: `concept-${lookId}`,
      category: slot,
      gender: "male",
      scene: "date",
      item_name: `${slot} item`,
      search_keywords: [`男 ${slot}`],
      ...overrides,
    },
    candidates,
  };
}

function requestContext(overrides = {}) {
  const gender = overrides.gender || "male";
  const scene = overrides.scene || "date";
  const desired = overrides.desired || ["年轻", "干净", "时髦"];
  const avoid = overrides.avoid || ["不要像上班"];
  return {
    gender,
    scene,
    decision_context: {
      raw_user_input: overrides.raw || "年轻约会，干净时髦，不要像上班",
      user_truth: {gender, scene},
      intent: {user_intent_brain: {
        desired_impression: {value: desired, source: "user", confidence: 1},
        explicit_avoid: {value: avoid, source: "user", confidence: 1},
      }},
    },
  };
}

function extractAdjudicationPayload(request) {
  const raw = request?.messages?.find((message) =>
    message.role === "user")?.content;
  const payload = JSON.parse(raw);
  const candidates = Array.isArray(payload.candidates)
    ? payload.candidates
    : [payload.candidate_a, payload.candidate_b].filter(Boolean);
  return {payload, candidates};
}

function adjudicationResponse(winnerId) {
  return {
    choices: [{message: {content: JSON.stringify({
      winner_candidate_id: winnerId,
      confidence: 0.92,
      audience_fit: "match",
      contemporary_fit: "match",
      occasion_fit: "match",
      desired_impression_fit: "match",
      short_reason: "更符合当前用户目标与场景。",
    })}}],
  };
}

function fakeAdjudicationClient({
  winner = (candidates) => candidates[0].candidate_id || candidates[0].product_id,
  delayMs = 0,
  fail = null,
  onCall = null,
} = {}) {
  const state = {calls: [], active: 0, maxActive: 0};
  return {
    state,
    client: {
      chat: {completions: {create: async (request, options = {}) => {
        const parsed = extractAdjudicationPayload(request);
        state.calls.push(parsed);
        state.active += 1;
        state.maxActive = Math.max(state.maxActive, state.active);
        onCall?.(parsed);
        try {
          if (fail === "timeout") {
            return await new Promise((_resolve, reject) => {
              options.signal?.addEventListener("abort", () => reject(
                Object.assign(new Error("adjudication aborted"), {
                  code: "ABORTED",
                }),
              ), {once: true});
            });
          }
          if (fail) throw Object.assign(new Error(fail), {code: fail});
          if (delayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          }
          return adjudicationResponse(winner(parsed.candidates, parsed.payload));
        } finally {
          state.active -= 1;
        }
      }}},
    },
  };
}

function reranker(client, overrides = {}) {
  return new ProductAestheticReranker({
    client,
    model: "test-qwen-plus",
    visualEvaluationEnabled: false,
    selectiveAdjudicationEnabled: true,
    adjudicationMargin: 3,
    adjudicationMaxCalls: 3,
    adjudicationTimeoutMs: 100,
    adjudicationTotalBudgetMs: 500,
    selectionConcurrency: 2,
    logger: silentLogger,
    ...overrides,
  });
}

function selectionTrace(instance, requestId) {
  return instance.getTraceForRequest(requestId)?.selection;
}

test("A: a clear 88 vs 60 deterministic lead skips AI adjudication", async () => {
  const candidates = [candidate("clear-a", 88), candidate("clear-b", 60)];
  assert.equal(deterministicScore(candidates[0]), 88);
  const ambiguity = detectGroupAmbiguity(group("look-1", "top", candidates), {
    margin: 3,
  });
  assert.equal(ambiguity.ai_adjudication_required, false);
  assert.equal(ambiguity.status, "DETERMINISTIC_MARGIN_CLEAR");

  const fake = fakeAdjudicationClient();
  const instance = reranker(fake.client);
  const products = await instance.rerank({
    groups: [group("look-1", "top", candidates)],
    context: requestContext(),
    requestId: "clear-margin",
  });
  const trace = selectionTrace(instance, "clear-margin");
  assert.equal(fake.state.calls.length, 0);
  assert.equal(products[0].product_id, "clear-a");
  assert.equal(trace.total_slot_count, 1);
  assert.equal(trace.deterministic_slot_count, 1);
  assert.equal(trace.adjudication_attempted_count, 0);
  assert.equal(trace.slots[0].status, "DETERMINISTIC_MARGIN_CLEAR");
});

test("B: an 84 vs 83 margin triggers one strict two-candidate adjudication", async () => {
  const candidates = [candidate("close-a", 84), candidate("close-b", 83)];
  const plan = buildAmbiguityPlan([
    group("look-1", "top", candidates),
  ], {margin: 3, maxCalls: 3});
  assert.equal(plan.selected_count, 1);
  assert.deepEqual(plan.slots[0].reasons, ["DETERMINISTIC_MARGIN_AMBIGUOUS"]);

  const fake = fakeAdjudicationClient({
    winner: (values) => values[1].candidate_id || values[1].product_id,
  });
  const instance = reranker(fake.client);
  const products = await instance.rerank({
    groups: [group("look-1", "top", candidates)],
    context: requestContext(),
    requestId: "close-margin",
  });
  const trace = selectionTrace(instance, "close-margin");
  assert.equal(fake.state.calls.length, 1);
  assert.deepEqual(fake.state.calls[0].candidates.map((item) =>
    item.candidate_id || item.product_id), ["close-a", "close-b"]);
  assert.equal(products[0].product_id, "close-b");
  assert.equal(products.some((item) => item.product_id === "close-a"), false);
  assert.equal(trace.adjudication_required_count, 1);
  assert.equal(trace.adjudication_attempted_count, 1);
  assert.equal(trace.success_count, 1);
});

test("C: young date footwear ambiguity lets AI prefer the modern shoe", async () => {
  const candidates = [
    candidate("traditional-shoe", 84, {
      slot: "shoes",
      title: "男士传统成熟布鞋",
      styleTags: ["traditional", "mature"],
      acceptance: acceptanceEvidence({
        audience_fit: evidence("mismatch", 0.88, ["mature expression"]),
        contemporary_fit: evidence("mismatch", 0.86, ["traditional shape"]),
      }),
      acceptanceResult: "PASS_WITH_UNCERTAINTY",
    }),
    candidate("modern-shoe", 83, {
      slot: "shoes",
      title: "男士现代简洁低帮休闲鞋",
      styleTags: ["modern", "clean"],
    }),
  ];
  const fake = fakeAdjudicationClient({winner: () => "modern-shoe"});
  const instance = reranker(fake.client);
  const products = await instance.rerank({
    groups: [group("look-1", "shoes", candidates)],
    context: requestContext(),
    requestId: "young-date-shoes",
  });
  const trace = selectionTrace(instance, "young-date-shoes");
  assert.equal(fake.state.calls.length, 1);
  assert.equal(products[0].product_id, "modern-shoe");
  assert.equal(trace.slots[0].reasons.includes("AUDIENCE_FIT_CONFLICT"), true);
});

test("D: formal intent permits AI to choose the business shoe", async () => {
  const candidates = [
    candidate("casual-shoe", 84, {
      lookId: "formal-look",
      slot: "shoes",
      title: "男士日常休闲鞋",
      styleTags: ["casual"],
    }),
    candidate("business-shoe", 83, {
      lookId: "formal-look",
      slot: "shoes",
      title: "男士商务正装牛津鞋",
      styleTags: ["formal", "business"],
    }),
  ];
  const fake = fakeAdjudicationClient({winner: () => "business-shoe"});
  const instance = reranker(fake.client);
  const products = await instance.rerank({
    groups: [group("formal-look", "shoes", candidates, {
      scene: "formal_event",
      style: "formal",
    })],
    context: requestContext({
      raw: "正式商务活动，需要稳重的正装",
      scene: "formal_event",
      desired: ["正式", "稳重"],
      avoid: [],
    }),
    requestId: "formal-shoes",
  });
  assert.equal(fake.state.calls.length, 1);
  assert.equal(products[0].product_id, "business-shoe");
  assert.equal(selectionTrace(instance, "formal-shoes").success_count, 1);
});

test("E: a child Hard Reject never enters the AI adjudication payload", async () => {
  const child = candidate("child-top", 99, {
    lookId: "adult-look",
    slot: "top",
    title: "品牌男童短袖T恤",
  });
  const groups = [
    group("adult-look", "top", [
      child,
      candidate("adult-top-a", 84, {slot: "top", lookId: "adult-look"}),
      candidate("adult-top-b", 83, {slot: "top", lookId: "adult-look"}),
    ]),
    group("adult-look", "bottom", [
      candidate("adult-bottom-a", 88, {slot: "bottom", lookId: "adult-look"}),
      candidate("adult-bottom-b", 60, {slot: "bottom", lookId: "adult-look"}),
    ]),
    group("adult-look", "shoes", [
      candidate("adult-shoes-a", 88, {slot: "shoes", lookId: "adult-look"}),
      candidate("adult-shoes-b", 60, {slot: "shoes", lookId: "adult-look"}),
    ]),
  ];
  const fake = fakeAdjudicationClient();
  const instance = reranker(fake.client);
  const result = await runSharedCandidatePipeline({
    requirements: groups.map((item) => item.requirement),
    groups,
    context: requestContext(),
    provider: "taobao",
    reranker: instance,
    logger: silentLogger,
  });
  assert.equal(result.trace.gate_reject.some((item) =>
    item.candidate_id === "child-top" &&
    item.product_acceptance_result === "HARD_REJECT"), true);
  assert.equal(fake.state.calls.flatMap((call) => call.candidates)
    .some((item) => item.candidate_id === "child-top"), false);
  assert.equal(result.products.some((item) =>
    item.product_id === "child-top"), false);
  assert.equal(result.trace.strategy_executed, true);
});

test("F: nine slots with only two ambiguities make only two concurrent AI calls", async () => {
  const groups = [];
  for (let lookIndex = 1; lookIndex <= 3; lookIndex += 1) {
    for (const slot of ["top", "bottom", "shoes"]) {
      const ambiguous = (lookIndex === 1 && slot === "top") ||
        (lookIndex === 2 && slot === "bottom");
      groups.push(group(`look-${lookIndex}`, slot, [
        candidate(`l${lookIndex}-${slot}-a`, ambiguous ? 84 : 88, {
          lookId: `look-${lookIndex}`,
          slot,
        }),
        candidate(`l${lookIndex}-${slot}-b`, ambiguous ? 83 : 60, {
          lookId: `look-${lookIndex}`,
          slot,
        }),
      ]));
    }
  }
  const fake = fakeAdjudicationClient({delayMs: 20});
  const instance = reranker(fake.client);
  await instance.rerank({
    groups,
    context: requestContext(),
    requestId: "two-of-nine",
  });
  const trace = selectionTrace(instance, "two-of-nine");
  assert.equal(fake.state.calls.length, 2);
  assert.equal(fake.state.maxActive, 2);
  assert.equal(trace.total_slot_count, 9);
  assert.equal(trace.deterministic_slot_count, 7);
  assert.equal(trace.adjudication_required_count, 2);
  assert.equal(trace.adjudication_attempted_count, 2);
  assert.equal(trace.slots.filter((item) =>
    item.slot === "shoes" && item.selected_for_adjudication).length, 0);
  assert.equal(trace.total_ai_latency_ms >= 0, true);
  assert.equal(trace.wall_clock_ms >= 0, true);
});

test("G: AI timeout falls back to deterministic Top1 and the pipeline continues", async () => {
  const groups = [
    group("timeout-look", "top", [
      candidate("timeout-top-a", 84, {lookId: "timeout-look"}),
      candidate("timeout-top-b", 83, {lookId: "timeout-look"}),
    ]),
    group("timeout-look", "bottom", [
      candidate("timeout-bottom-a", 88, {lookId: "timeout-look", slot: "bottom"}),
      candidate("timeout-bottom-b", 60, {lookId: "timeout-look", slot: "bottom"}),
    ]),
    group("timeout-look", "shoes", [
      candidate("timeout-shoes-a", 88, {lookId: "timeout-look", slot: "shoes"}),
      candidate("timeout-shoes-b", 60, {lookId: "timeout-look", slot: "shoes"}),
    ]),
  ];
  const fake = fakeAdjudicationClient({fail: "timeout"});
  const instance = reranker(fake.client, {
    adjudicationTimeoutMs: 25,
    adjudicationTotalBudgetMs: 100,
  });
  const result = await runSharedCandidatePipeline({
    requirements: groups.map((item) => item.requirement),
    groups,
    context: requestContext(),
    provider: "taobao",
    reranker: instance,
    logger: silentLogger,
  });
  const trace = selectionTrace(instance, result.trace.request_id || "");
  const currentTrace = trace || instance.getStats().last_trace.selection;
  assert.equal(fake.state.calls.length, 1);
  assert.equal(result.products.some((item) =>
    item.product_id === "timeout-top-a"), true);
  assert.equal(result.trace.strategy_executed, true);
  assert.equal(currentTrace.success_count, 0);
  assert.equal(currentTrace.timeout_count, 1);
  assert.equal(currentTrace.fallback_count, 1);
  assert.match(currentTrace.slots.find((item) =>
    item.slot === "top").fallback_reason, /TIMEOUT|ABORT/u);
});

test("H: more than three ambiguities adjudicates only the three highest priorities", async () => {
  const lowPriority = (index) => group(`look-${index}`, "top", [
    candidate(`low-${index}-a`, 84, {lookId: `look-${index}`}),
    candidate(`low-${index}-b`, 83, {lookId: `look-${index}`}),
  ]);
  const highPriority = (index) => group(`look-${index}`, "top", [
    candidate(`high-${index}-a`, 84, {
      lookId: `look-${index}`,
      acceptance: acceptanceEvidence({
        audience_fit: evidence("match", 0.9),
        occasion_fit: evidence("match", 0.9),
      }),
    }),
    candidate(`high-${index}-b`, 83, {
      lookId: `look-${index}`,
      acceptance: acceptanceEvidence({
        audience_fit: evidence("mismatch", 0.9),
        occasion_fit: evidence("mismatch", 0.9),
      }),
    }),
  ]);
  const groups = [lowPriority(1), lowPriority(2), highPriority(3),
    highPriority(4), highPriority(5)];
  const plan = buildAmbiguityPlan(groups, {margin: 3, maxCalls: 3});
  assert.deepEqual(plan.slots.filter((item) => item.selected_for_adjudication)
    .map((item) => item.group_index), [2, 3, 4]);
  assert.equal(plan.slots.filter((item) =>
    item.status === "ADJUDICATION_LIMIT_REACHED").length, 2);

  const fake = fakeAdjudicationClient();
  const instance = reranker(fake.client, {adjudicationMaxCalls: 3});
  await instance.rerank({
    groups,
    context: requestContext(),
    requestId: "adjudication-cap",
  });
  const trace = selectionTrace(instance, "adjudication-cap");
  assert.equal(fake.state.calls.length, 3);
  assert.equal(trace.adjudication_required_count, 5);
  assert.equal(trace.adjudication_attempted_count, 3);
  assert.equal(trace.deterministic_slot_count, 2);
  assert.equal(trace.slots.filter((item) =>
    item.status === "ADJUDICATION_LIMIT_REACHED").length, 2);
  assert.deepEqual(fake.state.calls.map((call) =>
    (call.candidates[0].candidate_id || call.candidates[0].product_id)).sort(), [
    "high-3-a", "high-4-a", "high-5-a",
  ]);
});

test("cached adjudication reuses its audited winner without reporting a new model call", async () => {
  const values = [candidate("cache-a", 84), candidate("cache-b", 83)];
  const fake = fakeAdjudicationClient({winner: () => "cache-b"});
  const instance = reranker(fake.client);
  await instance.rerank({
    groups: [group("cache-look", "top", values)],
    context: requestContext(),
    requestId: "cache-first",
  });
  const second = await instance.rerank({
    groups: [group("cache-look", "top", values)],
    context: requestContext(),
    requestId: "cache-second",
  });
  const trace = selectionTrace(instance, "cache-second");
  assert.equal(fake.state.calls.length, 1);
  assert.equal(second[0].product_id, "cache-b");
  assert.equal(trace.mode, "CACHED_SELECTIVE_AI_ADJUDICATION");
  assert.equal(trace.model_calls_this_request, 0);
  assert.equal(trace.adjudication_attempted_count, 0);
  assert.equal(trace.reused_success_count, 1);
  assert.deepEqual(trace.reused_winner_candidate_ids, ["cache-b"]);
  assert.equal(trace.slots[0].cached_reuse, true);
});
