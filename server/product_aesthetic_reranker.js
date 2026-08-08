const crypto = require("node:crypto");
const {
  categoryPriority,
  productQualityBlock,
  semanticCategoryMatch,
} = require("./product_relevance");

const DEFAULT_SELECTION_LIMIT = 6;
const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_CACHE_ENTRIES = 100;
const DEFAULT_VISUAL_CANDIDATES_PER_GROUP = 10;
const MAX_VISUAL_IMAGES_PER_REQUEST = 40;
const HIGH_QUALITY_BRAND_SCORE = 65;

const BRAND_TIERS = Object.freeze({
  S: Object.freeze([
    ["ralph lauren", "拉夫劳伦", "拉尔夫劳伦"],
    ["cos"],
    ["massimo dutti"],
    ["a.p.c.", "apc"],
    ["theory"],
    ["sandro"],
    ["maje"],
    ["acne studios"],
  ]),
  A: Object.freeze([
    ["uniqlo", "优衣库"],
    ["zara"],
    ["nike", "耐克"],
    ["adidas", "阿迪达斯"],
    ["new balance", "newbalance", "新百伦"],
    ["levi's", "levis", "李维斯"],
    ["tommy hilfiger", "tommyhilfiger"],
    ["lacoste", "鳄鱼"],
  ]),
});

const BRAND_SCORE = Object.freeze({S: 100, A: 85, B: 68, C: 25});
const POSITIVE_TITLE_QUALITY_TERMS = Object.freeze([
  "旗舰店", "官方", "品牌", "设计师", "系列",
]);
const NEGATIVE_TITLE_QUALITY_TERMS = Object.freeze([
  "清仓", "爆款", "地摊", "同款", "学生", "9.9", "秒杀", "促销",
]);
const STRONG_IMAGE_QUALITY_HINTS = new Set([
  "white_background", "model_display", "official",
]);

class ProductAestheticReranker {
  constructor({
    client,
    model,
    timeoutMs = 45_000,
    cacheTtlMs = DEFAULT_CACHE_TTL_MS,
    maxCacheEntries = DEFAULT_CACHE_ENTRIES,
    visualEvaluationEnabled = true,
    logger = console,
  } = {}) {
    this.client = client || null;
    this.model = String(model || "").trim();
    this.timeoutMs = positiveInteger(timeoutMs, 45_000);
    this.cacheTtlMs = positiveInteger(cacheTtlMs, DEFAULT_CACHE_TTL_MS);
    this.maxCacheEntries = positiveInteger(maxCacheEntries, DEFAULT_CACHE_ENTRIES);
    this.visualEvaluationEnabled = visualEvaluationEnabled !== false;
    this.logger = logger;
    this.cache = new Map();
    this.selectionHistory = new Map();
    this.metrics = {
      callCount: 0,
      cacheHits: 0,
      fallbackCount: 0,
      totalDurationMs: 0,
      lastDurationMs: null,
      visualCallCount: 0,
      visualFallbackCount: 0,
      visualTotalDurationMs: 0,
      visualLastDurationMs: null,
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
      visual_call_count: this.metrics.visualCallCount,
      visual_fallback_count: this.metrics.visualFallbackCount,
      visual_average_duration_ms: this.metrics.visualCallCount > 0
        ? Math.round(this.metrics.visualTotalDurationMs / this.metrics.visualCallCount)
        : 0,
      visual_last_duration_ms: this.metrics.visualLastDurationMs,
      cache_entries: this.cache.size,
    };
  }

