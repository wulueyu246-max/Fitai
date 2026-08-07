const {ProductCatalog, canonicalCategory} = require("./product_catalog");
const {
  TAOBAO_MATERIAL_SAMPLE_METHOD,
  TAOBAO_MATERIAL_SEARCH_METHOD,
  TaobaoApiClient,
  TaobaoApiError,
  signTaobaoRequest,
} = require("./taobao_client");
const {
  SUPPORTED_PRODUCT_CATEGORIES,
  buildSearchKeywords,
  normalizeGender,
  normalizeProductCategory,
  normalizeProductRequirement,
  rankProducts,
} = require("./product_relevance");

const PRODUCT_CATEGORIES = SUPPORTED_PRODUCT_CATEGORIES;
const DEFAULT_SAMPLE_MATERIAL_ID = "28029";

class ProductProviderError extends Error {
  constructor(message, {status = 502, code = "PRODUCT_PROVIDER_FAILED", cause} = {}) {
    super(message, {cause});
    this.name = "ProductProviderError";
    this.status = status;
    this.code = code;
  }
}

class ProductProvider {
  async recommend() {
    throw new ProductProviderError("商品 Provider 未实现");
  }

  async recommendForQueries(queries, context = {}) {
    const batches = await Promise.all((Array.isArray(queries) ? queries : []).map(
      (query) => this.recommend({...context, ...query, limit: 2}),
    ));
    return uniqueProducts(batches.flat()).slice(0, 12);
  }
}

class MockProductProvider extends ProductProvider {
  constructor({catalog = new ProductCatalog()} = {}) {
    super();
    this.catalog = catalog;
    this.name = "mock";
    this.configured = false;
    this.status = "mock";
  }

  async recommend(filters = {}) {
    return this.catalog.recommend(filters);
  }

  async recommendForQueries(queries, context = {}) {
    return this.catalog.recommendForQueries(queries, context);
  }
}

class UnavailableProductProvider extends ProductProvider {
  constructor({
    missingVariables = [],
    message = "淘宝商品 Provider 配置不完整",
    code = "PRODUCT_PROVIDER_NOT_CONFIGURED",
  } = {}) {
    super();
    this.name = "taobao";
    this.configured = false;
    this.status = "unconfigured";
    this.missingVariables = [...missingVariables];
    this.message = message;
    this.code = code;
  }

  async recommend() {
    throw new ProductProviderError(this.message, {
      status: 503,
      code: this.code,
    });
  }
}

class TaobaoProductProvider extends ProductProvider {
  constructor({
    appKey,
    appSecret,
    pid,
    adzoneId,
    client,
    catalog = new ProductCatalog(),
    endpoint,
    fetchImpl,
    connectTimeoutMs,
    timeoutMs,
    maxRetries,
    sampleMaterialId = DEFAULT_SAMPLE_MATERIAL_ID,
    reranker = null,
    logger = console,
  }) {
    super();
    this.pid = requireConfig(pid, "TAOBAO_PID");
    const placement = parseTaobaoPlacement(this.pid, adzoneId);
    this.siteId = placement.siteId;
    this.adzoneId = placement.adzoneId;
    this.sampleMaterialId = String(sampleMaterialId || DEFAULT_SAMPLE_MATERIAL_ID);
    this.reranker = reranker;
    this.logger = logger;
    this.client = client || new TaobaoApiClient({
      appKey,
      appSecret,
      endpoint,
      fetchImpl,
      connectTimeoutMs,
      totalTimeoutMs: timeoutMs,
      maxRetries,
      logger,
    });
    this.name = "taobao";
    this.configured = true;
    this.status = "taobao";
  }

  async healthCheck() {
    await this.#search(normalizeFilters({category: "top", keyword: "上衣", limit: 1}));
    return true;
  }

