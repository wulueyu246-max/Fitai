const crypto = require("crypto");

const RAW_TAOBAO_PRODUCT_SCHEMA_VERSION = "raw_taobao_product_v1";
const RAW_TAOBAO_FIXTURE_SCHEMA_VERSION = "raw_taobao_product_probe_v1";

function buildRawTaobaoProduct(item, {query = "", observedAt = new Date().toISOString()} = {}) {
  const source = objectValue(item);
  const basic = objectValue(source.item_basic_info || source.itemBasicInfo || source);
  const price = objectValue(source.price_promotion_info || source.pricePromotionInfo || source);
  const publish = objectValue(source.publish_info || source.publishInfo || source);
  const income = objectValue(publish.income_info || publish.incomeInfo || publish);

  return deepFreeze({
    schema_version: RAW_TAOBAO_PRODUCT_SCHEMA_VERSION,
    source: "taobao",
    query: safeText(query),
    identity: {
      item_id: safeText(firstDefined(basic.item_id, basic.itemId, source.item_id, source.itemId)),
    },
    text: {
      title: safeText(firstDefined(basic.title, source.title)),
      short_title: safeText(firstDefined(basic.short_title, basic.shortTitle, source.short_title)),
    },
    category: {
      category_id: safeText(firstDefined(basic.category_id, basic.categoryId, source.category_id)),
      category_name: safeText(firstDefined(basic.category_name, basic.categoryName, source.category_name)),
      level_one_category_id: safeText(firstDefined(
        basic.level_one_category_id,
        basic.levelOneCategoryId,
        source.level_one_category_id,
      )),
      level_one_category_name: safeText(firstDefined(
        basic.level_one_category_name,
        basic.levelOneCategoryName,
        source.level_one_category_name,
      )),
    },
    pricing: {
      price: safeNumber(firstDefined(
        price.final_promotion_price,
        price.finalPromotionPrice,
        price.zk_final_price,
        price.zkFinalPrice,
        basic.zk_final_price,
        source.zk_final_price,
      )),
      original_price: safeNumber(firstDefined(
        price.reserve_price,
        price.reservePrice,
        basic.reserve_price,
        source.reserve_price,
      )),
      zk_final_price: safeNumber(firstDefined(price.zk_final_price, basic.zk_final_price, source.zk_final_price)),
      reserve_price: safeNumber(firstDefined(price.reserve_price, basic.reserve_price, source.reserve_price)),
    },
    sales_evidence: {
      annual_vol: safeNumber(firstDefined(basic.annual_vol, basic.annualVol, source.annual_vol)),
      volume: safeNumber(firstDefined(basic.volume, source.volume)),
      tk_total_sales: safeNumber(firstDefined(
        basic.tk_total_sales,
        basic.tkTotalSales,
        source.tk_total_sales,
      )),
    },
    media: {
      white_image: sanitizeUrl(firstDefined(basic.white_image, basic.whiteImage, source.white_image)),
      pict_url: sanitizeUrl(firstDefined(basic.pict_url, basic.pictUrl, source.pict_url)),
      small_images: sanitizeImageList(firstDefined(basic.small_images, basic.smallImages, source.small_images)),
    },
    commerce: {
      item_url: sanitizeUrl(firstDefined(basic.item_url, basic.itemUrl, source.item_url, source.url)),
      shop_title: safeText(firstDefined(basic.shop_title, basic.shopTitle, source.shop_title)),
      seller_nick: safeText(firstDefined(basic.seller_nick, basic.sellerNick, source.seller_nick)),
      brand_name: safeText(firstDefined(basic.brand_name, basic.brandName, source.brand_name)),
    },
    promotion: {
      coupon_amount: safeNumber(firstDefined(price.coupon_amount, price.couponAmount, source.coupon_amount)),
      coupon_start_fee: safeNumber(firstDefined(price.coupon_start_fee, price.couponStartFee)),
      coupon_total_count: safeNumber(firstDefined(price.coupon_total_count, price.couponTotalCount)),
      coupon_remain_count: safeNumber(firstDefined(price.coupon_remain_count, price.couponRemainCount)),
      commission_rate: safeNumber(firstDefined(income.commission_rate, income.commissionRate)),
      commission_amount: safeNumber(firstDefined(income.commission_amount, income.commissionAmount)),
      publish_info_present: Object.keys(publish).length > 0,
    },
    observed_at: safeIsoDate(observedAt),
  });
}

function createSanitizedRawFixture({products = [], queries = [], capturedAt = new Date().toISOString()} = {}) {
  const fixture = {
    schema_version: RAW_TAOBAO_FIXTURE_SCHEMA_VERSION,
    captured_at: safeIsoDate(capturedAt),
    source: "taobao_protected_probe",
    queries: (Array.isArray(queries) ? queries : []).map((entry) => ({
      query: safeText(entry?.query),
      api_success: entry?.api_success === true,
      error_code: safeText(entry?.error_code),
      sub_code: safeText(entry?.sub_code),
      msg: safeText(entry?.msg),
      request_id: safeText(entry?.request_id),
      result_count: Math.max(0, Number(entry?.result_count) || 0),
    })),
    product_count: Math.min(Array.isArray(products) ? products.length : 0, 30),
    products: (Array.isArray(products) ? products : []).slice(0, 30).map(sanitizeRawProduct),
  };
  const checksum = crypto.createHash("sha256").update(JSON.stringify(fixture)).digest("hex");
  return deepFreeze({...fixture, checksum});
}

