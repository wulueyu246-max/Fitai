"use strict";

const CORE_SLOTS = Object.freeze(["top", "bottom", "shoes"]);
const SHOPPING_PRODUCTION_POLICY = Object.freeze({
  decision_priority: Object.freeze([
    "explicit_user_intent",
    "persona_gender_body",
    "aesthetic_direction",
    "body_proportion_strategy",
    "occasion",
    "weather_comfort",
  ]),
  persona_principles: Object.freeze([
    "authoritative_gender_is_immutable",
    "gender_does_not_imply_a_specific_garment",
    "neutral_expression_is_allowed_without_explicit_persona_conflict",
  ]),
  body_strategy_principles: Object.freeze([
    "use_structured_body_evidence",
    "optimize_proportion_without_rigid_item_rules",
    "preserve_wearability_and_user_intent",
  ]),
  weather_role_boundary: Object.freeze([
    "material",
    "thickness",
    "breathability",
    "comfort",
    "layering",
    "safety",
  ]),
});

function shoppingAgentFeatureEnabled(
  environment = process.env,
  nodeEnvironment = environment.NODE_ENV,
) {
  const configured = String(environment.SHOPPING_AGENT_V1_ENABLED || "")
    .trim()
    .toLowerCase();
  if (["true", "1", "yes", "on"].includes(configured)) return true;
  if (["false", "0", "no", "off"].includes(configured)) return false;
  return nodeEnvironment === "test";
}

function buildShoppingAgentMainInput(outfitRequest, _analysis, requestId) {
  const context = plainObject(outfitRequest?.context);
  const weatherMode = resolveWeatherMode({
    userInput: outfitRequest?.user_input || outfitRequest?.request,
    requestedMode: context.weather_mode || outfitRequest?.weather_mode,
  });
  const weather = weatherMode === "explicit"
    ? plainObject(context.weather)
    : {};
  const authoritativeGender = normalizeGender(
    outfitRequest?.authoritative_gender || outfitRequest?.gender,
  );
  return {
    request_id: String(requestId || outfitRequest?.requestId || "").trim(),
    user_input: String(
      outfitRequest?.user_input || outfitRequest?.request || "",
    ).trim(),
    authoritative_gender: authoritativeGender,
    gender: authoritativeGender,
    height: outfitRequest?.height,
    weight: outfitRequest?.weight,
    body_profile: {
      ...plainObject(context.body_profile),
      gender: authoritativeGender,
    },
    persona: {
      gender: authoritativeGender,
      source: "authoritative_user_truth",
    },
    styling_policy: SHOPPING_PRODUCTION_POLICY,
    occasion: String(context.scene || outfitRequest?.scene || "").trim(),
    weather_mode: weatherMode,
    weather: {
      ...weather,
      constraints: weatherMode === "explicit" &&
        Array.isArray(context.weather_constraints)
        ? context.weather_constraints
        : [],
    },
    budget: {
      item_budget: numericBudget(outfitRequest?.itemBudget),
      outfit_budget: numericBudget(outfitRequest?.outfitBudget),
    },
  };
}

function resolveWeatherMode({userInput, requestedMode} = {}) {
  const normalizedMode = String(requestedMode || "").trim().toLowerCase();
  if (normalizedMode === "explicit") return "explicit";
  const input = String(userInput || "").replace(/\s+/g, "");
  if (!input) return "off";
  const explicitWeatherRequest = /(?:根据|按照|结合).{0,6}(?:天气|气温)|天气.{0,6}(?:搭|穿)|(?:今天|今日|明天|现在|此刻).{0,10}(?:天气|气温|下雨|雨天|很热|太热|高温|很冷|降温|大风|刮风|潮湿|闷热|穿什么|怎么穿|搭一套|搭配|出门|出去)|(?:下雨|雨天|暴雨|很热|太热|高温|很冷|降温|大风|刮风|潮湿|闷热)(?:$|.{0,12}(?:穿|搭|出门|出去|怎么办))/.test(input);
  return explicitWeatherRequest ? "explicit" : "off";
}

