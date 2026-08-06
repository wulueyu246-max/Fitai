const crypto = require("node:crypto");

const DEFAULT_SELECTION_LIMIT = 6;
const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_CACHE_ENTRIES = 100;

class ProductAestheticReranker {
  constructor({
    client,
    model,
    timeoutMs = 45_000,
    cacheTtlMs = DEFAULT_CACHE_TTL_MS,
    maxCacheEntries = DEFAULT_CACHE_ENTRIES,
    logger = console,
  } = {}) {
    this.client = client || null;
    this.model = String(model || "").trim();
    this.timeoutMs = positiveInteger(timeoutMs, 45_000);
    this.cacheTtlMs = positiveInteger(cacheTtlMs, DEFAULT_CACHE_TTL_MS);
    this.maxCacheEntries = positiveInteger(maxCacheEntries, DEFAULT_CACHE_ENTRIES);
    this.logger = logger;
    this.cache = new Map();
    this.metrics = {
      callCount: 0,
      cacheHits: 0,
      fallbackCount: 0,
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
      call_count: this.metrics.callCount,
      cache_hits: this.metrics.cacheHits,
      fallback_count: this.metrics.fallbackCount,
      average_duration_ms: this.metrics.callCount > 0
        ? Math.round(this.metrics.totalDurationMs / this.metrics.callCount)
        : 0,
      last_duration_ms: this.metrics.lastDurationMs,
      cache_entries: this.cache.size,
    };
  }

  async rerank({groups, context = {}, requestId = "", selectionLimit = DEFAULT_SELECTION_LIMIT}) {
    const normalizedGroups = normalizeGroups(groups, selectionLimit);
    const candidateCount = normalizedGroups.reduce(
      (total, group) => total + group.candidates.length,
      0,
    );
    if (candidateCount === 0) return [];

    const fallback = () => ruleFallback(normalizedGroups, selectionLimit);
    if (!this.configured) {
      this.metrics.fallbackCount += 1;
      this.#logResult({
        requestId,
        candidateCount,
        selectedCount: fallback().length,
        durationMs: 0,
        cached: false,
        fallback: true,
        errorCode: "AI_RERANK_NOT_CONFIGURED",
      });
      return fallback();
    }

    const cacheKey = buildCacheKey(normalizedGroups, context);
    const cached = this.#readCache(cacheKey);
    if (cached) {
      this.metrics.cacheHits += 1;
      this.#logResult({
        requestId,
        candidateCount,
        selectedCount: cached.length,
        durationMs: 0,
        cached: true,
        fallback: false,
      });
      return cloneProducts(cached);
    }

    const startedAt = Date.now();
    this.metrics.callCount += 1;
    try {
      const response = await this.client.chat.completions.create(
        {
          model: this.model,
          response_format: {type: "json_object"},
          temperature: 0.2,
          messages: buildMessages(normalizedGroups, context),
        },
        {
          timeout: this.timeoutMs,
          maxRetries: 0,
        },
      );
      const selected = validateSelection(
        parseJsonResponse(extractText(response)),
        normalizedGroups,
        selectionLimit,
      );
      const durationMs = Date.now() - startedAt;
      this.metrics.totalDurationMs += durationMs;
      this.metrics.lastDurationMs = durationMs;
      this.#writeCache(cacheKey, selected);
      this.#logResult({
        requestId,
        candidateCount,
        selectedCount: selected.length,
        durationMs,
        cached: false,
        fallback: false,
      });
      return cloneProducts(selected);
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      this.metrics.totalDurationMs += durationMs;
      this.metrics.lastDurationMs = durationMs;
      this.metrics.fallbackCount += 1;
      const products = fallback();
      this.#logResult({
        requestId,
        candidateCount,
        selectedCount: products.length,
        durationMs,
        cached: false,
        fallback: true,
        errorCode: safeErrorCode(error),
      });
      return products;
    }
  }

  #readCache(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.products;
  }

  #writeCache(key, products) {
    this.cache.set(key, {
      expiresAt: Date.now() + this.cacheTtlMs,
      products: cloneProducts(products),
    });
    while (this.cache.size > this.maxCacheEntries) {
      this.cache.delete(this.cache.keys().next().value);
    }
  }

  #logResult(details) {
    const message = details.fallback ? "AI 商品复选规则回退" : "AI 商品复选完成";
    const safeDetails = {
      requestId: details.requestId || undefined,
      candidateCount: details.candidateCount,
      selectedCount: details.selectedCount,
      aiDurationMs: details.durationMs,
      cached: details.cached,
      ruleFallback: details.fallback,
      errorCode: details.errorCode || undefined,
    };
    if (details.fallback) this.logger.warn?.(message, safeDetails);
    else this.logger.info?.(message, safeDetails);
  }
}

