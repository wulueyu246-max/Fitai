"use strict";

const crypto = require("node:crypto");

const AI_RERANKER_LATENCY_PROBE_PATH =
  "/internal/probes/ai-reranker-latency-v1";
const INTERNAL_PROBE_TOKEN_MIN_LENGTH = 32;
const AI_RERANKER_LATENCY_PROBE_MAX_REQUESTS = 9;
const AI_RERANKER_LATENCY_PROBE_RUNS_PER_SCENARIO = 3;
const AI_RERANKER_LATENCY_PROBE_MAX_TOKENS = 512;
const AI_RERANKER_LATENCY_PROBE_TEMPERATURE = 0.2;
const AI_RERANKER_LATENCY_PROBE_TIMEOUT_MS = 45_000;
const AI_RERANKER_LATENCY_PROBE_TOTAL_BUDGET_MS = 90_000;
const AI_RERANKER_LATENCY_PROBE_CONCURRENCY = 2;
const AI_RERANKER_SHORT_REASON_MAX_CHARACTERS = 24;
const FIT_VALUES = Object.freeze(["PASS", "MIXED", "FAIL"]);
const DECISION_VALUES = Object.freeze(["KEEP", "REJECT"]);

const AI_RERANKER_LATENCY_PROBE_SCENARIOS = Object.freeze([
  Object.freeze({scenario_id: "A", candidate_count: 1}),
  Object.freeze({scenario_id: "B", candidate_count: 2}),
  Object.freeze({scenario_id: "C", candidate_count: 4}),
]);

const AI_RERANKER_LATENCY_PROBE_PLAN = Object.freeze(
  AI_RERANKER_LATENCY_PROBE_SCENARIOS.flatMap((scenario) => [
    Object.freeze({...scenario, repetition: 1, streaming: false}),
    Object.freeze({...scenario, repetition: 2, streaming: true}),
    Object.freeze({...scenario, repetition: 3, streaming: false}),
  ]),
);

const PROBE_CONTEXT = Object.freeze({
  scene: "weekend_date",
  desired_impression: Object.freeze(["clean", "contemporary", "effortless"]),
  explicit_avoid: Object.freeze(["office_uniform", "overly_formal"]),
  concept_summary: "Clean modern casual look with one restrained design detail.",
  slot: "top",
});

const PROBE_CANDIDATES = Object.freeze([
  Object.freeze({
    candidate_id: "candidate-1",
    category: "top",
    title: "Clean-cut cotton overshirt",
    color: "soft navy",
    material: "cotton twill",
    silhouette: "relaxed straight",
    price_band: "mid",
    presentation_metadata: "clear product view on a clean background",
    enrichment_evidence: Object.freeze({
      category: "top",
      attributes: "color,material,silhouette",
    }),
    acceptance_evidence: Object.freeze({
      category_gate: "PASS",
      listing_quality_gate: "PASS",
    }),
  }),
  Object.freeze({
    candidate_id: "candidate-2",
    category: "top",
    title: "Textured knit polo shirt",
    color: "warm ivory",
    material: "fine gauge knit",
    silhouette: "regular fit",
    price_band: "mid",
    presentation_metadata: "clear model view with minimal graphics",
    enrichment_evidence: Object.freeze({
      category: "top",
      attributes: "color,material,silhouette",
    }),
    acceptance_evidence: Object.freeze({
      category_gate: "PASS",
      listing_quality_gate: "PASS",
    }),
  }),
  Object.freeze({
    candidate_id: "candidate-3",
    category: "top",
    title: "Asymmetric panel shirt",
    color: "charcoal",
    material: "cotton blend",
    silhouette: "boxy cropped",
    price_band: "mid",
    presentation_metadata: "clear product view on a neutral background",
    enrichment_evidence: Object.freeze({
      category: "top",
      attributes: "color,material,silhouette",
    }),
    acceptance_evidence: Object.freeze({
      category_gate: "PASS",
      listing_quality_gate: "PASS",
    }),
  }),
  Object.freeze({
    candidate_id: "candidate-4",
    category: "top",
    title: "Minimal zip jacket",
    color: "stone grey",
    material: "matte technical weave",
    silhouette: "controlled relaxed",
    price_band: "mid",
    presentation_metadata: "clear model view without sale graphics",
    enrichment_evidence: Object.freeze({
      category: "top",
      attributes: "color,material,silhouette",
    }),
    acceptance_evidence: Object.freeze({
      category_gate: "PASS",
      listing_quality_gate: "PASS",
    }),
  }),
]);