  async recommend(filters = {}) {
    const normalized = normalizeFilters(filters);
    if (!normalized.category && normalized.keyword) {
      try {
        const products = await this.#search({
          ...normalized,
          searchKeyword: normalized.keyword,
        });
        this.status = "taobao";
        return products.slice(0, normalized.limit);
      } catch (error) {
        this.status = "error";
        throw asProductProviderError(error);
      }
    }
    const categories = normalized.category
      ? [normalized.category]
      : PRODUCT_CATEGORIES;
    try {
      const settled = await Promise.all(categories.map((category) =>
        this.#recommendRequirement({
          ...normalized,
          category,
          item_name: normalized.itemName || normalized.keyword || category,
          search_keywords: normalized.searchKeywords,
          negative_keywords: normalized.negativeKeywords,
        })));
      this.status = "taobao";
      return uniqueProducts(settled.flat()).slice(0, normalized.category
        ? Math.min(normalized.limit, 3)
        : 18);
    } catch (error) {
      this.status = "error";
      this.logger.warn?.("淘宝商品推荐失败", {
        requestId: normalized.requestId || undefined,
        provider: "taobao",
        search_keyword: normalized.searchKeywords[0] || normalized.keyword || undefined,
        gender: normalized.gender,
        category: normalized.category || undefined,
        errorCode: safeProviderCode(error),
      });
      throw asProductProviderError(error);
    }
  }

  async recommendForQueries(queries, context = {}) {
    const values = Array.isArray(queries) ? queries : [];
    if (values.length === 0) return [];
    if (values.length > 24) {
      throw new ProductProviderError("商品需求不能超过 8 项", {
        status: 400,
        code: "INVALID_PRODUCT_REQUIREMENTS",
      });
    }
    try {
      const groups = await Promise.all(values.map(async (query) => {
        const requirement = normalizeProductRequirement({...context, ...query}, context);
        const candidates = await this.#candidatePool({
          ...context,
          ...query,
          ...requirement,
          limit: 20,
        });
        return {requirement, candidates};
      }));
      const products = this.reranker
        ? await this.reranker.rerank({
          groups,
          context,
          requestId: context.requestId || "",
          selectionLimit: 6,
        })
        : groups.flatMap((group) => group.candidates.slice(0, 6));
      this.logger.info?.("AI最终选择", {
        requestId: context.requestId || undefined,
        provider: "taobao",
        selectedCount: products.length,
        looks: summarizeProductsByLook(products),
      });
      this.status = "taobao";
      return uniqueProducts(products).slice(0, values.length * 6);
    } catch (error) {
      this.status = "error";
      throw asProductProviderError(error);
    }
  }

  async #recommendRequirement(filters) {
    const targetLimit = Math.min(positiveInteger(filters.limit, 3), 6);
    const products = await this.#candidatePool({...filters, limit: 20});
    return products.slice(0, targetLimit);
  }

  async #candidatePool(filters) {
    const requirement = normalizeProductRequirement(filters, filters);
    const keywords = buildSearchKeywords(requirement);
    this.logger.info?.("淘宝商品搜索需求", {
      requestId: filters.requestId || undefined,
      look_id: requirement.look_id || undefined,
      search_requirement_gender: requirement.gender,
      search_keywords: keywords,
      category: requirement.category,
      item_name: requirement.item_name,
    });
    const candidateLimit = Math.min(positiveInteger(filters.limit, 20), 20);
    let products = [];
    for (const searchKeyword of keywords) {
      for (let pageNo = 1; pageNo <= 2; pageNo += 1) {
        const matches = await this.#search({
          ...filters,
          ...requirement,
          searchKeyword,
          pageNo,
          minimumRelevanceScore: 35,
          limit: 50,
        });
        products = uniqueProducts([...products, ...matches])
          .sort((left, right) => right.relevance_score - left.relevance_score);
        if (products.length >= candidateLimit || matches.length === 0) break;
      }
      if (products.length >= candidateLimit) break;
    }
    if (products.length < Math.min(candidateLimit, 4)) {
      const sampled = await this.#sample({
        ...filters,
        ...requirement,
        searchKeyword: keywords[0],
        limit: 20,
      });
      products = uniqueProducts([...products, ...sampled])
        .sort((left, right) => right.relevance_score - left.relevance_score);
    }
    const budget = Number(filters.budget);
    const hardFiltered = Number.isFinite(budget) && budget > 0
      ? products.filter((product) => Number(product.price) <= budget)
      : products;
    this.logger.info?.("淘宝返回候选", {
      requestId: filters.requestId || undefined,
      look_id: requirement.look_id || undefined,
      search_keyword: keywords[0],
      gender: requirement.gender,
      category: requirement.category,
      candidateCount: products.length,
      hardFilteredCount: hardFiltered.length,
    });
    return hardFiltered.slice(0, candidateLimit);
  }

  async #search(filters) {
    let payload;
    try {
      payload = await this.client.call(TAOBAO_MATERIAL_SEARCH_METHOD, {
        adzone_id: this.adzoneId,
        q: filters.searchKeyword || buildSearchKeyword(filters),
        page_no: String(filters.pageNo || 1),
        page_size: String(filters.limit),
        platform: "2",
        ...(filters.budget > 0 ? {end_price: String(filters.budget)} : {}),
      }, {
        requestId: filters.requestId || undefined,
        provider: "taobao",
        siteId: this.siteId,
      });
    } catch (error) {
      if (isEmptyTaobaoResult(error)) {
        this.logger.info?.("淘宝商品搜索无结果", {
          requestId: filters.requestId || undefined,
          provider: "taobao",
          search_keyword: filters.searchKeyword || buildSearchKeyword(filters),
          gender: normalizeGender(filters.gender),
          category: filters.category || undefined,
          errorCode: safeProviderCode(error),
        });
        return [];
      }
      this.logger.warn?.("淘宝商品搜索失败", {
        requestId: filters.requestId || undefined,
        provider: "taobao",
        search_keyword: filters.searchKeyword || buildSearchKeyword(filters),
        gender: normalizeGender(filters.gender),
        category: filters.category || undefined,
        errorCode: safeProviderCode(error),
      });
      throw error;
    }
    return mapPayload(payload, filters, this.pid, "search", (details) => {
      logMappingDiagnostics(this.logger, {
        requestId: filters.requestId || undefined,
        provider: "taobao",
        method: TAOBAO_MATERIAL_SEARCH_METHOD,
        ...details,
      });
    });
  }

  async #sample(filters) {
    let payload;
    try {
      payload = await this.client.call(TAOBAO_MATERIAL_SAMPLE_METHOD, {
        adzone_id: this.adzoneId,
        material_id: this.sampleMaterialId,
        page_no: "1",
        page_size: String(filters.limit),
      }, {
        requestId: filters.requestId || undefined,
        provider: "taobao",
        siteId: this.siteId,
      });
    } catch (error) {
      if (isEmptyTaobaoResult(error)) return [];
      throw error;
    }
    return mapPayload(payload, filters, this.pid, "sample", (details) => {
      logMappingDiagnostics(this.logger, {
        requestId: filters.requestId || undefined,
        provider: "taobao",
        method: TAOBAO_MATERIAL_SAMPLE_METHOD,
        ...details,
      });
    });
  }
}

