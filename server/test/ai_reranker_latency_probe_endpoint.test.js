"use strict";

const assert = require("node:assert/strict");
const {EventEmitter} = require("node:events");
const test = require("node:test");

const {
  AI_RERANKER_LATENCY_PROBE_MAX_REQUESTS,
  AI_RERANKER_LATENCY_PROBE_MAX_TOKENS,
  AI_RERANKER_LATENCY_PROBE_CONCURRENCY,
  AI_RERANKER_LATENCY_PROBE_PATH,
  AI_RERANKER_LATENCY_PROBE_PLAN,
  AI_RERANKER_LATENCY_PROBE_SCENARIOS,
  AI_RERANKER_LATENCY_PROBE_TOTAL_BUDGET_MS,
  PROBE_CANDIDATES,
  aiRerankerLatencyProbeEnabled,
  buildProbeMessages,
  createAiRerankerLatencyProbeHandler,
  percentile,
  validateProbePayload,
} = require("../ai_reranker_latency_probe_endpoint");

const TOKEN = "ai-latency-probe-token-at-least-32-characters";
const API_SECRET = "dashscope-secret-must-never-be-returned";
const BASE_ENVIRONMENT = Object.freeze({
  RENDER: "true",
  ENABLE_AI_RERANKER_LATENCY_PROBE: "true",
  INTERNAL_PROBE_TOKEN: TOKEN,
  OPENAI_API_KEY: API_SECRET,
});
const silentLogger = Object.freeze({info() {}, warn() {}, error() {}});

function responseRecorder() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function eventedResponseRecorder() {
  const response = new EventEmitter();
  response.statusCode = null;
  response.body = null;
  response.writableEnded = false;
  response.status = function status(code) {
    this.statusCode = code;
    return this;
  };
  response.json = function json(body) {
    this.body = body;
    this.writableEnded = true;
    return this;
  };
  return response;
}

function request({token = TOKEN, body = {}} = {}) {
  return {
    headers: token === null ? {} : {authorization: `Bearer ${token}`},
    body,
  };
}

function fakeClock(start = Date.UTC(2026, 7, 30, 0, 0, 0)) {
  let current = start;
  const clock = () => current;
  clock.advance = (milliseconds) => {
    current += milliseconds;
  };
  return clock;
}

function validOutput(candidateCount) {
  return JSON.stringify({
    evaluations: PROBE_CANDIDATES.slice(0, candidateCount).map((candidate) => ({
      candidate_id: candidate.candidate_id,
      audience_fit: "PASS",
      contemporary_fit: "PASS",
      occasion_fit: "PASS",
      desired_impression_fit: "PASS",
      visual_quality: "PASS",
      decision: "KEEP",
      short_reason: "Clean and current.",
    })),
  });
}

function candidateCountFromRequest(payload) {
  return JSON.parse(payload.messages[1].content).candidates.length;
}

function successfulFakeClient(clock) {
  const calls = [];
  const occurrence = new Map();
  const client = {
    chat: {
      completions: {
        async create(payload, options) {
          const candidateCount = candidateCountFromRequest(payload);
          const index = occurrence.get(candidateCount) || 0;
          occurrence.set(candidateCount, index + 1);
          const latency = candidateCount * 100 + index * 10;
          const content = validOutput(candidateCount);
          calls.push({payload, options, candidateCount, latency});
          if (!payload.stream) {
            clock.advance(latency);
            return {
              choices: [{message: {content}}],
              usage: {completion_tokens: 30 + candidateCount},
            };
          }
          return {
            async *[Symbol.asyncIterator]() {
              clock.advance(5);
              yield {choices: [{delta: {role: "assistant", content: ""}}]};
              clock.advance(5);
              const splitAt = Math.floor(content.length / 2);
              yield {choices: [{delta: {content: content.slice(0, splitAt)}}]};
              clock.advance(latency - 10);
              yield {
                choices: [{
                  delta: {content: content.slice(splitAt)},
                  finish_reason: "stop",
                }],
              };
              yield {
                choices: [],
                usage: {completion_tokens: 30 + candidateCount},
              };
            },
          };
        },
      },
    },
  };
  return {client, calls};
}

