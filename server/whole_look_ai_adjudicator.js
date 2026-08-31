"use strict";

const DEFAULT_MODEL = "qwen3.7-plus";
const DEFAULT_SCORE_GAP = 8;
const DEFAULT_TIMEOUT_MS = 6_000;
const DEFAULT_TOTAL_BUDGET_MS = 10_000;
const DEFAULT_MAX_CALLS = 2;
const MAX_CANDIDATES = 3;
const MAX_PROMPT_BYTES = 12 * 1024;
const MAX_OUTPUT_TOKENS = 192;

class WholeLookAIAdjudicator {
  constructor({
    client = null,
    model = DEFAULT_MODEL,
    scoreGap = DEFAULT_SCORE_GAP,
    scoreGapThreshold,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    totalBudgetMs = DEFAULT_TOTAL_BUDGET_MS,
    maxCalls = DEFAULT_MAX_CALLS,
    now = Date.now,
  } = {}) {
    this.client = client;
    this.model = cleanText(model, 80) || DEFAULT_MODEL;
    this.scoreGap = nonNegativeNumber(
      scoreGapThreshold ?? scoreGap,
      DEFAULT_SCORE_GAP,
    );
    this.timeoutMs = Math.min(
      positiveInteger(timeoutMs, DEFAULT_TIMEOUT_MS),
      DEFAULT_TIMEOUT_MS,
    );
    this.totalBudgetMs = Math.min(
      positiveInteger(totalBudgetMs, DEFAULT_TOTAL_BUDGET_MS),
      DEFAULT_TOTAL_BUDGET_MS,
    );
    this.maxCalls = Math.min(
      positiveInteger(maxCalls, DEFAULT_MAX_CALLS),
      DEFAULT_MAX_CALLS,
    );
    this.now = typeof now === "function" ? now : Date.now;
  }

  get configured() {
    return Boolean(this.client?.chat?.completions?.create);
  }

  createSession(options = {}) {
    const startedAt = this.now();
    const totalBudgetMs = Math.min(
      positiveInteger(options.totalBudgetMs, this.totalBudgetMs),
      this.totalBudgetMs,
      DEFAULT_TOTAL_BUDGET_MS,
    );
    const maxCalls = Math.min(
      positiveInteger(options.maxCalls, this.maxCalls),
      this.maxCalls,
      DEFAULT_MAX_CALLS,
    );
    return {
      kind: "whole_look_ai_adjudication_session",
      startedAt,
      deadlineAt: startedAt + totalBudgetMs,
      totalBudgetMs,
      maxCalls,
      callCount: 0,
    };
  }