function buildDirectShoppingAgentBasePayload(outfitRequest, requestId) {
  const context = plainObject(outfitRequest?.context);
  const bodyProfile = plainObject(context.body_profile);
  const gender = normalizeGender(
    outfitRequest?.authoritative_gender || outfitRequest?.gender,
  );
  const bodySummary = [
    outfitRequest?.height ? `${outfitRequest.height}cm` : "",
    outfitRequest?.weight ? `${outfitRequest.weight}kg` : "",
    String(bodyProfile.shape || bodyProfile.body_shape || "").trim(),
  ].filter(Boolean).join("，") || "已使用结构化身体资料";
  return {
    request_id: String(requestId || outfitRequest?.requestId || "").trim(),
    bodyProfile: bodySummary,
    body_profile: bodySummary,
    body_summary: {
      height_cm: outfitRequest?.height ?? null,
      weight_kg: outfitRequest?.weight ?? null,
      gender,
      profile: bodyProfile,
    },
    style: "智能选品",
    style_expression: "auto",
    analysisMode: "shopping_agent_v1",
    analysis_mode: "shopping_agent_v1",
    weather_mode: resolveWeatherMode({
      userInput: outfitRequest?.user_input || outfitRequest?.request,
      requestedMode: context.weather_mode || outfitRequest?.weather_mode,
    }),
    gender,
    looks: [],
    products: [],
    recommendations: {
      top: "由 Shopping Agent 从真实候选中选择上衣",
      bottom: "由 Shopping Agent 从真实候选中选择下装",
      shoes: "由 Shopping Agent 从真实候选中选择鞋履",
      accessories: "本阶段不包含配饰",
      summary: "基于真实商品候选生成完整穿搭",
      products: [],
    },
  };
}

async function dispatchOutfitProductionPath({
  enabled,
  agent,
  outfitRequest,
  requestId,
  legacyPath,
  logger = console,
  deadlineMs,
  now = () => new Date(),
}) {
  if (!enabled) {
    if (typeof legacyPath !== "function") {
      throw integrationError("legacy rollback path is unavailable");
    }
    return {
      mode: "legacy",
      payload: await legacyPath(),
    };
  }

  const basePayload = buildDirectShoppingAgentBasePayload(
    outfitRequest,
    requestId,
  );
  logger.info?.("shopping_agent_production_path", {
    request_id: basePayload.request_id,
    authoritative_gender: basePayload.gender,
    legacy_intent_calls: 0,
    blueprint_calls: 0,
    native_look_calls: 0,
    style_repair_calls: 0,
    legacy_purchase_specification_calls: 0,
    hard_deadline_ms: deadlineMs ?? null,
  });
  const payload = await integrateShoppingAgentMainChain({
    enabled: true,
    agent,
    basePayload,
    outfitRequest,
    analysis: null,
    requestId,
    deadlineMs,
    now,
  });
  return {mode: "shopping_agent_v1", payload};
}

async function integrateShoppingAgentMainChain({
  enabled,
  agent,
  basePayload,
  outfitRequest,
  analysis,
  requestId,
  deadlineMs,
  now = () => new Date(),
}) {
  if (!enabled) {
    return {
      ...basePayload,
      shopping_agent_status: "disabled",
    };
  }

  const agentRequestId = String(requestId || outfitRequest?.requestId || "").trim();
  try {
    const result = await agent.run(
      buildShoppingAgentMainInput(outfitRequest, analysis, agentRequestId),
      {deadlineMs},
    );
    if (result?.state !== "success") {
      return attachShoppingAgentFailure(basePayload, {
        requestId: result?.request_id || agentRequestId,
        firstFailureStage: firstFailureStage(result),
        retryable: result?.state === "retryable",
        code: result?.reason || "SHOPPING_AGENT_FAILED",
      });
    }
    return adaptShoppingAgentSuccess(result, {
      basePayload,
      outfitRequest,
      now,
    });
  } catch (error) {
    return attachShoppingAgentFailure(basePayload, {
      requestId: agentRequestId,
      firstFailureStage: firstFailureStage(error),
      retryable: isRetryableShoppingAgentError(error),
      code: error?.code || "SHOPPING_AGENT_FAILED",
    });
  }
}