function createAiRerankerLatencyProbeHandler({
  environment = process.env,
  client = null,
  provider = "unconfigured",
  model = "",
  logger = console,
  clock = () => Date.now(),
  requestTimeoutMs = AI_RERANKER_LATENCY_PROBE_TIMEOUT_MS,
  totalBudgetMs = AI_RERANKER_LATENCY_PROBE_TOTAL_BUDGET_MS,
  concurrency = AI_RERANKER_LATENCY_PROBE_CONCURRENCY,
} = {}) {
  let running = false;
  return async function aiRerankerLatencyProbeHandler(req, res) {
    const currentEnvironment = typeof environment === "function"
      ? environment()
      : environment;
    if (!aiRerankerLatencyProbeEnabled(currentEnvironment)) {
      return res.status(404).json({error: "NOT_FOUND"});
    }
    if (!authorized(req, currentEnvironment.INTERNAL_PROBE_TOKEN)) {
      return res.status(403).json({error: "FORBIDDEN"});
    }
    if (!emptyProbeBody(req?.body)) {
      return res.status(400).json({
        probe_status: "REJECTED",
        error_code: "AI_RERANKER_LATENCY_PROBE_FIXED_INPUT_ONLY",
      });
    }
    if (running) {
      return res.status(409).json({
        probe_status: "REJECTED",
        error_code: "AI_RERANKER_LATENCY_PROBE_ALREADY_RUNNING",
      });
    }
    if (!client?.chat?.completions?.create || !String(model || "").trim()) {
      return res.status(503).json({
        probe_status: "FAILED",
        error_code: "AI_RERANKER_MODEL_UNAVAILABLE",
      });
    }

    running = true;
    const disconnectController = new AbortController();
    const detachDisconnect = bindClientDisconnect(
      req,
      res,
      disconnectController,
    );
    try {
      const result = await executeAiRerankerLatencyProbe({
        client,
        provider,
        model,
        logger: createSafeProbeLogger(logger),
        clock,
        requestTimeoutMs,
        totalBudgetMs,
        concurrency,
        signal: disconnectController.signal,
      });
      if (disconnectController.signal.aborted) return undefined;
      return res.status(result.probe_status === "SUCCESS" ? 200 : 502)
        .json(result);
    } catch (error) {
      logger.error?.("ai_reranker_latency_probe_failed", {
        error_code: classifyFailure(error),
      });
      return res.status(502).json({
        probe_status: "FAILED",
        error_code: "AI_RERANKER_LATENCY_PROBE_FAILED",
      });
    } finally {
      detachDisconnect();
      running = false;
    }
  };
}

