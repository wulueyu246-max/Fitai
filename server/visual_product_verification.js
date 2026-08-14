"use strict";

const {
  compilePurchaseSpecification,
} = require("./purchase_specification");
const {
  compareProductPurchaseAesthetic,
} = require("./product_aesthetic_match");

const VISUAL_STATUS = Object.freeze({
  PASS: "PASS",
  FAIL: "FAIL",
  UNCERTAIN: "UNCERTAIN",
});
const VERIFICATION_STATUS = Object.freeze({
  VERIFIED: "verified",
  FALLBACK: "fallback",
});
const DEFAULT_MAX_CANDIDATES_PER_SLOT = 10;
const MAX_CANDIDATES_PER_SLOT = 12;
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_FALLBACK_AESTHETIC_SCORE = 65;
const REASON_CODES = new Set([
  "SPORTY_CONFLICT",
  "BULKY_SILHOUETTE",
  "WRONG_CATEGORY",
  "MATURE_STYLE_DRIFT",
  "TOO_SHEER",
  "WRONG_PROPORTION",
  "WRONG_SHOE_STRUCTURE",
  "LOW_STYLE_MATCH",
  "IMAGE_EVIDENCE_INSUFFICIENT",
]);
const FATAL_REASON_CODES = new Set([
  "SPORTY_CONFLICT",
  "BULKY_SILHOUETTE",
  "WRONG_CATEGORY",
  "MATURE_STYLE_DRIFT",
  "TOO_SHEER",
  "WRONG_PROPORTION",
  "WRONG_SHOE_STRUCTURE",
]);

function text(value, maxLength = 160) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function list(value, maxItems = 12, maxLength = 80) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(values.map((item) => text(item, maxLength)).filter(Boolean))]
    .slice(0, maxItems);
}

function boundedScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(100, Math.round(number * 10) / 10));
}

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0
    ? Math.min(number, maximum)
    : fallback;
}

function safeErrorCode(error) {
  const source = String(error?.code || error?.message || "VISUAL_VERIFICATION_FAILED");
  return /^[A-Z0-9_.-]{3,80}$/i.test(source)
    ? source
    : "VISUAL_VERIFICATION_FAILED";
}

function normalizeVisualResponsePayload(payload) {
  let assessments;
  if (payload && typeof payload === "object" && !Array.isArray(payload) &&
      Array.isArray(payload.assessments)) {
    assessments = payload.assessments;
  } else if (Array.isArray(payload) && payload.length > 0 && payload.every((item) =>
    item && typeof item === "object" && !Array.isArray(item) &&
    Array.isArray(item.assessments))) {
    assessments = payload.flatMap((item) => item.assessments);
  } else {
    throw new Error("VISUAL_RESPONSE_STRUCTURE_INVALID");
  }

  const candidateIds = new Set();
  for (const assessment of assessments) {
    if (!assessment || typeof assessment !== "object" || Array.isArray(assessment) ||
        !text(assessment.candidate_id, 120)) {
      throw new Error("VISUAL_RESPONSE_CANDIDATE_ID_MISSING");
    }
    const candidateId = text(assessment.candidate_id, 120);
    if (candidateIds.has(candidateId)) {
      throw new Error("VISUAL_RESPONSE_CANDIDATE_ID_DUPLICATE");
    }
    candidateIds.add(candidateId);
  }
  return {assessments};
}

function parseJsonResponse(response) {
  const content = response?.choices?.[0]?.message?.content;
  const source = Array.isArray(content)
    ? content.map((part) => typeof part === "string" ? part : part?.text || "").join("")
    : String(content || "");
  const payload = JSON.parse(source.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, ""));
  return normalizeVisualResponsePayload(payload);
}

function currentStyleAnchor(context = {}) {
  const blueprint = context.outfit_blueprint || context.outfitBlueprint ||
    context.recommendation_context?.outfit_blueprint || {};
  const anchor = blueprint.style_anchor || blueprint.styleAnchor || {};
  return text(anchor.core_style_anchor || anchor.coreStyleAnchor, 80);
}

function slotVisualGoal(requirement = {}, specification = {}) {
  return list([
    requirement.visual_goal,
    requirement.visualGoal,
    requirement.fit,
    requirement.style_role,
    requirement.styleRole,
    ...specification.should_attributes,
    ...specification.preferred_attributes,
  ], 10, 60);
}