  async adjudicate(input = {}, options = {}) {
    const normalized = normalizeArguments(input, options);
    const session = validSession(normalized.options.session)
      ? normalized.options.session
      : this.createSession(normalized.options);
    const startedAt = this.now();
    const prepared = prepareCandidates(normalized.candidates);
    const top = prepared.eligible[0] || null;
    const runnerUp = prepared.eligible[1] || null;
    const scoreGap = top && runnerUp
      ? roundScore(top.score - runnerUp.score)
      : null;
    const trace = {
      version: "whole_look_ai_adjudicator.v1",
      request_id: normalized.requestId || null,
      look_id: normalized.lookId || null,
      model: this.model,
      status: "STARTED",
      decision_mode: null,
      input_candidate_count: prepared.inputCount,
      considered_candidate_count: prepared.eligible.length,
      considered_candidate_ids: prepared.eligible.map((entry) => entry.id),
      excluded_candidates: prepared.excluded,
      truncated_candidate_count: prepared.truncatedCount,
      score_gap: scoreGap,
      score_gap_threshold: this.scoreGap,
      deterministic_winner_look_candidate_id: top?.id || null,
      ai_attempted: false,
      ai_call_number: null,
      session_call_count: session.callCount,
      session_max_calls: session.maxCalls,
      total_budget_ms: session.totalBudgetMs,
      remaining_budget_ms_at_start: Math.max(0, session.deadlineAt - startedAt),
      timeout_ms: null,
      prompt_bytes: null,
      model_request_ms: 0,
      response_parse_ms: null,
      fallback_reason: null,
      winner_look_candidate_id: top?.id || null,
      confidence: null,
      duration_ms: null,
    };

    if (!top) {
      return finishResult(null, trace, startedAt, this.now, {
        status: "NO_QUALITY_VALID_CANDIDATE",
        decisionMode: "DETERMINISTIC",
        fallbackReason: "NO_QUALITY_VALID_CANDIDATE",
      });
    }
    if (!runnerUp) {
      return finishResult(top, trace, startedAt, this.now, {
        status: "DETERMINISTIC_ONLY",
        decisionMode: "DETERMINISTIC",
        fallbackReason: "FEWER_THAN_TWO_QUALITY_VALID_CANDIDATES",
      });
    }
    if (scoreGap >= this.scoreGap) {
      return finishResult(top, trace, startedAt, this.now, {
        status: "DETERMINISTIC_MARGIN_CLEAR",
        decisionMode: "DETERMINISTIC",
      });
    }
    if (!this.configured) {
      return finishResult(top, trace, startedAt, this.now, {
        status: "AI_FALLBACK",
        decisionMode: "DETERMINISTIC_FALLBACK",
        fallbackReason: "AI_CLIENT_NOT_CONFIGURED",
      });
    }
    if (session.callCount >= session.maxCalls) {
      return finishResult(top, trace, startedAt, this.now, {
        status: "AI_FALLBACK",
        decisionMode: "DETERMINISTIC_FALLBACK",
        fallbackReason: "AI_CALL_BUDGET_EXHAUSTED",
      });
    }

    const remainingBudgetMs = session.deadlineAt - this.now();
    if (remainingBudgetMs <= 0) {
      return finishResult(top, trace, startedAt, this.now, {
        status: "AI_FALLBACK",
        decisionMode: "DETERMINISTIC_FALLBACK",
        fallbackReason: "AI_TOTAL_TIME_BUDGET_EXHAUSTED",
      });
    }

    let messages;
    try {
      messages = buildWholeLookAdjudicationMessages(
        prepared.eligible,
        normalized.context,
      );
      trace.prompt_bytes = Buffer.byteLength(JSON.stringify(messages), "utf8");
      if (trace.prompt_bytes >= MAX_PROMPT_BYTES) {
        throw codedError("AI_PROMPT_TOO_LARGE", "AI prompt exceeded size bound");
      }
    } catch (error) {
      return finishResult(top, trace, startedAt, this.now, {
        status: "AI_FALLBACK",
        decisionMode: "DETERMINISTIC_FALLBACK",
        fallbackReason: safeErrorCode(error),
      });
    }

    const remainingAfterPromptMs = session.deadlineAt - this.now();
    if (remainingAfterPromptMs <= 0) {
      return finishResult(top, trace, startedAt, this.now, {
        status: "AI_FALLBACK",
        decisionMode: "DETERMINISTIC_FALLBACK",
        fallbackReason: "AI_TOTAL_TIME_BUDGET_EXHAUSTED",
      });
    }
    const timeoutMs = Math.max(1, Math.min(
      this.timeoutMs,
      remainingAfterPromptMs,
      DEFAULT_TIMEOUT_MS,
    ));
    session.callCount += 1;
    trace.ai_attempted = true;
    trace.ai_call_number = session.callCount;
    trace.session_call_count = session.callCount;
    trace.timeout_ms = timeoutMs;
    const modelStartedAt = this.now();
    let parseStartedAt = null;
    try {
      const response = await abortableRequest(this.client, {
        model: this.model,
        response_format: {type: "json_object"},
        enable_thinking: false,
        temperature: 0.1,
        max_tokens: MAX_OUTPUT_TOKENS,
        messages,
      }, timeoutMs);
      trace.model_request_ms = Math.max(0, this.now() - modelStartedAt);
      parseStartedAt = this.now();
      const payload = validateWholeLookAdjudicationResponse(
        parseStrictJson(extractResponseText(response)),
        prepared.eligible.map((entry) => entry.id),
      );
      trace.response_parse_ms = Math.max(0, this.now() - parseStartedAt);
      const winner = prepared.eligible.find((entry) =>
        entry.id === payload.winner_look_candidate_id);
      trace.confidence = payload.confidence;
      return finishResult(winner, trace, startedAt, this.now, {
        status: "AI_SUCCESS",
        decisionMode: "AI",
        confidence: payload.confidence,
        shortReason: payload.short_reason,
      });
    } catch (error) {
      trace.model_request_ms = Math.max(0, this.now() - modelStartedAt);
      if (parseStartedAt != null) {
        trace.response_parse_ms = Math.max(0, this.now() - parseStartedAt);
      }
      return finishResult(top, trace, startedAt, this.now, {
        status: "AI_FALLBACK",
        decisionMode: "DETERMINISTIC_FALLBACK",
        fallbackReason: safeErrorCode(error),
      });
    }
  }

