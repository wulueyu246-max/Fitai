"use strict";

const CORE_SLOTS = Object.freeze(["top", "bottom", "shoes"]);
const SHOPPING_PRODUCTION_POLICY = Object.freeze({
  decision_priority: Object.freeze([
    "explicit_user_intent",
    "persona_gender_body",
    "aesthetic_direction",
    "body_proportion_strategy",
    "occasion",
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
  const authoritativeGender = normalizeGender(
    outfitRequest?.authoritative_gender || outfitRequest?.gender,
  );
  const userInput = String(
    outfitRequest?.user_input || outfitRequest?.request || "",
  ).trim();
  return {
    request_id: String(requestId || outfitRequest?.requestId || "").trim(),
    user_input: userInput,
    authoritative_gender: authoritativeGender,
    gender: authoritativeGender,
    height: outfitRequest?.height,
    weight: outfitRequest?.weight,
    body_profile: {
      ...withoutWeatherFields(plainObject(context.body_profile)),
      gender: authoritativeGender,
    },
    persona: {
      gender: authoritativeGender,
      expression: resolvePersonaExpression(authoritativeGender, userInput),
      source: "authoritative_user_truth",
    },
    styling_policy: SHOPPING_PRODUCTION_POLICY,
    occasion: String(context.scene || outfitRequest?.scene || "").trim(),
    budget: {
      item_budget: numericBudget(outfitRequest?.itemBudget),
      outfit_budget: numericBudget(outfitRequest?.outfitBudget),
    },
  };
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
    shopping_agent_weather_input_present: false,
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
    logger,
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
  logger = console,
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
      logger,
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
  logger = console,
} = {}) {
  if (result?.state !== "success" || !Array.isArray(result.looks)) {
    throw integrationError("Shopping Agent success payload is invalid");
  }
  if (result.looks.length < 2) {
    throw integrationError("Shopping Agent returned fewer than two Looks");
  }

  const requestId = String(result.request_id || outfitRequest.requestId || "").trim();
  const gender = normalizeGender(
    outfitRequest.authoritative_gender || outfitRequest.gender || result.authoritative_gender,
  );
  const resultGender = normalizeGender(result.authoritative_gender);
  const genderDrifted = resultGender !== gender;
  if (genderDrifted) {
    logger.warn?.("SHOPPING_AGENT_GENDER_CONTEXT_DRIFT", {
      request_id: requestId,
      phase: "response_adapter",
      authoritative_gender: gender,
      received_gender: resultGender,
      applied_gender: gender,
      resolution: "AUTHORITATIVE_OVERRIDE",
    });
  }
  const internalStyle = String(
    result.shopping_intent?.overall_aesthetic?.core_direction || basePayload.style || "",
  ).trim();
  const persona = plainObject(result.shopping_intent?.persona);
  const bodyStrategy = plainObject(result.shopping_intent?.body_strategy);
  const display = buildChineseDisplayFields({
    internalStyle,
    persona,
    bodyStrategy,
    slots: result.shopping_intent?.slots,
    gender,
  });
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
    const explanation = `第${index + 1}套采用真实淘宝商品，保持${display.display_style_name}方向，整套评分 ${finalScore} 分。`;
    return {
      look_id: lookId,
      ...mappedItems,
      explanation,
      display_look_explanation: explanation,
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
    style: display.display_style_name,
    style_direction: display.display_style_name,
    display_style_name: display.display_style_name,
    display_look_explanation: look.display_look_explanation,
    gender,
    request_id: requestId,
    look_id: look.look_id,
    matchScore: Math.round(look.final_score),
  }));

  return {
    ...basePayload,
    request_id: requestId || basePayload.request_id,
    gender,
    gender_context_drift: genderDrifted,
    style: display.display_style_name,
    bodyProfile: display.display_style_summary,
    body_profile: display.display_style_summary,
    display_style_name: display.display_style_name,
    display_style_summary: display.display_style_summary,
    display_top_advice: display.display_top_advice,
    display_bottom_advice: display.display_bottom_advice,
    display_shoes_advice: display.display_shoes_advice,
    display_look_explanation: shoppingAgentLooks[0].display_look_explanation,
    styling_summary: {
      display_style_name: display.display_style_name,
      display_style_summary: display.display_style_summary,
      display_top_advice: display.display_top_advice,
      display_bottom_advice: display.display_bottom_advice,
      display_shoes_advice: display.display_shoes_advice,
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
      top: display.display_top_advice,
      bottom: display.display_bottom_advice,
      shoes: display.display_shoes_advice,
      summary: display.display_style_summary,
      products,
    },
  };
}