class AutoProductProvider extends ProductProvider {
  constructor({
    taobao,
    mock = new MockProductProvider(),
    logger = console,
    allowMockFallback = true,
  }) {
    super();
    this.taobao = taobao;
    this.mock = mock;
    this.logger = logger;
    this.allowMockFallback = allowMockFallback;
    this.name = "auto";
    this.configured = true;
    this.status = "checking";
    this.health = null;
  }

  async recommend(filters = {}) {
    try {
      const products = await this.taobao.recommend(filters);
      this.health = true;
      this.status = "taobao";
      return products;
    } catch (error) {
      this.health = false;
      this.#logFallback(error, filters);
      if (!this.allowMockFallback) {
        this.status = "error";
        throw asProductProviderError(error);
      }
      this.status = "mock";
      return this.mock.recommend({
        ...filters,
        category: mockCompatibleCategory(filters.category),
      });
    }
  }

  async recommendForQueries(queries, context = {}) {
    try {
      const products = await this.taobao.recommendForQueries(queries, context);
      this.health = true;
      this.status = "taobao";
      return products;
    } catch (error) {
      this.health = false;
      const first = Array.isArray(queries) ? queries[0] || {} : {};
      this.#logFallback(error, {...context, ...first});
      if (!this.allowMockFallback) {
        this.status = "error";
        throw asProductProviderError(error);
      }
      this.status = "mock";
      const fallbackQueries = (Array.isArray(queries) ? queries : []).map((query) => ({
        ...query,
        category: mockCompatibleCategory(query?.category),
        keyword: query?.search_keywords?.[0] || query?.item_name || query?.keyword,
      }));
      return this.mock.recommendForQueries(fallbackQueries, context);
    }
  }