  async select(input = {}, options = {}) {
    return this.adjudicate(input, options);
  }
}

function normalizeArguments(input, options) {
  if (Array.isArray(input)) {
    return {
      candidates: input,
      context: options.context || {},
      options,
      requestId: cleanText(options.requestId || options.request_id, 160),
      lookId: cleanText(options.lookId || options.look_id, 160),
    };
  }
  const source = input && typeof input === "object" ? input : {};
  return {
    candidates: source.candidates || source.lookCandidates ||
      source.look_candidates || [],
    context: source.context || source.decisionContext ||
      source.decision_context || options.context || {},
    options: {...options, ...source.options, session: source.session || options.session},
    requestId: cleanText(
      source.requestId || source.request_id || options.requestId || options.request_id,
      160,
    ),
    lookId: cleanText(
      source.lookId || source.look_id || options.lookId || options.look_id,
      160,
    ),
  };
}

function prepareCandidates(candidates) {
  const source = Array.isArray(candidates) ? candidates : [];
  const eligible = [];
  const excluded = [];
  source.forEach((candidate, inputIndex) => {
    const id = lookCandidateId(candidate);
    let reason = null;
    if (!id) reason = "MISSING_LOOK_CANDIDATE_ID";
    else if (!deterministicQualityPassed(candidate)) {
      reason = "DETERMINISTIC_QUALITY_NOT_PASS";
    } else if (hasHardReject(candidate)) {
      reason = "HARD_REJECT_PRESENT";
    }
    const score = deterministicScore(candidate);
    if (!reason && score == null) reason = "DETERMINISTIC_SCORE_MISSING";
    if (reason) {
      excluded.push(Object.freeze({
        look_candidate_id: id || null,
        reason,
      }));
      return;
    }
    eligible.push({candidate, id, score, inputIndex});
  });
  eligible.sort((left, right) =>
    right.score - left.score || left.inputIndex - right.inputIndex ||
    left.id.localeCompare(right.id));
  const considered = eligible.slice(0, MAX_CANDIDATES);
  return {
    inputCount: source.length,
    eligible: considered,
    excluded: Object.freeze(excluded),
    truncatedCount: Math.max(0, eligible.length - considered.length),
  };
}