test("probe path, scenarios, and run plan are fixed and bounded", () => {
  assert.equal(
    AI_RERANKER_LATENCY_PROBE_PATH,
    "/internal/probes/ai-reranker-latency-v1",
  );
  assert.deepEqual(
    AI_RERANKER_LATENCY_PROBE_SCENARIOS.map(({candidate_count: count}) => count),
    [1, 2, 4],
  );
  assert.equal(AI_RERANKER_LATENCY_PROBE_PLAN.length, 9);
  assert.equal(
    AI_RERANKER_LATENCY_PROBE_PLAN.length,
    AI_RERANKER_LATENCY_PROBE_MAX_REQUESTS,
  );
  for (const count of [1, 2, 4]) {
    const runs = AI_RERANKER_LATENCY_PROBE_PLAN.filter(
      ({candidate_count: value}) => value === count,
    );
    assert.equal(runs.length, 3);
    assert.equal(runs.filter(({streaming}) => streaming).length, 1);
  }
});

test("probe stays hidden unless independent flag, Render, and token are valid", async () => {
  let modelCalls = 0;
  const client = {
    chat: {completions: {async create() { modelCalls += 1; }}},
  };
  const closedEnvironments = [
    {...BASE_ENVIRONMENT, ENABLE_AI_RERANKER_LATENCY_PROBE: "false"},
    {...BASE_ENVIRONMENT, RENDER: "false"},
    {...BASE_ENVIRONMENT, INTERNAL_PROBE_TOKEN: "short"},
    {...BASE_ENVIRONMENT, INTERNAL_PROBE_TOKEN: API_SECRET},
  ];
  for (const environment of closedEnvironments) {
    const handler = createAiRerankerLatencyProbeHandler({
      environment,
      client,
      model: "qwen3.7-plus",
      logger: silentLogger,
    });
    const response = responseRecorder();
    await handler(request(), response);
    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.body, {error: "NOT_FOUND"});
  }
  assert.equal(modelCalls, 0);
  assert.equal(aiRerankerLatencyProbeEnabled(BASE_ENVIRONMENT), true);
});

test("enabled probe rejects missing and incorrect bearer credentials", async () => {
  let modelCalls = 0;
  const handler = createAiRerankerLatencyProbeHandler({
    environment: BASE_ENVIRONMENT,
    client: {
      chat: {completions: {async create() { modelCalls += 1; }}},
    },
    model: "qwen3.7-plus",
    logger: silentLogger,
  });
  for (const token of [null, "wrong-token"] ) {
    const response = responseRecorder();
    await handler(request({token}), response);
    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.body, {error: "FORBIDDEN"});
  }
  assert.equal(modelCalls, 0);
});

test("probe rejects every caller-supplied input before any model request", async () => {
  let modelCalls = 0;
  const handler = createAiRerankerLatencyProbeHandler({
    environment: BASE_ENVIRONMENT,
    client: {
      chat: {completions: {async create() { modelCalls += 1; }}},
    },
    model: "qwen3.7-plus",
    logger: silentLogger,
  });
  const response = responseRecorder();
  await handler(request({body: {prompt: "caller controlled"}}), response);
  assert.equal(response.statusCode, 400);
  assert.equal(
    response.body.error_code,
    "AI_RERANKER_LATENCY_PROBE_FIXED_INPUT_ONLY",
  );
  assert.equal(modelCalls, 0);
});