  async rerank({groups, context = {}, requestId = "", selectionLimit = DEFAULT_SELECTION_LIMIT}) {
    const qualityBlocks = collectQualityBlocks(groups);
    if (qualityBlocks.length > 0) {
      this.logger.warn?.("商品质量过滤", {
        requestId: requestId || undefined,
        stage: "ai_reranker",
        blocked_category: [...new Set(qualityBlocks.map((item) => item.blocked_category))],
        blocked_keyword: [...new Set(qualityBlocks.map((item) => item.blocked_keyword))],
        blockedCount: qualityBlocks.length,
      });
    }
    const normalizedGroups = normalizeGroups(groups, selectionLimit);
    let workingGroups = normalizedGroups;
    const candidateCount = normalizedGroups.reduce(
      (total, group) => total + group.candidates.length,
      0,
    );
    if (candidateCount === 0) return [];

    const cacheKey = buildCacheKey(normalizedGroups, context);
    const finalize = (products) => this.#diversify(
      cacheKey,
      products,
      workingGroups,
      selectionLimit,
    );
    const fallback = () => finalize(ruleFallback(workingGroups, selectionLimit));
    if (!this.configured) {
      this.metrics.fallbackCount += 1;
      const products = fallback();
      this.#logResult({
        requestId,
        candidateCount,
        selectedCount: products.length,
        brandFallback: products.some((product) => product.brand_fallback === true),
        durationMs: 0,
        cached: false,
        fallback: true,
        errorCode: "AI_RERANK_NOT_CONFIGURED",
      });
      return products;
    }

    const cached = this.#readCache(cacheKey);
    if (cached) {
      this.metrics.cacheHits += 1;
      const cachedFallback = cached.some((product) => product.ai_rerank_fallback === true);
      const diversified = finalize(cached);
      this.#logResult({
        requestId,
        candidateCount,
        selectedCount: diversified.length,
        brandFallback: diversified.some((product) => product.brand_fallback === true),
        durationMs: 0,
        cached: true,
        fallback: cachedFallback,
        errorCode: cachedFallback ? "AI_RERANK_CACHED_FALLBACK" : undefined,
      });
      return cloneProducts(diversified);
    }

    const startedAt = Date.now();
    try {
      workingGroups = await this.#assessVisuals(normalizedGroups, context, requestId);
      let selected = validateSelection(
        await this.#select(workingGroups, context),
        workingGroups,
        selectionLimit,
      );
      const incompleteGroups = groupsBelowMinimum(workingGroups, selected);
      let usedFallback = false;
      if (incompleteGroups.length > 0) {
        const repaired = (await Promise.all(incompleteGroups.map(async (group) => {
          try {
            return validateSelection(
              await this.#select([group], context),
              [group],
              selectionLimit,
            );
          } catch (_) {
            return [];
          }
        }))).flat();
        selected = replaceGroupProducts(selected, repaired, incompleteGroups);
        const unresolvedGroups = groupsBelowMinimum(incompleteGroups, selected);
        if (unresolvedGroups.length > 0) {
          usedFallback = true;
          selected = replaceGroupProducts(
            selected,
            ruleFallback(unresolvedGroups, selectionLimit),
            unresolvedGroups,
          );
        }
      }
      const durationMs = Date.now() - startedAt;
      if (usedFallback) this.metrics.fallbackCount += 1;
      this.#writeCache(cacheKey, selected);
      const diversified = finalize(selected);
      this.#logResult({
        requestId,
        candidateCount,
        selectedCount: diversified.length,
        brandFallback: diversified.some((product) => product.brand_fallback === true),
        durationMs,
        cached: false,
        fallback: usedFallback,
        errorCode: usedFallback ? "AI_RERANK_INCOMPLETE_SELECTION" : undefined,
      });
      return cloneProducts(diversified);
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      this.metrics.fallbackCount += 1;
      const products = fallback();
      this.#logResult({
        requestId,
        candidateCount,
        selectedCount: products.length,
        brandFallback: products.some((product) => product.brand_fallback === true),
        durationMs,
        cached: false,
        fallback: true,
        errorCode: safeErrorCode(error),
      });
      return products;
    }
  }

  async #select(groups, context) {
    const startedAt = Date.now();
    this.metrics.callCount += 1;
    try {
      const response = await this.client.chat.completions.create(
        {
          model: this.model,
          response_format: {type: "json_object"},
          enable_thinking: false,
          temperature: 0.2,
          messages: buildMessages(groups, context),
        },
        {
          timeout: this.timeoutMs,
          maxRetries: 0,
        },
      );
      return parseJsonResponse(extractText(response));
    } finally {
      const durationMs = Date.now() - startedAt;
      this.metrics.totalDurationMs += durationMs;
      this.metrics.lastDurationMs = durationMs;
    }
  }

  async #assessVisuals(groups, context, requestId) {
    if (!this.visualEvaluationEnabled) return groups;
    const batch = buildVisualBatch(groups);
    if (batch.length === 0) return groups;
    const startedAt = Date.now();
    this.metrics.visualCallCount += 1;
    try {
      const response = await this.client.chat.completions.create(
        {
          model: this.model,
          response_format: {type: "json_object"},
          enable_thinking: false,
          temperature: 0,
          messages: buildVisualQualityMessages(groups, context, batch),
        },
        {
          timeout: this.timeoutMs,
          maxRetries: 0,
        },
      );
      const assessed = applyVisualAssessments(
        groups,
        parseJsonResponse(extractText(response)),
      );
      this.logger.info?.("商品图片视觉质量评估完成", {
        requestId: requestId || undefined,
        evaluatedCount: batch.length,
        retainedCount: assessed.reduce(
          (total, group) => total + group.candidates.length,
          0,
        ),
        visualDurationMs: Date.now() - startedAt,
      });
      return assessed;
    } catch (error) {
      this.metrics.visualFallbackCount += 1;
      this.logger.warn?.("商品图片视觉质量评估回退", {
        requestId: requestId || undefined,
        evaluatedCount: batch.length,
        errorCode: safeErrorCode(error),
      });
      return groups;
    } finally {
      const durationMs = Date.now() - startedAt;
      this.metrics.visualTotalDurationMs += durationMs;
      this.metrics.visualLastDurationMs = durationMs;
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
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
      this.selectionHistory.delete(oldestKey);
    }
  }

  #diversify(key, products, groups, selectionLimit) {
    const recent = this.selectionHistory.get(key) || [];
    const result = applyDiversityScores(products, groups, {
      selectionLimit,
      recentSelections: recent.flat(),
    });
    this.selectionHistory.set(key, [
      result.primarySelections,
      ...recent,
    ].slice(0, 2));
    return result.products;
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
      brand_fallback: details.brandFallback === true,
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
      item_budget: context.item_budget ?? context.itemBudget,
      outfit_budget: context.outfit_budget ?? context.outfitBudget,
      user_input: context.userInput,
    }, [
      "scene", "style", "season", "weather", "budget",
      "item_budget", "itemBudget", "outfit_budget", "outfitBudget",
      "color_preferences", "colorPreferences", "user_input", "userInput",
    ]),
    outfit_plan: pickFields(context.outfit_plan || context.outfitPlan || {}, [
      "styling_strategy", "stylingStrategy", "looks", "top", "bottom", "dress",
      "shoes", "outerwear", "bag", "accessories", "summary",
    ]),
    product_groups: groups.map((group, index) => ({
      requirement_index: index,
      category_priority: categoryPriority(group.requirement.category),
      required_minimum: Math.min(4, group.candidates.length),
      maximum: Math.min(6, group.candidates.length),
      requirement: compactObject(group.requirement),
      candidates: group.candidates.map((product) => compactObject({
        product_id: product.product_id,
        look_id: product.look_id,
        title: product.title,
        price: product.price,
        image_url: product.image_url,
        brand: product.brand,
        shop_name: product.shop_name,
        material: product.material,
        sales: product.sales,
        relevance_score: product.relevance_score,
        catalog_aesthetic_score: product.catalog_aesthetic_score,
        aesthetic_score: product.aesthetic_score,
        image_quality_hint: product.image_quality_hint,
        visual_quality_score: product.visual_quality_score,
        fashion_taste_score: product.fashion_taste_score,
        commercial_ad_penalty: product.commercial_ad_penalty,
        subject_coverage_score: product.subject_coverage_score,
        commerce_visual_score: product.commerce_visual_score,
        brand_quality_score: product.brand_quality_score,
        brand_tier: product.brand_tier,
        brand_fallback: product.brand_fallback,
        budget_preference_score: product.budget_preference_score,
        budget_note: product.budget_note,
        aesthetic_quality_flags: product.aesthetic_quality_flags,
      })),
    })),
  };
  return [
    {
      role: "system",
      content: [
        "Each selected_products entry must include the source requirement_index and product_id.",
        "All user-facing natural-language values MUST be written in Simplified Chinese (zh-CN). English is allowed only for internal enum values and identifiers.",
        "Never select underwear, bras, socks, hosiery, sleepwear, homewear, adult products, shapewear, or swimwear unless explicit_user_search is true.",
        "Prioritize top, bottom, shoes, outerwear, dress, and bag over accessory, underwear, and homewear.",
        "Prioritize brand tiers S, A, and credible original/designer B over ordinary or unbranded C products. Use brand_quality_score as an independent ranking signal.",
        "Never select titles containing manufacturer/wholesale/clearance/viral bargain/street stall/student budget/copy/replica/high replica marketing terms. Only use brand_fallback products when stronger branded candidates are insufficient.",
        "Treat item_budget and outfit_budget as soft preferences for brand choice, price ranking, value assessment, and recommendation reasons; never use them as hard filters.",
        "A slightly over-budget product may be selected when its quality or outfit fit justifies it, but the reason must clearly explain that tradeoff.",
        "Use styling_strategy plus every Look's styling_goal and proportion_strategy as the source of truth for body-proportion fit.",
        "Do not equate brand with taste. Brand/shop trust is only supporting evidence; image quality, silhouette, material, Look coherence, and body strategy matter more.",
        "Never select a candidate with commercial_ad_penalty >= 60.",
        "Each selected product must also include body_strategy_match_score from 0 to 100.",
        "你是 FitAI 商品审美复选器。只能从候选商品中选择，不得编造或修改 product_id。",
        "综合整套穿搭、用户身材比例、性别、场景、季节、预算、颜色、版型、材质和设计语言判断。",
        "审美分重点判断品牌/店铺可信度、图片呈现、设计感、材质描述和风格匹配；显著降低低价爆款、关键词堆叠标题、廉价感图片和信息不完整商品。",
        "淘汰廉价感明显、设计杂乱、印花夸张、版型冲突或与整套不协调的商品。男性和女性规则必须由输入决定。",
        "必须分别处理每个 requirement_index，而不是整套合计选择 4 至 6 件。",
        "每组 candidates 数量不少于 4 时，该组必须选择 4 至 6 件；少于 4 时选择全部合格商品，不得跨组凑数。",
        "product_groups 中的 required_minimum 和 maximum 是该组的明确数量约束，selected_products 必须逐组满足。",
        "同组商品应兼顾审美首选、百搭、性价比、设计感和身材适配。",
        "三套 Look 之间必须主动保持多样性：同品类避免相同商品、同品牌、标题高度相似或相同图片，并呼应各自不同的 style_direction。",
        "只返回严格 JSON：{\"selected_products\":[{\"product_id\":\"候选ID\",\"aesthetic_score\":0,\"fit_score\":0,\"outfit_coherence_score\":0,\"value_score\":0,\"reason\":\"\",\"concern\":\"\"}]}。",
        "所有分数必须在 0 到 100 之间，输出顺序就是最终推荐顺序。",
      ].join("\n"),
    },
    {role: "user", content: JSON.stringify(payload)},
  ];
}