function compactSpecification(requirement = {}, context = {}) {
  const specification = compilePurchaseSpecification(requirement, context);
  return {
    category: specification.category,
    product_type: specification.product_type,
    product_family: specification.product_family,
    must_attributes: [...specification.must_attributes],
    should_attributes: [...specification.should_attributes],
    avoid_attributes: [...specification.avoid_attributes],
    style_roles: [...specification.style_roles],
    core_style_anchor: currentStyleAnchor(context),
    slot_visual_goal: slotVisualGoal(requirement, specification),
  };
}

function visualResponseFormat() {
  return {
    type: "json_schema",
    json_schema: {
      name: "fitai_visual_product_verification",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["assessments"],
        properties: {
          assessments: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "candidate_id",
                "visual_status",
                "visual_match_score",
                "category_match",
                "silhouette_match",
                "style_match",
                "material_visual_match",
                "avoid_conflicts",
                "visual_tags",
                "reason_codes",
              ],
              properties: {
                candidate_id: {type: "string"},
                visual_status: {type: "string", enum: Object.values(VISUAL_STATUS)},
                visual_match_score: {type: "number", minimum: 0, maximum: 100},
                category_match: {type: "number", minimum: 0, maximum: 100},
                silhouette_match: {type: "number", minimum: 0, maximum: 100},
                style_match: {type: "number", minimum: 0, maximum: 100},
                material_visual_match: {type: "number", minimum: 0, maximum: 100},
                avoid_conflicts: {type: "array", items: {type: "string"}},
                visual_tags: {type: "array", items: {type: "string"}},
                reason_codes: {
                  type: "array",
                  items: {type: "string", enum: [...REASON_CODES]},
                },
              },
            },
          },
        },
      },
    },
  };
}

function buildVisualVerificationMessages(requirement, context, candidates) {
  const specification = compactSpecification(requirement, context);
  const content = [{
    type: "text",
    text: JSON.stringify({
      task: "Verify whether each product image satisfies the supplied purchase specification.",
      purchase_specification: specification,
      candidates: candidates.map((product, imageIndex) => ({
        candidate_id: String(product.product_id),
        image_index: imageIndex,
      })),
    }),
  }];
  candidates.forEach((product, imageIndex) => {
    content.push({
      type: "text",
      text: `candidate_id=${String(product.product_id)}; image_index=${imageIndex}`,
    });
    content.push({
      type: "image_url",
      image_url: {url: String(product.image_url), detail: "auto"},
    });
  });
  return [
    {
      role: "system",
      content: [
        "You are FitAI's final product image inspector.",
        "Judge image evidence against the supplied structured purchase specification and core style anchor.",
        "Do not use brand reputation or invent facts that are not visible.",
        "PASS requires correct category, compatible silhouette/style, and no visible avoid conflict.",
        "FAIL applies to clear category mismatch, avoid conflict, severe style-anchor drift, sporty or bulky conflict for a non-sport refined request, or clearly wrong silhouette.",
        "UNCERTAIN applies when the image does not provide enough evidence. UNCERTAIN is not PASS.",
        "For sport requirements, a visible sport structure is not a conflict.",
        "Use only the provided stable reason codes and return strict JSON.",
      ].join("\n"),
    },
    {role: "user", content},
  ];
}

function normalizeVisualAssessment(value = {}) {
  const candidateId = text(value.candidate_id || value.product_id, 120);
  const scores = {
    visual_match_score: boundedScore(value.visual_match_score),
    category_match: boundedScore(value.category_match),
    silhouette_match: boundedScore(value.silhouette_match),
    style_match: boundedScore(value.style_match),
    material_visual_match: boundedScore(value.material_visual_match),
  };
  if (!candidateId || Object.values(scores).some((score) => score == null)) return null;
  const avoidConflicts = list(value.avoid_conflicts, 12, 80);
  const reasonCodes = list(value.reason_codes, 12, 80)
    .filter((code) => REASON_CODES.has(code));
  let status = Object.values(VISUAL_STATUS).includes(value.visual_status)
    ? value.visual_status
    : VISUAL_STATUS.UNCERTAIN;
  if (avoidConflicts.length > 0 || reasonCodes.some((code) => FATAL_REASON_CODES.has(code)) ||
      scores.category_match < 40 || scores.style_match < 35) {
    status = VISUAL_STATUS.FAIL;
  } else if (status === VISUAL_STATUS.PASS &&
      (scores.category_match < 60 || scores.style_match < 55)) {
    status = VISUAL_STATUS.UNCERTAIN;
  }
  return {
    candidate_id: candidateId,
    visual_status: status,
    ...scores,
    avoid_conflicts: avoidConflicts,
    visual_tags: list(value.visual_tags, 16, 60),
    reason_codes: reasonCodes,
  };
}