async function executeAiRerankerLatencyProbe({
  client,
  provider = "unconfigured",
  model,
  logger = console,
  clock = () => Date.now(),
  requestTimeoutMs = AI_RERANKER_LATENCY_PROBE_TIMEOUT_MS,
  totalBudgetMs = AI_RERANKER_LATENCY_PROBE_TOTAL_BUDGET_MS,
  concurrency = AI_RERANKER_LATENCY_PROBE_CONCURRENCY,
  signal = null,
} = {}) {
  if (!client?.chat?.completions?.create || !String(model || "").trim()) {
    const error = new Error("AI reranker model is unavailable");
    error.code = "AI_RERANKER_MODEL_UNAVAILABLE";
    throw error;
  }

  const boundedConcurrency = Math.min(
    boundedProbeConcurrency(concurrency),
    AI_RERANKER_LATENCY_PROBE_PLAN.length,
  );
  const boundedTotalBudgetMs = boundedProbeTotalBudget(totalBudgetMs);
  const deadlineAt = Number(clock()) + boundedTotalBudgetMs;
  const samples = new Array(AI_RERANKER_LATENCY_PROBE_PLAN.length);
  let cursor = 0;
  const workers = Array.from({length: boundedConcurrency}, async () => {
    while (cursor < AI_RERANKER_LATENCY_PROBE_PLAN.length) {
      const index = cursor;
      cursor += 1;
      const run = AI_RERANKER_LATENCY_PROBE_PLAN[index];
      let sample;
      if (signal?.aborted) {
        sample = skippedProbeSample(run, "SKIPPED_CLIENT_DISCONNECT");
      } else {
        const remainingBudgetMs = deadlineAt - Number(clock());
        if (remainingBudgetMs <= 0) {
          sample = skippedProbeSample(run, "SKIPPED_TOTAL_BUDGET");
        } else {
          const configuredRequestTimeoutMs = boundedProbeTimeout(requestTimeoutMs);
          const effectiveTimeoutMs = Math.max(
            1,
            Math.min(configuredRequestTimeoutMs, remainingBudgetMs),
          );
          sample = await executeProbeSample({
            client,
            model: String(model).trim(),
            run,
            clock,
            requestTimeoutMs: effectiveTimeoutMs,
            timeoutCode: effectiveTimeoutMs < configuredRequestTimeoutMs
              ? "AI_RERANKER_LATENCY_PROBE_TOTAL_BUDGET_TIMEOUT"
              : "AI_RERANKER_LATENCY_PROBE_TIMEOUT",
            signal,
          });
        }
      }
      samples[index] = sample;
      logger.info?.("ai_reranker_latency_probe_sample", {
        candidate_count: sample.candidate_count,
        streaming: sample.streaming,
        success: sample.success,
        failure_reason: sample.failure_reason,
        total_latency_ms: sample.total_latency_ms,
      });
    }
  });
  await Promise.all(workers);

  const successCount = samples.filter(({success}) => success).length;
  const actualModelRequests = samples.filter(
    ({model_request_started: started}) => started,
  ).length;
  const skippedCount = samples.length - actualModelRequests;
  const probeStatus = successCount === samples.length
    ? "SUCCESS"
    : successCount > 0 ? "PARTIAL" : "FAILED";
  return Object.freeze({
    probe_version: "ai_reranker_latency_v1",
    probe_status: probeStatus,
    execution: "BOUNDED_CONCURRENT",
    model_config: Object.freeze({
      provider: safeIdentifier(provider, "unconfigured"),
      model: safeIdentifier(model, "unconfigured"),
      endpoint_type: "openai_compatible_chat_completions",
      response_format: "json_object",
      max_tokens: AI_RERANKER_LATENCY_PROBE_MAX_TOKENS,
      temperature: AI_RERANKER_LATENCY_PROBE_TEMPERATURE,
      request_timeout_ms: boundedProbeTimeout(requestTimeoutMs),
      total_budget_ms: boundedTotalBudgetMs,
      retries: 0,
      concurrency: boundedConcurrency,
    }),
    limits: Object.freeze({
      fixed_scenarios: Object.freeze([1, 2, 4]),
      runs_per_scenario: AI_RERANKER_LATENCY_PROBE_RUNS_PER_SCENARIO,
      model_request_limit: AI_RERANKER_LATENCY_PROBE_MAX_REQUESTS,
      actual_model_requests: actualModelRequests,
      skipped_sample_count: skippedCount,
      image_count: 0,
      taobao_calls: 0,
      outfit_calls: 0,
      arbitrary_prompt_allowed: false,
    }),
    sample_count: samples.length,
    success_count: successCount,
    failure_count: samples.length - successCount,
    samples: Object.freeze(samples),
    statistics: summarizeSamples(samples),
  });
}