function buildMessages(groups, context) {
  const payload = {
    user_profile: compactProfile(context.user_profile || context.userProfile || {
      gender: context.gender,
      body_profile: context.bodyType,
    }),
    user_requirements: pickFields(context.user_requirements || context.userRequirements || {
      scene: context.scene,
      style: context.style,
      season: context.season,
      budget: context.budget,
      user_input: context.userInput,
    }, [
      "scene", "style", "season", "weather", "budget",
      "color_preferences", "colorPreferences", "user_input", "userInput",
    ]),
    outfit_plan: pickFields(context.outfit_plan || context.outfitPlan || {}, [
      "top", "bottom", "dress", "shoes", "outerwear", "bag", "accessories", "summary",
    ]),
    product_groups: groups.map((group, index) => ({
      requirement_index: index,
      requirement: compactObject(group.requirement),
      candidates: group.candidates.map((product) => compactObject({
        product_id: product.product_id,
        title: product.title,
        price: product.price,
        image_url: product.image_url,
        shop_name: product.shop_name,
        sales: product.sales,
        relevance_score: product.relevance_score,
      })),
    })),
  };
  return [
    {
      role: "system",
      content: [
        "你是 FitAI 商品审美复选器。只能从候选商品中选择，不得编造或修改 product_id。",
        "综合整套穿搭、用户身材比例、性别、场景、季节、预算、颜色、版型、材质和设计语言判断。",
        "淘汰廉价感明显、设计杂乱、印花夸张、版型冲突或与整套不协调的商品。男性和女性规则必须由输入决定。",
        "每个 requirement_index 最多选择 6 件，通常选择 4 至 6 件；合格商品不足时可以少选，不得凑数。",
        "同组商品应兼顾审美首选、百搭、性价比、设计感和身材适配。",
        "只返回严格 JSON：{\"selected_products\":[{\"product_id\":\"候选ID\",\"ai_taste_score\":0,\"fit_score\":0,\"outfit_coherence_score\":0,\"value_score\":0,\"reason\":\"\",\"concern\":\"\"}]}。",
        "所有分数必须在 0 到 100 之间，输出顺序就是最终推荐顺序。",
      ].join("\n"),
    },
    {role: "user", content: JSON.stringify(payload)},
  ];
}

function validateSelection(payload, groups, selectionLimit) {
  if (!payload || !Array.isArray(payload.selected_products)) {
    throw new Error("AI_RERANK_INVALID_RESPONSE");
  }
  const candidates = new Map();
  groups.forEach((group, groupIndex) => {
    group.candidates.forEach((product) => {
      candidates.set(String(product.product_id), {product, groupIndex});
    });
  });
  const selectedByGroup = groups.map(() => []);
  const seen = new Set();
  for (const item of payload.selected_products) {
    const id = String(item?.product_id || "").trim();
    const match = candidates.get(id);
    if (!match || seen.has(id)) continue;
    const values = {
      ai_taste_score: score(item.ai_taste_score),
      fit_score: score(item.fit_score),
      outfit_coherence_score: score(item.outfit_coherence_score),
      value_score: score(item.value_score),
    };
    if (Object.values(values).some((value) => value == null)) continue;
    const groupProducts = selectedByGroup[match.groupIndex];
    if (groupProducts.length >= selectionLimit) continue;
    seen.add(id);
    const finalScore = roundScore(
      Number(match.product.relevance_score || 0) * 0.2 +
      values.ai_taste_score * 0.35 +
      values.fit_score * 0.2 +
      values.outfit_coherence_score * 0.2 +
      values.value_score * 0.05,
    );
    groupProducts.push({
      ...match.product,
      ...values,
      final_score: finalScore,
      ai_match_score: finalScore,
      ai_recommendation_reason: safeText(item.reason, 240),
      ai_concern: safeText(item.concern, 180),
      recommendation_reason: safeText(item.reason, 240),
      ai_rerank_fallback: false,
    });
  }
  if (selectedByGroup.every((products) => products.length === 0)) {
    throw new Error("AI_RERANK_NO_VALID_SELECTION");
  }
  return selectedByGroup.flatMap((products, groupIndex) => {
    if (products.length === 0) {
      return ruleFallback([groups[groupIndex]], selectionLimit);
    }
    return applyLabels(products);
  });
}

