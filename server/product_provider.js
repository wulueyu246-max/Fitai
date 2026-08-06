const {ProductCatalog, canonicalCategory} = require("./product_catalog");
const {
  TAOBAO_MATERIAL_SAMPLE_METHOD,
  TAOBAO_MATERIAL_SEARCH_METHOD,
  TaobaoApiClient,
  TaobaoApiError,
  signTaobaoRequest,
} = require("./taobao_client");

const PRODUCT_CATEGORIES = Object.freeze([
  "top", "bottom", "shoes", "outerwear", "accessories",
]);
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
    logger = console,
  }) {
    super();
    this.pid = requireConfig(pid, "TAOBAO_PID");
    this.adzoneId = requireConfig(adzoneId, "TAOBAO_ADZONE_ID");
    this.sampleMaterialId = String(sampleMaterialId || DEFAULT_SAMPLE_MATERIAL_ID);
    this.logger = logger;
    this.mock = new MockProductProvider({catalog});
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
    const categories = normalized.category
      ? [normalized.category]
      : PRODUCT_CATEGORIES;
    const settled = await Promise.all(categories.map(async (category) => {
      const scoped = {...normalized, category, limit: Math.min(normalized.limit, 2)};
      try {
        let products = await this.#search(scoped);
        if (products.length < scoped.limit) {
          const sampled = await this.#sample(scoped);
          products = uniqueProducts([...products, ...sampled]);
        }
        return products.slice(0, scoped.limit);
      } catch (error) {
        this.logger.warn?.("淘宝分类商品降级", {
          category,
          errorCode: safeProviderCode(error),
        });
        return this.#mockFallback(scoped);
      }
    }));
    return uniqueProducts(settled.flat()).slice(0, normalized.category ? normalized.limit : 10);
  }

  async #search(filters) {
    const payload = await this.client.call(TAOBAO_MATERIAL_SEARCH_METHOD, {
      adzone_id: this.adzoneId,
      q: buildSearchKeyword(filters),
      page_no: "1",
      page_size: String(filters.limit),
      platform: "2",
      ...(filters.budget > 0 ? {end_price: String(Math.round(filters.budget * 100))} : {}),
    });
    return mapPayload(payload, filters, this.pid, "search");
  }

  async #sample(filters) {
    const payload = await this.client.call(TAOBAO_MATERIAL_SAMPLE_METHOD, {
      adzone_id: this.adzoneId,
      material_id: this.sampleMaterialId,
      page_no: "1",
      page_size: String(filters.limit),
    });
    return mapPayload(payload, filters, this.pid, "sample");
  }

  async #mockFallback(filters) {
    return (await this.mock.recommend(filters)).slice(0, filters.limit);
  }
}

class AutoProductProvider extends ProductProvider {
  constructor({taobao, logger = console}) {
    super();
    this.taobao = taobao;
    this.logger = logger;
    this.name = "auto";
    this.configured = true;
    this.status = "checking";
    this.health = null;
  }

  async recommend(filters = {}) {
    const products = await this.taobao.recommend(filters);
    const hasTaobaoProducts = products.some((product) => product?.source === "taobao");
    this.health = hasTaobaoProducts || products.length === 0;
    this.status = this.health ? "taobao" : "mock";
    return products;
  }
}

