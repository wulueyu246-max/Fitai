const crypto = require("crypto");

const {ProductCatalog, canonicalCategory} = require("./product_catalog");

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
    const batches = await Promise.all(
      (Array.isArray(queries) ? queries : []).map((query) => this.recommend({
        category: query.category,
        style: query.style || context.style,
        color: context.color,
        bodyType: context.bodyType,
        scene: context.scene,
        gender: context.gender,
        fit: context.fit,
        season: context.season,
        budget: context.budget,
        keyword: query.keyword,
        limit: 3,
      })),
    );
    const matched = new Map();
    for (const product of batches.flat()) {
      if (!matched.has(product.product_id)) {
        matched.set(product.product_id, product);
      }
    }
    return [...matched.values()].slice(0, 12);
  }
}

class MockProductProvider extends ProductProvider {
  constructor({catalog = new ProductCatalog()} = {}) {
    super();
    this.catalog = catalog;
    this.name = "mock";
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
    endpoint = "https://eco.taobao.com/router/rest",
    method = "taobao.tbk.dg.material.optional.upgrade",
    fetchImpl = fetch,
    timeoutMs = 10_000,
  }) {
    super();
    this.appKey = requireConfig(appKey, "TAOBAO_APP_KEY");
    this.appSecret = requireConfig(appSecret, "TAOBAO_APP_SECRET");
    this.pid = String(pid || "").trim();
    this.endpoint = requireHttpsUrl(endpoint, "TAOBAO_API_URL");
    this.method = requireConfig(method, "TAOBAO_API_METHOD");
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.name = "taobao";
  }

  async recommend(filters = {}) {
    const normalized = normalizeFilters(filters);
    const params = {
      app_key: this.appKey,
      format: "json",
      method: this.method,
      sign_method: "md5",
      simplify: "true",
      timestamp: taobaoTimestamp(),
      v: "2.0",
      page_size: String(normalized.limit),
      platform: "2",
      q: [
        normalized.category,
        normalized.style,
        normalized.color,
        normalized.bodyType,
        normalized.keyword,
      ].filter(Boolean).join(" ") || "服装",
      ...(this.pid ? {adzone_id: adzoneIdFromPid(this.pid)} : {}),
    };
    params.sign = signTaobaoRequest(params, this.appSecret);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    timer.unref?.();
    let response;
    try {
      response = await this.fetch(this.endpoint, {
        method: "POST",
        headers: {"content-type": "application/x-www-form-urlencoded"},
        body: new URLSearchParams(params).toString(),
        signal: controller.signal,
      });
    } catch (error) {
      throw new ProductProviderError("淘宝联盟商品请求失败", {cause: error});
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new ProductProviderError(
        `淘宝联盟商品请求失败（HTTP ${response.status}）`,
      );
    }
    const payload = await response.json();
    if (payload.error_response) {
      throw new ProductProviderError(
        String(payload.error_response.sub_msg ||
          payload.error_response.msg || "淘宝联盟返回错误"),
        {
          status: 502,
          code: String(payload.error_response.code || "TAOBAO_API_ERROR"),
        },
      );
    }
    return extractTaobaoItems(payload)
      .slice(0, normalized.limit)
      .map((item) => mapTaobaoProduct(item, {
        pid: this.pid,
        fallbackCategory: normalized.category,
        filters: normalized,
      }));
  }
}

function createProductProvider({
  environment = process.env,
  catalog,
  logger = console,
} = {}) {
  const requested = String(environment.PRODUCT_PROVIDER || "auto")
    .trim()
    .toLowerCase();
  const credentials = {
    appKey: String(environment.TAOBAO_APP_KEY || "").trim(),
    appSecret: String(environment.TAOBAO_APP_SECRET || "").trim(),
    pid: String(environment.TAOBAO_PID || "").trim(),
  };
  const configured = Boolean(
    credentials.appKey && credentials.appSecret && credentials.pid,
  );
  if (requested !== "mock" && configured) {
    return new TaobaoProductProvider({
      ...credentials,
      endpoint: environment.TAOBAO_API_URL || undefined,
      method: environment.TAOBAO_API_METHOD || undefined,
      timeoutMs: positiveInteger(environment.PRODUCT_PROVIDER_TIMEOUT_MS, 10_000),
    });
  }
  if (requested !== "mock") {
    logger.warn?.(
      "淘宝联盟凭证未完整配置，商品服务使用 Mock Provider；需要 TAOBAO_APP_KEY、TAOBAO_APP_SECRET、TAOBAO_PID。",
    );
  }
  return new MockProductProvider({catalog: catalog || new ProductCatalog()});
}

