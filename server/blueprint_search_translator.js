const {
  blueprintItemsForRequirement,
} = require("./outfit_blueprint");

const VAGUE_MARKETPLACE_TERMS = new Set([
  "少女",
  "女生",
  "女孩",
  "男生",
  "女人",
  "男人",
  "氛围感",
  "高级感",
  "时尚",
  "穿搭",
  "造型",
  "风格",
]);

function cleanText(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function cleanList(value, limit = 20) {
  const values = Array.isArray(value) ? value : [];
  return [...new Set(values.flatMap((entry) => cleanText(entry)
    .split(/[、,，/|]+/u)
    .map(cleanText)
    .filter(Boolean)))].slice(0, limit);
}

function audienceForGender(gender) {
  if (gender === "male") return "男士";
  if (gender === "female") return "女士";
  return "";
}

function normalizedEvidence(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/gu, "");
}

function usefulMarketplaceElement(value, itemName) {
  const text = cleanText(value);
  if (!text || VAGUE_MARKETPLACE_TERMS.has(text)) return false;
  const normalized = normalizedEvidence(text);
  const item = normalizedEvidence(itemName);
  if (!normalized || normalized === item) return false;
  return normalized.length >= 2 && normalized.length <= 18;
}

function sourceFieldsForCategory(category, blueprint) {
  const common = {
    core: cleanList(blueprint.core_elements),
    colors: cleanList(blueprint.color_palette),
    materials: cleanList(blueprint.material_direction),
    silhouettes: cleanList(blueprint.silhouette_strategy),
    visuals: cleanList(blueprint.visual_keywords),
  };
  switch (category) {
    case "shoes":
      return [common.core, common.materials, common.colors, common.visuals];
    case "bag":
    case "hat":
    case "accessory":
      return [common.core, common.materials, common.colors, common.visuals];
    default:
      return [
        common.core,
        common.silhouettes,
        common.materials,
        common.colors,
        common.visuals,
      ];
  }
}

function pickSourceElements(category, blueprint, itemName, limit = 3) {
  const selected = [];
  for (const field of sourceFieldsForCategory(category, blueprint)) {
    const candidate = field.find((value) =>
      usefulMarketplaceElement(value, itemName) && !selected.includes(value));
    if (candidate) selected.push(candidate);
    if (selected.length >= limit) break;
  }
  return selected;
}

function composeQuery(audience, elements, itemName) {
  const itemEvidence = normalizedEvidence(itemName);
  const values = [audience];
  for (const element of elements) {
    const evidence = normalizedEvidence(element);
    if (!evidence || itemEvidence.includes(evidence)) continue;
    values.push(element);
  }
  values.push(itemName);
  return [...new Set(values.map(cleanText).filter(Boolean))].join(" ");
}

function queryRecord({category, query, itemName, sourceElements}) {
  return Object.freeze({
    category,
    query,
    source_elements: Object.freeze([...sourceElements]),
    query_reason: sourceElements.length > 1
      ? `根据穿搭蓝图中的具体单品“${itemName}”及元素“${sourceElements.slice(1).join("、")}”生成`
      : `根据穿搭蓝图中的具体单品“${itemName}”生成`,
  });
}

function translateBlueprintSearchRequirement(
  requirement = {},
  blueprint = {},
  {variantIndex = 0} = {},
) {
  const itemNames = blueprintItemsForRequirement(blueprint, requirement);
  if (itemNames.length === 0) return {...requirement};
  const audience = audienceForGender(requirement.gender);
  const primaryItem = itemNames[Math.abs(variantIndex) % itemNames.length];
  const elements = pickSourceElements(
    requirement.category,
    blueprint,
    primaryItem,
  );
  const primarySources = [primaryItem, ...elements];
  const primary = queryRecord({
    category: requirement.category,
    query: composeQuery(audience, elements, primaryItem),
    itemName: primaryItem,
    sourceElements: primarySources,
  });
  const records = [primary];

  const alternateItem = itemNames.length > 1
    ? itemNames[(Math.abs(variantIndex) + 1) % itemNames.length]
    : "";
  if (alternateItem && alternateItem !== primaryItem) {
    const alternateElements = pickSourceElements(
      requirement.category,
      blueprint,
      alternateItem,
      1,
    );
    records.push(queryRecord({
      category: requirement.category,
      query: composeQuery(audience, alternateElements, alternateItem),
      itemName: alternateItem,
      sourceElements: [alternateItem, ...alternateElements],
    }));
  }
  records.push(queryRecord({
    category: requirement.category,
    query: composeQuery(audience, [], primaryItem),
    itemName: primaryItem,
    sourceElements: [primaryItem],
  }));

  const uniqueRecords = records.filter((record, index, all) =>
    record.query && all.findIndex((candidate) => candidate.query === record.query) === index)
    .slice(0, 3);
  return {
    ...requirement,
    item_name: primaryItem,
    search_keywords: uniqueRecords.map((record) => record.query),
    query_reason: primary.query_reason,
    source_elements: [...primary.source_elements],
    translated_queries: uniqueRecords.map((record) => ({...record})),
  };
}

module.exports = {
  VAGUE_MARKETPLACE_TERMS,
  translateBlueprintSearchRequirement,
};