function deterministicQualityPassed(candidate = {}) {
  const statuses = [
    candidate.deterministic_quality_status,
    candidate.deterministic_quality_gate_status,
    candidate.quality_floor_status,
    candidate.quality_status,
    candidate.deterministic_quality_gate?.status,
    candidate.deterministic_quality?.status,
    candidate.final_look_quality?.status,
    candidate.whole_look_quality?.status,
    candidate.quality_floor?.status,
    candidate.quality_validation?.status,
    candidate.quality_gate?.status,
    candidate.portfolio_validation?.status,
  ].filter((value) => value != null && String(value).trim() !== "");
  if (statuses.length > 0) {
    return statuses.every((status) => String(status).trim().toUpperCase() === "PASS");
  }
  return candidate.deterministic_quality_pass === true ||
    candidate.quality_valid === true;
}

function hasHardReject(candidate = {}) {
  if (candidate.hard_reject === true || candidate.has_hard_reject === true) {
    return true;
  }
  for (const key of ["hard_rejects", "hard_reject_reasons", "hard_rejections"]) {
    const value = candidate[key];
    if (Array.isArray(value) && value.length > 0) return true;
    if (typeof value === "string" && value.trim()) return true;
  }
  const products = [
    candidate.selected_products,
    candidate.products,
    candidate.items,
  ].find(Array.isArray) || [];
  return products.some((product) =>
    product?.hard_reject === true || product?.has_hard_reject === true ||
    String(product?.product_acceptance_result || "").trim().toUpperCase() ===
      "HARD_REJECT" ||
    String(product?.acceptance_result || "").trim().toUpperCase() ===
      "HARD_REJECT");
}

function deterministicScore(candidate = {}) {
  for (const value of [
    candidate.adjusted_score,
    candidate.deterministic_quality_score,
    candidate.final_look_quality?.overall_score,
    candidate.whole_look_quality?.overall_score,
    candidate.quality_floor?.overall_score,
    candidate.deterministic_score,
    candidate.quality_score,
    candidate.final_score,
    candidate.outfit_strategy_score,
    candidate.score,
  ]) {
    const number = Number(value);
    if (Number.isFinite(number)) return roundScore(number);
  }
  return null;
}

function lookCandidateId(candidate = {}) {
  return cleanText(
    candidate.look_candidate_id || candidate.candidate_id ||
      candidate.look_id || candidate.id,
    160,
  );
}

function buildWholeLookAdjudicationMessages(entries, context = {}) {
  const candidates = entries.slice(0, MAX_CANDIDATES).map((entry) =>
    compactLook(entry.candidate, entry.id, entry.score));
  const payload = {
    intent: compactIntent(context),
    look_candidates: candidates,
  };
  const messages = [
    {
      role: "system",
      content: [
        "你是 FitAI 整套穿搭近分裁决器，只能从输入的2至3个完整 Look 中选一个。",
        "候选已通过确定性质量底线；比较整套协调、场景与用户意图贴合、轮廓比例、颜色材质和完成度。不得编造候选或单品。",
        "只返回严格 JSON，且必须仅含 winner_look_candidate_id、confidence、short_reason。confidence 为0到1，short_reason不超过100字。",
      ].join("\n"),
    },
    {role: "user", content: JSON.stringify(payload)},
  ];
  if (Buffer.byteLength(JSON.stringify(messages), "utf8") >= MAX_PROMPT_BYTES) {
    const smaller = [
      messages[0],
      {role: "user", content: JSON.stringify({
        intent: compactIntent(context, true),
        look_candidates: candidates.map(compactLookFurther),
      })},
    ];
    return smaller;
  }
  return messages;
}

function compactIntent(context = {}, minimal = false) {
  const decision = context.decision_context || context;
  const truth = decision.user_truth || context.user_requirements ||
    decision.intent || context;
  const brain = decision?.intent?.user_intent_brain || {};
  const unwrap = (value) => value && typeof value === "object" &&
    Object.hasOwn(value, "value") ? value.value : value;
  const result = compactObject({
    scene: truth.scene || context.scene,
    style: unwrap(brain.explicit_style) || truth.style ||
      truth.explicit_style?.value || context.style,
    desired_impression: unwrap(brain.desired_impression) ||
      truth.desired_impression || context.desired_impression,
    gender: truth.gender || context.gender,
    body_notes: minimal ? undefined : decision.body_fit_profile?.strategy ||
      truth.body_notes || context.body_notes,
    avoid: minimal ? undefined : unwrap(brain.explicit_avoid) ||
      truth.explicit_avoid || context.user_requirements?.explicit_avoid ||
      context.explicit_avoid || context.avoid,
  }, minimal ? 80 : 180);
  return result;
}

