const crypto = require("crypto");
const {normalizeProductCategory} = require("./product_relevance");

const RAW_TAOBAO_PRODUCT_SCHEMA_VERSION = "raw_taobao_product_v1";
const RAW_TAOBAO_FIXTURE_SCHEMA_VERSION = "raw_taobao_product_probe_v1";
const ENRICHMENT_EXTRACTOR_VERSION = "candidate_enrichment_v1";

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

function buildTaobaoImageProvenance(rawProduct = {}) {
  const whiteImage = sanitizeUrl(rawProduct?.media?.white_image);
  const pictUrl = sanitizeUrl(rawProduct?.media?.pict_url);
  const imageUrl = whiteImage || pictUrl || null;
  const selectedField = whiteImage ? "white_image" : pictUrl ? "pict_url" : null;
  return deepFreeze({
    status: imageUrl ? "AVAILABLE" : "UNKNOWN",
    source: imageUrl ? "taobao_raw_product" : "unknown",
    image_url: imageUrl,
    white_image: whiteImage,
    pict_url: pictUrl,
    selected_field: selectedField,
    confidence: imageUrl ? 1 : 0,
    evidence: imageUrl ? [`raw_product.media.${selectedField}`] : [],
    observed_at: safeIsoDate(rawProduct?.observed_at),
  });
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

function enrichTaobaoCandidate(rawProduct, {visionObservation = null} = {}) {
  const raw = objectValue(rawProduct);
  const observedAt = raw.observed_at || new Date().toISOString();
  const title = String(raw.text?.title || raw.title || "").trim();
  const categoryName = safeText(firstDefined(
    raw.category?.category_name,
    raw.category_name,
    raw.categoryName,
  ));
  const levelOneCategoryName = safeText(firstDefined(
    raw.category?.level_one_category_name,
    raw.level_one_category_name,
    raw.levelOneCategoryName,
  ));
  const categoryText = [
    categoryName,
    levelOneCategoryName,
    title,
  ].filter(Boolean).join(" ");
  const vision = normalizeVisionObservation(visionObservation, observedAt);
  const taxonomy = inferProductTaxonomy(
    raw,
    title,
    categoryText,
    observedAt,
    visionObservation,
  );
  const normalizedCategory = taxonomy.category.value;
  const gender = inferGender(title, categoryText);
  const style = inferTokens(title, STYLE_PATTERNS);
  const occasion = inferTokens(title, OCCASION_PATTERNS);
  const semanticText = [title, categoryName, levelOneCategoryName]
    .filter(Boolean).join(" ");
  const styleExpression = inferSemanticExpression(
    semanticText, STYLE_EXPRESSION_PATTERNS, observedAt,
    vision.style_expression,
  );
  const contemporaryExpression = inferSemanticExpression(
    semanticText, CONTEMPORARY_EXPRESSION_PATTERNS, observedAt,
    vision.contemporary_expression,
  );
  const occasionExpression = inferSemanticExpression(
    semanticText, OCCASION_EXPRESSION_PATTERNS, observedAt,
    vision.occasion_expression,
  );
  const desiredImpressionEvidence = inferSemanticExpression(
    semanticText, DESIRED_IMPRESSION_PATTERNS, observedAt,
    vision.desired_impression,
  );
  const audienceExpression = inferSemanticExpression(
    semanticText, AUDIENCE_EXPRESSION_PATTERNS, observedAt,
    vision.audience_expression,
  );
  const color = inferTokens(title, COLOR_PATTERNS);
  const silhouette = inferTokens(title, SILHOUETTE_PATTERNS);
  const fit = inferTokens(title, FIT_PATTERNS);
  const footwear = normalizedCategory === "shoes"
    ? inferTokens(title, FOOTWEAR_PATTERNS)
    : [];
  const material = inferTokens(title, MATERIAL_PATTERNS);
  const bodyFit = inferBodyFit(title);
  const quality = inferQuality(raw, title, vision);
  const rawRef = deepFreeze({
    source: raw.source || "taobao",
    item_id: raw.identity?.item_id || null,
    observed_at: observedAt,
    schema_version: raw.schema_version || RAW_TAOBAO_PRODUCT_SCHEMA_VERSION,
  });
  const categoryEvidence = taxonomy.category;
  return deepFreeze({
    schema_version: "enriched_candidate_v1",
    raw_product_ref: rawRef,
    // `normalized_category` remains the compatibility field.  The explicit
    // alias makes the evidence contract discoverable without allowing a
    // request slot to masquerade as an observed product fact.
    normalized_category: categoryEvidence,
    category_evidence: categoryEvidence,
    subcategory: taxonomy.subcategory,
    gender_evidence: evidenceValue(
      gender.value,
      gender.source,
      gender.confidence,
      gender.evidence,
      observedAt,
    ),
    style_evidence: tokenEvidence([
      ...style,
      ...semanticValues(styleExpression),
    ], observedAt),
    occasion_evidence: tokenEvidence([
      ...occasion,
      ...semanticValues(occasionExpression),
    ], observedAt),
    style_expression: styleExpression,
    contemporary_expression: contemporaryExpression,
    occasion_expression: occasionExpression,
    desired_impression_evidence: desiredImpressionEvidence,
    audience_expression: audienceExpression,
    color_evidence: vision.color || tokenEvidence(color, observedAt),
    silhouette_evidence: vision.silhouette || tokenEvidence(silhouette, observedAt),
    fit_evidence: vision.fit || tokenEvidence(fit, observedAt),
    footwear_evidence: vision.footwear || tokenEvidence(footwear, observedAt),
    material_evidence: tokenEvidence(material, observedAt),
    body_fit_evidence: evidenceValue(
      bodyFit.value,
      bodyFit.value.length ? "inference" : "unknown",
      bodyFit.value.length ? 0.68 : 0,
      bodyFit.evidence,
      observedAt,
    ),
    visual_quality_evidence: vision.quality || evidenceValue(
      "unknown",
      "unknown",
      0,
      [],
      observedAt,
    ),
    quality_evidence: quality,
  });
}

function attachEnrichmentToCandidate(candidate, rawProduct, enrichedCandidate) {
  const imageProvenance = buildTaobaoImageProvenance(rawProduct);
  return {
    ...candidate,
    image_url: imageProvenance.image_url || candidate?.image_url || null,
    white_image: imageProvenance.white_image || candidate?.white_image || null,
    pict_url: imageProvenance.pict_url || candidate?.pict_url || null,
    image_provenance: imageProvenance,
    raw_product: rawProduct,
    raw_product_ref: enrichedCandidate.raw_product_ref,
    sales_evidence: rawProduct.sales_evidence,
    candidate_enrichment: enrichedCandidate,
  };
}

function evidenceValue(value, source, confidence, evidence, observedAt) {
  return deepFreeze({
    value,
    source,
    confidence,
    evidence: Array.isArray(evidence) ? [...evidence] : [],
    observed_at: observedAt,
    extractor_version: ENRICHMENT_EXTRACTOR_VERSION,
  });
}

function tokenEvidence(tokens, observedAt) {
  const values = Array.isArray(tokens) ? tokens : [];
  return evidenceValue(
    values,
    values.length ? "explicit_text_evidence" : "unknown",
    values.length ? 0.82 : 0,
    values,
    observedAt,
  );
}

function semanticValues(item) {
  return Array.isArray(item?.value) ? item.value : [];
}

function inferSemanticExpression(text, rules, observedAt, visionEvidence = null) {
  const matches = [];
  for (const rule of rules) {
    const match = String(text || "").match(rule.pattern);
    if (match) matches.push({
      value: rule.value,
      confidence: rule.confidence,
      evidence: `product_text:${match[0]}`,
    });
  }
  const visionValues = visionEvidence?.value == null ? [] :
    (Array.isArray(visionEvidence.value)
      ? visionEvidence.value : [visionEvidence.value]);
  const values = [...new Set([
    ...matches.map((item) => item.value),
    ...visionValues.map((value) => String(value || "").trim()).filter(Boolean),
  ])];
  const evidence = [...new Set([
    ...matches.map((item) => item.evidence),
    ...(Array.isArray(visionEvidence?.evidence)
      ? visionEvidence.evidence.map((item) => `vision:${item}`) : []),
  ])];
  const source = matches.length && visionValues.length
    ? "mixed_product_fact_evidence" : visionValues.length
      ? "vision" : matches.length ? "explicit_text_evidence" : "unknown";
  return evidenceValue(
    values,
    source,
    Math.max(
      matches.length ? Math.max(...matches.map((item) => item.confidence)) : 0,
      Number(visionEvidence?.confidence) || 0,
    ),
    evidence,
    observedAt,
  );
}

function inferTokens(text, patterns) {
  return patterns.filter((entry) => entry.pattern.test(text)).map((entry) => entry.value);
}

function inferGender(title, categoryName) {
  const text = `${title || ""} ${categoryName || ""}`;
  const female = text.match(/女(?:士|款|装|鞋)?|少女|妈妈|裙/u);
  const male = text.match(/男(?:士|款|装|鞋)?|绅士/u);
  if (female && !male) {
    return {
      value: "female",
      source: "explicit_text_evidence",
      confidence: 0.96,
      evidence: [female[0]],
    };
  }
  if (male && !female) {
    return {
      value: "male",
      source: "explicit_text_evidence",
      confidence: 0.96,
      evidence: [male[0]],
    };
  }
  return {value: "unknown", source: "unknown", confidence: 0, evidence: []};
}

function inferSubcategory(title, category) {
  const rules = category === "shoes" ? FOOTWEAR_PATTERNS : SUBCATEGORY_PATTERNS;
  return inferTokens(title, rules)[0] || "";
}

function inferProductTaxonomy(
  raw,
  title,
  categoryText,
  observedAt,
  visionObservation = null,
) {
  const facts = [
    {field: "title", text: title},
    {
      field: "category_name",
      text: safeText(firstDefined(
        raw.category?.category_name,
        raw.category_name,
        raw.categoryName,
      )) || "",
    },
    {
      field: "level_one_category_name",
      text: safeText(firstDefined(
        raw.category?.level_one_category_name,
        raw.level_one_category_name,
        raw.levelOneCategoryName,
      )) || "",
    },
  ].filter((entry) => entry.text);

  const visionFacts = extractVisionTaxonomyFacts(visionObservation);
  const candidates = OPTIONAL_TAXONOMY_PATTERNS.map((rule, ruleIndex) => {
    const matches = facts.flatMap((entry) => {
      const match = entry.text.match(rule.pattern);
      return match ? [{
        field: entry.field,
        token: match[0],
      }] : [];
    });
    for (const fact of visionFacts) {
      const match = fact.text.match(rule.pattern);
      if (match) {
        matches.push({
          field: "vision",
          token: match[0],
          confidence: fact.confidence,
          evidence: fact.evidence,
        });
      }
    }
    if (matches.length === 0) return null;
    const titleBacked = matches.some((entry) => entry.field === "title");
    const apiBacked = matches.some((entry) => entry.field === "category_name" ||
      entry.field === "level_one_category_name");
    const visionBacked = matches.some((entry) => entry.field === "vision");
    const sourceCount = [titleBacked, apiBacked, visionBacked].filter(Boolean).length;
    const source = sourceCount > 1
      ? "mixed_product_fact_evidence"
      : titleBacked ? "explicit_title_evidence"
        : apiBacked ? "api_category_evidence" : "vision";
    const confidence = sourceCount > 1
      ? 0.98
      : titleBacked ? 0.95
        : apiBacked ? 0.9
          : Math.max(...matches.map((entry) => entry.confidence || 0.72));
    const evidence = [...new Set(matches.flatMap((entry) => {
      const values = [`${entry.field}:${entry.token}`];
      if (entry.field === "vision") {
        values.push(...entry.evidence.map((item) => `vision:${item}`));
      }
      return values;
    }))];
    return {
      rule,
      ruleIndex,
      // A duplicated API category field must not outweigh one explicit title
      // fact.  Rank evidence sources first, then use the number of agreeing
      // observations as a tie-breaker.
      score: (titleBacked ? 3 : apiBacked ? 2 : 1) * 100 + matches.length,
      category: evidenceValue(rule.category, source, confidence, evidence, observedAt),
      subcategory: evidenceValue(rule.subcategory, source, confidence, evidence, observedAt),
    };
  }).filter(Boolean).sort((left, right) => right.score - left.score || left.ruleIndex - right.ruleIndex);

  if (candidates.length > 0) {
    return {
      category: candidates[0].category,
      subcategory: candidates[0].subcategory,
    };
  }

  const normalizedCategory = normalizeProductCategory(categoryText) || "unknown";
  const subcategory = inferSubcategory(title, normalizedCategory);
  return {
    category: evidenceValue(
      normalizedCategory,
      normalizedCategory === "unknown" ? "unknown" : "product_text_normalization",
      normalizedCategory === "unknown" ? 0 : 0.9,
      normalizedCategory === "unknown" ? [] : [categoryText],
      observedAt,
    ),
    subcategory: evidenceValue(
      subcategory || "unknown",
      subcategory ? "explicit_title_evidence" : "unknown",
      subcategory ? 0.86 : 0,
      subcategory ? [`title:${title}`] : [],
      observedAt,
    ),
  };
}

function extractVisionTaxonomyFacts(observation) {
  if (!observation || typeof observation !== "object") return [];
  const fields = [
    "category", "subcategory", "visible_category", "product_category",
    "product_subcategory", "item_type", "object",
  ];
  return fields.flatMap((field) => {
    const candidate = observation[field];
    if (candidate == null) return [];
    const value = candidate && typeof candidate === "object" && !Array.isArray(candidate)
      ? candidate.value : candidate;
    const text = safeText(value);
    if (!text) return [];
    const confidenceValue = candidate && typeof candidate === "object"
      ? Number(candidate.confidence) : NaN;
    const confidence = Number.isFinite(confidenceValue)
      ? Math.max(0, Math.min(confidenceValue, 1)) : 0.72;
    const evidence = candidate && typeof candidate === "object" && Array.isArray(candidate.evidence)
      ? candidate.evidence.map(String).slice(0, 10) : [text];
    return [{field, text, confidence, evidence}];
  });
}

function inferBodyFit(title) {
  const values = [];
  const evidence = [];
  for (const entry of BODY_FIT_PATTERNS) {
    const match = title.match(entry.pattern);
    if (match) {
      values.push(entry.value);
      evidence.push(match[0]);
    }
  }
  return {value: values, evidence};
}

function normalizeVisionObservation(observation, observedAt) {
  if (!observation || typeof observation !== "object") return {};
  const build = (key) => {
    const candidate = observation[key];
    if (!candidate || candidate.value == null) return null;
    const confidence = Number(candidate.confidence);
    return evidenceValue(
      candidate.value,
      "vision",
      Number.isFinite(confidence) ? Math.max(0, Math.min(confidence, 1)) : 0,
      Array.isArray(candidate.evidence) ? candidate.evidence.map(String) : [],
      observedAt,
    );
  };
  return Object.fromEntries([
    ["color", build("color")],
    ["silhouette", build("silhouette")],
    ["fit", build("fit")],
    ["footwear", build("footwear")],
    ["quality", build("quality")],
    ["style_expression", build("style_expression")],
    ["contemporary_expression", build("contemporary_expression")],
    ["occasion_expression", build("occasion_expression")],
    ["desired_impression", build("desired_impression")],
    ["audience_expression", build("audience_expression")],
  ].filter(([, value]) => value));
}

function inferQuality(raw, title, vision) {
  const signals = [];
  if (raw.commerce?.brand_name) signals.push("api:brand_name");
  if (raw.commerce?.shop_title) signals.push("api:shop_title");
  const detail = title.match(/立体剪裁|精纺|真皮|羊毛|丝绸|刺绣|提花/u);
  if (detail) signals.push(`title:${detail[0]}`);
  if (vision.quality?.value && vision.quality.value !== "unknown") {
    signals.push("vision:quality");
  }
  return evidenceValue(
    signals.length ? "evidence_available" : "unknown",
    signals.some((signal) => signal.startsWith("vision")) ? "mixed" : "api_and_text",
    signals.length ? Math.min(0.5 + signals.length * 0.1, 0.8) : 0,
    signals,
    raw.observed_at,
  );
}

const SUBCATEGORY_PATTERNS = [
  {value: "skirt", pattern: /半身裙|短裙|百褶裙|A字裙/iu},
  {value: "dress", pattern: /连衣裙|裙装/iu},
  {value: "trousers", pattern: /裤|牛仔裤|西装裤/iu},
  {value: "shirt", pattern: /衬衫/iu},
  {value: "knitwear", pattern: /针织|毛衣/iu},
  {value: "t_shirt", pattern: /T恤|短袖/iu},
];
// These rules describe observable product identity only.  They deliberately
// exclude raw.query and all request/requirement fields: a hosiery search may
// retrieve jewelry, but that does not turn the jewelry into hosiery.
const OPTIONAL_TAXONOMY_PATTERNS = [
  {
    category: "accessory",
    subcategory: "hosiery",
    pattern: /连裤袜|裤袜|丝袜|打底袜|stockings?|hosiery|tights?/iu,
  },
  {
    category: "accessory",
    subcategory: "socks",
    pattern: /袜子|短袜|中筒袜|长筒袜|长袜|过膝袜|船袜|棉袜|袜品|袜类|socks?/iu,
  },
  {
    category: "bag",
    subcategory: "shoulder_bag",
    pattern: /单肩包|腋下包|shoulder bag/iu,
  },
  {
    category: "bag",
    subcategory: "crossbody_bag",
    pattern: /斜挎包|crossbody/iu,
  },
  {
    category: "bag",
    subcategory: "tote_bag",
    pattern: /托特包|tote/iu,
  },
  {
    category: "bag",
    subcategory: "backpack",
    pattern: /双肩包|背包|backpack/iu,
  },
  {
    category: "bag",
    subcategory: "handbag",
    pattern: /手提包|手袋|handbags?/iu,
  },
  {
    category: "bag",
    subcategory: "bag",
    pattern: /包包|女包|男包|箱包|包袋|手包|皮具|(^|[^a-z])bags?([^a-z]|$)/iu,
  },
  {
    category: "hat",
    subcategory: "beret",
    pattern: /贝雷帽|beret/iu,
  },
  {
    category: "hat",
    subcategory: "baseball_cap",
    pattern: /棒球帽|鸭舌帽|baseball cap/iu,
  },
  {
    category: "hat",
    subcategory: "bucket_hat",
    pattern: /渔夫帽|bucket hat/iu,
  },
  {
    category: "hat",
    subcategory: "beanie",
    pattern: /针织帽|毛线帽|beanie/iu,
  },
  {
    category: "hat",
    subcategory: "headwear",
    pattern: /帽子|礼帽|遮阳帽|帽类|头饰|headwear|hats?|(^|[^a-z])cap([^a-z]|$)/iu,
  },
  {
    category: "accessory",
    subcategory: "jewelry",
    pattern: /珠宝|首饰|饰品|项链|吊坠|耳环|耳饰|耳钉|手链|手镯|戒指|胸针|脚链|jewelry|necklace|pendant|earrings?|bracelet|brooch/iu,
  },
  {
    category: "accessory",
    subcategory: "accessory",
    pattern: /配饰|accessor(?:y|ies)/iu,
  },
];
const STYLE_PATTERNS = [
  {value: "sweet", pattern: /甜美|甜妹|蝴蝶结|荷叶边/iu},
  {value: "elegant", pattern: /优雅|法式|精致/iu},
  {value: "minimal", pattern: /极简|简约|基础款/iu},
  {value: "cityboy", pattern: /cityboy|城市男孩/iu},
  {value: "sporty", pattern: /运动|跑步|训练/iu},
  {value: "street", pattern: /街头|潮牌|嘻哈/iu},
  {value: "business_casual", pattern: /商务休闲|通勤/iu},
];
const STYLE_EXPRESSION_PATTERNS = [
  {value: "design_expression", confidence: 0.9,
    pattern: /设计款|设计感|解构|不规则|拼接|褶皱|褶裥|不对称|立体剪裁|特殊廓形/iu},
  {value: "minimal_expression", confidence: 0.82,
    pattern: /极简|简约|纯色基础|clean\s*fit/iu},
  {value: "traditional_expression", confidence: 0.82,
    pattern: /传统|经典复古|中式复古|老式/iu},
];
const CONTEMPORARY_EXPRESSION_PATTERNS = [
  {value: "contemporary", confidence: 0.86,
    pattern: /解构|不规则|不对称|立体剪裁|现代廓形|当代|先锋/iu},
  {value: "fashion_forward", confidence: 0.78,
    pattern: /时髦|潮流|时尚款|小众设计|流行设计/iu},
  {value: "trend_mention", confidence: 0.45,
    pattern: /新款|当季|流行版型|今年流行/iu},
  {value: "traditional", confidence: 0.82,
    pattern: /传统|老式|经典商务|中老年/iu},
];
const OCCASION_EXPRESSION_PATTERNS = [
  {value: "nightlife_social", confidence: 0.9,
    pattern: /派对|聚会|夜店|酒吧|夜间社交|夜生活|KTV|晚宴/iu},
  {value: "date", confidence: 0.88, pattern: /约会/iu},
  {value: "work", confidence: 0.9,
    pattern: /通勤|工作装|职业装|职场|商务正装|正装/iu},
  {value: "daily", confidence: 0.76, pattern: /日常|休闲/iu},
  {value: "sport_outdoor", confidence: 0.9,
    pattern: /户外|登山|徒步|跑步|训练/iu},
];
const DESIRED_IMPRESSION_PATTERNS = [
  {value: "design_led", confidence: 0.9,
    pattern: /设计款|设计感|解构|不规则|拼接|褶皱|褶裥|不对称|立体剪裁|特殊廓形/iu},
  {value: "youthful", confidence: 0.84,
    pattern: /年轻|减龄|青春|少女感|少年感|学院风/iu},
  {value: "fashion_forward", confidence: 0.8,
    pattern: /时髦|时尚款|潮流|小众设计/iu},
  {value: "clean", confidence: 0.8, pattern: /干净利落|清爽|简洁利落/iu},
  {value: "relaxed", confidence: 0.78, pattern: /松弛|慵懒|宽松休闲/iu},
  {value: "polished", confidence: 0.82, pattern: /精致|考究|优雅/iu},
];
const AUDIENCE_EXPRESSION_PATTERNS = [
  {value: "child", confidence: 0.99,
    pattern: /婴幼儿|婴儿|幼童|儿童|童装|男童|女童|少儿|小童|中童|大童|kids?|children/iu},
  {value: "mature", confidence: 0.9,
    pattern: /中老年|老年|老人|奶奶|爷爷|妈妈款|妈妈鞋|爸爸款|爸爸鞋|老人鞋/iu},
  {value: "youthful", confidence: 0.82,
    pattern: /年轻|减龄|青春|少女感|少年感|学院风/iu},
];
const OCCASION_PATTERNS = [
  {value: "date", pattern: /约会/iu},
  {value: "work", pattern: /通勤|商务|职场/iu},
  {value: "party", pattern: /派对|宴会|晚宴/iu},
  {value: "daily", pattern: /日常|休闲/iu},
  {value: "sport", pattern: /运动|跑步|训练/iu},
];
const COLOR_PATTERNS = [
  {value: "black", pattern: /黑色|黑款|雅黑/iu},
  {value: "white", pattern: /白色|奶油白|米白/iu},
  {value: "beige", pattern: /米色|卡其|燕麦/iu},
  {value: "pink", pattern: /粉色|粉红/iu},
  {value: "red", pattern: /红色|酒红/iu},
  {value: "blue", pattern: /蓝色|藏蓝/iu},
  {value: "green", pattern: /绿色|薄荷绿/iu},
  {value: "gray", pattern: /灰色|炭灰/iu},
  {value: "brown", pattern: /棕色|咖色/iu},
];
const SILHOUETTE_PATTERNS = [
  {value: "cropped", pattern: /短款|露腰/iu},
  {value: "longline", pattern: /长款|长版/iu},
  {value: "a_line", pattern: /A字|伞裙/iu},
  {value: "wide_leg", pattern: /阔腿|宽腿/iu},
  {value: "straight", pattern: /直筒/iu},
  {value: "fitted", pattern: /修身|贴身/iu},
  {value: "oversized", pattern: /宽松|廓形|oversize/iu},
];
const FIT_PATTERNS = [
  {value: "slim", pattern: /修身|紧身|贴身/iu},
  {value: "regular", pattern: /常规版|合身/iu},
  {value: "relaxed", pattern: /宽松|落肩/iu},
];
const FOOTWEAR_PATTERNS = [
  {value: "mary_jane", pattern: /玛丽珍/iu},
  {value: "ballet_flat", pattern: /芭蕾鞋|舞鞋/iu},
  {value: "loafer", pattern: /乐福鞋/iu},
  {value: "pump", pattern: /尖头鞋|单鞋/iu},
  {value: "heel", pattern: /高跟|低跟|粗跟/iu},
  {value: "sneaker", pattern: /运动鞋|板鞋|德训鞋|跑鞋|训练鞋/iu},
  {value: "boot", pattern: /靴|短靴|长靴/iu},
  {value: "oxford", pattern: /牛津鞋/iu},
];
const MATERIAL_PATTERNS = [
  {value: "cotton_mention", pattern: /棉|纯棉/iu},
  {value: "wool_mention", pattern: /羊毛|羊绒/iu},
  {value: "leather_mention", pattern: /真皮|牛皮|羊皮/iu},
  {value: "knit_mention", pattern: /针织/iu},
  {value: "denim_mention", pattern: /牛仔/iu},
  {value: "silk_mention", pattern: /真丝|丝绸/iu},
  {value: "polyester_mention", pattern: /聚酯|涤纶/iu},
];
const BODY_FIT_PATTERNS = [
  {value: "high_rise_proportion", pattern: /高腰/iu},
  {value: "waist_definition", pattern: /收腰|束腰/iu},
  {value: "vertical_line", pattern: /直筒|纵向/iu},
  {value: "cropped_proportion", pattern: /短款/iu},
  {value: "relaxed_volume", pattern: /阔腿|宽松|廓形/iu},
];

module.exports = {
  ENRICHMENT_EXTRACTOR_VERSION,
  RAW_TAOBAO_FIXTURE_SCHEMA_VERSION,
  RAW_TAOBAO_PRODUCT_SCHEMA_VERSION,
  attachEnrichmentToCandidate,
  buildTaobaoImageProvenance,
  buildRawAvailabilityMatrix,
  buildRawTaobaoProduct,
  createSanitizedRawFixture,
  enrichTaobaoCandidate,
};
