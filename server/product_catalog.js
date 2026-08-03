const PRODUCT_SEEDS = Object.freeze([
  product("tee-001", "Uniqlo", "AIRism 圆领T恤", "T恤", "白色", "S-XL", 99, "assets/images/products/structured_shirt.jpg", ["极简", "通勤", "透气", "肩窄"]),
  product("tee-002", "COS", "重磅棉基础T恤", "T恤", "黑色", "XS-XL", 290, "assets/images/products/navy_knit.jpg", ["高级感", "极简", "挺括", "宽肩"]),
  product("tee-003", "ZARA", "宽松短款T恤", "T恤", "米白", "S-L", 159, "assets/images/products/structured_shirt.jpg", ["休闲", "短款", "显高", "小个子"]),
  product("tee-004", "Nike", "Dri-FIT 运动T恤", "T恤", "森林绿", "S-XXL", 249, "assets/images/products/navy_knit.jpg", ["运动", "速干", "透气", "健壮"]),
  product("tee-005", "Adidas", "简约三叶草T恤", "T恤", "浅灰", "XS-XL", 229, "assets/images/products/structured_shirt.jpg", ["街头", "休闲", "柔软", "匀称"]),
  product("pants-001", "Uniqlo", "高腰直筒裤", "裤子", "黑色", "S-XL", 299, "assets/images/products/pleated_trousers.jpg", ["通勤", "直筒", "显高", "腿短"]),
  product("pants-002", "COS", "垂感阔腿裤", "裤子", "深灰", "XS-L", 690, "assets/images/products/pleated_trousers.jpg", ["高级感", "垂感", "极简", "梨形"]),
  product("pants-003", "ZARA", "九分锥形裤", "裤子", "卡其", "S-XL", 359, "assets/images/products/pleated_trousers.jpg", ["通勤", "利落", "九分", "小个子"]),
  product("pants-004", "Nike", "梭织运动长裤", "裤子", "藏青", "S-XXL", 399, "assets/images/products/pleated_trousers.jpg", ["运动", "防风", "束脚", "健壮"]),
  product("pants-005", "Adidas", "直筒休闲运动裤", "裤子", "浅灰", "XS-XL", 369, "assets/images/products/pleated_trousers.jpg", ["休闲", "直筒", "舒适", "匀称"]),
  product("shoes-001", "Nike", "Air Max 休闲运动鞋", "鞋", "白灰", "36-45", 799, "assets/images/products/leather_loafers.jpg", ["运动", "增高", "缓震", "腿短"]),
  product("shoes-002", "Adidas", "Samba 低帮运动鞋", "鞋", "黑白", "35-45", 699, "assets/images/products/leather_loafers.jpg", ["街头", "低帮", "复古", "匀称"]),
  product("shoes-003", "COS", "极简皮革乐福鞋", "鞋", "黑色", "35-44", 990, "assets/images/products/leather_loafers.jpg", ["通勤", "商务", "极简", "修长"]),
  product("shoes-004", "ZARA", "厚底德训鞋", "鞋", "米白", "35-44", 499, "assets/images/products/leather_loafers.jpg", ["休闲", "增高", "简约", "小个子"]),
  product("shoes-005", "Uniqlo", "轻量防水休闲鞋", "鞋", "深灰", "36-44", 399, "assets/images/products/leather_loafers.jpg", ["旅行", "防水", "轻量", "通勤"]),
  product("coat-001", "Uniqlo", "短款轻型夹克", "外套", "藏青", "S-XL", 399, "assets/images/products/tailored_blazer.jpg", ["短款", "通勤", "显高", "肩窄"]),
  product("coat-002", "COS", "结构感羊毛外套", "外套", "炭灰", "XS-XL", 1890, "assets/images/products/tailored_blazer.jpg", ["高级感", "结构感", "秋冬", "肩窄"]),
  product("coat-003", "ZARA", "双排扣西装外套", "外套", "黑色", "S-XL", 699, "assets/images/products/tailored_blazer.jpg", ["商务", "正式", "收腰", "沙漏型"]),
  product("coat-004", "Nike", "轻量防风外套", "外套", "森林绿", "S-XXL", 599, "assets/images/products/navy_knit.jpg", ["运动", "防风", "防泼水", "旅行"]),
  product("coat-005", "Adidas", "经典三条纹夹克", "外套", "黑白", "XS-XL", 549, "assets/images/products/navy_knit.jpg", ["街头", "运动", "短款", "休闲"]),
]);

function product(
  id,
  brand,
  title,
  category,
  color,
  size,
  price,
  imageUrl,
  tags,
) {
  return Object.freeze({
    product_id: id,
    id,
    source: "mock",
    title,
    brand,
    category,
    color,
    size,
    price,
    image_url: imageUrl,
    original_price: null,
    coupon_amount: 0,
    shop_name: "",
    recommendation_reason: "根据本次 AI 穿搭关键词匹配的测试商品",
    match_explanation: "用于验证商品推荐展示，暂不代表真实在售商品",
    detail_url: "",
    purchase_url: "",
    platform: "mock-catalog",
    commission_rate: 0,
    affiliate_url: "",
    stock_status: "in_stock",
    pid: "",
    coupon_url: "",
    is_mock: true,
    tags: Object.freeze(tags),
  });
}