async function executeProbeSample({
  client,
  model,
  run,
  clock,
  requestTimeoutMs = AI_RERANKER_LATENCY_PROBE_TIMEOUT_MS,
  timeoutCode = "AI_RERANKER_LATENCY_PROBE_TIMEOUT",
  signal = null,
}) {
  const timeoutMs = boundedProbeTimeout(requestTimeoutMs);
  const messages = buildProbeMessages(run.candidate_count);
  const promptBytes = Buffer.byteLength(JSON.stringify(messages), "utf8");
  const requestStartedMs = Number(clock());
  const requestStart = timestamp(requestStartedMs);
  const firstByte = unavailableTiming("RAW_FIRST_BYTE_NOT_EXPOSED_BY_SDK");
  let firstStreamEvent = unavailableTiming(run.streaming
    ? "NO_STREAM_EVENT_OBSERVED"
    : "NOT_APPLICABLE_NON_STREAMING");
  let firstToken = unavailableTiming(run.streaming
    ? "NO_CONTENT_TOKEN_OBSERVED"
    : "UNAVAILABLE_NON_STREAMING_SDK");
  let responseCompleteMs = null;
  let parseCompleteMs = null;
  let outputTokens = null;
  let outputText = "";
  let finishReason = null;
  let modelRequestStarted = false;
  const controller = new AbortController();
  const timeoutError = Object.assign(
    new Error("AI reranker latency probe request timed out"),
    {code: timeoutCode},
  );
  const abortFromParent = () => {
    const reason = signal?.reason instanceof Error
      ? signal.reason
      : probeError("AI_RERANKER_LATENCY_PROBE_CLIENT_DISCONNECT");
    controller.abort(reason);
  };
  if (signal?.aborted) abortFromParent();
  else signal?.addEventListener?.("abort", abortFromParent, {once: true});
  const timeoutTimer = setTimeout(() => {
    controller.abort(timeoutError);
  }, timeoutMs);
  timeoutTimer.unref?.();

  try {
    const request = {
      model,
      response_format: {type: "json_object"},
      enable_thinking: false,
      temperature: AI_RERANKER_LATENCY_PROBE_TEMPERATURE,
      max_tokens: AI_RERANKER_LATENCY_PROBE_MAX_TOKENS,
      stream: run.streaming,
      messages,
      ...(run.streaming ? {stream_options: {include_usage: true}} : {}),
    };
    await raceWithAbort(controller.signal, async () => {
      modelRequestStarted = true;
      const response = await client.chat.completions.create(request, {
        timeout: timeoutMs,
        maxRetries: 0,
        signal: controller.signal,
      });
      if (run.streaming) {
        let firstChunkSeen = false;
        for await (const chunk of response) {
          const chunkAt = Number(clock());
          if (!firstChunkSeen) {
            firstChunkSeen = true;
            firstStreamEvent = availableTiming(chunkAt, requestStartedMs);
          }
          const content = streamChunkText(chunk);
          if (content && firstToken.status !== "AVAILABLE") {
            firstToken = availableTiming(chunkAt, requestStartedMs);
          }
          outputText += content;
          outputTokens = completionTokens(chunk?.usage) ?? outputTokens;
          finishReason = streamFinishReason(chunk) || finishReason;
        }
        if (controller.signal.aborted) throw controller.signal.reason;
        if (!finishReason) {
          const error = new Error("AI reranker probe stream ended incompletely");
          error.code = "AI_RERANKER_PROBE_STREAM_INCOMPLETE";
          throw error;
        }
      } else {
        outputText = completionText(response);
        outputTokens = completionTokens(response?.usage);
        finishReason = safeFinishReason(response?.choices?.[0]?.finish_reason);
      }
    });
    responseCompleteMs = Number(clock());
    if (finishReason === "length") {
      const error = new Error("AI reranker probe output reached max tokens");
      error.code = "AI_RERANKER_PROBE_OUTPUT_TRUNCATED";
      throw error;
    }
    if (finishReason === "content_filter") {
      const error = new Error("AI reranker probe output was filtered");
      error.code = "AI_RERANKER_PROBE_OUTPUT_FILTERED";
      throw error;
    }
    let parsed;
    try {
      parsed = JSON.parse(stripJsonFence(outputText));
      validateProbePayload(parsed, run.candidate_count);
    } finally {
      parseCompleteMs = Number(clock());
    }
    return freezeSample({
      run,
      promptBytes,
      requestStart,
      requestStartedMs,
      firstByte,
      firstStreamEvent,
      firstToken,
      responseCompleteMs,
      parseCompleteMs,
      outputTokens,
      outputBytes: Buffer.byteLength(outputText, "utf8"),
      finishReason,
      modelRequestStarted,
      success: true,
      failureReason: null,
    });
  } catch (error) {
    const failureAt = Number(clock());
    return freezeSample({
      run,
      promptBytes,
      requestStart,
      requestStartedMs,
      firstByte,
      firstStreamEvent,
      firstToken,
      responseCompleteMs,
      parseCompleteMs,
      outputTokens,
      outputBytes: Buffer.byteLength(outputText, "utf8"),
      finishReason,
      modelRequestStarted,
      success: false,
      failureReason: classifyFailure(error),
      failureAt,
    });
  } finally {
    clearTimeout(timeoutTimer);
    signal?.removeEventListener?.("abort", abortFromParent);
  }
}