function adaptShoppingAgentSuccess(result, {
  basePayload = {},
  outfitRequest = {},
  now = () => new Date(),
} = {}) {
  if (result?.state !== "success" || !Array.isArray(result.looks)) {
    throw integrationError("Shopping Agent success payload is invalid");
  }
  if (result.looks.length < 2) {
    throw integrationError("Shopping Agent returned fewer than two Looks");
  }

  const requestId = String(result.request_id || outfitRequest.requestId || "").trim();
  const gender = normalizeGender(
    result.authoritative_gender || outfitRequest.authoritative_gender || outfitRequest.gender,
  );
  const style = String(
    result.shopping_intent?.overall_aesthetic?.core_direction || basePayload.style || "",
  ).trim();
  const persona = plainObject(result.shopping_intent?.persona);
  const bodyStrategy = plainObject(result.shopping_intent?.body_strategy);
  const occasion = plainObject(result.shopping_intent?.occasion);
  const weatherConstraints = plainObject(result.shopping_intent?.weather_constraints);
  const scene = String(outfitRequest.scene || "日常").trim() || "日常";
  const createdTime = now().toISOString();
  const productsById = new Map();

  const shoppingAgentLooks = result.looks.map((look, index) => {
    const lookId = String(look?.look_id || `shopping-look-${index + 1}`).trim();
    const scores = plainObject(look?.scores);
    const mappedItems = Object.fromEntries(CORE_SLOTS.map((slot) => {
      const candidate = look?.items?.[slot];
      const mapped = mapCandidateProduct(candidate, {
        slot,
        lookId,
        requestId,
        gender,
      });
      if (!productsById.has(mapped.candidate_id)) {
        productsById.set(mapped.candidate_id, mapped);
      }
      return [slot, mapped];
    }));
    const finalScore = score(scores.final_score);
    const explanation = style
      ? `基于真实淘宝候选组成的${style}方案，整套评分 ${finalScore}。`
      : `基于真实淘宝候选组成的完整方案，整套评分 ${finalScore}。`;
    return {
      look_id: lookId,
      ...mappedItems,
      explanation,
      final_score: finalScore,
      scores,
    };
  });

  const products = [...productsById.values()];
  const outfitPlans = shoppingAgentLooks.map((look, index) => ({
    id: `shopping-agent-${look.look_id}`,
    title: `真实商品 Look ${index + 1}`,
    top: look.top,
    bottom: look.bottom,
    shoes: look.shoes,
    reason: look.explanation,
    createdTime,
    scene,
    style,
    style_direction: style,
    gender,
    request_id: requestId,
    look_id: look.look_id,
    matchScore: Math.round(look.final_score),
  }));

  return {
    ...basePayload,
    request_id: requestId || basePayload.request_id,
    gender,
    style: style || "智能选品",
    styling_summary: {
      overall_aesthetic: plainObject(result.shopping_intent?.overall_aesthetic),
      persona,
      body_strategy: bodyStrategy,
      occasion,
      weather_constraints: weatherConstraints,
    },
    shopping_agent_status: "success",
    shopping_agent_request_id: requestId,
    shopping_agent_first_failure_stage: null,
    shopping_agent_retryable: false,
    shopping_agent_looks: shoppingAgentLooks,
    shopping_agent_products: products,
    outfit_plans: outfitPlans,
    outfit_plan: outfitPlans[0],
    recommendations: {
      ...plainObject(basePayload.recommendations),
      top: slotSummary(result, "top", "真实上衣"),
      bottom: slotSummary(result, "bottom", "真实下装"),
      shoes: slotSummary(result, "shoes", "真实鞋履"),
      summary: style
        ? `Shopping Agent 已按${style}组合真实商品`
        : "Shopping Agent 已组合真实商品",
      products,
    },
  };
}

function slotSummary(result, category, fallback) {
  const slots = Array.isArray(result?.shopping_intent?.slots)
    ? result.shopping_intent.slots
    : [];
  const slot = slots.find((item) => item?.category === category);
  return String(slot?.role || fallback).trim() || fallback;
}