function normalize(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function canonicalCategory(value) {
  const normalized = normalize(value);
  if (/t恤|tee|短袖/.test(normalized)) return "T恤";
  if (/裤|下装|trouser|pants/.test(normalized)) return "裤子";
  if (/鞋|shoe|sneaker|乐福/.test(normalized)) return "鞋";
  if (/外套|夹克|西装|大衣|coat|jacket|blazer/.test(normalized)) {
    return "外套";
  }
  return value?.trim() || "";
}

function validateFilter(value, field) {
  if (value == null || value === "") return "";
  if (typeof value !== "string" || value.trim().length > 100) {
    throw new TypeError(`${field} must be a string of at most 100 characters`);
  }
  return value.trim();
}

function searchableText(productItem) {
  return normalize([
    productItem.title,
    productItem.brand,
    productItem.category,
    productItem.color,
    productItem.size,
    ...productItem.tags,
  ].join(" "));
}

function searchTerms(value) {
  return normalize(value)
    .split(/[\s,，、/]+/)
    .filter((term) => term.length > 0);
}

class ProductCatalog {
  constructor(products = PRODUCT_SEEDS) {
    this.products = Object.freeze([...products]);
  }

  recommend(filters = {}) {
    const category = canonicalCategory(validateFilter(filters.category, "category"));
    const style = validateFilter(filters.style, "style");
    const color = validateFilter(filters.color, "color");
    const bodyType = validateFilter(filters.bodyType, "bodyType");
    const scene = validateFilter(filters.scene, "scene");
    const gender = validateFilter(filters.gender, "gender");
    const fit = validateFilter(filters.fit, "fit");
    const budget = Number(filters.budget);
    const keyword = validateFilter(filters.keyword, "keyword");
    const limit = Number.isInteger(filters.limit)
      ? Math.min(Math.max(filters.limit, 1), 20)
      : 12;
    const terms = [
      ...searchTerms(style),
      ...searchTerms(color),
      ...searchTerms(bodyType),
      ...searchTerms(scene),
      ...searchTerms(gender),
      ...searchTerms(fit),
      ...searchTerms(keyword),
    ];

    const rankedProducts = this.products
      .filter((item) => (!category || item.category === category) &&
        (!Number.isFinite(budget) || budget <= 0 || item.price <= budget))
      .map((item) => {
        const searchable = searchableText(item);
        const score = terms.reduce(
          (total, term) => total + (searchable.includes(term) ? 1 : 0),
          category ? 4 : 0,
        );
        return {item, score};
      })
      .sort((left, right) =>
        right.score - left.score || left.item.id.localeCompare(right.item.id),
      )
      .map(({item}) => item);
    const selectedProducts = category
      ? rankedProducts.slice(0, limit)
      : selectBalancedProducts(rankedProducts, limit);

    return selectedProducts.map((item) => toRecommendation(item, {
        style,
        color,
        bodyType,
        scene,
        gender,
        fit,
        keyword,
      }));
  }

  recommendForQueries(queries, context = {}) {
    const matched = new Map();
    const normalizedQueries = Array.isArray(queries) ? queries : [];
    const totalBudget = Number(context.budget);
    const perItemBudget = Number.isFinite(totalBudget) && totalBudget > 0 &&
      normalizedQueries.length > 0
      ? totalBudget / normalizedQueries.length
      : 0;
    for (const query of normalizedQueries) {
      const results = this.recommend({
        category: query.category,
        style: query.style || context.style,
        color: context.color,
        bodyType: context.bodyType,
        scene: context.scene,
        gender: context.gender,
        fit: context.fit,
        budget: perItemBudget,
        keyword: query.keyword,
        limit: 3,
      });
      for (const item of results) {
        if (!matched.has(item.product_id)) {
          matched.set(item.product_id, item);
        }
      }
    }
    return [...matched.values()].slice(0, 12);
  }
}

function selectBalancedProducts(products, limit) {
  const selected = [];
  const selectedIds = new Set();

  for (const category of ["T恤", "裤子", "鞋", "外套"]) {
    const match = products.find((item) => item.category === category);
    if (match && selected.length < limit) {
      selected.push(match);
      selectedIds.add(match.product_id);
    }
  }

  for (const item of products) {
    if (selected.length >= limit) break;
    if (selectedIds.add(item.product_id)) {
      selected.push(item);
    }
  }

  return selected;
}

function toRecommendation(productItem, filters = {}) {
  const matchedTerms = [
    ...searchTerms(filters.style),
    ...searchTerms(filters.color),
    ...searchTerms(filters.bodyType),
    ...searchTerms(filters.keyword),
  ].filter((term) => searchableText(productItem).includes(term));
  const matchExplanation = matchedTerms.length > 0
    ? `匹配关键词：${[...new Set(matchedTerms)].slice(0, 4).join("、")}`
    : "匹配当前穿搭所需品类";
  return {
    product_id: productItem.product_id,
    source: productItem.source,
    title: productItem.title,
    brand: productItem.brand,
    category: productItem.category,
    price: productItem.price,
    image_url: productItem.image_url,
    original_price: productItem.original_price,
    coupon_amount: productItem.coupon_amount,
    shop_name: productItem.shop_name,
    recommendation_reason: productItem.recommendation_reason,
    match_explanation: matchExplanation,
    detail_url: productItem.detail_url,
    purchase_url: productItem.purchase_url,
    platform: productItem.platform,
    commission_rate: productItem.commission_rate,
    affiliate_url: productItem.affiliate_url,
    stock_status: productItem.stock_status,
    pid: productItem.pid,
    coupon_url: productItem.coupon_url,
    is_mock: productItem.is_mock,
    tags: productItem.tags,
  };
}

module.exports = {
  PRODUCT_SEEDS,
  ProductCatalog,
  canonicalCategory,
};