function freezeSample({
  run,
  promptBytes,
  requestStart,
  requestStartedMs,
  firstByte,
  firstStreamEvent,
  firstToken,
  responseCompleteMs,
  parseCompleteMs,
  outputTokens,
  outputBytes,
  finishReason,
  modelRequestStarted,
  success,
  failureReason,
  failureAt = null,
}) {
  const endedMs = parseCompleteMs ?? responseCompleteMs ?? failureAt ?? requestStartedMs;
  return Object.freeze({
    scenario_id: run.scenario_id,
    repetition: run.repetition,
    candidate_count: run.candidate_count,
    prompt_bytes: promptBytes,
    image_count: 0,
    streaming: run.streaming,
    model_request_started: modelRequestStarted,
    request_start: requestStart,
    first_byte: firstByte,
    first_stream_event: firstStreamEvent,
    first_token: firstToken,
    response_complete: responseCompleteMs == null
      ? null : timestamp(responseCompleteMs),
    parse_complete: parseCompleteMs == null ? null : timestamp(parseCompleteMs),
    response_latency_ms: responseCompleteMs == null
      ? null : roundedMs(responseCompleteMs - requestStartedMs),
    parse_latency_ms: responseCompleteMs == null || parseCompleteMs == null
      ? null : roundedMs(parseCompleteMs - responseCompleteMs),
    total_latency_ms: roundedMs(endedMs - requestStartedMs),
    output_tokens: outputTokens,
    output_tokens_status: outputTokens == null ? "UNAVAILABLE" : "AVAILABLE",
    output_bytes: outputBytes,
    finish_reason: finishReason,
    success,
    failure_reason: failureReason,
  });
}

function skippedProbeSample(run, failureReason) {
  const messages = buildProbeMessages(run.candidate_count);
  return Object.freeze({
    scenario_id: run.scenario_id,
    repetition: run.repetition,
    candidate_count: run.candidate_count,
    prompt_bytes: Buffer.byteLength(JSON.stringify(messages), "utf8"),
    image_count: 0,
    streaming: run.streaming,
    model_request_started: false,
    request_start: null,
    first_byte: unavailableTiming("MODEL_REQUEST_NOT_STARTED"),
    first_stream_event: unavailableTiming("MODEL_REQUEST_NOT_STARTED"),
    first_token: unavailableTiming("MODEL_REQUEST_NOT_STARTED"),
    response_complete: null,
    parse_complete: null,
    response_latency_ms: null,
    parse_latency_ms: null,
    total_latency_ms: null,
    output_tokens: null,
    output_tokens_status: "UNAVAILABLE",
    output_bytes: 0,
    finish_reason: null,
    success: false,
    failure_reason: failureReason,
  });
}

function buildProbeMessages(candidateCount) {
  const count = Number(candidateCount);
  if (![1, 2, 4].includes(count)) {
    throw new Error("AI_RERANKER_LATENCY_PROBE_INVALID_SCENARIO");
  }
  const userPayload = {
    scene: PROBE_CONTEXT.scene,
    desired_impression: [...PROBE_CONTEXT.desired_impression],
    explicit_avoid: [...PROBE_CONTEXT.explicit_avoid],
    concept_summary: PROBE_CONTEXT.concept_summary,
    slot: PROBE_CONTEXT.slot,
    candidates: PROBE_CANDIDATES.slice(0, count).map((candidate) => ({
      ...candidate,
    })),
  };
  return Object.freeze([
    Object.freeze({
      role: "system",
      content: [
        "Evaluate only the supplied ecommerce candidates for the supplied styling context.",
        "Return one JSON object whose only key is evaluations.",
        "evaluations must contain exactly one item per candidate in the same order.",
        `audience_fit, contemporary_fit, occasion_fit, desired_impression_fit, and visual_quality must be one of: ${FIT_VALUES.join(", ")}.`,
        `decision must be one of: ${DECISION_VALUES.join(", ")}.`,
        `short_reason must be plain text with at most ${AI_RERANKER_SHORT_REASON_MAX_CHARACTERS} Unicode characters.`,
        "Each evaluation may contain only candidate_id, audience_fit, contemporary_fit, occasion_fit, desired_impression_fit, visual_quality, decision, short_reason.",
        "Do not add markdown or commentary.",
      ].join("\n"),
    }),
    Object.freeze({role: "user", content: JSON.stringify(userPayload)}),
  ]);
}

function validateProbePayload(payload, candidateCount) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
      Object.keys(payload).length !== 1 || !Array.isArray(payload.evaluations) ||
      payload.evaluations.length !== candidateCount) {
    throw invalidResponseError();
  }
  const expectedIds = PROBE_CANDIDATES.slice(0, candidateCount)
    .map(({candidate_id: id}) => id);
  const allowedKeys = [
    "candidate_id",
    "audience_fit",
    "contemporary_fit",
    "occasion_fit",
    "desired_impression_fit",
    "visual_quality",
    "decision",
    "short_reason",
  ];
  payload.evaluations.forEach((evaluation, index) => {
    if (!evaluation || typeof evaluation !== "object" || Array.isArray(evaluation) ||
        Object.keys(evaluation).length !== allowedKeys.length ||
        !allowedKeys.every((key) => Object.hasOwn(evaluation, key)) ||
        evaluation.candidate_id !== expectedIds[index] ||
        !FIT_VALUES.includes(evaluation.audience_fit) ||
        !FIT_VALUES.includes(evaluation.contemporary_fit) ||
        !FIT_VALUES.includes(evaluation.occasion_fit) ||
        !FIT_VALUES.includes(evaluation.desired_impression_fit) ||
        !FIT_VALUES.includes(evaluation.visual_quality) ||
        !DECISION_VALUES.includes(evaluation.decision) ||
        typeof evaluation.short_reason !== "string" ||
        [...evaluation.short_reason].length === 0 ||
        [...evaluation.short_reason].length >
          AI_RERANKER_SHORT_REASON_MAX_CHARACTERS) {
      throw invalidResponseError();
    }
  });
  return payload;
}