test("authorized probe makes exactly nine fixed direct model calls and reports latency", async () => {
  const clock = fakeClock();
  const {client, calls} = successfulFakeClient(clock);
  const handler = createAiRerankerLatencyProbeHandler({
    environment: BASE_ENVIRONMENT,
    client,
    provider: "dashscope",
    model: "qwen3.7-plus",
    logger: silentLogger,
    clock,
  });
  const response = responseRecorder();
  await handler(request(), response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.probe_status, "SUCCESS");
  assert.equal(response.body.sample_count, 9);
  assert.equal(response.body.success_count, 9);
  assert.equal(response.body.limits.actual_model_requests, 9);
  assert.equal(response.body.limits.skipped_sample_count, 0);
  assert.equal(response.body.limits.model_request_limit, 9);
  assert.equal(response.body.limits.taobao_calls, 0);
  assert.equal(response.body.limits.outfit_calls, 0);
  assert.equal(response.body.limits.arbitrary_prompt_allowed, false);
  assert.equal(
    response.body.model_config.concurrency,
    AI_RERANKER_LATENCY_PROBE_CONCURRENCY,
  );
  assert.equal(
    response.body.model_config.total_budget_ms,
    AI_RERANKER_LATENCY_PROBE_TOTAL_BUDGET_MS,
  );
  assert.equal(calls.length, 9);
  assert.deepEqual(calls.map(({candidateCount}) => candidateCount), [
    1, 1, 1, 2, 2, 2, 4, 4, 4,
  ]);

  for (const [index, call] of calls.entries()) {
    assert.equal(call.payload.model, "qwen3.7-plus");
    assert.equal(call.payload.max_tokens, AI_RERANKER_LATENCY_PROBE_MAX_TOKENS);
    assert.equal(call.payload.temperature, 0.2);
    assert.deepEqual(call.payload.response_format, {type: "json_object"});
    assert.equal(call.payload.enable_thinking, false);
    assert.equal(call.options.maxRetries, 0);
    assert.equal(call.options.signal instanceof AbortSignal, true);
    const prompt = JSON.parse(call.payload.messages[1].content);
    assert.deepEqual(Object.keys(prompt).sort(), [
      "candidates",
      "concept_summary",
      "desired_impression",
      "explicit_avoid",
      "scene",
      "slot",
    ]);
    assert.equal(prompt.candidates.length, call.candidateCount);
    assert.deepEqual(Object.keys(prompt.candidates[0]).sort(), [
      "acceptance_evidence",
      "candidate_id",
      "category",
      "color",
      "enrichment_evidence",
      "material",
      "presentation_metadata",
      "price_band",
      "silhouette",
      "title",
    ]);
    assert.deepEqual(prompt.candidates[0].enrichment_evidence, {
      category: "top",
      attributes: "color,material,silhouette",
    });
    assert.deepEqual(prompt.candidates[0].acceptance_evidence, {
      category_gate: "PASS",
      listing_quality_gate: "PASS",
    });
    assert.doesNotMatch(call.payload.messages[1].content,
      /decision_context|raw_user_input|taobao|outfit/i);
    assert.equal(
      response.body.samples[index].prompt_bytes,
      Buffer.byteLength(JSON.stringify(call.payload.messages), "utf8"),
    );
  }

  const nonStreaming = response.body.samples.filter(({streaming}) => !streaming);
    assert.ok(nonStreaming.every((sample) =>
    sample.first_byte.status === "UNAVAILABLE" &&
    sample.first_token.status === "UNAVAILABLE" &&
    sample.first_token.reason === "UNAVAILABLE_NON_STREAMING_SDK"));
  const streaming = response.body.samples.filter((sample) => sample.streaming);
  assert.equal(streaming.length, 3);
  assert.ok(streaming.every((sample) =>
    sample.first_byte.status === "UNAVAILABLE" &&
    sample.first_byte.reason === "RAW_FIRST_BYTE_NOT_EXPOSED_BY_SDK" &&
    sample.first_stream_event.status === "AVAILABLE" &&
    sample.first_token.status === "AVAILABLE" &&
    sample.first_token.latency_ms >= sample.first_stream_event.latency_ms));
  assert.ok(response.body.samples.every((sample) =>
    sample.output_tokens === 30 + sample.candidate_count &&
    sample.response_complete !== null && sample.parse_complete !== null));

  const summaries = response.body.statistics.by_candidate_count;
  assert.equal(
    response.body.statistics.production_timeout_basis,
    "by_candidate_count_non_streaming_only",
  );
  assert.ok(summaries.every((bucket) =>
    bucket.streaming === false &&
    bucket.sample_count === 2 &&
    bucket.calibration_role === "PRODUCTION_TIMEOUT" &&
    bucket.usable_for_timeout_calibration === true &&
    Number.isFinite(bucket.total_latency_ms.p50) &&
    Number.isFinite(bucket.total_latency_ms.p95)));
  assert.equal(response.body.statistics.by_streaming[0].sample_count, 6);
  assert.equal(response.body.statistics.by_streaming[1].sample_count, 3);
  assert.ok(response.body.statistics.by_streaming.every((bucket) =>
    bucket.usable_for_timeout_calibration === false));
  assert.equal(
    response.body.statistics.by_candidate_count_and_streaming.length,
    6,
  );
  const oneCandidateNonStreaming =
    response.body.statistics.by_candidate_count_and_streaming.find((entry) =>
      entry.candidate_count === 1 && entry.streaming === false);
  assert.equal(oneCandidateNonStreaming.sample_count, 2);
  assert.equal(oneCandidateNonStreaming.usable_for_timeout_calibration, true);
  const oneCandidateStreaming =
    response.body.statistics.by_candidate_count_and_streaming.find((entry) =>
      entry.candidate_count === 1 && entry.streaming === true);
  assert.equal(oneCandidateStreaming.usable_for_timeout_calibration, false);
  assert.equal(
    oneCandidateStreaming.calibration_exclusion_reason,
    "STREAMING_COMPARISON_ONLY",
  );
  assert.doesNotMatch(JSON.stringify(response.body), new RegExp(TOKEN));
  assert.doesNotMatch(JSON.stringify(response.body), new RegExp(API_SECRET));
});