  #logFallback(error, filters = {}) {
    let searchKeyword = filters.search_keyword || filters.keyword;
    try {
      searchKeyword ||= buildSearchKeywords(filters)[0];
    } catch (_) {
      // Invalid filters are reported by the Mock provider after the safe log.
    }
    this.logger.warn?.(
      this.allowMockFallback ? "淘宝 Provider 降级 Mock" : "淘宝 Provider 请求失败",
      {
      requestId: filters.requestId || undefined,
      provider: "auto",
      search_keyword: searchKeyword || undefined,
      gender: normalizeGender(filters.gender),
      category: normalizeProductCategory(filters.category) || undefined,
      errorCode: safeProviderCode(error),
      },
    );
  }
}

function createProductProvider({
  environment = process.env,
  catalog,
  logger = console,
  client,
  reranker = null,
} = {}) {
  const mode = String(environment.PRODUCT_PROVIDER || "auto").trim().toLowerCase();
  if (!new Set(["mock", "taobao", "auto"]).has(mode)) {
    throw new ProductProviderError("PRODUCT_PROVIDER 必须为 mock、taobao 或 auto", {
      status: 500,
      code: "INVALID_PRODUCT_PROVIDER_MODE",
    });
  }
  const productCatalog = catalog || new ProductCatalog();
  const values = {
    appKey: String(environment.TAOBAO_APP_KEY || "").trim(),
    appSecret: String(environment.TAOBAO_APP_SECRET || "").trim(),
    pid: String(environment.TAOBAO_PID || "").trim(),
    adzoneId: String(environment.TAOBAO_ADZONE_ID || "").trim(),
  };
  const requiredVariables = {
    TAOBAO_APP_KEY: values.appKey,
    TAOBAO_APP_SECRET: values.appSecret,
    TAOBAO_PID: values.pid,
  };
  const missingVariables = Object.entries(requiredVariables)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  const configured = missingVariables.length === 0;
  const nodeEnvironment = String(
    environment.NODE_ENV || (environment.RENDER ? "production" : "development"),
  ).trim().toLowerCase();
  const allowMock = ["development", "test"].includes(nodeEnvironment) ||
    String(environment.MOCK_MODE || "").trim().toLowerCase() === "true";
  logger.info?.("淘宝 Provider 配置状态", {configured, mode});
  if (mode === "mock") {
    if (!allowMock) {
      logger.error?.("生产环境禁止 Mock 商品 Provider", {configured, mode});
      return new UnavailableProductProvider({
        message: "生产环境已禁用 Mock 商品数据",
        code: "PRODUCT_MOCK_DISABLED_IN_PRODUCTION",
      });
    }
    return new MockProductProvider({catalog: productCatalog});
  }
  if (!configured) {
    logger.warn?.("淘宝 Provider 未完整配置", {
      configured: false,
      missingVariables,
    });
    return new UnavailableProductProvider({missingVariables});
  }
  let taobao;
  try {
    taobao = new TaobaoProductProvider({
      ...values,
      client,
      catalog: productCatalog,
      endpoint: environment.TAOBAO_API_URL,
      connectTimeoutMs: positiveInteger(environment.TAOBAO_CONNECT_TIMEOUT_MS, 5_000),
      timeoutMs: positiveInteger(environment.PRODUCT_PROVIDER_TIMEOUT_MS, 12_000),
      maxRetries: positiveInteger(environment.TAOBAO_MAX_RETRIES, 1),
      sampleMaterialId: environment.TAOBAO_SAMPLE_MATERIAL_ID || DEFAULT_SAMPLE_MATERIAL_ID,
      reranker,
      logger,
    });
  } catch (error) {
    logger.error?.("淘宝推广位配置无效", {
      configured: true,
      errorCode: error instanceof ProductProviderError
        ? error.code
        : "TAOBAO_INVALID_PLACEMENT",
    });
    throw error;
  }
  if (mode === "taobao") return taobao;
  return new AutoProductProvider({
    taobao,
    mock: new MockProductProvider({catalog: productCatalog}),
    logger,
    allowMockFallback: allowMock,
  });
}