function mapCandidateProduct(candidate, {slot, lookId, requestId, gender}) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw integrationError(`${slot} candidate is missing`);
  }
  const candidateId = String(candidate.candidate_id || "").trim();
  const title = String(candidate.title || "").trim();
  const image = String(candidate.image_url || candidate.image || "").trim();
  const purchaseUrl = String(candidate.purchase_url || "").trim();
  const price = Number(candidate.price);
  if (!candidateId || !title || !image || !purchaseUrl || !Number.isFinite(price)) {
    throw integrationError(`${slot} candidate mapping is incomplete`);
  }
  const selectorScores = plainObject(candidate.selector_scores);
  return {
    id: candidateId,
    candidate_id: candidateId,
    product_id: candidateId,
    source_product_id: String(candidate.product_id || "").trim(),
    title,
    name: title,
    category: slot,
    image,
    image_url: image,
    price,
    purchase_url: purchaseUrl,
    affiliate_url: purchaseUrl,
    detail_url: purchaseUrl,
    brand: String(candidate.brand || "精选商品").trim() || "精选商品",
    shop_name: String(candidate.shop_name || "").trim(),
    platform: "taobao",
    source: "taobao",
    source_provider: "taobao",
    stock_status: "in_stock",
    is_mock: false,
    request_id: requestId,
    look_id: lookId,
    gender,
    selection_tier: candidate.selection_tier,
    aesthetic_score: score(
      selectorScores.aesthetic_fit ?? candidate.selector_quality_score,
    ),
    final_score: score(candidate.selector_quality_score),
    recommendation_reason: "Shopping Agent 视觉选品与整套组合结果",
  };
}

function attachShoppingAgentFailure(basePayload, {
  requestId,
  firstFailureStage,
  retryable,
  code,
}) {
  return {
    ...basePayload,
    shopping_agent_status: "failed",
    shopping_agent_request_id: String(requestId || "").trim(),
    shopping_agent_first_failure_stage: firstFailureStage || "shopping_agent",
    shopping_agent_retryable: retryable === true,
    shopping_agent_error_code: String(code || "SHOPPING_AGENT_FAILED"),
    shopping_agent_looks: [],
    shopping_agent_products: [],
    outfit_plans: [],
    outfit_plan: null,
    recommendations: {
      ...plainObject(basePayload?.recommendations),
      products: [],
    },
  };
}

function firstFailureStage(value) {
  const explicit = value?.first_failure_stage ||
    value?.details?.phase ||
    value?.phase;
  if (explicit) return String(explicit);
  const code = String(value?.code || value?.reason || "").toUpperCase();
  if (/TAOBAO|RETRIEVAL|PROVIDER/.test(code)) return "taobao_retrieval";
  if (/REFINEMENT_QUERY/.test(code)) return "product_selector_refinement";
  if (/SELECTOR/.test(code)) return "product_selector";
  if (/COMPOSER|LOOK/.test(code)) return "real_product_outfit_composer";
  if (/INTENT|SEARCH_PLAN|SCHEMA/.test(code)) return "shopping_intent_search_plan";
  if (/CANDIDATE|HARD_GATE/.test(code)) return "candidate_gate";
  return "shopping_agent";
}

function isRetryableShoppingAgentError(error) {
  if (typeof error?.retryable === "boolean") return error.retryable;
  const code = String(error?.code || "").toUpperCase();
  return /TIMEOUT|NETWORK|AI_FAILED|PROVIDER|INSUFFICIENT/.test(code);
}

function integrationError(message) {
  const error = new Error(message);
  error.code = "SHOPPING_AGENT_RESPONSE_ADAPTER_INVALID";
  return error;
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeGender(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["female", "女", "女性", "女士"].includes(normalized)) return "female";
  if (["male", "男", "男性", "男士"].includes(normalized)) return "male";
  return "unisex";
}

function numericBudget(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function score(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 0;
}

module.exports = {
  adaptShoppingAgentSuccess,
  attachShoppingAgentFailure,
  buildDirectShoppingAgentBasePayload,
  buildShoppingAgentMainInput,
  dispatchOutfitProductionPath,
  integrateShoppingAgentMainChain,
  resolveWeatherMode,
  SHOPPING_PRODUCTION_POLICY,
  shoppingAgentFeatureEnabled,
};