function buildRawAvailabilityMatrix(products = []) {
  const paths = [
    "identity.item_id",
    "text.title",
    "category.category_name",
    "pricing.price",
    "pricing.original_price",
    "sales_evidence.annual_vol",
    "sales_evidence.volume",
    "sales_evidence.tk_total_sales",
    "media.white_image",
    "media.pict_url",
    "commerce.item_url",
    "commerce.shop_title",
    "commerce.seller_nick",
    "commerce.brand_name",
    "promotion.coupon_amount",
    "promotion.commission_rate",
    "promotion.commission_amount",
    "promotion.publish_info_present",
  ];
  const list = Array.isArray(products) ? products : [];
  return paths.map((field) => {
    const observed = list.filter((item) => isPresent(valueAtPath(item, field))).length;
    return {
      field,
      status: observed === 0 ? "MISSING" : observed === list.length ? "AVAILABLE" : "CONDITIONAL",
      observed_count: observed,
      product_count: list.length,
    };
  });
}

function sanitizeRawProduct(value) {
  const item = objectValue(value);
  return {
    schema_version: RAW_TAOBAO_PRODUCT_SCHEMA_VERSION,
    source: "taobao",
    query: safeText(item.query),
    identity: {item_id: safeText(item.identity?.item_id)},
    text: {
      title: safeText(item.text?.title),
      short_title: safeText(item.text?.short_title),
    },
    category: {
      category_id: safeText(item.category?.category_id),
      category_name: safeText(item.category?.category_name),
      level_one_category_id: safeText(item.category?.level_one_category_id),
      level_one_category_name: safeText(item.category?.level_one_category_name),
    },
    pricing: {
      price: safeNumber(item.pricing?.price),
      original_price: safeNumber(item.pricing?.original_price),
      zk_final_price: safeNumber(item.pricing?.zk_final_price),
      reserve_price: safeNumber(item.pricing?.reserve_price),
    },
    sales_evidence: {
      annual_vol: safeNumber(item.sales_evidence?.annual_vol),
      volume: safeNumber(item.sales_evidence?.volume),
      tk_total_sales: safeNumber(item.sales_evidence?.tk_total_sales),
    },
    media: {
      white_image: sanitizeUrl(item.media?.white_image),
      pict_url: sanitizeUrl(item.media?.pict_url),
      small_images: sanitizeImageList(item.media?.small_images),
    },
    commerce: {
      item_url: sanitizeUrl(item.commerce?.item_url),
      shop_title: safeText(item.commerce?.shop_title),
      seller_nick: safeText(item.commerce?.seller_nick),
      brand_name: safeText(item.commerce?.brand_name),
    },
    promotion: {
      coupon_amount: safeNumber(item.promotion?.coupon_amount),
      coupon_start_fee: safeNumber(item.promotion?.coupon_start_fee),
      coupon_total_count: safeNumber(item.promotion?.coupon_total_count),
      coupon_remain_count: safeNumber(item.promotion?.coupon_remain_count),
      commission_rate: safeNumber(item.promotion?.commission_rate),
      commission_amount: safeNumber(item.promotion?.commission_amount),
      publish_info_present: item.promotion?.publish_info_present === true,
    },
    observed_at: safeIsoDate(item.observed_at),
  };
}

function sanitizeUrl(value) {
  const text = safeText(value);
  if (!text) return null;
  try {
    const normalized = text.startsWith("//") ? `https:${text}` : text;
    const parsed = new URL(normalized);
    if (!new Set(["http:", "https:"]).has(parsed.protocol)) return null;
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch (_) {
    return null;
  }
}

function sanitizeImageList(value) {
  const raw = Array.isArray(value) ? value : value?.string || value?.strings || [];
  return (Array.isArray(raw) ? raw : [raw]).map(sanitizeUrl).filter(Boolean).slice(0, 10);
}

function valueAtPath(value, path) {
  return path.split(".").reduce((current, key) => current?.[key], value);
}

function isPresent(value) {
  return value !== null && value !== undefined && value !== "" && value !== false;
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function safeText(value) {
  if (value === undefined || value === null) return null;
  const result = String(value).trim();
  return result ? result.slice(0, 500) : null;
}

function safeNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const result = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(result) ? result : null;
}

function safeIsoDate(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

module.exports = {
  RAW_TAOBAO_FIXTURE_SCHEMA_VERSION,
  RAW_TAOBAO_PRODUCT_SCHEMA_VERSION,
  buildRawAvailabilityMatrix,
  buildRawTaobaoProduct,
  createSanitizedRawFixture,
};