function summarizeSamples(samples) {
  const candidateCounts = AI_RERANKER_LATENCY_PROBE_SCENARIOS.map(
    ({candidate_count: candidateCount}) => summarizeBucket(
      samples.filter((sample) =>
        sample.candidate_count === candidateCount && !sample.streaming),
      {
        candidate_count: candidateCount,
        streaming: false,
        calibration_role: "PRODUCTION_TIMEOUT",
      },
      {calibrationEligible: true},
    ),
  );
  const streamingModes = [false, true].map((streaming) => summarizeBucket(
    samples.filter((sample) => sample.streaming === streaming),
    {streaming, calibration_role: "COMPARISON_ONLY"},
    {
      calibrationEligible: false,
      exclusionReason: streaming
        ? "STREAMING_COMPARISON_ONLY"
        : "MIXED_CANDIDATE_COUNTS",
    },
  ));
  const candidateCountsAndStreaming = AI_RERANKER_LATENCY_PROBE_SCENARIOS
    .flatMap(({candidate_count: candidateCount}) => [false, true].map(
      (streaming) => summarizeBucket(
        samples.filter((sample) =>
          sample.candidate_count === candidateCount &&
          sample.streaming === streaming),
        {
          candidate_count: candidateCount,
          streaming,
          calibration_role: streaming
            ? "STREAMING_COMPARISON"
            : "PRODUCTION_TIMEOUT",
        },
        {
          calibrationEligible: !streaming,
          exclusionReason: streaming ? "STREAMING_COMPARISON_ONLY" : null,
        },
      ),
    ));
  return Object.freeze({
    percentile_method: "linear_interpolation_successful_samples_only",
    production_timeout_basis: "by_candidate_count_non_streaming_only",
    by_candidate_count: Object.freeze(candidateCounts),
    by_streaming: Object.freeze(streamingModes),
    by_candidate_count_and_streaming: Object.freeze(
      candidateCountsAndStreaming,
    ),
  });
}

function summarizeBucket(samples, identity, {
  calibrationEligible = false,
  exclusionReason = null,
} = {}) {
  const successful = samples.filter(({success}) => success);
  const started = samples.filter(({model_request_started: value}) => value);
  const latencies = successful.map(({total_latency_ms: value}) => value);
  const outputTokens = successful.map(({output_tokens: value}) => value)
    .filter(Number.isFinite);
  const ttft = successful.map(({first_token: timing}) =>
    timing?.status === "AVAILABLE" ? timing.latency_ms : null)
    .filter(Number.isFinite);
  return Object.freeze({
    ...identity,
    sample_count: samples.length,
    started_sample_count: started.length,
    skipped_sample_count: samples.length - started.length,
    success_count: successful.length,
    failure_count: samples.length - successful.length,
    latency_censored_by_failure: successful.length !== samples.length,
    usable_for_timeout_calibration:
      calibrationEligible && samples.length > 0 &&
      successful.length === samples.length,
    calibration_exclusion_reason: !calibrationEligible
      ? exclusionReason || "COMPARISON_ONLY"
      : successful.length !== samples.length
        ? "INCOMPLETE_OR_CENSORED_SAMPLES" : null,
    total_latency_ms: distribution(latencies),
    output_tokens: distribution(outputTokens),
    first_token_latency_ms: distribution(ttft),
  });
}

function distribution(values) {
  const numbers = values.filter(Number.isFinite).sort((left, right) => left - right);
  return Object.freeze({
    sample_count: numbers.length,
    min: numbers.length ? numbers[0] : null,
    p50: percentile(numbers, 0.5),
    p95: percentile(numbers, 0.95),
    max: numbers.length ? numbers[numbers.length - 1] : null,
  });
}