function uncertainAssessment(candidateId) {
  return {
    candidate_id: String(candidateId),
    visual_status: VISUAL_STATUS.UNCERTAIN,
    visual_match_score: 0,
    category_match: 0,
    silhouette_match: 0,
    style_match: 0,
    material_visual_match: 0,
    avoid_conflicts: [],
    visual_tags: [],
    reason_codes: ["IMAGE_EVIDENCE_INSUFFICIENT"],
  };
}

function visualStatusPriority(product) {
  return ({PASS: 2, UNCERTAIN: 1, FAIL: 0})[product?.visual_status] || 0;
}

function compareVisualProducts(left, right) {
  return visualStatusPriority(right) - visualStatusPriority(left) ||
    Number(right?.visual_match_score || 0) - Number(left?.visual_match_score || 0) ||
    compareProductPurchaseAesthetic(left, right);
}

function applyVisualVerification(candidates, payload) {
  const values = Array.isArray(payload?.assessments) ? payload.assessments : [];
  const assessments = new Map(values
    .map(normalizeVisualAssessment)
    .filter(Boolean)
    .map((assessment) => [assessment.candidate_id, assessment]));
  return candidates.flatMap((product) => {
    const assessment = assessments.get(String(product.product_id)) ||
      uncertainAssessment(product.product_id);
    if (assessment.visual_status === VISUAL_STATUS.FAIL) return [];
    return [{
      ...product,
      ...assessment,
      visual_verification: assessment,
      visual_verification_status: VERIFICATION_STATUS.VERIFIED,
    }];
  }).sort(compareVisualProducts);
}

function visualFallbackCandidates(candidates, minimumAestheticScore =
  DEFAULT_FALLBACK_AESTHETIC_SCORE) {
  return candidates.filter((product) =>
    product.candidate_gate_state === "PASS" &&
    Number(product.product_aesthetic_score || 0) >= minimumAestheticScore &&
    product.visual_status !== VISUAL_STATUS.FAIL &&
    product.visual_verification?.visual_status !== VISUAL_STATUS.FAIL)
    .map((product) => ({
      ...product,
      visual_verification_status: VERIFICATION_STATUS.FALLBACK,
    }))
    .sort(compareProductPurchaseAesthetic);
}

class VisualProductVerifier {
  constructor({
    client,
    model,
    maxCandidatesPerSlot = DEFAULT_MAX_CANDIDATES_PER_SLOT,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fallbackAestheticScore = DEFAULT_FALLBACK_AESTHETIC_SCORE,
    logger = console,
  } = {}) {
    this.client = client || null;
    this.model = text(model, 120);
    this.maxCandidatesPerSlot = positiveInteger(
      maxCandidatesPerSlot,
      DEFAULT_MAX_CANDIDATES_PER_SLOT,
      MAX_CANDIDATES_PER_SLOT,
    );
    this.timeoutMs = positiveInteger(timeoutMs, DEFAULT_TIMEOUT_MS, 20_000);
    this.fallbackAestheticScore = boundedScore(fallbackAestheticScore) ??
      DEFAULT_FALLBACK_AESTHETIC_SCORE;
    this.logger = logger;
    this.metrics = {
      callCount: 0,
      fallbackCount: 0,
      candidateCount: 0,
      totalDurationMs: 0,
      lastDurationMs: null,
    };
  }

  get configured() {
    return Boolean(this.client && this.model);
  }

  getStats() {
    return {
      configured: this.configured,
      max_candidates_per_slot: this.maxCandidatesPerSlot,
      call_count: this.metrics.callCount,
      fallback_count: this.metrics.fallbackCount,
      candidate_count: this.metrics.candidateCount,
      total_duration_ms: this.metrics.totalDurationMs,
      average_duration_ms: this.metrics.callCount > 0
        ? Math.round(this.metrics.totalDurationMs / this.metrics.callCount)
        : 0,
      last_duration_ms: this.metrics.lastDurationMs,
    };
  }