function compactLook(candidate, id, score) {
  const products = [candidate.selected_products, candidate.products, candidate.items]
    .find(Array.isArray) || [];
  return compactObject({
    look_candidate_id: id,
    deterministic_quality_score: score,
    concept: candidate.concept_summary || candidate.styling_goal ||
      candidate.style_direction || candidate.concept,
    scene: candidate.scene,
    style: candidate.style || candidate.style_direction,
    silhouette: candidate.silhouette || candidate.proportion_strategy,
    palette: candidate.palette || candidate.color_story,
    quality_evidence: candidate.quality_evidence ||
      candidate.deterministic_quality?.evidence ||
      candidate.final_look_quality?.dimension_scores ||
      candidate.whole_look_quality?.dimension_scores ||
      candidate.quality_validation?.evidence,
    candidate_ids: candidate.candidate_ids,
    items: products.slice(0, 8).map((product) => compactObject({
      slot: product.category || product.slot,
      title: product.title || product.name,
      color: product.color || product.color_label,
      material: product.material,
      silhouette: product.silhouette || product.fit,
      style: product.style || product.style_tags,
    }, 100)),
  }, 240);
}

function compactLookFurther(candidate) {
  return compactObject({
    look_candidate_id: candidate.look_candidate_id,
    deterministic_quality_score: candidate.deterministic_quality_score,
    concept: cleanText(candidate.concept, 100),
    scene: cleanText(candidate.scene, 60),
    style: cleanText(candidate.style, 80),
    silhouette: cleanText(candidate.silhouette, 80),
    palette: cleanText(candidate.palette, 80),
    items: (candidate.items || []).slice(0, 8).map((item) => compactObject({
      slot: item.slot,
      title: cleanText(item.title, 60),
      color: cleanText(item.color, 40),
      material: cleanText(item.material, 40),
    }, 60)),
  }, 100);
}

function validateWholeLookAdjudicationResponse(payload, allowedIds) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw codedError("AI_RESPONSE_INVALID", "AI response must be an object");
  }
  const requiredKeys = [
    "winner_look_candidate_id",
    "confidence",
    "short_reason",
  ];
  const keys = Object.keys(payload);
  if (keys.length !== requiredKeys.length ||
      requiredKeys.some((key) => !Object.hasOwn(payload, key))) {
    throw codedError("AI_RESPONSE_INVALID", "AI response keys are invalid");
  }
  const winner = cleanText(payload.winner_look_candidate_id, 160);
  if (!winner || !new Set(allowedIds).has(winner)) {
    throw codedError("AI_WINNER_NOT_ALLOWED", "AI winner is not an input candidate");
  }
  const confidence = Number(payload.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw codedError("AI_RESPONSE_INVALID", "AI confidence is invalid");
  }
  const shortReason = cleanText(payload.short_reason, 101);
  if (!shortReason || [...shortReason].length > 100) {
    throw codedError("AI_RESPONSE_INVALID", "AI short_reason is invalid");
  }
  return Object.freeze({
    winner_look_candidate_id: winner,
    confidence,
    short_reason: shortReason,
  });
}

function parseStrictJson(text) {
  const source = String(text || "").trim();
  if (!source || !source.startsWith("{") || !source.endsWith("}")) {
    throw codedError("AI_RESPONSE_PARSE_FAILED", "AI response is not strict JSON");
  }
  try {
    return JSON.parse(source);
  } catch (cause) {
    throw codedError("AI_RESPONSE_PARSE_FAILED", "AI response JSON is invalid", cause);
  }
}