function buildVisualBatch(groups) {
  const categories = new Map();
  (Array.isArray(groups) ? groups : []).forEach((group, requirementIndex) => {
    const category = String(group?.requirement?.category || "other");
    const bucket = categories.get(category) || [];
    for (const product of Array.isArray(group?.candidates) ? group.candidates : []) {
      const productId = String(product?.product_id || "").trim();
      const imageUrl = String(product?.image_url || "").trim();
      if (!productId || !/^https:\/\/[^\s]+$/i.test(imageUrl)) continue;
      if (bucket.some((entry) => entry.product_id === productId)) continue;
      if (bucket.length >= DEFAULT_VISUAL_CANDIDATES_PER_GROUP) break;
      bucket.push({
        requirement_index: requirementIndex,
        category,
        product_id: productId,
        title: safeText(product.title, 120),
        image_url: imageUrl,
      });
    }
    categories.set(category, bucket);
  });
  const buckets = [...categories.values()];
  const batch = [];
  for (let offset = 0; batch.length < MAX_VISUAL_IMAGES_PER_REQUEST; offset += 1) {
    let added = false;
    for (const bucket of buckets) {
      if (bucket[offset]) {
        batch.push(bucket[offset]);
        added = true;
        if (batch.length >= MAX_VISUAL_IMAGES_PER_REQUEST) break;
      }
    }
    if (!added) break;
  }
  return batch;
}