function percentile(values, quantile) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * Math.max(0, Math.min(1, quantile));
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return roundedMs(
    sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower),
  );
}

function aiRerankerLatencyProbeEnabled(environment = {}) {
  const enabled = String(environment.ENABLE_AI_RERANKER_LATENCY_PROBE || "")
    .trim().toLowerCase() === "true";
  const renderRuntime = String(environment.RENDER || "")
    .trim().toLowerCase() === "true";
  const token = String(environment.INTERNAL_PROBE_TOKEN || "");
  const modelSecrets = [
    environment.OPENAI_API_KEY,
    environment.DASHSCOPE_API_KEY,
  ].map((value) => String(value || "")).filter(Boolean);
  const independent = !modelSecrets.includes(token);
  return enabled && renderRuntime &&
    token.length >= INTERNAL_PROBE_TOKEN_MIN_LENGTH && independent;
}

function authorized(req, expectedToken) {
  const header = String(req?.headers?.authorization || "");
  if (!header.startsWith("Bearer ")) return false;
  const actual = Buffer.from(header.slice(7), "utf8");
  const expected = Buffer.from(String(expectedToken || ""), "utf8");
  return actual.length === expected.length && actual.length > 0 &&
    crypto.timingSafeEqual(actual, expected);
}

function emptyProbeBody(body) {
  return body === undefined || body === null ||
    (typeof body === "object" && !Array.isArray(body) &&
      Object.keys(body).length === 0);
}

function bindClientDisconnect(req, res, controller) {
  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort(probeError(
        "AI_RERANKER_LATENCY_PROBE_CLIENT_DISCONNECT",
      ));
    }
  };
  const onRequestAborted = () => abort();
  const onRequestClose = () => {
    if (req?.aborted === true || req?.complete === false) abort();
  };
  const onResponseClose = () => {
    if (res?.writableEnded !== true) abort();
  };
  req?.once?.("aborted", onRequestAborted);
  req?.once?.("close", onRequestClose);
  res?.once?.("close", onResponseClose);
  return () => {
    req?.off?.("aborted", onRequestAborted);
    req?.off?.("close", onRequestClose);
    res?.off?.("close", onResponseClose);
  };
}

function raceWithAbort(signal, operation) {
  if (signal.aborted) {
    return Promise.reject(signal.reason || probeError(
      "AI_RERANKER_LATENCY_PROBE_ABORTED",
    ));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback(value);
    };
    const onAbort = () => settle(
      reject,
      signal.reason || probeError("AI_RERANKER_LATENCY_PROBE_ABORTED"),
    );
    signal.addEventListener("abort", onAbort, {once: true});
    Promise.resolve().then(operation).then(
      (value) => settle(resolve, value),
      (error) => settle(reject, error),
    );
  });
}

function completionText(response) {
  const content = response?.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : "";
}

function streamChunkText(chunk) {
  const content = chunk?.choices?.[0]?.delta?.content;
  return typeof content === "string" ? content : "";
}

function streamFinishReason(chunk) {
  const choices = Array.isArray(chunk?.choices) ? chunk.choices : [];
  for (const choice of choices) {
    const reason = safeFinishReason(choice?.finish_reason);
    if (reason) return reason;
  }
  return null;
}

function safeFinishReason(value) {
  const reason = String(value || "").trim().toLowerCase();
  return ["stop", "length", "content_filter", "tool_calls"].includes(reason)
    ? reason : null;
}

function completionTokens(usage) {
  const value = usage?.completion_tokens ?? usage?.output_tokens;
  return Number.isFinite(value) && value >= 0 ? Number(value) : null;
}