function normalizeFilters(filters) {
  const text = (value, field) => {
    if (value == null || value === "") return "";
    if (typeof value !== "string" || value.trim().length > 100) {
      throw new ProductProviderError(`${field} 参数无效`, {
        status: 400,
        code: "INVALID_PRODUCT_FILTER",
      });
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
    budget: nonNegativeNumber(filters.budget),
    keyword: text(filters.keyword, "keyword"),
    limit: Number.isInteger(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 20)
      : 12,
  };
}

function signTaobaoRequest(params, appSecret) {
  const content = Object.keys(params)
    .filter((key) => key !== "sign")
    .sort()
    .map((key) => `${key}${params[key]}`)
    .join("");
  return crypto
    .createHash("md5")
    .update(`${appSecret}${content}${appSecret}`, "utf8")
    .digest("hex")
    .toUpperCase();
}

function extractTaobaoItems(payload) {
  const response = payload.tbk_dg_material_optional_upgrade_response ||
    payload.tbk_dg_material_optional_response || {};
  const raw = response.result_list?.map_data ||
    response.result_list?.mapData || [];
  if (Array.isArray(raw)) return raw;
  return raw && typeof raw === "object" ? [raw] : [];
}

function mapTaobaoProduct(item, {pid, fallbackCategory = "", filters = {}}) {
  const productId = String(item.item_id || item.itemId || "").trim();
  if (!productId) {
    throw new ProductProviderError("淘宝联盟商品缺少 item_id");
  }
  const detailUrl = normalizeHttpsUrl(
    item.item_url || item.url ||
      `https://item.taobao.com/item.htm?id=${encodeURIComponent(productId)}`,
  );
  const couponUrl = normalizeHttpsUrl(
    item.coupon_share_url || item.coupon_click_url || "",
  );
  const affiliateUrl = normalizeHttpsUrl(
    item.click_url || item.clickUrl || couponUrl,
  );
  const rawCategory = String(
    item.category_name || item.level_one_category_name || fallbackCategory || "",
  ).trim();
  const category = canonicalCategory(`${rawCategory} ${item.title || ""}`) ||
    canonicalCategory(fallbackCategory) || "top";
  return {
    product_id: productId,
    source: "taobao",
    title: String(item.short_title || item.title || "淘宝精选商品").trim(),
    brand: String(item.brand_name || item.shop_title || "淘宝精选").trim(),
    category,
    price: nonNegativeNumber(
      item.price_after_coupon || item.zk_final_price || item.reserve_price,
    ),
    image_url: normalizeHttpsUrl(item.pict_url || item.white_image || ""),
    original_price: nonNegativeNumber(
      item.reserve_price || item.zk_final_price || item.price_after_coupon,
    ),
    coupon_amount: nonNegativeNumber(item.coupon_amount),
    shop_name: String(item.shop_title || item.seller_nick || "").trim(),
    recommendation_reason: buildRecommendationReason(filters),
    match_explanation: buildMatchExplanation(filters),
    detail_url: detailUrl,
    purchase_url: affiliateUrl,
    platform: "taobao",
    commission_rate: normalizeCommissionRate(item.commission_rate),
    affiliate_url: affiliateUrl,
    stock_status: "in_stock",
    pid,
    coupon_url: couponUrl,
    is_mock: false,
    tags: [filters.style, filters.color, filters.keyword].filter(Boolean),
  };
}

function buildRecommendationReason(filters = {}) {
  const style = String(filters.style || "").trim();
  const category = String(filters.category || "").trim();
  return [style, category].filter(Boolean).length > 0
    ? `根据你的${style || "当前"}穿搭方案推荐${category || "该商品"}`
    : "根据当前 AI 穿搭方案推荐";
}

function buildMatchExplanation(filters = {}) {
  const values = [filters.color, filters.bodyType, filters.keyword]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return values.length > 0
    ? `匹配需求：${values.join("、")}`
    : "匹配当前穿搭品类与风格";
}

function normalizeCommissionRate(value) {
  const rate = nonNegativeNumber(value);
  if (rate > 100) return Math.min(rate / 10_000, 1);
  if (rate > 1) return Math.min(rate / 100, 1);
  return Math.min(rate, 1);
}

function nonNegativeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeHttpsUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const candidate = text.startsWith("//") ? `https:${text}` : text;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" ? url.toString() : "";
  } catch (_) {
    return "";
  }
}

function adzoneIdFromPid(pid) {
  const parts = pid.split("_").filter(Boolean);
  return parts.at(-1) || pid;
}

function taobaoTimestamp(now = new Date()) {
  const chinaTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return chinaTime.toISOString().slice(0, 19).replace("T", " ");
}

function requireConfig(value, field) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new ProductProviderError(`${field} 未配置`, {
      status: 503,
      code: "PRODUCT_PROVIDER_NOT_CONFIGURED",
    });
  }
  return normalized;
}

function requireHttpsUrl(value, field) {
  const normalized = requireConfig(value, field);
  let url;
  try {
    url = new URL(normalized);
  } catch (error) {
    throw new ProductProviderError(`${field} 不是有效地址`, {
      status: 500,
      code: "INVALID_PRODUCT_PROVIDER_CONFIG",
      cause: error,
    });
  }
  if (url.protocol !== "https:") {
    throw new ProductProviderError(`${field} 必须使用 HTTPS`, {
      status: 500,
      code: "INVALID_PRODUCT_PROVIDER_CONFIG",
    });
  }
  return url.toString();
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

module.exports = {
  MockProductProvider,
  ProductProvider,
  ProductProviderError,
  TaobaoProductProvider,
  createProductProvider,
  mapTaobaoProduct,
  normalizeHttpsUrl,
  signTaobaoRequest,
};