function buildVisualQualityMessages(groups, context, batch = buildVisualBatch(groups)) {
  const stylingStrategy = context?.outfit_plan?.styling_strategy ||
    context?.outfitPlan?.stylingStrategy ||
    context?.styling_strategy ||
    context?.stylingStrategy || {};
  const content = [{
    type: "text",
    text: JSON.stringify({
      task: "Evaluate ecommerce product image quality for a professional styling service.",
      styling_strategy: compactObject(stylingStrategy),
      candidates: batch.map((entry, imageIndex) => ({
        image_index: imageIndex,
        requirement_index: entry.requirement_index,
        category: entry.category,
        product_id: entry.product_id,
        title: entry.title,
      })),
      output_schema: {
        image_assessments: [{
          requirement_index: 0,
          product_id: "candidate id",
          visual_quality_score: 0,
          fashion_taste_score: 0,
          commercial_ad_penalty: 0,
          subject_coverage_score: 0,
          reason: "brief evidence from the image",
        }],
      },
    }),
  }];
  batch.forEach((entry, imageIndex) => {
    content.push({
      type: "text",
      text: `image_index=${imageIndex}; product_id=${entry.product_id}; category=${entry.category}`,
    });
    content.push({
      type: "image_url",
      image_url: {url: entry.image_url, detail: "auto"},
    });
  });
  return [
    {
      role: "system",
      content: [
        "You are a strict ecommerce image art director for a premium personal styling product.",
        "Judge the image itself, not only the title or brand.",
        "High visual_quality_score requires a clear garment/product, clean composition, useful white-background or model presentation, and adequate subject coverage.",
        "Set commercial_ad_penalty high for large advertising text, red/yellow sale banners, oversized price numbers, messy collage layout, tiny product subjects, or phrases such as 50-year-old store, Beijing Mall, factory direct, livestream deal, buy one get one, flash sale, clearance, bestseller, or lowest price.",
        "Do not invent product IDs. Return exactly one assessment for every supplied candidate using strict JSON.",
      ].join("\n"),
    },
    {role: "user", content},
  ];
}

function applyVisualAssessments(groups, payload) {
  const values = payload?.image_assessments || payload?.products;
  if (!Array.isArray(values)) throw new Error("AI_VISUAL_INVALID_RESPONSE");
  const assessments = new Map();
  for (const item of values) {
    const productId = String(item?.product_id || "").trim();
    const requirementIndex = Number(item?.requirement_index);
    const visualQuality = score(item?.visual_quality_score);
    const fashionTaste = score(item?.fashion_taste_score);
    const adPenalty = score(item?.commercial_ad_penalty);
    const subjectCoverage = score(item?.subject_coverage_score);
    if (!productId || visualQuality == null || fashionTaste == null ||
        adPenalty == null || subjectCoverage == null) continue;
    const assessment = {
      visual_quality_score: visualQuality,
      image_quality_score: visualQuality,
      fashion_taste_score: fashionTaste,
      commercial_ad_penalty: adPenalty,
      subject_coverage_score: subjectCoverage,
      commerce_visual_score: commerceVisualScore({
        visualQuality,
        fashionTaste,
        adPenalty,
        subjectCoverage,
      }),
      visual_quality_reason: safeText(item.reason, 180),
    };
    assessments.set(`id:${productId}`, assessment);
    if (Number.isInteger(requirementIndex) && requirementIndex >= 0) {
      assessments.set(`${requirementIndex}:${productId}`, assessment);
    }
  }
  if (assessments.size === 0) throw new Error("AI_VISUAL_NO_VALID_ASSESSMENT");
  return groups.map((group, requirementIndex) => ({
    ...group,
    candidates: group.candidates
      .map((product) => ({
        ...product,
        ...(assessments.get(`${requirementIndex}:${product.product_id}`) ||
          assessments.get(`id:${product.product_id}`) ||
          visualAssessmentDefaults(product)),
      }))
      .filter((product) => product.commercial_ad_penalty < 60)
      .sort((left, right) => candidateQualityPrior(right) - candidateQualityPrior(left)),
  }));
}

function visualAssessmentDefaults(product) {
  const existingVisualQuality = score(
    product?.visual_quality_score ?? product?.image_quality_score,
  );
  const existingFashionTaste = score(product?.fashion_taste_score);
  const existingAdPenalty = score(product?.commercial_ad_penalty);
  const existingSubjectCoverage = score(product?.subject_coverage_score);
  if (existingVisualQuality != null && existingFashionTaste != null &&
      existingAdPenalty != null && existingSubjectCoverage != null) {
    return {
      visual_quality_score: existingVisualQuality,
      image_quality_score: existingVisualQuality,
      fashion_taste_score: existingFashionTaste,
      commercial_ad_penalty: existingAdPenalty,
      subject_coverage_score: existingSubjectCoverage,
      commerce_visual_score: boundedScore(
        product?.commerce_visual_score ?? commerceVisualScore({
          visualQuality: existingVisualQuality,
          fashionTaste: existingFashionTaste,
          adPenalty: existingAdPenalty,
          subjectCoverage: existingSubjectCoverage,
        }),
      ),
      visual_quality_reason: safeText(product?.visual_quality_reason, 180),
    };
  }
  const hint = String(product?.image_quality_hint || "").toLowerCase();
  const promotion = hint === "promotion_poster";
  const visualQuality = promotion ? 20
    : hint === "white_background" ? 86
      : hint === "model_display" ? 82
        : hint === "official" ? 78 : 60;
  const fashionTaste = boundedScore(product?.catalog_aesthetic_score ?? 55);
  const adPenalty = promotion ? 75 : 20;
  const subjectCoverage = promotion ? 30 : 65;
  return {
    visual_quality_score: visualQuality,
    image_quality_score: visualQuality,
    fashion_taste_score: fashionTaste,
    commercial_ad_penalty: adPenalty,
    subject_coverage_score: subjectCoverage,
    commerce_visual_score: commerceVisualScore({
      visualQuality,
      fashionTaste,
      adPenalty,
      subjectCoverage,
    }),
    visual_quality_reason: "",
  };
}

function commerceVisualScore({visualQuality, fashionTaste, adPenalty, subjectCoverage}) {
  return roundScore(boundedScore(
    boundedScore(visualQuality) * 0.45 +
    boundedScore(fashionTaste) * 0.25 +
    boundedScore(subjectCoverage) * 0.3 -
    boundedScore(adPenalty) * 0.6,
  ));
}

