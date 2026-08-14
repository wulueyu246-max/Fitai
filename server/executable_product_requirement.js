"use strict";

const FAMILY_RULES = Object.freeze({
  top: Object.freeze([
    ["knitwear", /(?:针织|毛衣|开衫|knitwear|knit)/iu],
    ["tshirt", /(?:T恤|tee)/iu],
    ["vest", /(?:背心|吊带)/u],
    ["blouse", /(?:雪纺|蕾丝|荷叶边|泡泡袖)/u],
    ["shirt", /(?:衬衫|衬衣|shirt)/iu],
    ["top", /(?:上衣|上装)/u],
  ]),
  bottom: Object.freeze([
    ["skirt", /(?:半身裙|A字裙|百褶裙|迷笛裙|短裙|长裙|裙)/iu],
    ["wide_leg_pants", /(?:阔腿|宽腿|wide[- ]?leg)/iu],
    ["shorts", /短裤/u],
    ["jeans", /牛仔裤/u],
    ["straight_pants", /(?:直筒|九分|烟管|西装裤|straight(?:[- ]leg)?\s+trousers?)/iu],
    ["pants", /(?:裤|下装|trousers?|pants)/iu],
  ]),
  dress: Object.freeze([
    ["dress", /(?:连衣裙|裙装|茶歇裙|套裙)/u],
  ]),
  shoes: Object.freeze([
    ["mary_jane", /玛丽珍/u],
    ["loafers", /(?:乐福|loafers?)/iu],
    ["boots", /靴/u],
    ["sneakers", /(?:运动鞋|跑鞋|训练鞋|篮球鞋|德训鞋|板鞋|sneakers?)/iu],
    ["heels", /(?:细高跟|高跟|中跟|猫跟|细跟|粗跟|(?<!低)跟鞋|heels?)/iu],
    ["pointed_flat", /(?=.*(?:尖头|浅口))(?=.*(?:平底|低跟|单鞋))/u],
    ["heels", /低跟/u],
    ["flats", /(?:芭蕾鞋|平底鞋|单鞋|凉鞋)/u],
    ["shoes", /鞋/u],
  ]),
  outerwear: Object.freeze([
    ["blazer", /(?:西装外套|西服外套|西装)/u],
    ["coat", /(?:风衣|大衣)/u],
    ["jacket", /(?:夹克|外套)/u],
    ["cardigan", /开衫/u],
  ]),
  bag: Object.freeze([["bag", /(?:包|手袋)/u]]),
  hat: Object.freeze([["hat", /帽/u]]),
  accessory: Object.freeze([
    ["jewelry", /(?:耳环|耳饰|项链|手链|戒指|胸针)/u],
    ["belt", /(?:腰带|皮带)/u],
    ["scarf", /(?:丝巾|围巾)/u],
    ["socks", /(?:袜|丝袜)/u],
    ["watch", /手表/u],
    ["glasses", /眼镜/u],
    ["accessory", /配饰/u],
  ]),
});

const FAMILY_CATEGORY = Object.freeze(Object.fromEntries(
  Object.entries(FAMILY_RULES).flatMap(([category, rules]) =>
    rules.map(([family]) => [family, category])),
));
const FIT_FAMILY_STATUS = Object.freeze({
  COMPATIBLE: "COMPATIBLE",
  NEUTRAL: "NEUTRAL",
  CONFLICT: "CONFLICT",
});
const FIT_COMPATIBLE_FAMILY_PAIRS = new Set([
  "jeans:straight_pants",
  "jeans:wide_leg_pants",
  "pants:straight_pants",
  "pants:wide_leg_pants",
  "straight_pants:wide_leg_pants",
  "flats:pointed_flat",
]);
const EXPLICIT_FIT_CONFLICT_RULES = Object.freeze({
  skirt: /(?:阔腿|直筒裤|铅笔裤|小脚裤|牛仔裤|短裤|pants?|jeans?|shorts?)/iu,
  wide_leg_pants: /(?:紧身|贴腿|铅笔裤|小脚裤|打底裤|skinny|leggings?)/iu,
  straight_pants: /(?:紧身|贴腿|铅笔裤|小脚裤|打底裤|喇叭裤|skinny|leggings?|flare)/iu,
  heels: /(?:平底|无跟|flat)/iu,
  pointed_flat: /(?:高跟|细高跟|中跟|猫跟|细跟|粗跟|heels?)/iu,
  flats: /(?:高跟|细高跟|中跟|猫跟|细跟|粗跟|heels?)/iu,
});

const SLOT_CATEGORY = Object.freeze({
  top: "top",
  bottom: "bottom",
  dress: "dress",
  shoes: "shoes",
  outerwear: "outerwear",
  bag: "bag",
  hat: "hat",
  cap: "hat",
  accessory: "accessory",
  jewelry: "accessory",
  belt: "accessory",
  scarf: "accessory",
  socks: "accessory",
  watch: "accessory",
  glasses: "accessory",
});

const GENERIC_PRODUCT_NAMES = new Set([
  "上衣", "上装", "下装", "裤子", "裙子", "连衣裙", "鞋", "鞋履", "单品",
  "款式", "高级感单品", "经典款式", "甜美风格鞋履", "上短下长单品",
]);

const ABSTRACT_PRODUCT_PATTERN =
  /(?:比例优化|造型作用|风格单品|高腰线上衣|高腰线连衣裙|上短下长单品|·)/u;
