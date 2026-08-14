const BLUEPRINT_ITEM_KEYS = Object.freeze([
  "top",
  "bottom",
  "dress",
  "shoes",
  "outerwear",
  "bag",
  "hat",
  "socks",
  "jewelry",
  "belt",
  "scarf",
  "glasses",
  "watch",
  "accessory",
]);

const BLUEPRINT_SOURCES = Object.freeze([
  "ai_generated",
  "semantic_fallback",
]);

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanList(value, limit = 16) {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[、,，/|]+/u)
      : [];
  return [...new Set(values.map(cleanText).filter(Boolean))].slice(0, limit);
}

function normalizeTypedAnchorEvidence(value, limit = 48) {
  const source = Array.isArray(value) ? value : [];
  const allowedDomains = new Set([
    "style",
    "persona",
    "aesthetic_direction",
    "explicit_user_avoid_style",
  ]);
  const result = [];
  const seen = new Set();
  for (const item of source) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const evidence = cleanText(item.value || item.term);
    const domain = cleanText(item.evidence_domain || item.evidenceDomain);
    if (!evidence || !allowedDomains.has(domain)) continue;
    const key = `${domain}\u0000${evidence}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(Object.freeze({
      value: evidence,
      evidence_domain: domain,
      source: cleanText(item.source),
    }));
    if (result.length >= limit) break;
  }
  return result;
}

function normalizeStyleAnchorSignature(value) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  const rawDimensions = source.dimensions &&
    typeof source.dimensions === "object" &&
    !Array.isArray(source.dimensions)
    ? source.dimensions
    : {};
  const dimensions = Object.fromEntries(Object.entries(rawDimensions)
    .flatMap(([name, value]) => {
      const score = Number(value);
      return Number.isFinite(score)
        ? [[name, Math.round(Math.max(0, Math.min(100, score)))]]
        : [];
    }));
  return Object.freeze({
    style_traits: Object.freeze(cleanList(
      source.style_traits || source.styleTraits,
      48,
    )),
    silhouette_tendencies: Object.freeze(cleanList(
      source.silhouette_tendencies || source.silhouetteTendencies,
      32,
    )),
    material_tendencies: Object.freeze(cleanList(
      source.material_tendencies || source.materialTendencies,
      32,
    )),
    design_directions: Object.freeze(cleanList(
      source.design_directions || source.designDirections,
      48,
    )),
    dimensions: Object.freeze(dimensions),
    anti_drift: Object.freeze(cleanList(
      source.anti_drift || source.antiDrift,
      48,
    )),
    anti_drift_evidence: Object.freeze(normalizeTypedAnchorEvidence(
      source.anti_drift_evidence || source.antiDriftEvidence,
    )),
  });
}

function normalizeStyleAnchor(value) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  const strength = cleanText(source.anchor_strength || source.anchorStrength);
  return Object.freeze({
    core_style_anchor: cleanText(
      source.core_style_anchor || source.coreStyleAnchor,
    ),
    anchor_strength: strength === "strong" ? "strong" : "weak",
    allowed_style_variants: Object.freeze(cleanList(
      source.allowed_style_variants || source.allowedStyleVariants,
    )),
    disallowed_style_drift: Object.freeze(cleanList(
      source.disallowed_style_drift || source.disallowedStyleDrift,
    )),
    anti_drift_evidence: Object.freeze(normalizeTypedAnchorEvidence(
      source.anti_drift_evidence || source.antiDriftEvidence,
    )),
    style_anchor_signature: normalizeStyleAnchorSignature(
      source.style_anchor_signature || source.styleAnchorSignature,
    ),
  });
}

const CONCRETE_PRODUCT_ITEM_PATTERN =
  /(?:上衣|衬衫|针织衫|毛衣|背心|吊带|T恤|Polo|卫衣|裤|半身裙|连衣裙|裙装|裙|鞋|靴|凉鞋|单鞋|外套|西装|风衣|大衣|夹克|开衫|包|手袋|帽|袜|耳环|耳饰|项链|手链|戒指|胸针|腰带|皮带|丝巾|围巾|手表|眼镜)/iu;

const PRODUCT_ITEM_MATCH_FEATURES = Object.freeze([
  "A字", "百褶", "半身裙", "连衣裙", "迷笛裙", "短裙", "长裙",
  "阔腿裤", "九分裤", "直筒裤", "西装裤", "短裤", "牛仔裤",
  "衬衫", "针织衫", "毛衣", "背心", "吊带", "T恤", "Polo", "卫衣",
  "平底鞋", "尖头", "浅口", "玛丽珍", "芭蕾鞋", "乐福鞋", "凉鞋",
  "猫跟", "低跟", "高跟", "靴", "外套", "西装", "风衣", "大衣",
  "手提包", "斜挎包", "托特包", "帽", "袜", "耳饰", "项链", "腰带",
]);

function hasConcreteProductItem(value) {
  return CONCRETE_PRODUCT_ITEM_PATTERN.test(cleanText(value));
}

function splitOutsideItemGroups(text) {
  const parts = [];
  let current = "";
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (["（", "(", "【", "["].includes(character)) depth += 1;
    if (["）", ")", "】", "]"].includes(character)) {
      depth = Math.max(0, depth - 1);
    }
    const alternativeWord = depth === 0 && text.startsWith("或者", index)
      ? "或者"
      : depth === 0 && character === "或" ? "或" : "";
    if (alternativeWord || (depth === 0 && /[、,，/|]/u.test(character))) {
      const part = cleanText(current);
      if (part) parts.push(part);
      current = "";
      if (alternativeWord === "或者") index += 1;
      continue;
    }
    current += character;
  }
  const last = cleanText(current);
  if (last) parts.push(last);
  return parts;
}

function splitBlueprintItemNames(value) {
  const text = cleanText(value);
  if (!text) return [];
  const alternatives = splitOutsideItemGroups(text);
  if (alternatives.length < 2 || !alternatives.every(hasConcreteProductItem)) {
    return [text];
  }
  return [...new Set(alternatives)].slice(0, 8);
}

function normalizeBlueprintItemKey(value) {
  const key = cleanText(value).toLowerCase();
  if (BLUEPRINT_ITEM_KEYS.includes(key)) return key;
  if (key === "cap") return "hat";
  if (key === "accessories") return "accessory";
  if (key === "jewel" || key === "jewellery") return "jewelry";
  return "";
}

function blueprintItemNames(value) {
  if (typeof value === "string") return splitBlueprintItemNames(value);
  if (Array.isArray(value)) {
    return [...new Set(value.flatMap(blueprintItemNames))].slice(0, 8);
  }
  if (!value || typeof value !== "object") return [];
  const candidates = [
    value.items,
    value.item_names,
    value.itemNames,
    value.item_name,
    value.itemName,
    value.name,
    value.requirement,
    value.description,
  ];
  return [...new Set(candidates.flatMap(blueprintItemNames))].slice(0, 8);
}

function matchingBlueprintItem(desiredItems, requestedItemName) {
  const requested = normalizeEvidence(requestedItemName);
  if (requested.length < 3) return "";
  const exact = desiredItems.find((itemName) => {
    const desired = normalizeEvidence(itemName);
    return desired === requested || desired.includes(requested) ||
      requested.includes(desired);
  });
  if (exact) return exact;
  const requestedFeatures = PRODUCT_ITEM_MATCH_FEATURES.filter((feature) =>
    requested.includes(normalizeEvidence(feature)));
  if (requestedFeatures.length === 0) return "";
  const ranked = desiredItems.map((itemName, index) => ({
    itemName,
    index,
    score: requestedFeatures.filter((feature) =>
      normalizeEvidence(itemName).includes(normalizeEvidence(feature))).length,
  })).filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index);
  return ranked[0]?.itemName || "";
}

function normalizeMustHaveItems(value) {
  const collected = Object.fromEntries(BLUEPRINT_ITEM_KEYS.map((key) => [
    key,
    [],
  ]));
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const key = normalizeBlueprintItemKey(
        entry.category || entry.type || entry.item_category || entry.itemCategory,
      );
      if (key) {
        collected[key].push(...blueprintItemNames(entry));
        continue;
      }
      for (const [rawKey, nestedValue] of Object.entries(entry)) {
        const nestedKey = normalizeBlueprintItemKey(rawKey);
        if (!nestedKey) continue;
        collected[nestedKey].push(...blueprintItemNames(nestedValue));
      }
    }
  } else if (value && typeof value === "object") {
    for (const [rawKey, entry] of Object.entries(value)) {
      const key = normalizeBlueprintItemKey(rawKey);
      if (!key) continue;
      collected[key].push(...blueprintItemNames(entry));
    }
  }
  return Object.freeze(Object.fromEntries(BLUEPRINT_ITEM_KEYS.map((key) => [
    key,
    Object.freeze([...new Set(collected[key].map(cleanText).filter(Boolean))]
      .slice(0, 8)),
  ])));
}

function normalizeOutfitBlueprint(value, {
  styleProfile = {},
  styleSemantics = {},
  defaultSource = "ai_generated",
} = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  const mustHaveItems = normalizeMustHaveItems(
    source.must_have_items || source.mustHaveItems,
  );
  const styleIdentity = cleanText(
    source.style_identity || source.styleIdentity || styleProfile.primary_style ||
    styleProfile.source_text,
  );
  const visualKeywords = cleanList(
    source.visual_keywords || source.visualKeywords ||
    styleSemantics.must_express || styleProfile.must_have ||
    styleProfile.positive_keywords,
  );
  const avoidItems = cleanList(
    source.avoid_items || source.avoidItems ||
    styleSemantics.must_avoid || styleProfile.must_avoid ||
    styleProfile.negative_keywords,
  );
  const requestedSource = cleanText(
    source.blueprint_source || source.blueprintSource,
  );
  const blueprintSource = BLUEPRINT_SOURCES.includes(requestedSource)
    ? requestedSource
    : BLUEPRINT_SOURCES.includes(defaultSource) ? defaultSource : "ai_generated";

  return Object.freeze({
    blueprint_source: blueprintSource,
    style_identity: styleIdentity,
    character_impression: cleanText(
      source.character_impression || source.characterImpression ||
      styleProfile.interpretation || styleSemantics.interpretation_summary,
    ),
    visual_keywords: Object.freeze(visualKeywords),
    core_elements: Object.freeze(cleanList(
      source.core_elements || source.coreElements || styleSemantics.style_atoms,
    )),
    silhouette_strategy: Object.freeze(cleanList(
      source.silhouette_strategy || source.silhouetteStrategy ||
      styleProfile.silhouette,
    )),
    color_palette: Object.freeze(cleanList(
      source.color_palette || source.colorPalette || styleProfile.preferred_colors,
    )),
    material_direction: Object.freeze(cleanList(
      source.material_direction || source.materialDirection ||
      styleProfile.preferred_materials,
    )),
    must_have_items: mustHaveItems,
    avoid_items: Object.freeze(avoidItems),
    occasion_strategy: cleanText(
      source.occasion_strategy || source.occasionStrategy,
    ),
    style_anchor: normalizeStyleAnchor(
      source.style_anchor || source.styleAnchor,
    ),
  });
}

function blueprintItemKey(requirement = {}) {
  const subcategory = cleanText(
    requirement.search_subcategory || requirement.searchSubcategory ||
    requirement.accessory_type || requirement.accessoryType,
  ).toLowerCase();
  if (BLUEPRINT_ITEM_KEYS.includes(subcategory)) return subcategory;
  const category = cleanText(requirement.category).toLowerCase();
  return BLUEPRINT_ITEM_KEYS.includes(category) ? category : "";
}

function blueprintItemsForRequirement(blueprint = {}, requirement = {}) {
  const key = blueprintItemKey(requirement);
  const items = blueprint?.must_have_items?.[key];
  return Array.isArray(items) ? items.map(cleanText).filter(Boolean) : [];
}

function normalizeEvidence(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/gu, "");
}

function fragments(values) {
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const text = cleanText(value).toLowerCase();
    if (!text) continue;
    result.push(normalizeEvidence(text));
    try {
      const segmenter = new Intl.Segmenter("zh-CN", {granularity: "word"});
      for (const segment of segmenter.segment(text)) {
        if (segment.isWordLike) result.push(normalizeEvidence(segment.segment));
      }
    } catch {
      result.push(...text.split(/[\s,，、/|+-]+/u).map(normalizeEvidence));
    }
  }
  return [...new Set(result.filter((item) => item.length >= 2))];
}

function blueprintMatchAssessment(product = {}, requirement = {}, blueprint = {}) {
  const desiredItems = blueprintItemsForRequirement(blueprint, requirement);
  const avoidFragments = [...new Set((blueprint.avoid_items || [])
    .map(normalizeEvidence)
    .filter((item) => item.length >= 2))];
  const evidence = normalizeEvidence([
    product.title,
    product.brand,
    product.shop_name,
    product.material,
    product.style,
    product.color,
  ].filter(Boolean).join(" "));
  const matchedAvoid = avoidFragments.filter((token) => evidence.includes(token));
  if (matchedAvoid.length > 0) {
    return Object.freeze({
      configured: true,
      allowed: false,
      score: 0,
      matched_items: Object.freeze([]),
      matched_avoid: Object.freeze(matchedAvoid),
      matched_elements: Object.freeze([]),
      conflict_elements: Object.freeze(matchedAvoid),
    });
  }

  const desiredFragments = fragments([
    ...desiredItems,
    requirement.item_name,
    ...(blueprint.core_elements || []),
    ...(blueprint.visual_keywords || []),
    ...(blueprint.color_palette || []),
    ...(blueprint.material_direction || []),
  ]);
  const configured = desiredItems.length > 0 || [
    ...(blueprint.core_elements || []),
    ...(blueprint.visual_keywords || []),
    ...(blueprint.color_palette || []),
    ...(blueprint.material_direction || []),
  ].some((value) => cleanText(value));
  if (!configured) {
    return Object.freeze({
      configured: false,
      allowed: true,
      score: 60,
      matched_items: Object.freeze([]),
      matched_avoid: Object.freeze([]),
      matched_elements: Object.freeze([]),
      conflict_elements: Object.freeze([]),
    });
  }
  const matched = desiredFragments.filter((token) => evidence.includes(token));
  const directItemMatch = desiredItems.some((item) => {
    const normalized = normalizeEvidence(item);
    if (normalized && evidence.includes(normalized)) return true;
    const itemFragments = fragments([item]);
    if (itemFragments.length === 0) return false;
    const matchingFragments = itemFragments.filter((token) =>
      evidence.includes(token));
    return matchingFragments.length / itemFragments.length >= 0.5;
  });
  const coverage = desiredFragments.length > 0
    ? Math.min(1, matched.length / Math.min(desiredFragments.length, 5))
    : 0;
  const score = Math.round(Math.min(
    100,
    30 + (directItemMatch ? 35 : 0) + coverage * 35,
  ));
  return Object.freeze({
    configured: true,
    allowed: true,
    score,
    matched_items: Object.freeze(matched),
    matched_avoid: Object.freeze([]),
    matched_elements: Object.freeze(matched),
    conflict_elements: Object.freeze([]),
  });
}

function blueprintMatchPassesHardGate(assessment = {}, intentPriorityScore = 0) {
  if (assessment.allowed === false) return false;
  const priority = Number(intentPriorityScore);
  if (!assessment.configured || !Number.isFinite(priority) || priority < 80) {
    return true;
  }
  return Number(assessment.score) >= 50;
}

function applyBlueprintToRequirement(requirement = {}, blueprint = {}, variantIndex = 0) {
  const desiredItems = blueprintItemsForRequirement(blueprint, requirement);
  if (desiredItems.length === 0) {
    return {
      ...requirement,
      negative_keywords: [...new Set([
        ...(Array.isArray(requirement.negative_keywords)
          ? requirement.negative_keywords
          : []),
        ...(blueprint.avoid_items || []),
      ].map(cleanText).filter(Boolean))],
      blueprint_required: false,
    };
  }
  const matchedItem = matchingBlueprintItem(
    desiredItems,
    requirement.item_name || requirement.itemName,
  );
  const itemName = desiredItems.length > 0
    ? matchedItem || desiredItems[Math.abs(variantIndex) % desiredItems.length]
    : cleanText(requirement.item_name);
  const audience = requirement.gender === "male"
    ? "男士"
    : requirement.gender === "female" ? "女士" : "";
  const visualKeyword = cleanText(blueprint.visual_keywords?.[
    Math.abs(variantIndex) % Math.max(blueprint.visual_keywords?.length || 1, 1)
  ]);
  const color = cleanText(requirement.color) || cleanText(blueprint.color_palette?.[0]);
  const material = cleanText(requirement.material) ||
    cleanText(blueprint.material_direction?.[0]);
  const generatedKeywords = desiredItems.length > 0 && itemName ? [
    [audience, visualKeyword, itemName].filter(Boolean).join(" "),
    [audience, color, material, itemName].filter(Boolean).join(" "),
  ] : [];
  return {
    ...requirement,
    item_name: itemName || requirement.item_name,
    color,
    material,
    style: cleanText(requirement.style) || cleanText(blueprint.style_identity),
    search_keywords: [...new Set([
      ...generatedKeywords,
      ...(desiredItems.length === 0 && Array.isArray(requirement.search_keywords)
        ? requirement.search_keywords
        : []),
    ].map(cleanText).filter(Boolean))].slice(0, 3),
    negative_keywords: [...new Set([
      ...(Array.isArray(requirement.negative_keywords)
        ? requirement.negative_keywords
        : []),
      ...(blueprint.avoid_items || []),
    ].map(cleanText).filter(Boolean))],
    blueprint_required: desiredItems.length > 0,
  };
}

function blueprintHasCoreItems(blueprint = {}) {
  const items = blueprint.must_have_items || {};
  const hasTopBottom = (items.top?.length || items.outerwear?.length) &&
    items.bottom?.length;
  const hasDress = items.dress?.length;
  return Boolean((hasTopBottom || hasDress) && items.shoes?.length);
}

function enrichBlueprintFromLooks(blueprint = {}, looks = []) {
  const normalized = normalizeOutfitBlueprint(blueprint);
  const collected = Object.fromEntries(BLUEPRINT_ITEM_KEYS.map((key) => [
    key,
    [...(normalized.must_have_items?.[key] || [])],
  ]));
  for (const look of Array.isArray(looks) ? looks : []) {
    for (const item of Array.isArray(look?.items) ? look.items : []) {
      const key = blueprintItemKey(item);
      const itemName = cleanText(item?.item_name || item?.itemName);
      if (!key || !itemName || collected[key].includes(itemName)) continue;
      collected[key].push(itemName);
    }
  }
  return normalizeOutfitBlueprint({
    ...normalized,
    must_have_items: collected,
  });
}

module.exports = {
  BLUEPRINT_ITEM_KEYS,
  BLUEPRINT_SOURCES,
  applyBlueprintToRequirement,
  blueprintHasCoreItems,
  blueprintMatchPassesHardGate,
  blueprintItemKey,
  blueprintItemsForRequirement,
  blueprintMatchAssessment,
  enrichBlueprintFromLooks,
  normalizeOutfitBlueprint,
};