function normalizeFilters(filters = {}) {
  const text = (value, field) => {
    if (value == null || value === "") return "";
    if (typeof value !== "string" || value.trim().length > 100) {
      throw new ProductProviderError(`${field} 参数无效`, {status: 400, code: "INVALID_PRODUCT_FILTER"});
    }
    return value.trim();
  };
  const requestedLimit = Number(filters.limit);
  return {
    category: canonicalCategory(text(filters.category, "category")) ||
      normalizeProductCategory(text(filters.category, "category")),
    style: text(filters.style, "style"),
    color: text(filters.color, "color"),
    bodyType: text(filters.bodyType, "bodyType"),
    scene: text(filters.scene, "scene"),
    gender: normalizeGender(text(filters.gender, "gender")),
    fit: text(filters.fit, "fit"),
    season: text(filters.season, "season"),
    requestId: text(filters.requestId, "requestId"),
    lookId: text(filters.look_id ?? filters.lookId, "look_id"),
    budget: optionalNumber(filters.budget) || 0,
    keyword: text(filters.keyword, "keyword"),
    itemName: text(filters.item_name ?? filters.itemName, "item_name"),
    material: text(filters.material, "material"),
    searchKeywords: normalizeFilterList(
      filters.search_keywords ?? filters.searchKeywords,
      "search_keywords",
      3,
    ),
    negativeKeywords: normalizeFilterList(
      filters.negative_keywords ?? filters.negativeKeywords,
      "negative_keywords",
      30,
    ),
    limit: Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 20) : 2,
  };
}

function buildSearchKeyword(filters) {
  const categoryNames = {
    top: "上衣", bottom: "裤子 裙子", shoes: "鞋", outerwear: "外套", accessories: "配饰",
  };
  return [filters.gender, filters.scene, filters.style, categoryNames[filters.category],
    filters.color, filters.season, filters.fit, filters.keyword].filter(Boolean).join(" ") || "服饰";
}

function normalizeFilterList(value, field, limit) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > limit) {
    throw new ProductProviderError(`${field} 参数无效`, {
      status: 400,
      code: "INVALID_PRODUCT_FILTER",
    });
  }
  return value.map((entry) => {
    if (typeof entry !== "string" || !entry.trim() || entry.trim().length > 160) {
      throw new ProductProviderError(`${field} 参数无效`, {
        status: 400,
        code: "INVALID_PRODUCT_FILTER",
      });
    }
    return entry.trim();
  });
}

function mockCompatibleCategory(value) {
  const category = normalizeProductCategory(value) || canonicalCategory(value);
  if (["bag", "hat", "accessory"].includes(category)) return "accessories";
  if (category === "dress") return "top";
  return category;
}