function ruleFallback(groups, selectionLimit) {
  return groups.flatMap((group) => group.candidates.slice(0, selectionLimit).map((product) => ({
    ...product,
    final_score: Number(product.relevance_score || 0),
    ai_rerank_fallback: true,
  })));
}

function applyLabels(products) {
  if (products.length === 0) return products;
  const maxima = {
    value: Math.max(...products.map((product) => product.value_score)),
    fit: Math.max(...products.map((product) => product.fit_score)),
    coherence: Math.max(...products.map((product) => product.outfit_coherence_score)),
  };
  return products.map((product, index) => ({
    ...product,
    ai_label: index === 0
      ? "AI首选"
      : product.value_score === maxima.value
        ? "性价比"
        : product.fit_score === maxima.fit
          ? "更显比例"
          : product.outfit_coherence_score === maxima.coherence
            ? "最百搭"
            : "设计感",
  }));
}

function normalizeGroups(groups, selectionLimit) {
  const limit = Math.min(positiveInteger(selectionLimit, DEFAULT_SELECTION_LIMIT), 6);
  return (Array.isArray(groups) ? groups : []).map((group) => ({
    requirement: compactObject(group?.requirement || {}),
    candidates: Array.isArray(group?.candidates)
      ? group.candidates.slice(0, 20)
      : [],
    selectionLimit: limit,
  }));
}

function buildCacheKey(groups, context) {
  const normalizedContext = compactObject(context);
  delete normalizedContext.requestId;
  delete normalizedContext.request_id;
  const key = JSON.stringify({
    context: normalizedContext,
    groups: groups.map((group) => ({
      requirement: group.requirement,
      candidates: group.candidates.map((product) => ({
        product_id: product.product_id,
        title: product.title,
        price: product.price,
      })),
    })),
  });
  return crypto.createHash("sha256").update(key).digest("hex");
}

function parseJsonResponse(text) {
  const normalized = String(text || "").trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return JSON.parse(normalized);
}

function extractText(response) {
  const content = response?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => typeof part === "string" ? part : part?.text || "").join("");
  }
  return "";
}

function compactProfile(value) {
  return pickFields(value, [
    "gender", "age", "height", "weight", "body_type", "bodyType",
    "skin_tone", "skinTone", "body_profile", "bodyProfile", "proportions",
  ]);
}

function pickFields(value, fields) {
  const source = compactObject(value);
  return Object.fromEntries(fields
    .filter((field) => source[field] !== undefined)
    .map((field) => [field, source[field]]));
}

function compactObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, item]) =>
    item !== undefined && item !== null && item !== ""));
}

function score(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100
    ? roundScore(number)
    : null;
}

function roundScore(value) {
  return Math.round(Number(value) * 10) / 10;
}

function safeText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function safeErrorCode(error) {
  const code = String(error?.code || error?.message || "AI_RERANK_FAILED");
  return /^[A-Z0-9_.-]{3,80}$/i.test(code) ? code : "AI_RERANK_FAILED";
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function cloneProducts(products) {
  return products.map((product) => ({...product}));
}

module.exports = {
  ProductAestheticReranker,
  applyLabels,
  buildMessages,
  ruleFallback,
  validateSelection,
};