function validateSelection(payload, groups, selectionLimit) {
  if (!payload || !Array.isArray(payload.selected_products)) {
    throw new Error("AI_RERANK_INVALID_RESPONSE");
  }
  const safeGroups = normalizeGroups(groups, selectionLimit);
  const candidates = new Map();
  const productGroups = new Map();
  safeGroups.forEach((group, groupIndex) => {
    group.candidates.forEach((product) => {
      const id = String(product.product_id);
      candidates.set(`${groupIndex}:${id}`, {product, groupIndex});
      const indexes = productGroups.get(id) || [];
      indexes.push(groupIndex);
      productGroups.set(id, indexes);
    });
  });
  const selectedByGroup = safeGroups.map(() => []);
  const seen = new Set();
  for (const item of payload.selected_products) {
    const id = String(item?.product_id || "").trim();
    const requestedGroup = Number(item?.requirement_index);
    const inferredGroups = productGroups.get(id) || [];
    const groupIndex = Number.isInteger(requestedGroup) && requestedGroup >= 0
      ? requestedGroup
      : inferredGroups.length === 1 ? inferredGroups[0] : -1;
    const match = candidates.get(`${groupIndex}:${id}`);
    const selectionKey = `${groupIndex}:${id}`;
    if (!match || seen.has(selectionKey)) continue;
    const catalogAesthetic = boundedScore(match.product.catalog_aesthetic_score ?? 50);
    const brandQuality = boundedScore(match.product.brand_quality_score ?? BRAND_SCORE.C);
    const aiAesthetic = score(item.aesthetic_score ?? item.ai_taste_score);
    const bodyStrategyMatch = score(
      item.body_strategy_match_score ?? item.fit_score,
    );
    const visualQuality = boundedScore(
      match.product.commerce_visual_score ??
      match.product.visual_quality_score ??
      match.product.image_quality_score ?? 60,
    );
    const values = {
      ai_taste_score: aiAesthetic,
      aesthetic_score: aiAesthetic,
      fit_score: score(item.fit_score),
      body_strategy_match_score: bodyStrategyMatch,
      outfit_coherence_score: score(item.outfit_coherence_score),
      value_score: score(item.value_score),
    };
    if (Object.values(values).some((value) => value == null)) continue;
    const groupProducts = selectedByGroup[match.groupIndex];
    if (groupProducts.length >= selectionLimit) continue;
    seen.add(selectionKey);
    const matchScore = budgetAdjustedMatchScore(match.product);
    const recommendationReason = appendBudgetNote(
      userFacingChineseText(item.reason, "该商品与当前穿搭方案和身体比例策略相匹配", 240),
      match.product.budget_note,
    );
    const finalScore = compositeProductScore({
      matchScore,
      aestheticScore: values.aesthetic_score,
      visualQualityScore: visualQuality,
      bodyStrategyScore: values.body_strategy_match_score,
      brandQualityScore: brandQuality,
      diversityScore: 100,
    });
    groupProducts.push({
      ...match.product,
      ...values,
      match_score: matchScore,
      catalog_aesthetic_score: catalogAesthetic,
      commerce_visual_score: visualQuality,
      brand_quality_score: brandQuality,
      diversity_score: 100,
      final_score: finalScore,
      ai_match_score: finalScore,
      ai_recommendation_reason: recommendationReason,
      ai_concern: userFacingChineseText(item.concern, "", 180),
      recommendation_reason: recommendationReason,
      ai_rerank_fallback: false,
    });
  }
  if (selectedByGroup.every((products) => products.length === 0)) {
    throw new Error("AI_RERANK_NO_VALID_SELECTION");
  }
  return selectedByGroup.flatMap((products) => applyLabels(products));
}

function groupsBelowMinimum(groups, products) {
  const selectedIds = new Set(products.map(productGroupKey));
  return groups.filter((group) => group.candidates.length >= 4 &&
    group.candidates.filter((product) => selectedIds.has(productGroupKey(product))).length < 4);
}

function replaceGroupProducts(products, replacements, groups) {
  const groupIds = new Set(groups.flatMap((group) =>
    group.candidates.map(productGroupKey)));
  return [
    ...products.filter((product) => !groupIds.has(productGroupKey(product))),
    ...replacements,
  ];
}

function productGroupKey(product) {
  return `${product?.look_id || ""}:${product?.product_id || ""}`;
}

function applyDiversityScores(products, groups, {
  selectionLimit = DEFAULT_SELECTION_LIMIT,
  recentSelections = [],
} = {}) {
  const safeGroups = normalizeGroups(groups, selectionLimit);
  const available = new Map((Array.isArray(products) ? products : [])
    .map((product) => [productGroupKey(product), product]));
  const previousLookPrimaries = [];
  const primarySelections = [];
  const diversified = [];

  for (const group of safeGroups) {
    const requirement = group.requirement;
    const groupProducts = group.candidates
      .map((candidate) => available.get(productGroupKey(candidate)))
      .filter(Boolean);
    const ranked = [];
    const remaining = [...groupProducts];
    while (remaining.length > 0 && ranked.length < selectionLimit) {
      const scored = remaining.map((product) => {
        const comparisons = [
          ...previousLookPrimaries.filter((item) =>
            item.category === requirement.category),
          ...recentSelections.filter((item) =>
            item.category === requirement.category),
          ...ranked.map((item) => productFingerprint(item, requirement)),
        ];
        const diversity = diversityScore(product, requirement, comparisons);
        const relevance = budgetAdjustedMatchScore(product);
        const aesthetic = boundedScore(
          product.aesthetic_score ?? product.ai_taste_score ??
          product.catalog_aesthetic_score ?? relevance,
        );
        const brandQuality = boundedScore(
          product.brand_quality_score ?? BRAND_SCORE.C,
        );
        const visualQuality = boundedScore(
          product.commerce_visual_score ??
          product.visual_quality_score ??
          product.image_quality_score ?? 60,
        );
        const bodyStrategy = boundedScore(
          product.body_strategy_match_score ?? product.fit_score ?? 60,
        );
        const exactDuplicate = hasExactDuplicate(product, comparisons);
        const finalScore = roundScore(Math.max(
          0,
          compositeProductScore({
            matchScore: relevance,
            aestheticScore: aesthetic,
            visualQualityScore: visualQuality,
            bodyStrategyScore: bodyStrategy,
            brandQualityScore: brandQuality,
            diversityScore: diversity,
          }) - (exactDuplicate ? 35 : 0),
        ));
        return {
          product: {
            ...product,
            match_score: relevance,
            aesthetic_score: aesthetic,
            commerce_visual_score: visualQuality,
            body_strategy_match_score: bodyStrategy,
            brand_quality_score: brandQuality,
            diversity_score: diversity,
            final_score: finalScore,
            ai_match_score: finalScore,
          },
          finalScore,
        };
      }).sort((left, right) => right.finalScore - left.finalScore);
      const selected = scored[0].product;
      ranked.push(selected);
      const selectedIndex = remaining.findIndex((item) =>
        productGroupKey(item) === productGroupKey(selected));
      remaining.splice(selectedIndex, 1);
    }
    if (ranked.length > 0) {
      const primary = productFingerprint(ranked[0], requirement);
      previousLookPrimaries.push(primary);
      primarySelections.push(primary);
    }
    diversified.push(...applyLabels(ranked));
  }
  return {products: diversified, primarySelections};
}