function buildChineseDisplayFields({
  internalStyle,
  persona,
  bodyStrategy,
  slots,
  gender,
} = {}) {
  const displayStyleName = localizeStyleName(internalStyle);
  const personaLabel = gender === "female"
    ? "女性或自然中性的人物表达"
    : gender === "male"
      ? "男性或自然中性的人物表达"
      : "自然中性的人物表达";
  const bodyGoal = firstChinesePhrase(bodyStrategy?.goals).replace(/[。！？]$/u, "");
  const summaryParts = [
    `以${displayStyleName}为整体方向`,
    `保持${personaLabel}`,
    bodyGoal ? `并兼顾${bodyGoal}` : "并兼顾整体比例与日常可穿性",
  ];
  const slotList = Array.isArray(slots) ? slots : [];
  const role = (category) => firstChinesePhrase(
    slotList.find((slot) => slot?.category === category)?.role,
  );
  return Object.freeze({
    display_style_name: displayStyleName,
    display_style_summary: `${summaryParts.join("，")}。`,
    display_top_advice: role("top") ||
      "选择轮廓利落、松量适中的上衣，保持上半身清爽协调。",
    display_bottom_advice: role("bottom") ||
      "通过合适腰线与纵向线条优化下装比例，避免压低视觉重心。",
    display_shoes_advice: role("shoes") ||
      "选择量感适中、线条简洁的鞋型，衔接整套风格与比例。",
  });
}

function localizeStyleName(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  const known = [
    [/clean\s*fit|洁净合身/u, "清爽利落风"],
    [/urban\s+light\s+romantic|都市轻浪漫/u, "都市轻浪漫风"],
    [/fresh\s+urban\s+casual|清新都市休闲/u, "清新都市休闲风"],
    [/smart\s+casual|都市轻熟/u, "都市轻熟风"],
    [/french|法式/u, "法式轻盈休闲风"],
    [/cute|sweet|可爱|甜美/u, "甜美清新风"],
    [/minimal|极简/u, "简约利落风"],
  ];
  for (const [pattern, label] of known) {
    if (pattern.test(normalized)) return label;
  }
  const chinese = firstChinesePhrase(value).replace(/[。！？]$/u, "");
  return chinese || "清爽协调的日常风格";
}

function firstChinesePhrase(value) {
  const values = Array.isArray(value) ? value : [value];
  for (const item of values) {
    const source = String(item || "").trim();
    if (!/[\u3400-\u9fff]/u.test(source)) continue;
    const chinese = source
      .replace(/[（(][^\u3400-\u9fff]*[）)]/gu, "")
      .replace(/[A-Za-z][A-Za-z0-9_\-\s/]*/g, "")
      .replace(/[_|]+/g, "")
      .replace(/\s+/g, "")
      .replace(/^[，。；：、\s]+|[，；：、\s]+$/g, "")
      .trim();
    if (chinese.length >= 2) return /[。！？]$/u.test(chinese) ? chinese : `${chinese}。`;
  }
  return "";
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
  if (explicitGenderConflict(title, gender)) {
    const error = integrationError(`${slot} candidate conflicts with authoritative gender`);
    error.code = "SHOPPING_AGENT_GENDER_CONTEXT_DRIFT";
    throw error;
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

function withoutWeatherFields(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key]) =>
    !/^(?:weather|weather_constraints|weatherConstraints|temperature|temperature_c|humidity|rain|wind|wind_kph|condition|forecast)$/i.test(key)));
}

function normalizeGender(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["female", "女", "女性", "女士"].includes(normalized)) return "female";
  if (["male", "男", "男性", "男士"].includes(normalized)) return "male";
  return "unisex";
}

function resolvePersonaExpression(gender, userInput = "") {
  const explicitNeutral = /中性|无性别|男友风|boyfriend|androgynous/i.test(
    String(userInput || ""),
  );
  if (gender === "female") {
    return explicitNeutral ? "neutral_feminine" : "feminine_or_neutral_feminine";
  }
  if (gender === "male") {
    return explicitNeutral ? "neutral_masculine" : "masculine_or_neutral_masculine";
  }
  return "neutral";
}

function explicitGenderConflict(value, gender) {
  const textValue = String(value || "");
  if (gender === "unisex" || /男女同款|男女通用|中性|情侣/u.test(textValue)) {
    return false;
  }
  const female = /女士|女装|女款|女鞋|女性|女生/u.test(textValue);
  const male = /男士|男装|男款|男鞋|男性|男生/u.test(textValue);
  return gender === "female" ? male && !female : female && !male;
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
  SHOPPING_PRODUCTION_POLICY,
  shoppingAgentFeatureEnabled,
};