function stripJsonFence(content) {
  return String(content || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function invalidResponseError() {
  const error = new Error("AI reranker probe returned an invalid response");
  error.code = "AI_RERANKER_PROBE_INVALID_RESPONSE";
  return error;
}

function probeError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function classifyFailure(error) {
  const status = Number(error?.status || error?.cause?.status);
  const code = String(error?.code || error?.cause?.code || "").toUpperCase();
  const name = String(error?.name || "").toUpperCase();
  if (status === 429 || code.includes("RATE_LIMIT")) return "UPSTREAM_RATE_LIMIT";
  if (code === "AI_RERANKER_LATENCY_PROBE_CLIENT_DISCONNECT") {
    return "CLIENT_DISCONNECT";
  }
  if (code === "AI_RERANKER_LATENCY_PROBE_TOTAL_BUDGET_TIMEOUT") {
    return "TOTAL_BUDGET_EXHAUSTED_DURING_REQUEST";
  }
  if (code === "AI_RERANKER_PROBE_INVALID_RESPONSE" ||
      error instanceof SyntaxError) return "RESPONSE_PARSE_FAILED";
  if (code === "AI_RERANKER_PROBE_STREAM_INCOMPLETE") {
    return "MODEL_GENERATION_INCOMPLETE";
  }
  if (code === "AI_RERANKER_PROBE_OUTPUT_TRUNCATED") {
    return "MODEL_OUTPUT_TRUNCATED";
  }
  if (code === "AI_RERANKER_PROBE_OUTPUT_FILTERED") {
    return "MODEL_OUTPUT_FILTERED";
  }
  if (status === 401 || status === 403) return "UPSTREAM_AUTH_FAILED";
  if (name.includes("ABORT") || name.includes("TIMEOUT") ||
      code.includes("TIMEOUT") || code.includes("ETIMEDOUT")) {
    return "MODEL_REQUEST_TIMEOUT";
  }
  if (code.includes("ECONN") || code.includes("ENOTFOUND") ||
      code.includes("SOCKET")) return "MODEL_CONNECTION_FAILED";
  return "MODEL_REQUEST_FAILED";
}

function availableTiming(atMs, startedMs) {
  return Object.freeze({
    status: "AVAILABLE",
    at: timestamp(atMs),
    latency_ms: roundedMs(atMs - startedMs),
    reason: null,
  });
}

function unavailableTiming(reason) {
  return Object.freeze({
    status: "UNAVAILABLE",
    at: null,
    latency_ms: null,
    reason,
  });
}

function timestamp(milliseconds) {
  return new Date(milliseconds).toISOString();
}

function roundedMs(value) {
  return Number(Math.max(0, Number(value) || 0).toFixed(3));
}

function boundedProbeTimeout(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return AI_RERANKER_LATENCY_PROBE_TIMEOUT_MS;
  }
  return Math.min(Math.round(parsed), AI_RERANKER_LATENCY_PROBE_TIMEOUT_MS);
}

function boundedProbeTotalBudget(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return AI_RERANKER_LATENCY_PROBE_TOTAL_BUDGET_MS;
  }
  return Math.min(
    Math.round(parsed),
    AI_RERANKER_LATENCY_PROBE_TOTAL_BUDGET_MS,
  );
}

function boundedProbeConcurrency(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return AI_RERANKER_LATENCY_PROBE_CONCURRENCY;
  }
  return Math.min(parsed, AI_RERANKER_LATENCY_PROBE_CONCURRENCY);
}

function safeIdentifier(value, fallback) {
  const sanitized = String(value || "").trim()
    .replace(/[^a-zA-Z0-9._:/+-]/g, "")
    .slice(0, 100);
  return sanitized || fallback;
}

function createSafeProbeLogger(logger = console) {
  return {
    info(message, details) {
      logger.info?.(message, safeLogDetails(details));
    },
    warn(message, details) {
      logger.warn?.(message, safeLogDetails(details));
    },
    error(message, details) {
      logger.error?.(message, safeLogDetails(details));
    },
  };
}

function safeLogDetails(details) {
  if (!details || typeof details !== "object") return undefined;
  const allowed = [
    "candidate_count",
    "streaming",
    "success",
    "failure_reason",
    "total_latency_ms",
    "error_code",
  ];
  return Object.fromEntries(allowed
    .filter((key) => details[key] !== undefined)
    .map((key) => [key, details[key]]));
}

module.exports = {
  AI_RERANKER_LATENCY_PROBE_MAX_REQUESTS,
  AI_RERANKER_LATENCY_PROBE_MAX_TOKENS,
  AI_RERANKER_LATENCY_PROBE_CONCURRENCY,
  AI_RERANKER_LATENCY_PROBE_PATH,
  AI_RERANKER_LATENCY_PROBE_PLAN,
  AI_RERANKER_LATENCY_PROBE_SCENARIOS,
  AI_RERANKER_LATENCY_PROBE_TIMEOUT_MS,
  AI_RERANKER_LATENCY_PROBE_TOTAL_BUDGET_MS,
  AI_RERANKER_SHORT_REASON_MAX_CHARACTERS,
  PROBE_CANDIDATES,
  PROBE_CONTEXT,
  aiRerankerLatencyProbeEnabled,
  buildProbeMessages,
  createAiRerankerLatencyProbeHandler,
  executeAiRerankerLatencyProbe,
  percentile,
  summarizeSamples,
  validateProbePayload,
};