function extractTaobaoItems(payload) {
  const response = payload?.tbk_dg_material_optional_upgrade_response ||
    payload?.tbkDgMaterialOptionalUpgradeResponse ||
    payload?.tbk_dg_material_optional_response ||
    payload?.tbkDgMaterialOptionalResponse ||
    payload?.tbk_dg_material_recommend_response ||
    payload?.tbkDgMaterialRecommendResponse || {};
  const resultList = response.result_list || response.resultList || response.results || {};
  const raw = resultList.map_data || resultList.mapData || resultList.items ||
    response.map_data || response.mapData || [];
  return Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
}

function mapPayload(payload, filters, pid, origin, onDiagnostics) {
  const rawItems = extractTaobaoItems(payload);
  const mapped = rawItems.map((item) => {
    try {
      return mapTaobaoProduct(item, {pid, fallbackCategory: filters.category, filters, origin});
    } catch (_) {
      return null;
    }
  }).filter(Boolean);
  const usable = mapped.filter(isUsableTaobaoProduct);
  const products = filters.category
    ? rankProducts(
      usable,
      filters,
      filters.searchKeyword || filters.keyword,
      {minimumScore: filters.minimumRelevanceScore},
    )
    : usable.map((product) => {
      const {_category_text: _, ...publicProduct} = product;
      return {
        ...publicProduct,
        gender: normalizeGender(filters.gender),
        search_keyword: filters.searchKeyword || filters.keyword || "",
        relevance_score: 0,
      };
    });
  onDiagnostics?.({
    origin,
    ...safeTaobaoResponseShape(payload),
    rawCount: rawItems.length,
    mappedCount: mapped.length,
    usableCount: products.length,
    missingImageCount: mapped.filter((product) => !normalizePublicImageUrl(product.image_url)).length,
    missingPriceCount: mapped.filter((product) => !(Number(product.price) > 0)).length,
    missingPromotionUrlCount: mapped.filter(
      (product) => !normalizeHttpsUrl(product.purchase_url),
    ).length,
    categoryMismatchCount: Math.max(usable.length - products.length, 0),
  });
  return products;
}

function safeTaobaoResponseShape(payload) {
  const rootKey = Object.keys(payload || {}).find((key) => /response$/i.test(key)) || "";
  const response = rootKey && payload[rootKey] && typeof payload[rootKey] === "object"
    ? payload[rootKey]
    : {};
  const resultList = response.result_list || response.resultList || response.results;
  return {
    responseRoot: rootKey,
    responseKeys: Object.keys(response).sort().slice(0, 20),
    resultListType: Array.isArray(resultList) ? "array" : typeof resultList,
    resultListKeys: resultList && typeof resultList === "object" && !Array.isArray(resultList)
      ? Object.keys(resultList).sort().slice(0, 20)
      : [],
    totalResults: firstNumber(response.total_results, response.totalResults) ?? null,
  };
}

