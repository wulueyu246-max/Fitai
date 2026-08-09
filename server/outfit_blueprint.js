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

function normalizeMustHaveItems(value) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  return Object.freeze(Object.fromEntries(BLUEPRINT_ITEM_KEYS.map((key) => [
    key,
    Object.freeze(cleanList(source[key], 8)),
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
  const itemName = desiredItems.length > 0
    ? desiredItems[Math.abs(variantIndex) % desiredItems.length]
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