function diversityScore(product, requirement, comparisons) {
  if (!Array.isArray(comparisons) || comparisons.length === 0) return 100;
  let scoreValue = 100;
  const current = productFingerprint(product, requirement);
  for (const previous of comparisons) {
    if (current.product_id && current.product_id === previous.product_id) {
      scoreValue = Math.min(scoreValue, 0);
      continue;
    }
    if (current.image_url && current.image_url === previous.image_url) {
      scoreValue = Math.min(scoreValue, 5);
    }
    const similarity = titleSimilarity(current.title, previous.title);
    if (similarity >= 0.85) scoreValue = Math.min(scoreValue, 20);
    else if (similarity >= 0.65) scoreValue = Math.min(scoreValue, 45);
    if (current.brand && previous.brand && current.brand === previous.brand) {
      scoreValue -= 15;
    }
    if (current.color && previous.color && current.color === previous.color) {
      scoreValue -= 8;
    }
    if (current.fit && previous.fit && current.fit === previous.fit) {
      scoreValue -= 7;
    }
  }
  return boundedScore(scoreValue);
}

function hasExactDuplicate(product, comparisons) {
  const current = productFingerprint(product);
  return comparisons.some((previous) =>
    (current.product_id && current.product_id === previous.product_id) ||
    (current.image_url && current.image_url === previous.image_url));
}

function productFingerprint(product, requirement = {}) {
  return {
    product_id: String(product?.product_id || product?.id || "").trim(),
    category: String(product?.category || requirement.category || "").trim(),
    title: normalizeComparisonText(product?.title),
    image_url: String(product?.image_url || product?.imageUrl || "").trim().toLowerCase(),
    brand: normalizeComparisonText(product?.brand || product?.shop_name),
    color: normalizeComparisonText(product?.color || requirement.color),
    fit: normalizeComparisonText(product?.fit || requirement.fit),
  };
}

function titleSimilarity(left, right) {
  const leftParts = bigrams(normalizeComparisonText(left));
  const rightParts = bigrams(normalizeComparisonText(right));
  if (leftParts.size === 0 || rightParts.size === 0) return 0;
  let intersection = 0;
  for (const part of leftParts) {
    if (rightParts.has(part)) intersection += 1;
  }
  return intersection / (leftParts.size + rightParts.size - intersection);
}

function bigrams(value) {
  const chars = [...String(value || "")];
  if (chars.length === 1) return new Set(chars);
  const result = new Set();
  for (let index = 0; index < chars.length - 1; index += 1) {
    result.add(`${chars[index]}${chars[index + 1]}`);
  }
  return result;
}

function normalizeComparisonText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
}