test("model failures are classified, retained in statistics, and sanitized", async () => {
  let modelCalls = 0;
  const logs = [];
  const client = {
    chat: {
      completions: {
        async create() {
          modelCalls += 1;
          const error = new Error(`rate limit ${TOKEN} ${API_SECRET}`);
          error.status = 429;
          error.code = `RATE_LIMIT_${API_SECRET}`;
          throw error;
        },
      },
    },
  };
  const handler = createAiRerankerLatencyProbeHandler({
    environment: BASE_ENVIRONMENT,
    client,
    provider: "dashscope",
    model: "qwen3.7-plus",
    logger: {
      info(message, details) { logs.push({message, details}); },
      warn(message, details) { logs.push({message, details}); },
      error(message, details) { logs.push({message, details}); },
    },
  });
  const response = responseRecorder();
  await handler(request(), response);

  assert.equal(response.statusCode, 502);
  assert.equal(response.body.probe_status, "FAILED");
  assert.equal(response.body.failure_count, 9);
  assert.equal(modelCalls, 9);
  assert.ok(response.body.samples.every((sample) =>
    sample.success === false &&
    sample.failure_reason === "UPSTREAM_RATE_LIMIT"));
  const serializedResponse = JSON.stringify(response.body);
  const serializedLogs = JSON.stringify(logs);
  for (const secret of [TOKEN, API_SECRET]) {
    assert.doesNotMatch(serializedResponse, new RegExp(secret));
    assert.doesNotMatch(serializedLogs, new RegExp(secret));
  }
});

test("total budget prevents queued samples from starting and keeps concurrency bounded", async () => {
  let modelCalls = 0;
  let active = 0;
  let maximumActive = 0;
  const client = {
    chat: {completions: {create: async () => {
      modelCalls += 1;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      return new Promise(() => {});
    }}},
  };
  const handler = createAiRerankerLatencyProbeHandler({
    environment: BASE_ENVIRONMENT,
    client,
    provider: "dashscope",
    model: "qwen3.7-plus",
    logger: silentLogger,
    requestTimeoutMs: 50,
    totalBudgetMs: 5,
  });
  const response = responseRecorder();
  await handler(request(), response);

  assert.equal(response.statusCode, 502);
  assert.ok(modelCalls <= AI_RERANKER_LATENCY_PROBE_CONCURRENCY);
  assert.ok(maximumActive <= AI_RERANKER_LATENCY_PROBE_CONCURRENCY);
  assert.equal(response.body.limits.actual_model_requests, modelCalls);
  assert.ok(response.body.limits.actual_model_requests < 9);
  assert.ok(response.body.samples.some((sample) =>
    sample.model_request_started === false &&
    sample.failure_reason === "SKIPPED_TOTAL_BUDGET"));
  assert.ok(response.body.samples.filter((sample) =>
    sample.model_request_started).every((sample) =>
    sample.failure_reason === "TOTAL_BUDGET_EXHAUSTED_DURING_REQUEST"));
});

test("request close aborts running calls and does not start the remaining queue", async () => {
  const logs = [];
  const signals = [];
  let modelCalls = 0;
  const client = {
    chat: {completions: {create: async (_payload, options) => {
      modelCalls += 1;
      signals.push(options.signal);
      return new Promise(() => {});
    }}},
  };
  const handler = createAiRerankerLatencyProbeHandler({
    environment: BASE_ENVIRONMENT,
    client,
    provider: "dashscope",
    model: "qwen3.7-plus",
    logger: {
      info(_message, details) { logs.push(details); },
      warn() {},
      error() {},
    },
  });
  const req = new EventEmitter();
  req.headers = {authorization: `Bearer ${TOKEN}`};
  req.body = {};
  req.complete = false;
  req.aborted = false;
  const res = eventedResponseRecorder();
  const pending = handler(req, res);
  setImmediate(() => {
    req.aborted = true;
    req.emit("close");
  });
  await pending;

  assert.ok(modelCalls <= AI_RERANKER_LATENCY_PROBE_CONCURRENCY);
  assert.ok(signals.every((signal) => signal.aborted));
  assert.equal(res.statusCode, null);
  assert.ok(logs.some(({failure_reason: reason}) =>
    reason === "SKIPPED_CLIENT_DISCONNECT"));
  assert.ok(logs.some(({failure_reason: reason}) =>
    reason === "CLIENT_DISCONNECT"));
});