function mapTaobaoProduct(item, {pid, fallbackCategory = "", filters = {}, origin = "search"} = {}) {
  const basic = item.item_basic_info || item.itemBasicInfo || item;
  const priceInfo = item.price_promotion_info || item.pricePromotionInfo || item;
  const publish = item.publish_info || item.publishInfo || item;
  const income = publish.income_info || publish.incomeInfo || publish;
  const productId = firstText(basic.item_id, basic.itemId, item.item_id, item.itemId);
  if (!productId) throw new ProductProviderError("淘宝商品缺少 item_id");
  const title = firstText(basic.short_title, basic.title, item.short_title, item.title);
  if (!title) throw new ProductProviderError("淘宝商品缺少标题");
  const couponUrl = firstHttps(
    publish.coupon_share_url, publish.couponShareUrl,
    publish.coupon_click_url, publish.couponClickUrl,
    item.coupon_share_url, item.couponShareUrl,
    item.coupon_click_url, item.couponClickUrl,
  );
  const affiliateUrl = firstHttps(
    publish.click_url, publish.clickUrl,
    publish.item_url, publish.itemUrl,
    item.click_url, item.clickUrl,
    item.url,
    couponUrl,
  );
  const purchaseUrl = couponUrl || affiliateUrl;
  const rawCategory = firstText(
    basic.category_name, basic.level_one_category_name, item.category_name,
    item.level_one_category_name, fallbackCategory,
  );
  const category = normalizeProductCategory(`${rawCategory} ${title}`) ||
    normalizeProductCategory(fallbackCategory) ||
    canonicalCategory(`${rawCategory} ${title}`) ||
    canonicalCategory(fallbackCategory) ||
    "top";
  const price = firstNumber(
    priceInfo.final_promotion_price, priceInfo.price_after_coupon,
    item.final_promotion_price, item.price_after_coupon, basic.zk_final_price,
    item.zk_final_price, basic.reserve_price, item.reserve_price,
  ) ?? 0;
  const originalPrice = firstNumber(priceInfo.reserve_price, basic.reserve_price, item.reserve_price);
  const commissionRate = normalizeCommissionRate(firstNumber(income.commission_rate, item.commission_rate));
  return compact({
    product_id: productId,
    source: "taobao",
    title,
    _category_text: `${rawCategory} ${title}`.trim(),
    brand: firstText(basic.brand_name, item.brand_name),
    category,
    price,
    image_url: firstPublicImageUrl(
      basic.pict_url,
      basic.white_image,
      item.pict_url,
      item.white_image,
    ),
    original_price: originalPrice != null && originalPrice > price ? originalPrice : null,
    coupon_amount: firstNumber(priceInfo.coupon_amount, item.coupon_amount) ?? null,
    shop_name: firstText(basic.shop_title, basic.seller_nick, item.shop_title, item.seller_nick),
    sales: firstText(
      basic.annual_vol,
      basic.volume,
      item.annual_vol,
      item.volume,
      item.tk_total_sales,
    ) || undefined,
    recommendation_reason: buildRecommendationReason(filters),
    match_explanation: buildMatchExplanation(filters),
    detail_url: firstHttps(basic.item_url, basic.itemUrl, item.item_url, item.itemUrl),
    purchase_url: purchaseUrl,
    platform: "taobao",
    commission_rate: commissionRate ?? null,
    affiliate_url: affiliateUrl,
    stock_status: "unknown",
    pid,
    coupon_url: couponUrl,
    is_mock: false,
    tags: [filters.style, filters.color, filters.keyword, origin].filter(Boolean),
  });
}

function buildRecommendationReason(filters = {}) {
  const values = [filters.style, filters.scene, filters.category].filter(Boolean);
  return values.length ? `根据本次${values.join("、")}穿搭方案匹配` : "根据当前 AI 穿搭方案匹配";
}

function buildMatchExplanation(filters = {}) {
  const values = [filters.gender, filters.color, filters.season, filters.fit, filters.keyword].filter(Boolean);
  return values.length ? `匹配需求：${values.join("、")}` : "匹配当前穿搭品类与风格";
}

function normalizeCommissionRate(value) {
  if (value == null) return undefined;
  if (value > 100) return Math.min(value / 10_000, 1);
  if (value > 1) return Math.min(value / 100, 1);
  return Math.min(Math.max(value, 0), 1);
}

function firstNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (value !== "" && value != null && Number.isFinite(number) && number >= 0) return number;
  }
  return undefined;
}

function optionalNumber(value) {
  return firstNumber(value);
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function firstHttps(...values) {
  for (const value of values) {
    const normalized = normalizeHttpsUrl(value);
    if (normalized) return normalized;
  }
  return "";
}

function firstPublicImageUrl(...values) {
  for (const value of values) {
    const normalized = normalizePublicImageUrl(value);
    if (normalized) return normalized;
  }
  return "";
}

function normalizePublicImageUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const candidate = text.startsWith("//") ? `https:${text}` : text;
  try {
    const url = new URL(candidate);
    if (!["http:", "https:"].includes(url.protocol) || !isPublicHost(url.hostname)) {
      return "";
    }
    return url.toString();
  } catch (_) {
    return "";
  }
}

function isPublicHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host === "::1") {
    return false;
  }
  const parts = host.split(".").map(Number);
  if (parts.length === 4 && parts.every(Number.isInteger)) {
    const [first, second] = parts;
    return first !== 0 &&
      first !== 10 &&
      first !== 127 &&
      !(first === 169 && second === 254) &&
      !(first === 172 && second >= 16 && second <= 31) &&
      !(first === 192 && second === 168);
  }
  return true;
}

function normalizeHttpsUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const candidate = text.startsWith("//") ? `https:${text}` : text;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" && url.host ? url.toString() : "";
  } catch (_) {
    return "";
  }
}

function compact(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

function isUsableTaobaoProduct(product) {
  return product?.source === "taobao" &&
    product?.is_mock === false &&
    Boolean(product.product_id) &&
    Boolean(product.title) &&
    Number(product.price) > 0 &&
    Boolean(normalizePublicImageUrl(product.image_url)) &&
    Boolean(normalizeHttpsUrl(product.purchase_url));
}

function logMappingDiagnostics(logger, details) {
  logger.info?.(`淘宝商品映射诊断 ${JSON.stringify(details)}`);
}

function uniqueProducts(products) {
  const seen = new Set();
  return products.filter((product) => {
    const id = product?.product_id || product?.id;
    const key = `${product?.look_id || ""}:${id || ""}`;
    if (!id || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function summarizeProductsByLook(products) {
  const counts = {};
  for (const product of products) {
    const lookId = String(product?.look_id || "unbound");
    counts[lookId] = (counts[lookId] || 0) + 1;
  }
  return counts;
}

function requireConfig(value, field) {
  const text = String(value || "").trim();
  if (!text) throw new ProductProviderError(`${field} 未配置`, {status: 503, code: "PRODUCT_PROVIDER_NOT_CONFIGURED"});
  return text;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function parseTaobaoPlacement(pid, adzoneIdOverride = "") {
  const normalizedPid = requireConfig(pid, "TAOBAO_PID");
  const match = /^mm_(\d+)_(\d+)_(\d+)$/.exec(normalizedPid);
  if (!match) {
    throw new ProductProviderError(
      "TAOBAO_PID 格式无效，应为 mm_accountId_siteId_adzoneId",
      {status: 500, code: "TAOBAO_INVALID_PID"},
    );
  }
  const siteId = match[2];
  const pidAdzoneId = match[3];
  const override = String(adzoneIdOverride || "").trim();
  if (override && !/^\d+$/.test(override)) {
    throw new ProductProviderError("TAOBAO_ADZONE_ID 格式无效", {
      status: 500,
      code: "TAOBAO_INVALID_ADZONE_ID",
    });
  }
  if (override && override !== pidAdzoneId) {
    throw new ProductProviderError(
      "TAOBAO_ADZONE_ID 必须与 TAOBAO_PID 最后一段一致",
      {status: 500, code: "TAOBAO_PID_ADZONE_MISMATCH"},
    );
  }
  return {siteId, adzoneId: override || pidAdzoneId};
}

function safeProviderCode(error) {
  if (error instanceof TaobaoApiError || error instanceof ProductProviderError) return error.code;
  return "TAOBAO_UNKNOWN_ERROR";
}

function isEmptyTaobaoResult(error) {
  return error instanceof TaobaoApiError &&
    error.details?.taobao_error_code === "15" &&
    error.details?.taobao_sub_code === "50001";
}

function asProductProviderError(error) {
  if (error instanceof ProductProviderError) return error;
  return new ProductProviderError("淘宝商品接口请求失败", {
    status: 502,
    code: safeProviderCode(error),
    cause: error,
  });
}

module.exports = {
  AutoProductProvider,
  MockProductProvider,
  ProductProvider,
  ProductProviderError,
  TaobaoProductProvider,
  UnavailableProductProvider,
  createProductProvider,
  extractTaobaoItems,
  mapTaobaoProduct,
  normalizeHttpsUrl,
  normalizePublicImageUrl,
  parseTaobaoPlacement,
  safeTaobaoResponseShape,
  signTaobaoRequest,
};