  async verifyGroups({groups, context = {}, requestId = "", timeoutMs} = {}) {
    const startedAt = Date.now();
    const safeGroups = Array.isArray(groups) ? groups : [];
    const results = await Promise.all(safeGroups.map((group) =>
      this.#verifyGroup(group, context, requestId, timeoutMs)));
    const durationMs = Date.now() - startedAt;
    return {
      groups: results.map((result) => result.group),
      summary: {
        request_id: requestId || undefined,
        slot_count: results.length,
        candidate_count: results.reduce((sum, result) => sum + result.candidateCount, 0),
        visual_call_count: results.reduce((sum, result) => sum + result.callCount, 0),
        pass_count: results.reduce((sum, result) => sum + result.passCount, 0),
        uncertain_count: results.reduce((sum, result) => sum + result.uncertainCount, 0),
        fail_count: results.reduce((sum, result) => sum + result.failCount, 0),
        fallback_used: results.some((result) => result.fallback),
        total_visual_ms: durationMs,
      },
    };
  }

  async #verifyGroup(group = {}, context, requestId, timeoutOverride) {
    const startedAt = Date.now();
    const candidates = (Array.isArray(group.candidates) ? group.candidates : [])
      .filter((product) => product.candidate_gate_state !== "FAIL")
      .sort(compareProductPurchaseAesthetic)
      .slice(0, this.maxCandidatesPerSlot);
    const imageCandidates = candidates.filter((product) =>
      product.product_id && /^https:\/\/[^\s]+$/i.test(String(product.image_url || "")));
    this.metrics.candidateCount += imageCandidates.length;
    let products;
    let fallback = false;
    let callCount = 0;
    let errorCode;
    if (!this.configured || imageCandidates.length === 0) {
      fallback = true;
      errorCode = this.configured ? "VISUAL_IMAGES_UNAVAILABLE" :
        "VISUAL_VERIFICATION_NOT_CONFIGURED";
      products = visualFallbackCandidates(candidates, this.fallbackAestheticScore);
    } else {
      this.metrics.callCount += 1;
      callCount = 1;
      try {
        const response = await this.client.chat.completions.create({
          model: this.model,
          response_format: visualResponseFormat(),
          enable_thinking: false,
          temperature: 0,
          messages: buildVisualVerificationMessages(
            group.requirement,
            context,
            imageCandidates,
          ),
        }, {
          timeout: positiveInteger(timeoutOverride, this.timeoutMs, this.timeoutMs),
          maxRetries: 0,
        });
        products = applyVisualVerification(imageCandidates, parseJsonResponse(response));
      } catch (error) {
        fallback = true;
        errorCode = safeErrorCode(error);
        products = visualFallbackCandidates(candidates, this.fallbackAestheticScore);
      }
    }
    if (fallback) this.metrics.fallbackCount += 1;
    const durationMs = Date.now() - startedAt;
    this.metrics.totalDurationMs += durationMs;
    this.metrics.lastDurationMs = durationMs;
    const originalIds = new Set(candidates.map((product) => String(product.product_id)));
    const retainedIds = new Set(products.map((product) => String(product.product_id)));
    const result = {
      group: {...group, candidates: products},
      candidateCount: imageCandidates.length,
      callCount,
      passCount: products.filter((product) => product.visual_status === "PASS").length,
      uncertainCount: products.filter((product) => product.visual_status === "UNCERTAIN").length,
      failCount: [...originalIds].filter((id) => !retainedIds.has(id)).length,
      fallback,
    };
    this.logger.info?.("visual_product_verification_summary", {
      request_id: requestId || undefined,
      look_id: group.requirement?.look_id || undefined,
      slot_key: group.requirement?.slot_key || undefined,
      category: group.requirement?.category || undefined,
      candidate_count: result.candidateCount,
      visual_call_count: callCount,
      duration_ms: durationMs,
      pass_count: result.passCount,
      uncertain_count: result.uncertainCount,
      fail_count: result.failCount,
      fallback_used: fallback,
      error_code: errorCode,
    });
    return result;
  }
}

module.exports = {
  DEFAULT_FALLBACK_AESTHETIC_SCORE,
  DEFAULT_MAX_CANDIDATES_PER_SLOT,
  VERIFICATION_STATUS,
  VISUAL_STATUS,
  VisualProductVerifier,
  applyVisualVerification,
  buildVisualVerificationMessages,
  compactSpecification,
  normalizeVisualAssessment,
  normalizeVisualResponsePayload,
  visualFallbackCandidates,
  visualResponseFormat,
};