function createProductProvider({environment = process.env, catalog, logger = console, client} = {}) {
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
    TAOBAO_ADZONE_ID: values.adzoneId,
  };
  const missingVariables = Object.entries(requiredVariables)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  const configured = missingVariables.length === 0;
  logger.info?.("淘宝 Provider 配置状态", {configured, mode});
  if (mode === "mock" || !configured) {
    if (mode !== "mock") {
      logger.warn?.("淘宝 Provider 未完整配置，使用 Mock", {
        configured: false,
        missingVariables,
      });
    }
    return new MockProductProvider({catalog: productCatalog});
  }
  const placementError = validatePlacement(values.pid, values.adzoneId);
  if (placementError) {
    logger.warn?.("淘宝推广位配置无效，使用 Mock", {
      configured: true,
      errorCode: placementError,
    });
    return new MockProductProvider({catalog: productCatalog});
  }
  const taobao = new TaobaoProductProvider({
    ...values,
    client,
    catalog: productCatalog,
    endpoint: environment.TAOBAO_API_URL,
    connectTimeoutMs: positiveInteger(environment.TAOBAO_CONNECT_TIMEOUT_MS, 5_000),
    timeoutMs: positiveInteger(environment.PRODUCT_PROVIDER_TIMEOUT_MS, 12_000),
    maxRetries: positiveInteger(environment.TAOBAO_MAX_RETRIES, 1),
    sampleMaterialId: environment.TAOBAO_SAMPLE_MATERIAL_ID || DEFAULT_SAMPLE_MATERIAL_ID,
    logger,
  });
  if (mode === "taobao") return taobao;
  return new AutoProductProvider({
    taobao,
    logger,
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
    category: canonicalCategory(text(filters.category, "category")),
    style: text(filters.style, "style"),
    color: text(filters.color, "color"),
    bodyType: text(filters.bodyType, "bodyType"),
    scene: text(filters.scene, "scene"),
    gender: text(filters.gender, "gender"),
    fit: text(filters.fit, "fit"),
    season: text(filters.season, "season"),
    budget: optionalNumber(filters.budget) || 0,
    keyword: text(filters.keyword, "keyword"),
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

function extractTaobaoItems(payload) {
  const response = payload?.tbk_dg_material_optional_upgrade_response ||
    payload?.tbk_dg_material_optional_response ||
    payload?.tbk_dg_material_recommend_response || {};
  const raw = response.result_list?.map_data || response.result_list?.mapData ||
    response.result_list || response.results?.map_data || [];
  return Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
}

function mapPayload(payload, filters, pid, origin) {
  return extractTaobaoItems(payload).map((item) => {
    try {
      return mapTaobaoProduct(item, {pid, fallbackCategory: filters.category, filters, origin});
    } catch (_) {
      return null;
    }
  }).filter((product) => product && (
    !filters.category || product.category === filters.category
  ));
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
  const category = canonicalCategory(`${rawCategory} ${title}`) || canonicalCategory(fallbackCategory) || "top";
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
    brand: firstText(basic.brand_name, item.brand_name),
    category,
    price,
    image_url: firstHttps(basic.pict_url, basic.white_image, item.pict_url, item.white_image),
    original_price: originalPrice != null && originalPrice > price ? originalPrice : undefined,
    coupon_amount: firstNumber(priceInfo.coupon_amount, item.coupon_amount),
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
    commission_rate: commissionRate,
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
  return Object.fromEntries(Object.entries(object).filter(([, value]) =>
    value !== undefined && value !== null));
}

function uniqueProducts(products) {
  const seen = new Set();
  return products.filter((product) => {
    const id = product?.product_id || product?.id;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
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

function validatePlacement(pid, adzoneId) {
  if (!/^\d+$/.test(adzoneId)) return "TAOBAO_INVALID_ADZONE_ID";
  const pidParts = pid.split("_").filter(Boolean);
  const pidAdzoneId = pidParts.length > 1 ? pidParts.at(-1) : "";
  if (pidAdzoneId && /^\d+$/.test(pidAdzoneId) && pidAdzoneId !== adzoneId) {
    return "TAOBAO_PID_ADZONE_MISMATCH";
  }
  return null;
}

function safeProviderCode(error) {
  if (error instanceof TaobaoApiError || error instanceof ProductProviderError) return error.code;
  return "TAOBAO_UNKNOWN_ERROR";
}

module.exports = {
  AutoProductProvider,
  MockProductProvider,
  ProductProvider,
  ProductProviderError,
  TaobaoProductProvider,
  createProductProvider,
  extractTaobaoItems,
  mapTaobaoProduct,
  normalizeHttpsUrl,
  signTaobaoRequest,
};