test("a silently ended aborted stream remains a model timeout, not a parse error", async () => {
  const client = {
    chat: {
      completions: {
        async create(payload, options) {
          const candidateCount = candidateCountFromRequest(payload);
          if (!payload.stream) {
            return {
              choices: [{
                message: {content: validOutput(candidateCount)},
                finish_reason: "stop",
              }],
            };
          }
          return {
            async *[Symbol.asyncIterator]() {
              yield {choices: [{delta: {role: "assistant", content: ""}}]};
              await new Promise((resolve) => {
                if (options.signal.aborted) return resolve();
                options.signal.addEventListener("abort", resolve, {once: true});
              });
            },
          };
        },
      },
    },
  };
  const handler = createAiRerankerLatencyProbeHandler({
    environment: BASE_ENVIRONMENT,
    client,
    provider: "dashscope",
    model: "qwen3.7-plus",
    logger: silentLogger,
    requestTimeoutMs: 5,
  });
  const response = responseRecorder();
  await handler(request(), response);

  assert.equal(response.statusCode, 502);
  assert.equal(response.body.probe_status, "PARTIAL");
  const streaming = response.body.samples.filter((sample) => sample.streaming);
  assert.equal(streaming.length, 3);
  assert.ok(streaming.every((sample) =>
    sample.failure_reason === "MODEL_REQUEST_TIMEOUT" &&
    sample.first_byte.status === "UNAVAILABLE" &&
    sample.first_stream_event.status === "AVAILABLE"));
  const nonStreaming = response.body.samples.filter((sample) => !sample.streaming);
  assert.ok(nonStreaming.every((sample) =>
    sample.success === true &&
    sample.output_tokens === null &&
    sample.output_tokens_status === "UNAVAILABLE"));
  assert.ok(response.body.statistics.by_candidate_count.every((bucket) =>
    bucket.latency_censored_by_failure === false &&
    bucket.usable_for_timeout_calibration === true));
  const productionBuckets =
    response.body.statistics.by_candidate_count_and_streaming
      .filter(({streaming: enabled}) => !enabled);
  assert.ok(productionBuckets.every((bucket) =>
    bucket.latency_censored_by_failure === false &&
    bucket.usable_for_timeout_calibration === true));
});

test("finish_reason length is reported as output truncation", async () => {
  const client = {
    chat: {
      completions: {
        async create(payload) {
          const candidateCount = candidateCountFromRequest(payload);
          const content = validOutput(candidateCount);
          if (!payload.stream) {
            return {
              choices: [{message: {content}, finish_reason: "length"}],
              usage: {completion_tokens: AI_RERANKER_LATENCY_PROBE_MAX_TOKENS},
            };
          }
          return {
            async *[Symbol.asyncIterator]() {
              yield {
                choices: [{
                  delta: {content},
                  finish_reason: "length",
                }],
              };
            },
          };
        },
      },
    },
  };
  const handler = createAiRerankerLatencyProbeHandler({
    environment: BASE_ENVIRONMENT,
    client,
    provider: "dashscope",
    model: "qwen3.7-plus",
    logger: silentLogger,
  });
  const response = responseRecorder();
  await handler(request(), response);
  assert.equal(response.statusCode, 502);
  assert.ok(response.body.samples.every((sample) =>
    sample.success === false &&
    sample.failure_reason === "MODEL_OUTPUT_TRUNCATED" &&
    sample.finish_reason === "length"));
});

test("output contract rejects extra fields and overlong short reasons", () => {
  const valid = JSON.parse(validOutput(1));
  assert.equal(validateProbePayload(valid, 1), valid);
  const extra = JSON.parse(validOutput(1));
  extra.evaluations[0].score = 99;
  assert.throws(() => validateProbePayload(extra, 1), /invalid response/i);
  const longReason = JSON.parse(validOutput(1));
  longReason.evaluations[0].short_reason = "x".repeat(25);
  assert.throws(() => validateProbePayload(longReason, 1), /invalid response/i);
});

test("percentiles use documented linear interpolation", () => {
  assert.equal(percentile([], 0.95), null);
  assert.equal(percentile([12], 0.95), 12);
  assert.equal(percentile([100, 120, 110], 0.5), 110);
  assert.equal(percentile([100, 120, 110], 0.95), 119);
});

test("probe message builder accepts only the three fixed candidate counts", () => {
  assert.equal(buildProbeMessages(1).length, 2);
  assert.equal(buildProbeMessages(2).length, 2);
  assert.equal(buildProbeMessages(4).length, 2);
  assert.throws(() => buildProbeMessages(3), /INVALID_SCENARIO/);
});