const STRATEGY_TEXT_PATTERN =
  /(?:提高腰线|缩短上半身|延长腿部|视觉长度|视觉比例|纵向线条|强制将|用于|因为|适合)/u;
const EXPLANATION_PATTERN = /[:：；;]|[（(][^）)]*[A-Za-z][^）)]*[）)]/u;
const MULTI_PRODUCT_PATTERN = /(?:或者|或)(?=.*(?:衣|衫|裙|裤|鞋|靴|包|帽))/u;

function cleanText(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function uniqueStrings(values) {
  return [...new Set(values.map(cleanText).filter(Boolean))];
}

function stripExplanation(value) {
  let text = cleanText(value)
    .replace(/\s*[（(][^）)]*[）)]\s*/gu, " ")
    .trim();
  const boundary = text.search(/[:：；;]/u);
  if (boundary >= 0) text = text.slice(0, boundary).trim();
  if (/[\u3400-\u9fff]/u.test(text)) {
    text = text.replace(/\s+[A-Za-z][A-Za-z\s-]*$/u, "");
  }
  return text.replace(/[。；;：:]+$/gu, "").trim();
}

function normalizeExecutableItemName(value) {
  return stripExplanation(value).replace(/^修身短款/u, "短款修身");
}

function splitAttributeValues(...values) {
  return uniqueStrings(values.flatMap((value) => {
    const entries = Array.isArray(value) ? value : [value];
    return entries.flatMap((entry) => {
      let text = stripExplanation(entry)
        .replace(/^(?:主色|辅色|点缀|颜色|色彩|材质|面料)\s*[:：]\s*/u, "");
      text = text.split(/\s+-\s+|—/u)[0].trim();
      return text.split(/\s*(?:\/|、|，|,|或者|或)\s*/u).map(cleanText);
    });
  }));
}

function normalizeConstraintArray(value, field) {
  if (value == null) return {values: [], repaired: true};
  if (!Array.isArray(value)) {
    throw new TypeError(`Native Executable Look Contract 的 ${field} 必须是数组`);
  }
  return {values: uniqueStrings(value), repaired: false};
}

const ATTRIBUTE_CANONICAL_RULES = Object.freeze([
  ["short_length", /(?:短款|不过胯|短长度|\bcropped\b)/iu, "短款"],
  ["high_waist", /(?:高腰|high[- ]?rise)/iu, "高腰"],
  ["vertical_drape", /(?:纵向垂感|垂坠|垂感|纵向延伸)/u, "纵向垂感"],
  ["stretch", /(?:高弹|弹力|弹性|\bstretch(?:y)?\b)/iu, "弹力"],
  ["low_vamp", /(?:浅口|低鞋口)/u, "浅口"],
  ["pointed_toe", /(?:尖头|pointed[- ]?toe)/iu, "尖头"],
  ["round_toe", /(?:圆头|round[- ]?toe)/iu, "圆头"],
  ["square_neck", /(?:方领|square[- ]?neck)/iu, "方领"],
  ["v_neck", /(?:V领|V字领|v[- ]?neck)/iu, "V领"],
  ["low_heel", /(?:低跟|中低跟|猫跟|low[- ]?heel)/iu, "低跟"],
  ["cropped_length", /(?:九分|ankle[- ]?length)/iu, "九分"],
  ["light_platform", /(?:轻量增高|轻量厚底)/u, "轻量增高"],
  ["low_waist", /(?:低腰|low[- ]?rise)/iu, "低腰"],
  ["floor_length", /(?:拖地|及地)/u, "拖地"],
  ["heavy_high_top", /(?:厚重高帮|粗重高帮)/u, "厚重高帮"],
  ["heavy_platform", /(?:粗重厚底|厚重厚底)/u, "粗重厚底"],
]);

function canonicalAttributeKey(value) {
  const text = cleanText(value);
  return ATTRIBUTE_CANONICAL_RULES.find(([, pattern]) => pattern.test(text))?.[0] || "";
}

function canonicalizeAttribute(value) {
  return canonicalAttributeKey(value) || cleanText(value).toLowerCase();
}

function extractCanonicalAttributeValues(value) {
  const text = cleanText(value);
  return ATTRIBUTE_CANONICAL_RULES
    .filter(([, pattern]) => pattern.test(text))
    .map(([, , label]) => label);
}

function extractBlueprintAttributeConstraints(value) {
  const source = cleanText(value);
  const alternatives = uniqueStrings(source.split(/\s*(?:或者|或)\s*/u));
  if (alternatives.length < 2) return extractCanonicalAttributeValues(source);
  const attributesByAlternative = alternatives.map(extractCanonicalAttributeValues);
  if (attributesByAlternative.some((attributes) => attributes.length === 0)) {
    return extractCanonicalAttributeValues(source);
  }
  const common = attributesByAlternative[0].filter((attribute) =>
    attributesByAlternative.slice(1).every((attributes) =>
      attributes.includes(attribute)));
  const varying = uniqueStrings(attributesByAlternative.flatMap((attributes) =>
    attributes.filter((attribute) => !common.includes(attribute))));
  return uniqueStrings([
    ...common,
    ...(varying.length > 1 ? [varying.join("或")] : varying),
  ]);
}

function constraintScopeKey(value) {
  return constraintAlternatives(value)
    .map((alternative) => canonicalizeAttribute(alternative))
    .sort()
    .join("|");
}