function boundedScore(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function compositeProductScore({
  matchScore,
  aestheticScore,
  visualQualityScore = aestheticScore,
  bodyStrategyScore = matchScore,
  brandQualityScore,
  diversityScore = 100,
}) {
  const baseScore =
    boundedScore(matchScore) * 0.25 +
    boundedScore(aestheticScore) * 0.3 +
    boundedScore(visualQualityScore) * 0.2 +
    boundedScore(bodyStrategyScore) * 0.15 +
    boundedScore(brandQualityScore) * 0.1;
  const diversityPenalty = (100 - boundedScore(diversityScore)) * 0.05;
  return roundScore(Math.max(0, baseScore - diversityPenalty));
}

function ruleFallback(groups, selectionLimit) {
  return groups.flatMap((group) => group.candidates.slice(0, selectionLimit).map((product) => {
    const matchScore = budgetAdjustedMatchScore(product);
    const aestheticScore = boundedScore(
      product.catalog_aesthetic_score ?? matchScore,
    );
    const brandQualityScore = boundedScore(
      product.brand_quality_score ?? BRAND_SCORE.C,
    );
    const visualQualityScore = boundedScore(
      product.commerce_visual_score ??
      product.visual_quality_score ??
      product.image_quality_score ?? 60,
    );
    const bodyStrategyScore = boundedScore(
      product.body_strategy_match_score ?? product.fit_score ?? 60,
    );
    const diversity = 100;
    const finalScore = compositeProductScore({
      matchScore,
      aestheticScore,
      visualQualityScore,
      bodyStrategyScore,
      brandQualityScore,
      diversityScore: diversity,
    });
    return {
      ...product,
      match_score: matchScore,
      aesthetic_score: aestheticScore,
      commerce_visual_score: visualQualityScore,
      body_strategy_match_score: bodyStrategyScore,
      brand_quality_score: brandQualityScore,
      diversity_score: diversity,
      final_score: finalScore,
      ai_match_score: finalScore,
      recommendation_reason: appendBudgetNote(
        userFacingChineseText(
          product.recommendation_reason,
          "该商品与当前穿搭需求相匹配",
          240,
        ),
        product.budget_note,
      ),
      ai_rerank_fallback: true,
    };
  }));
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
  return (Array.isArray(groups) ? groups : []).map((group) => {
    const requirement = compactObject(group?.requirement || {});
    const assessedCandidates = Array.isArray(group?.candidates)
      ? group.candidates
        .filter((product) => semanticCategoryMatch(product, requirement))
        .filter((product) => !productQualityBlock(product, requirement))
        .map((product) => {
          const assessed = {
            ...product,
            ...catalogAestheticAssessment(product, requirement),
            ...brandQualityAssessment(product),
          };
          return {...assessed, ...visualAssessmentDefaults(assessed)};
        })
        .filter((product) => !isAestheticJunk(product))
      : [];
    const requiredMinimum = Math.min(4, assessedCandidates.length);
    const highQualityCount = assessedCandidates.filter((product) =>
      product.brand_quality_score >= HIGH_QUALITY_BRAND_SCORE).length;
    const brandFallback = highQualityCount < requiredMinimum;
    const candidates = assessedCandidates
      .map((product) => ({...product, brand_fallback: brandFallback}))
      .sort((left, right) => candidateQualityPrior(right) - candidateQualityPrior(left) ||
        String(left.product_id).localeCompare(String(right.product_id)))
      .slice(0, DEFAULT_VISUAL_CANDIDATES_PER_GROUP);
    return {
      requirement,
      candidates,
      selectionLimit: limit,
    };
  });
}

function candidateQualityPrior(product) {
  return boundedScore(product.relevance_score) * 0.25 +
    boundedScore(product.aesthetic_score ?? product.catalog_aesthetic_score) * 0.25 +
    boundedScore(product.commerce_visual_score ?? product.visual_quality_score) * 0.25 +
    boundedScore(product.brand_quality_score) * 0.1 +
    boundedScore(product.budget_preference_score ?? 70) * 0.15;
}

function budgetAdjustedMatchScore(product) {
  const relevance = boundedScore(product?.relevance_score);
  const rawBudgetScore = Number(product?.budget_preference_score);
  if (!Number.isFinite(rawBudgetScore)) return relevance;
  return roundScore(relevance * 0.85 + boundedScore(rawBudgetScore) * 0.15);
}

function appendBudgetNote(reason, budgetNote) {
  const safeReason = safeText(reason, 240);
  const safeBudgetNote = safeText(budgetNote, 140);
  if (!safeBudgetNote) return safeReason;
  if (!safeReason) return safeBudgetNote;
  if (safeReason.includes(safeBudgetNote)) return safeReason;
  return safeText(`${safeReason} ${safeBudgetNote}`, 320);
}

function brandQualityAssessment(product) {
  const title = String(product?.title || "").trim();
  const brand = String(product?.brand || "").trim();
  const shop = String(product?.shop_name || "").trim();
  const evidence = [brand, shop, title].filter(Boolean);
  const matchedS = matchKnownBrand(evidence, BRAND_TIERS.S);
  if (matchedS) {
    return brandAssessmentResult(BRAND_SCORE.S, "S", matchedS, title);
  }
  const matchedA = matchKnownBrand(evidence, BRAND_TIERS.A);
  if (matchedA) {
    return brandAssessmentResult(BRAND_SCORE.A, "A", matchedA, title);
  }

  const normalizedBrand = normalizeComparisonText(brand);
  const normalizedShop = normalizeComparisonText(shop);
  const genericBrand = /^(?:其他|其它|无品牌|other|none|unknown|精选商品|精选商城)?$/.test(
    normalizedBrand,
  );
  const credibleOriginal = !genericBrand && Boolean(normalizedBrand) &&
    /官方|旗舰|天猫|专卖|原创|设计师|品牌/.test(`${shop}${title}`);
  if (credibleOriginal) {
    return brandAssessmentResult(BRAND_SCORE.B, "B", brand, title);
  }
  if (!genericBrand && normalizedBrand) {
    return brandAssessmentResult(45, "C", brand, title);
  }
  if (normalizedShop && /官方|旗舰|天猫|原创|设计师/.test(shop)) {
    return brandAssessmentResult(55, "C", shop, title);
  }
  return brandAssessmentResult(BRAND_SCORE.C, "C", "", title);
}

function brandAssessmentResult(scoreValue, tier, brandName, title) {
  const sameStyleMarketing = /同款/.test(String(title || ""));
  return {
    brand_quality_score: sameStyleMarketing
      ? Math.min(35, scoreValue)
      : scoreValue,
    brand_tier: sameStyleMarketing ? "C" : tier,
    brand_name: brandName,
  };
}

function matchKnownBrand(evidence, groups) {
  for (const aliases of groups) {
    for (const alias of aliases) {
      if (evidence.some((value) => hasBrandAlias(value, alias))) return aliases[0];
    }
  }
  return "";
}

function hasBrandAlias(value, alias) {
  const normalizedValue = normalizeComparisonText(value);
  const normalizedAlias = normalizeComparisonText(alias);
  if (!normalizedValue || !normalizedAlias) return false;
  if (normalizedAlias === "cos" || normalizedAlias === "apc") {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`, "i").test(value) ||
      normalizeComparisonText(String(value).split(/旗舰|官方|天猫|专卖/)[0]) === normalizedAlias;
  }
  return normalizedValue.includes(normalizedAlias);
}

function catalogAestheticAssessment(product, requirement = {}) {
  const title = String(product?.title || "").trim();
  const normalizedTitle = normalizeComparisonText(title);
  const brand = normalizeComparisonText(product?.brand);
  const shop = normalizeComparisonText(product?.shop_name);
  const materialDescription = normalizeComparisonText(
    product?.material || requirement.material,
  );
  const materialEvidence = `${materialDescription}${normalizedTitle}`;
  const imageUrl = String(product?.image_url || "").trim().toLowerCase();
  const imageQualityHint = String(product?.image_quality_hint || "").trim().toLowerCase();
  const price = Number(product?.price);
  const flags = [];
  let scoreValue = 50;

  if (hasExplicitBrand(product)) {
    scoreValue += 30;
  } else {
    scoreValue -= 20;
    flags.push("missing_brand");
  }

  const positiveTitleTerms = POSITIVE_TITLE_QUALITY_TERMS.filter((term) =>
    title.includes(term));
  if (positiveTitleTerms.length > 0) {
    scoreValue += Math.min(positiveTitleTerms.length * 5, 15);
  }
  if (shop.includes("旗舰店") || shop.includes("天猫") || shop.includes("官方")) {
    scoreValue += 8;
  } else if (shop) {
    scoreValue += 3;
  }

  if (STRONG_IMAGE_QUALITY_HINTS.has(imageQualityHint)) {
    scoreValue += 15;
  } else if (imageQualityHint === "promotion_poster" ||
      /(?:promo|poster|banner|activity|marketing|campaign|sale)[-_/.]/.test(imageUrl)) {
    scoreValue -= 30;
    flags.push("promotion_poster");
  } else if (/^https:\/\//.test(imageUrl) && /(?:alicdn|taobaocdn)\.com/.test(imageUrl)) {
    scoreValue += 8;
  } else if (/^https:\/\//.test(imageUrl)) {
    scoreValue += 3;
  } else {
    scoreValue -= 20;
    flags.push("weak_image_url");
  }
  if (/placeholder|noimage|default[-_]?image/.test(imageUrl)) {
    scoreValue -= 25;
    flags.push("placeholder_image");
  }

  if (title.length >= 8 && title.length <= 38) scoreValue += 8;
  if (title.length > 55 || repeatedBigramRatio(normalizedTitle) > 0.42) {
    scoreValue -= 18;
    flags.push("keyword_stuffing");
  }
  const negativeTitleTerms = NEGATIVE_TITLE_QUALITY_TERMS.filter((term) =>
    title.includes(term));
  if (negativeTitleTerms.length > 0 ||
      /网红|特价|买一送一|全网最低|厂家直销/.test(title)) {
    scoreValue -= 30;
    flags.push("low_end_marketing");
  }
  if (/羊毛|羊绒|真丝|桑蚕丝|亚麻|纯棉|牛皮|头层皮|精纺|醋酸/.test(materialEvidence)) {
    scoreValue += 10;
  } else if (!materialDescription) {
    scoreValue -= 8;
    flags.push("missing_material");
  }
  if (/廓形|垂感|剪裁|肌理|提花|立体|极简|复古|设计感|cleanfit/.test(normalizedTitle)) {
    scoreValue += 7;
  }

  const minimumPrice = {
    top: 35,
    bottom: 45,
    shoes: 60,
    outerwear: 80,
    dress: 60,
    bag: 50,
  }[requirement.category] || 25;
  if (Number.isFinite(price) && price > 0 && price < minimumPrice * 0.55) {
    scoreValue -= 18;
    flags.push("suspiciously_low_price");
  } else if (Number.isFinite(price) && price > 0 && price < minimumPrice) {
    scoreValue -= 7;
    flags.push("low_price");
  }

  const aestheticScore = roundScore(boundedScore(scoreValue));
  return {
    catalog_aesthetic_score: aestheticScore,
    aesthetic_score: aestheticScore,
    aesthetic_quality_flags: flags,
  };
}

function hasExplicitBrand(product) {
  const brand = normalizeComparisonText(product?.brand);
  if (!brand || /^(?:其他|其它|无品牌|other|none|unknown|精选商品|精选商家)$/.test(brand)) {
    return false;
  }
  return true;
}

function isAestheticJunk(product) {
  const scoreValue = boundedScore(
    product?.aesthetic_score ?? product?.catalog_aesthetic_score,
  );
  const flags = new Set(Array.isArray(product?.aesthetic_quality_flags)
    ? product.aesthetic_quality_flags
    : []);
  if (scoreValue <= 10) return true;
  return scoreValue < 40 && [
    "promotion_poster",
    "low_end_marketing",
    "keyword_stuffing",
    "placeholder_image",
  ].some((flag) => flags.has(flag));
}

function repeatedBigramRatio(value) {
  const chars = [...String(value || "")];
  if (chars.length < 12) return 0;
  const sequence = [];
  for (let index = 0; index < chars.length - 1; index += 1) {
    sequence.push(`${chars[index]}${chars[index + 1]}`);
  }
  return 1 - new Set(sequence).size / sequence.length;
}

function collectQualityBlocks(groups) {
  return (Array.isArray(groups) ? groups : []).flatMap((group) =>
    (Array.isArray(group?.candidates) ? group.candidates : [])
      .map((product) => productQualityBlock(product, group?.requirement || {}))
      .filter(Boolean));
}

function buildCacheKey(groups, context) {
  const normalizedContext = stripRequestIds(compactObject(context));
  const key = JSON.stringify({
    context: normalizedContext,
    groups: groups.map((group) => ({
      requirement: group.requirement,
      candidates: group.candidates.map((product) => ({
        product_id: product.product_id,
        title: product.title,
        image_url: product.image_url,
        price: product.price,
        brand: product.brand,
        brand_quality_score: product.brand_quality_score,
      })),
    })),
  });
  return crypto.createHash("sha256").update(key).digest("hex");
}

function stripRequestIds(value) {
  if (Array.isArray(value)) return value.map(stripRequestIds);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== "requestId" && key !== "request_id")
    .map(([key, item]) => [key, stripRequestIds(item)]));
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

function userFacingChineseText(value, fallback, maxLength) {
  const text = safeText(value, maxLength);
  return /[\u3400-\u9fff]/u.test(text) ? text : fallback;
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
  applyVisualAssessments,
  applyDiversityScores,
  applyLabels,
  brandQualityAssessment,
  buildMessages,
  buildVisualBatch,
  buildVisualQualityMessages,
  catalogAestheticAssessment,
  compositeProductScore,
  ruleFallback,
  validateSelection,
};
