"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const PORTFOLIO_FAILURE_TRACE_VERSION = "portfolio_failure_trace.v2";
const DEFAULT_RETENTION_LIMIT = 20;
const INTENT_SCORE_KEYS = Object.freeze([
  "scene_expression_strength",
  "desired_impression_coverage",
  "design_interest",
  "contemporary_expression",
  "silhouette_interest",
  "color_story",
  "footwear_statement",
  "styling_distinction",
  "overall_memorability",
  "youthful_social_energy",
]);

class PortfolioFailureTraceStore {
  constructor({
    enabled = false,
    filePath,
    retentionLimit = DEFAULT_RETENTION_LIMIT,
    logger = console,
  } = {}) {
    this.enabled = enabled === true;
    this.filePath = String(filePath || "").trim();
    this.retentionLimit = Math.max(1, Number(retentionLimit) ||
      DEFAULT_RETENTION_LIMIT);
    this.logger = logger;
    this.pendingWrite = Promise.resolve();
  }

  get writable() {
    return this.enabled && Boolean(this.filePath);
  }

  async persist(input = {}) {
    if (!this.writable) return false;
    const trace = buildPortfolioFailureTrace(input);
    this.pendingWrite = this.pendingWrite.catch(() => {}).then(async () => {
      const existing = await readTraceFile(this.filePath);
      const retained = [...existing.filter((entry) =>
        entry?.request_id !== trace.request_id), trace]
        .slice(-this.retentionLimit);
      await atomicWriteJson(this.filePath, retained);
      this.logger.error?.(
        "portfolio_failure_trace_persisted",
        JSON.stringify(trace),
      );
    });
    try {
      await this.pendingWrite;
      return true;
    } catch (error) {
      this.logger.warn?.("portfolio_failure_trace_persistence_failed", {
        request_id: trace.request_id,
        error_code: error?.code || "TRACE_PERSISTENCE_FAILED",
      });
      return false;
    }
  }

  async latest() {
    if (!this.writable) return null;
    const traces = await readTraceFile(this.filePath);
    return traces.at(-1) || null;
  }

  async readByRequestId(requestId) {
    if (!this.writable) return null;
    const normalized = safeIdentifier(requestId);
    if (!normalized) return null;
    const traces = await readTraceFile(this.filePath);
    return traces.findLast((trace) => trace?.request_id === normalized) || null;
  }
}

function buildPortfolioFailureTrace({
  requestId,
  timestamp,
  commitVersion,
  failureCode,
  validation,
} = {}) {
  const validationTrace = object(validation?.validation_trace);
  const looks = Array.isArray(validationTrace.looks)
    ? validationTrace.looks.map(safeLookTrace) : [];
  return deepFreeze({
    trace_version: PORTFOLIO_FAILURE_TRACE_VERSION,
    request_id: safeIdentifier(requestId) || "unknown",
    timestamp: safeTimestamp(timestamp),
    commit_version: safeVersion(commitVersion),
    failure_code: safeReason(failureCode) || "NEW_DECISION_PORTFOLIO_INVALID",
    look_count: finiteInteger(validationTrace.validator_input_look_count) ??
      looks.length,
    quality_valid_look_count: finiteInteger(
      validationTrace.quality_valid_look_count,
    ) ?? 0,
    pass_count: finiteInteger(validationTrace.pass_count) ?? 0,
    reject_count: finiteInteger(validationTrace.reject_count) ?? looks.length,
    looks,
    final_portfolio_failure_reason: safeReason(
      validationTrace.final_portfolio_failure_reason ||
      validationTrace.first_reject_reason ||
      failureCode,
    ),
  });
}

function safeLookTrace(value) {
  const source = object(value);
  const quality = object(source.final_quality);
  const portfolioValidation = object(source.portfolio_validation);
  const rules = object(source.validator_rules);
  return {
    concept_id: safeIdentifier(source.concept_id),
    quality_score: finiteScore(source.quality_score ?? quality.score),
    human_grounded_score: finiteScore(source.human_grounded_score),
    scene_score: finiteScore(source.scene_score),
    intent_scores: safeIntentScores(source.intent_scores),
    baseline_score: finiteScore(source.baseline_score),
    portfolio_validation: {
      status: source.portfolio_pass === true ||
        String(portfolioValidation.status || "").toUpperCase() === "PASS"
        ? "PASS" : "FAIL",
      first_reject_reason: safeReason(
        source.first_reject_reason || portfolioValidation.first_reject_reason,
      ),
      all_reject_reasons: safeReasons(
        source.all_reject_reasons || portfolioValidation.all_reject_reasons,
      ),
      core_validation_errors: safeReasons(
        source.coreValidation?.errors || portfolioValidation.core_validation_errors,
      ),
      validator_rules: safeValidatorRules(rules),
    },
    coreValidation: {
      errors: safeReasons(source.coreValidation?.errors),
    },
  };
}

function safeIntentScores(value) {
  const source = object(value);
  return Object.fromEntries(INTENT_SCORE_KEYS.map((key) => [
    key,
    finiteScore(source[key]),
  ]));
}

function safeValidatorRules(value) {
  return Object.fromEntries(Object.entries(object(value))
    .filter(([key]) => /^[A-Z][A-Z0-9_]{0,63}$/u.test(key))
    .map(([key, rule]) => [key, {
      status: String(rule?.status || "").toUpperCase() === "PASS" ? "PASS" : "FAIL",
    }]));
}

function safeReasons(values) {
  return [...new Set((Array.isArray(values) ? values : [values])
    .map(safeReason).filter(Boolean))];
}

function safeReason(value) {
  const text = String(value || "").trim();
  return /^[A-Z0-9_:-]{1,256}$/u.test(text) ? text : null;
}

function safeIdentifier(value) {
  const text = String(value || "").trim();
  return /^[A-Za-z0-9_.:-]{1,160}$/u.test(text) ? text : null;
}

function safeVersion(value) {
  const text = String(value || "").trim();
  return /^[A-Za-z0-9_.+-]{1,160}$/u.test(text) ? text : "unknown";
}

function safeTimestamp(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function finiteScore(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(0, Math.min(100, Math.round(number * 100) / 100)) : null;
}

function finiteInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

async function readTraceFile(filePath) {
  try {
    const value = JSON.parse(await fs.readFile(filePath, "utf8"));
    return Array.isArray(value) ? value : [];
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function atomicWriteJson(filePath, value) {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, {recursive: true});
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.rm(filePath, {force: true});
  await fs.rename(temporaryPath, filePath);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

module.exports = {
  INTENT_SCORE_KEYS,
  PORTFOLIO_FAILURE_TRACE_VERSION,
  PortfolioFailureTraceStore,
  buildPortfolioFailureTrace,
};