function isExplicitCategoryConstraint(value) {
  const text = cleanText(value);
  return /^(?:必须|仅限|只限)/u.test(text) ||
    /(?:所有|全部|每(?:件|条|双|款|套)|该类|本类).*(?:必须|均需|都要|只限|仅限)/u
      .test(text) ||
    /^(?:上衣|上装|下装|裤装|裙装|连衣裙|鞋履|鞋子|配饰).*(?:必须|均需|都要|只限|仅限)/u
      .test(text);
}

function normalizeConstraintSources(value) {
  if (!Array.isArray(value)) return [];
  const normalized = value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const constraintValue = cleanText(entry.value);
    const level = cleanText(entry.level).toLowerCase();
    const source = cleanText(entry.source).toLowerCase();
    if (!constraintValue || !["required", "preferred", "avoid"].includes(level) ||
        !source) return [];
    return [{value: constraintValue, level, source}];
  });
  const seen = new Set();
  return normalized.filter((entry) => {
    const key = `${entry.level}:${canonicalizeAttribute(entry.value)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function constraintAlternatives(value) {
  return uniqueStrings(cleanText(value).split(/\s*(?:或|或者|\/|、)\s*/u));
}

function constraintSatisfied(value, evidence) {
  const normalizedEvidence = cleanText(evidence).replace(/\s+/g, "");
  const canonicalEvidence = new Set(extractCanonicalAttributeValues(evidence)
    .map(canonicalizeAttribute));
  return constraintAlternatives(value).some((alternative) => {
    const canonical = canonicalAttributeKey(alternative);
    return (canonical && canonicalEvidence.has(canonical)) ||
      normalizedEvidence.includes(alternative.replace(/\s+/g, ""));
  });
}

const REQUIRED_CONFLICT_RULES = Object.freeze({
  short_length: /(?:盖臀|过胯|长款|超长|常规长度)/u,
  high_waist: /(?:低腰|中低腰|普通腰线)/u,
  vertical_drape: /(?:横向扩张|蓬松膨胀|厚重堆积)/u,
  low_vamp: /(?:高帮|高鞋口)/u,
  pointed_toe: /(?:圆头|方头)/u,
  low_heel: /(?:超高跟|厚重高跟)/u,
  low_waist: /(?:高腰|high[- ]?rise)/iu,
});

function constraintExplicitlyContradicted(value, evidence) {
  return constraintAlternatives(value).some((alternative) => {
    const canonical = canonicalAttributeKey(alternative);
    const conflictPattern = REQUIRED_CONFLICT_RULES[canonical];
    return conflictPattern ? conflictPattern.test(cleanText(evidence)) : false;
  });
}

function requiredConstraintRule(value) {
  const values = constraintAlternatives(value);
  const canonical = canonicalAttributeKey(values[0]);
  const key = canonical === "short_length"
    ? "top_length"
    : canonical === "high_waist" ? "waistline" : canonical || cleanText(value);
  return {
    key,
    mode: values.length > 1 ? "any_of" : "all_of",
    values,
    level: "required",
  };
}

function normalizeNativeExecutableProductContract(
  requirement = {},
  {expectedRequestId = "", expectedLookId = "", expectedCategory = ""} = {},
) {
  if (!requirement || typeof requirement !== "object" ||
      Array.isArray(requirement)) {
    throw new TypeError("Native Executable Look item 必须是对象");
  }
  for (const field of [
    "request_id", "look_id", "category", "slot_key", "product_type",
    "product_family", "item_name", "style_role", "fit",
  ]) {
    if (!Object.prototype.hasOwnProperty.call(requirement, field)) {
      throw new TypeError(`Native Executable Look Contract 缺少 ${field}`);
    }
  }
  const arrayFields = [
    "colors", "materials", "design_elements", "required_attributes",
    "preferred_attributes", "avoid_attributes",
  ];
  const arrays = {};
  let repaired = false;
  for (const field of arrayFields) {
    const normalized = normalizeConstraintArray(requirement[field], field);
    arrays[field] = normalized.values;
    repaired ||= normalized.repaired;
    if (["colors", "materials", "design_elements"].includes(field) &&
        arrays[field].some((value) => /[\/、，,]/u.test(value))) {
      throw new TypeError(
        `Native Executable Look Contract 的 ${field} 必须使用独立数组元素`,
      );
    }
  }
  const contract = {
    ...requirement,
    request_id: cleanText(requirement.request_id),
    look_id: cleanText(requirement.look_id),
    category: cleanText(requirement.category).toLowerCase(),
    slot_key: cleanText(requirement.slot_key),
    product_type: cleanText(requirement.product_type),
    product_family: cleanText(requirement.product_family).toLowerCase(),
    item_name: cleanText(requirement.item_name),
    style_role: cleanText(requirement.style_role),
    fit: cleanText(requirement.fit),
    ...arrays,
    color: arrays.colors[0] || "",
    material: arrays.materials[0] || "",
    constraint_sources: normalizeConstraintSources(requirement.constraint_sources),
  };
  if (expectedRequestId && contract.request_id !== expectedRequestId) {
    throw new TypeError("Native Executable Look item request_id 与请求不一致");
  }
  if (expectedLookId && contract.look_id !== expectedLookId) {
    throw new TypeError("Native Executable Look item look_id 与当前 Look 不一致");
  }
  if (expectedCategory && contract.category !== expectedCategory) {
    throw new TypeError("Native Executable Look item category 与 slot 不一致");
  }
  const expectedSlotPrefix = `${contract.request_id}:${contract.look_id}:${contract.category}:`;
  if (!contract.slot_key.startsWith(expectedSlotPrefix)) {
    throw new TypeError("Native Executable Look item slot_key 未绑定当前请求、Look 和品类");
  }
  if (contract.item_name !== contract.product_type) {
    throw new TypeError("Native Executable Look item_name 必须等于 product_type");
  }
  validateExecutableProductContract(contract);
  const executableEvidence = [
    contract.product_type,
    contract.fit,
    ...contract.design_elements,
  ].join(" ");
  const missingRequired = contract.required_attributes.filter(
    (attribute) => !constraintSatisfied(attribute, executableEvidence),
  );
  const contradictedRequired = missingRequired.filter(
    (attribute) => constraintExplicitlyContradicted(attribute, executableEvidence),
  );
  if (contradictedRequired.length > 0) {
    throw new TypeError(
      `Native Executable Look 明确违反 required_attributes：${contradictedRequired.join("、")}`,
    );
  }
  const avoidConflicts = contract.avoid_attributes.filter(
    (attribute) => constraintSatisfied(attribute, executableEvidence),
  );
  if (avoidConflicts.length > 0) {
    throw new TypeError(
      `Native Executable Look 命中 avoid_attributes：${avoidConflicts.join("、")}`,
    );
  }
  const preferenceEvidence = [
    executableEvidence,
    ...contract.materials,
    ...contract.colors,
  ].join(" ");
  const missingPreferred = contract.preferred_attributes.filter(
    (attribute) => !constraintSatisfied(attribute, preferenceEvidence),
  );
  contract.missing_preferred_attributes = missingPreferred;
  contract.preferred_match_score = contract.preferred_attributes.length === 0
    ? 100
    : Math.round(
      ((contract.preferred_attributes.length - missingPreferred.length) /
        contract.preferred_attributes.length) * 100,
    );
  contract.required_attribute_constraints = contract.required_attributes.map(
    requiredConstraintRule,
  );
  contract.missing_required_attributes = missingRequired;
  contract.warnings = uniqueStrings([
    ...(Array.isArray(requirement.warnings) ? requirement.warnings : []),
    ...missingRequired.map((attribute) => `硬约束缺少明确落实证据：${attribute}`),
    ...missingPreferred.map((attribute) => `偏好属性未体现：${attribute}`),
    ...(contract.colors.length === 0 ? ["颜色信息缺失"] : []),
    ...(contract.materials.length === 0 ? ["材质信息缺失"] : []),
  ]);
  return {contract, repaired};
}

function splitProductAlternatives(value) {
  const normalized = normalizeExecutableItemName(value);
  if (!normalized) return [];
  const alternatives = normalized.split(/\s*(?:或者|或)\s*/u).filter(Boolean);
  return uniqueStrings(alternatives.length > 1 ? alternatives : [normalized]);
}

function extractLeadingColorAlternatives(value) {
  const productType = normalizeExecutableItemName(value);
  const match = /^([^/、，,]{1,6}色)\s*[\/、，,]\s*([^/、，,]{1,6}色)(.+)$/u
    .exec(productType);
  return match
    ? {product_type: cleanText(match[3]), colors: [match[1], match[2]]}
    : {product_type: productType, colors: []};
}

function inferProductFamily(category, ...values) {
  const rules = FAMILY_RULES[cleanText(category).toLowerCase()] || [];
  const evidence = values.flatMap((value) => Array.isArray(value) ? value : [value])
    .map(cleanText).filter(Boolean).join(" ");
  return rules.find(([, pattern]) => pattern.test(evidence))?.[0] || "";
}

function assessFitFamilyCompatibility(category, productFamily, fit) {
  const normalizedCategory = cleanText(category).toLowerCase();
  const normalizedFamily = cleanText(productFamily).toLowerCase();
  const fitText = cleanText(fit);
  const fitFamily = inferProductFamily(normalizedCategory, fitText);
  if (!fitText || !fitFamily) {
    return Object.freeze({
      status: FIT_FAMILY_STATUS.NEUTRAL,
      fit_family: fitFamily,
    });
  }
  const explicitConflict = EXPLICIT_FIT_CONFLICT_RULES[normalizedFamily];
  if (explicitConflict?.test(fitText)) {
    return Object.freeze({
      status: FIT_FAMILY_STATUS.CONFLICT,
      fit_family: fitFamily,
    });
  }
  if (fitFamily === normalizedFamily) {
    return Object.freeze({
      status: FIT_FAMILY_STATUS.COMPATIBLE,
      fit_family: fitFamily,
    });
  }
  const pair = [normalizedFamily, fitFamily].sort().join(":");
  if (FIT_COMPATIBLE_FAMILY_PAIRS.has(pair)) {
    return Object.freeze({
      status: FIT_FAMILY_STATUS.COMPATIBLE,
      fit_family: fitFamily,
    });
  }
  return Object.freeze({
    status: FIT_FAMILY_STATUS.NEUTRAL,
    fit_family: fitFamily,
  });
}

function categoryForFamily(productFamily) {
  return FAMILY_CATEGORY[cleanText(productFamily).toLowerCase()] || "";
}

function categoryForSlotRole(slotRole) {
  return SLOT_CATEGORY[cleanText(slotRole).toLowerCase()] || "";
}

function compileExecutableProductContract(
  semanticItem = {},
  {
    requestId = "",
    lookId = "",
    category = "",
    itemIndex = 0,
    gender = "",
    style = "",
    scene = "",
    constraintSources = [],
  } = {},
) {
  if (!semanticItem || typeof semanticItem !== "object" ||
      Array.isArray(semanticItem)) {
    throw new TypeError("Semantic Look item 必须是对象");
  }
  const resolvedRequestId = cleanText(requestId);
  const resolvedLookId = cleanText(lookId);
  const resolvedCategory = categoryForSlotRole(category) ||
    categoryForSlotRole(
      semanticItem.slot_role || semanticItem.slotRole || semanticItem.category,
    );
  if (!resolvedRequestId || !resolvedLookId || !resolvedCategory) {
    throw new TypeError("Contract Compiler 缺少 request_id、look_id 或有效 slot");
  }
  if (!Number.isInteger(itemIndex) || itemIndex < 0) {
    throw new TypeError("Contract Compiler itemIndex 必须是非负整数");
  }

  const productType = normalizeExecutableItemName(
    semanticItem.product_type || semanticItem.productType,
  );
  const productFamily = inferProductFamily(resolvedCategory, productType);
  if (!productFamily || !isConcreteProductType(productType, resolvedCategory)) {
    throw new TypeError(
      `Semantic Look item product_type 与 ${resolvedCategory} slot 冲突`,
    );
  }

  const upstreamSources = normalizeConstraintSources(constraintSources);
  const upstreamRequired = upstreamSources
    .filter((entry) => entry.level === "required");
  const upstreamPreferred = upstreamSources
    .filter((entry) => entry.level === "preferred");
  const upstreamAvoid = upstreamSources
    .filter((entry) => entry.level === "avoid");
  const aiRequired = uniqueStrings(
    Array.isArray(semanticItem.required_attributes)
      ? semanticItem.required_attributes
      : [],
  );
  const aiPreferred = uniqueStrings(
    Array.isArray(semanticItem.preferred_attributes)
      ? semanticItem.preferred_attributes
      : [],
  );
  const aiAvoid = uniqueStrings(
    Array.isArray(semanticItem.avoid_attributes)
      ? semanticItem.avoid_attributes
      : [],
  );
  const downgradedAiRequired = aiRequired.filter((attribute) =>
    !upstreamRequired.some((entry) =>
      canonicalizeAttribute(entry.value) === canonicalizeAttribute(attribute) ||
      constraintSatisfied(attribute, entry.value) ||
      constraintSatisfied(entry.value, attribute)));
  const constraintSourceRecords = normalizeConstraintSources([
    ...upstreamSources,
    ...downgradedAiRequired.map((value) => ({
      value,
      level: "preferred",
      source: "look_ai",
    })),
    ...aiPreferred.map((value) => ({
      value,
      level: "preferred",
      source: "look_ai",
    })),
    ...aiAvoid.map((value) => ({
      value,
      level: "avoid",
      source: "look_ai",
    })),
  ]);

  const contract = {
    request_id: resolvedRequestId,
    look_id: resolvedLookId,
    category: resolvedCategory,
    slot_key: `${resolvedRequestId}:${resolvedLookId}:${resolvedCategory}:${itemIndex}`,
    product_type: productType,
    product_family: productFamily,
    item_name: productType,
    slot_role: cleanText(
      semanticItem.slot_role || semanticItem.slotRole || resolvedCategory,
    ).toLowerCase(),
    style_role: cleanText(semanticItem.style_role || semanticItem.styleRole),
    fit: cleanText(semanticItem.fit),
    colors: splitAttributeValues(semanticItem.colors, semanticItem.color),
    materials: splitAttributeValues(
      semanticItem.materials,
      semanticItem.material,
    ),
    design_elements: splitAttributeValues(
      semanticItem.design_elements,
      semanticItem.designElements,
    ),
    required_attributes: uniqueStrings(upstreamRequired.map((entry) => entry.value)),
    preferred_attributes: uniqueStrings([
      ...upstreamPreferred.map((entry) => entry.value),
      ...aiPreferred,
      ...downgradedAiRequired,
    ]),
    avoid_attributes: uniqueStrings([
      ...upstreamAvoid.map((entry) => entry.value),
      ...aiAvoid,
    ]),
    constraint_sources: constraintSourceRecords,
    gender: cleanText(gender),
    style: cleanText(style),
    scene: cleanText(scene),
  };

  return normalizeNativeExecutableProductContract(contract, {
    expectedRequestId: resolvedRequestId,
    expectedLookId: resolvedLookId,
    expectedCategory: resolvedCategory,
  }).contract;
}

function isConcreteProductType(value, category = "") {
  const productType = cleanText(value);
  if (!productType || GENERIC_PRODUCT_NAMES.has(productType)) return false;
  if (ABSTRACT_PRODUCT_PATTERN.test(productType) ||
      STRATEGY_TEXT_PATTERN.test(productType) ||
      EXPLANATION_PATTERN.test(productType) ||
      MULTI_PRODUCT_PATTERN.test(productType)) return false;
  if (/[A-Za-z]{2,}/u.test(productType)) return false;
  return Boolean(inferProductFamily(category, productType));
}

function normalizeCategoryForCandidate(category, productType) {
  const declared = cleanText(category).toLowerCase();
  if (inferProductFamily(declared, productType)) return declared;
  for (const candidateCategory of Object.keys(FAMILY_RULES)) {
    if (inferProductFamily(candidateCategory, productType)) return candidateCategory;
  }
  return declared;
}

function structuredBlueprintCandidates(blueprint = {}) {
  const items = blueprint.must_have_items || blueprint.mustHaveItems || {};
  if (!items || typeof items !== "object") return [];
  return Object.entries(items).flatMap(([declaredCategory, rawValues]) => {
    const values = Array.isArray(rawValues) ? rawValues : [rawValues];
    return values.flatMap((rawValue) => {
      const source = rawValue && typeof rawValue === "object"
        ? rawValue
        : {product_type: rawValue};
      return splitProductAlternatives(
        source.product_type || source.item_name || source.itemName,
      ).map((rawProductType) => {
        const separated = extractLeadingColorAlternatives(rawProductType);
        const productType = separated.product_type;
        const category = normalizeCategoryForCandidate(declaredCategory, productType);
        return {
          category,
          product_type: productType,
          product_family: cleanText(
            source.product_family || source.productFamily,
          ).toLowerCase() || inferProductFamily(category, productType),
          colors: splitAttributeValues(
            separated.colors,
            source.colors,
            source.color,
          ),
          materials: splitAttributeValues(source.materials, source.material),
          design_elements: splitAttributeValues(
            source.design_elements,
            source.designElements,
          ),
          source: "blueprint",
        };
      });
    });
  });
}

function blueprintCategoryConstraintCandidates(blueprint = {}, category = "") {
  const normalizedCategory = cleanText(category).toLowerCase();
  const items = blueprint.must_have_items || blueprint.mustHaveItems || {};
  const rawValues = Array.isArray(items?.[normalizedCategory])
    ? items[normalizedCategory]
    : items?.[normalizedCategory] == null ? [] : [items[normalizedCategory]];
  return rawValues.flatMap((rawValue) => {
    const source = rawValue && typeof rawValue === "object"
      ? rawValue
      : {product_type: rawValue};
    const rawProductType = cleanText(
      source.product_type || source.item_name || source.itemName,
    );
    const alternatives = splitProductAlternatives(rawProductType);
    const alternativesAreProducts = alternatives.length > 1 &&
      alternatives.every((value) => isConcreteProductType(
        value,
        normalizedCategory,
      ));
    return (alternativesAreProducts ? alternatives : [rawProductType])
      .filter(Boolean)
      .map((value) => {
        const separated = extractLeadingColorAlternatives(value);
        return {
          category: normalizedCategory,
          product_type: separated.product_type,
          product_family: cleanText(
            source.product_family || source.productFamily,
          ).toLowerCase() || inferProductFamily(
            normalizedCategory,
            separated.product_type,
          ),
        };
      });
  });
}

function blueprintConstraintScope(
  blueprint = {},
  category = "",
  semanticItem = {},
) {
  const normalizedCategory = cleanText(category).toLowerCase();
  const allCandidates = blueprintCategoryConstraintCandidates(
    blueprint,
    normalizedCategory,
  );
  const explicitShared = allCandidates
    .filter((candidate) => isExplicitCategoryConstraint(candidate.product_type))
    .flatMap((candidate) =>
      extractBlueprintAttributeConstraints(candidate.product_type));
  const candidates = allCandidates
    .filter((candidate) => !isExplicitCategoryConstraint(candidate.product_type))
    .map((candidate) => ({
      ...candidate,
      constraints: extractBlueprintAttributeConstraints(candidate.product_type),
    }))
    .filter((candidate) => isConcreteProductType(
      candidate.product_type,
      normalizedCategory,
    ) || (candidate.product_family && candidate.constraints.length > 0));
  const sharedFromIntersection = candidates.length === 0
    ? []
    : candidates[0].constraints.filter((constraint) => {
      const key = constraintScopeKey(constraint);
      return candidates.slice(1).every((candidate) =>
        candidate.constraints.some((value) => constraintScopeKey(value) === key));
    });
  const sharedConstraints = uniqueStrings([
    ...explicitShared,
    ...sharedFromIntersection,
  ]);
  const sharedKeys = new Set(sharedConstraints.map(constraintScopeKey));
  const productType = normalizeExecutableItemName(
    semanticItem.product_type || semanticItem.productType ||
      semanticItem.item_name || semanticItem.itemName,
  );
  const productFamily = inferProductFamily(normalizedCategory, productType);
  const evidence = [
    productType,
    cleanText(semanticItem.fit),
    ...(Array.isArray(semanticItem.design_elements)
      ? semanticItem.design_elements
      : []),
  ].join(" ");
  const matchedCandidate = candidates.map((candidate, index) => {
    const candidateType = cleanText(candidate.product_type);
    const exact = candidateType === productType;
    const contains = candidateType && productType &&
      (candidateType.includes(productType) || productType.includes(candidateType));
    const sameFamily = productFamily &&
      candidate.product_family === productFamily;
    const candidateSpecific = candidate.constraints.filter(
      (constraint) => !sharedKeys.has(constraintScopeKey(constraint)),
    );
    const satisfied = candidateSpecific.filter((constraint) =>
      constraintSatisfied(constraint, evidence)).length;
    const conflicts = candidateSpecific.filter((constraint) =>
      !constraintSatisfied(constraint, evidence) &&
      constraintExplicitlyContradicted(constraint, evidence)).length;
    const score = (exact ? 100 : 0) + (contains ? 60 : 0) +
      (sameFamily ? 30 : 0) + (satisfied * 20) - (conflicts * 100) - index / 100;
    return {...candidate, candidateSpecific, score};
  }).filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)[0];
  return Object.freeze({
    shared_constraints: Object.freeze(sharedConstraints),
    candidate_constraints: Object.freeze(
      uniqueStrings(matchedCandidate?.candidateSpecific || []),
    ),
    matched_candidate: matchedCandidate?.product_type || "",
  });
}

function structuralProductType(category, productFamily, fit = "", material = "") {
  const evidence = `${cleanText(fit)} ${cleanText(material)}`;
  const highWaist = /高腰/u.test(evidence) ? "高腰" : "";
  const shortFitted = [
    /短款|不过胯/u.test(evidence) ? "短款" : "",
    /修身|合身/u.test(evidence) ? "修身" : "",
  ].join("");
  switch (productFamily) {
    case "knitwear": return `${shortFitted || "修身"}针织衫`;
    case "shirt": return `${shortFitted || "修身"}衬衫`;
    case "blouse": return `${shortFitted || "修身"}上衣`;
    case "tshirt": return `${shortFitted || "合身"}T恤`;
    case "vest": return `${shortFitted || "修身"}背心`;
    case "top": return `${shortFitted || "合身"}上衣`;
    case "skirt": return `${highWaist}A字半身裙`;
    case "wide_leg_pants": return `${highWaist}垂感阔腿裤`;
    case "straight_pants": return `${highWaist}直筒九分裤`;
    case "shorts": return `${highWaist}A字短裤`;
    case "jeans": return `${highWaist}直筒牛仔裤`;
    case "pants": return `${highWaist}直筒裤`;
    case "dress": return "收腰A字连衣裙";
    case "mary_jane": return "圆头低跟玛丽珍鞋";
    case "pointed_flat": return "尖头浅口低跟鞋";
    case "heels": return "尖头低跟单鞋";
    case "loafers": return "浅口乐福鞋";
    case "boots": return "修身短靴";
    case "sneakers": return "轻量低帮运动鞋";
    case "flats": return "浅口平底单鞋";
    case "shoes": return "浅口单鞋";
    case "blazer": return "短款结构感西装外套";
    case "coat": return "垂感长款大衣";
    case "jacket": return "短款合身外套";
    case "cardigan": return "短款针织开衫";
    case "bag": return "结构感手提包";
    case "hat": return "合身帽子";
    case "jewelry": return "精致耳饰";
    case "belt": return "细腰带";
    case "scarf": return "轻薄丝巾";
    case "socks": return "及踝袜";
    case "watch": return "简约腕表";
    case "glasses": return "轻量镜框眼镜";
    default:
      return category === "dress" ? "收腰连衣裙" : "";
  }
}

function candidateFromRequirement(requirement, source) {
  const category = cleanText(requirement.category).toLowerCase();
  const separated = extractLeadingColorAlternatives(
    requirement.product_type || requirement.productType ||
      requirement.item_name || requirement.itemName,
  );
  const productType = separated.product_type;
  const semanticProductFamily = inferProductFamily(
    category,
    productType,
    requirement.fit,
    requirement.material,
    requirement.materials,
  );
  const productFamily = cleanText(
    requirement.product_family || requirement.productFamily,
  ).toLowerCase() || semanticProductFamily;
  return {
    category,
    product_type: productType,
    product_family: productFamily,
    semantic_product_family: semanticProductFamily,
    colors: splitAttributeValues(
      separated.colors,
      requirement.colors,
      requirement.color,
    ),
    materials: splitAttributeValues(requirement.materials, requirement.material),
    design_elements: splitAttributeValues(
      requirement.design_elements,
      requirement.designElements,
    ),
    source,
  };
}

function normalizeExecutableProductRequirement(
  requirement = {},
  {originalRequirement = {}, blueprint = {}} = {},
) {
  const category = cleanText(
    requirement.category || originalRequirement.category,
  ).toLowerCase();
  const original = candidateFromRequirement(
    {...originalRequirement, category},
    "look",
  );
  const applied = candidateFromRequirement({...requirement, category}, "applied");
  const fit = cleanText(originalRequirement.fit || requirement.fit);
  const fitFamily = inferProductFamily(
    category,
    fit,
    originalRequirement.material,
    requirement.material,
  );
  const productFamily = cleanText(
    originalRequirement.product_family || originalRequirement.productFamily ||
      requirement.product_family || requirement.productFamily,
  ).toLowerCase() || fitFamily || (
    isConcreteProductType(original.product_type, category) ||
      !["top", "pants", "shoes", "accessory"].includes(
        original.product_family,
      )
      ? original.product_family
      : ""
  );
  const blueprintCandidates = structuredBlueprintCandidates(blueprint);
  const candidates = [original, applied, ...blueprintCandidates]
    .filter((candidate) => candidate.category === category)
    .filter((candidate) => !productFamily ||
      candidate.product_family === productFamily)
    .filter((candidate) => !candidate.semantic_product_family ||
      candidate.semantic_product_family === candidate.product_family)
    .filter((candidate) => isConcreteProductType(
      candidate.product_type,
      category,
    ));
  const selected = candidates.find((candidate) => candidate.source === "look") ||
    candidates.find((candidate) => candidate.source === "blueprint") ||
    candidates.find((candidate) => candidate.source === "applied");
  const resolvedFamily = productFamily || selected?.product_family ||
    inferProductFamily(
      category,
      fit,
      requirement.material,
      originalRequirement.material,
    );
  const productType = selected?.product_type || structuralProductType(
    category,
    resolvedFamily,
    fit,
    requirement.material || originalRequirement.material,
  );

  const colors = splitAttributeValues(
    requirement.colors,
    requirement.color,
    originalRequirement.colors,
    originalRequirement.color,
    selected?.colors,
  );
  const materials = splitAttributeValues(
    requirement.materials,
    requirement.material,
    originalRequirement.materials,
    originalRequirement.material,
    selected?.materials,
  );
  const designElements = uniqueStrings([
    ...splitAttributeValues(
      requirement.design_elements,
      requirement.designElements,
      originalRequirement.design_elements,
      originalRequirement.designElements,
      selected?.design_elements,
    ),
  ]);
  const requiredAttributes = uniqueStrings([
    ...(Array.isArray(requirement.required_attributes)
      ? requirement.required_attributes
      : []),
    ...(Array.isArray(originalRequirement.required_attributes)
      ? originalRequirement.required_attributes
      : []),
  ]);
  const preferredAttributes = uniqueStrings([
    ...(Array.isArray(requirement.preferred_attributes)
      ? requirement.preferred_attributes
      : []),
    ...(Array.isArray(originalRequirement.preferred_attributes)
      ? originalRequirement.preferred_attributes
      : []),
  ]);
  const avoidAttributes = uniqueStrings([
    ...(Array.isArray(requirement.avoid_attributes)
      ? requirement.avoid_attributes
      : []),
    ...(Array.isArray(originalRequirement.avoid_attributes)
      ? originalRequirement.avoid_attributes
      : []),
  ]);
  const contract = {
    ...requirement,
    request_id: cleanText(
      requirement.request_id || requirement.requestId ||
        originalRequirement.request_id || originalRequirement.requestId,
    ),
    look_id: cleanText(
      requirement.look_id || requirement.lookId ||
        originalRequirement.look_id || originalRequirement.lookId,
    ),
    category,
    slot_key: cleanText(
      requirement.slot_key || requirement.slotKey ||
        originalRequirement.slot_key || originalRequirement.slotKey,
    ),
    product_type: productType,
    product_family: resolvedFamily,
    item_name: productType,
    style_role: cleanText(
      requirement.style_role || requirement.styleRole ||
        originalRequirement.style_role || originalRequirement.styleRole,
    ),
    fit,
    colors,
    materials,
    design_elements: designElements,
    required_attributes: requiredAttributes,
    preferred_attributes: preferredAttributes,
    avoid_attributes: avoidAttributes,
    color: colors[0] || "",
    material: materials[0] || "",
    attributes: {
      colors,
      materials,
      design_elements: designElements,
    },
  };
  return validateExecutableProductContract(contract);
}

function validateExecutableProductContract(contract = {}) {
  for (const field of [
    "request_id", "look_id", "category", "slot_key", "product_type",
    "product_family", "item_name",
  ]) {
    if (!cleanText(contract[field])) {
      throw new TypeError(`Executable Product Contract 缺少 ${field}`);
    }
  }
  if (categoryForFamily(contract.product_family) !== contract.category) {
    throw new TypeError(
      "Executable Product Contract 的 product_family 与 category 不一致",
    );
  }
  if (!Array.isArray(contract.colors) || !Array.isArray(contract.materials) ||
      !Array.isArray(contract.design_elements)) {
    throw new TypeError("Executable Product Contract 的属性字段必须是数组");
  }
  if (!isConcreteProductType(contract.product_type, contract.category) ||
      contract.item_name !== contract.product_type) {
    throw new TypeError("Executable Product Contract 缺少单一具体商品名称");
  }
  if (inferProductFamily(contract.category, contract.product_type) !==
      contract.product_family) {
    throw new TypeError(
      "Executable Product Contract 的 product_type 与 product_family 冲突",
    );
  }
  const fitCompatibility = assessFitFamilyCompatibility(
    contract.category,
    contract.product_family,
    contract.fit,
  );
  if (fitCompatibility.status === FIT_FAMILY_STATUS.CONFLICT) {
    const error = new TypeError(
      "Executable Product Contract 的 fit 与 product_family 冲突",
    );
    error.contractDiagnostics = {
      request_id: cleanText(contract.request_id),
      look_id: cleanText(contract.look_id),
      slot_key: cleanText(contract.slot_key),
      category: cleanText(contract.category),
      product_type: cleanText(contract.product_type),
      fit: cleanText(contract.fit),
      product_family: cleanText(contract.product_family),
      fit_family: fitCompatibility.fit_family,
      fit_family_status: fitCompatibility.status,
    };
    throw error;
  }
  return contract;
}

module.exports = {
  FAMILY_RULES,
  FIT_FAMILY_STATUS,
  assessFitFamilyCompatibility,
  blueprintConstraintScope,
  canonicalizeAttribute,
  categoryForSlotRole,
  categoryForFamily,
  compileExecutableProductContract,
  extractCanonicalAttributeValues,
  extractBlueprintAttributeConstraints,
  inferProductFamily,
  isConcreteProductType,
  extractLeadingColorAlternatives,
  normalizeExecutableItemName,
  normalizeNativeExecutableProductContract,
  normalizeExecutableProductRequirement,
  splitAttributeValues,
  splitProductAlternatives,
  structuredBlueprintCandidates,
  validateExecutableProductContract,
};