function extractResponseText(response) {
  const content = response?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => typeof part === "string" ? part : part?.text || "")
      .join("");
  }
  if (typeof response?.output_text === "string") return response.output_text;
  throw codedError("AI_RESPONSE_PARSE_FAILED", "AI response text is missing");
}

async function abortableRequest(client, payload, timeoutMs) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      client.chat.completions.create(payload, {
        timeout: timeoutMs,
        maxRetries: 0,
        signal: controller.signal,
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = codedError("AI_ADJUDICATION_TIMEOUT", "AI adjudication timed out");
          controller.abort(error);
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function finishResult(entry, trace, startedAt, now, {
  status,
  decisionMode,
  fallbackReason = null,
  confidence = null,
  shortReason = null,
}) {
  trace.status = status;
  trace.decision_mode = decisionMode;
  trace.fallback_reason = fallbackReason;
  trace.winner_look_candidate_id = entry?.id || null;
  trace.confidence = confidence;
  trace.duration_ms = Math.max(0, now() - startedAt);
  const frozenTrace = deepFreeze(trace);
  return Object.freeze({
    winner_look_candidate_id: entry?.id || null,
    winner: entry?.candidate || null,
    confidence,
    short_reason: shortReason,
    source: decisionMode === "AI" ? "AI" : "DETERMINISTIC",
    fallback: decisionMode === "DETERMINISTIC_FALLBACK",
    fallback_reason: fallbackReason,
    trace: frozenTrace,
  });
}

function validSession(session) {
  return session && session.kind === "whole_look_ai_adjudication_session" &&
    Number.isFinite(session.deadlineAt) && Number.isInteger(session.callCount) &&
    Number.isInteger(session.maxCalls);
}

function compactObject(value, maxTextLength = 160) {
  const result = {};
  for (const [key, raw] of Object.entries(value || {})) {
    if (raw == null || raw === "") continue;
    if (typeof raw === "string") {
      const text = cleanText(raw, maxTextLength);
      if (text) result[key] = text;
    } else if (Array.isArray(raw)) {
      const array = raw.slice(0, 12).map((item) =>
        typeof item === "string" ? cleanText(item, maxTextLength) : item);
      if (array.length > 0) result[key] = array;
    } else if (["number", "boolean"].includes(typeof raw)) {
      result[key] = raw;
    } else if (typeof raw === "object") {
      const nested = compactObject(raw, maxTextLength);
      if (Object.keys(nested).length > 0) result[key] = nested;
    }
  }
  return result;
}

function cleanText(value, maxLength) {
  if (value == null) return "";
  const text = Array.isArray(value) ? value.flat(2).join(", ") : String(value);
  return text.replace(/[\u0000-\u001f\u007f]/gu, " ").trim().slice(0, maxLength);
}

function codedError(code, message, cause) {
  const error = new Error(message, cause ? {cause} : undefined);
  error.code = code;
  return error;
}

function safeErrorCode(error) {
  const code = String(error?.code || "AI_ADJUDICATION_FAILED").trim();
  return /^[A-Z0-9_.-]{3,80}$/u.test(code) ? code : "AI_ADJUDICATION_FAILED";
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function nonNegativeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function roundScore(value) {
  return Math.round(Number(value) * 10) / 10;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

module.exports = {
  DEFAULT_MAX_CALLS,
  DEFAULT_MODEL,
  DEFAULT_SCORE_GAP,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_TOTAL_BUDGET_MS,
  MAX_CANDIDATES,
  MAX_OUTPUT_TOKENS,
  MAX_PROMPT_BYTES,
  WholeLookAIAdjudicator,
  buildWholeLookAdjudicationMessages,
  deterministicQualityPassed,
  hasHardReject,
  validateWholeLookAdjudicationResponse,
};
