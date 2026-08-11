"use strict";

const {
  validateExecutableProductContract,
} = require("./executable_product_requirement");

const VAGUE_MARKETPLACE_TERMS = new Set([
  "少女", "女生", "女孩", "男生", "女人", "男人", "氛围感", "高级感",
  "时尚", "穿搭", "造型", "风格",
]);

function cleanText(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function normalizedEvidence(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/gu, "");
}

function audienceForGender(gender) {
  if (gender === "male") return "男士";
  if (gender === "female") return "女士";
  return "";
}

function safeDesignElements(values, productType) {
  const productEvidence = normalizedEvidence(productType);
  return [...new Set((Array.isArray(values) ? values : [])
    .map(cleanText)
    .filter(Boolean)
    .filter((value) => !VAGUE_MARKETPLACE_TERMS.has(value))
    .filter((value) => !/[A-Za-z]{2,}|[:：；;]/u.test(value))
    .filter((value) => !/(?:策略|视觉|比例|腰线提升|缩短上半身|延长腿部|因为|适合|用于)/u
      .test(value))
    .filter((value) => !productEvidence.includes(normalizedEvidence(value))))]
    .slice(0, 2);
}

function buildProductSearchTokens({requirement = {}, itemName = ""}) {
  const productType = cleanText(
    itemName || requirement.product_type || requirement.item_name,
  );
  const audience = audienceForGender(requirement.gender);
  const color = cleanText(
    requirement.selected_color || requirement.color || requirement.colors?.[0],
  );
  const material = cleanText(
    requirement.selected_material || requirement.material ||
      requirement.materials?.[0],
  );
  const designElements = safeDesignElements(
    requirement.design_elements,
    productType,
  );
  const productEvidence = normalizedEvidence(productType);
  return [...new Set([
    audience,
    color && !productEvidence.includes(normalizedEvidence(color)) ? color : "",
    material && !productEvidence.includes(normalizedEvidence(material))
      ? material
      : "",
    ...designElements,
    productType,
  ].map(cleanText).filter(Boolean))];
}

function queryRecord(contract, query, color, material) {
  return Object.freeze({
    category: contract.category,
    query,
    product_type: contract.product_type,
    product_family: contract.product_family,
    selected_color: color,
    selected_material: material,
    source_elements: Object.freeze([
      contract.product_type,
      ...safeDesignElements(contract.design_elements, contract.product_type),
    ]),
    query_reason: `根据可执行商品合同中的具体商品“${contract.product_type}”生成`,
  });
}

function translateBlueprintSearchRequirement(
  requirement = {},
  _blueprint = {},
  _options = {},
) {
  const contract = validateExecutableProductContract(requirement);
  const colors = contract.colors.length > 0 ? contract.colors : [""];
  const materials = contract.materials.length > 0 ? contract.materials : [""];
  const variantCount = Math.min(3, Math.max(colors.length, materials.length, 1));
  const records = [];

  for (let index = 0; index < variantCount; index += 1) {
    const color = colors[index % colors.length];
    const material = materials[index % materials.length];
    const variant = {
      ...contract,
      selected_color: color,
      selected_material: material,
    };
    const query = buildProductSearchTokens({
      requirement: variant,
      itemName: contract.product_type,
    }).join(" ");
    if (!records.some((record) => record.query === query)) {
      records.push(queryRecord(contract, query, color, material));
    }
  }

  const genericQuery = buildProductSearchTokens({
    requirement: {
      ...contract,
      selected_color: "",
      selected_material: "",
      color: "",
      material: "",
      colors: [],
      materials: [],
    },
    itemName: contract.product_type,
  }).join(" ");
  if (genericQuery && !records.some((record) => record.query === genericQuery)) {
    records.push(queryRecord(contract, genericQuery, "", ""));
  }

  const translatedQueries = records.slice(0, 3);
  return {
    ...contract,
    item_name: contract.product_type,
    search_keywords: translatedQueries.map((record) => record.query),
    query_reason: translatedQueries[0]?.query_reason || "",
    source_elements: [...(translatedQueries[0]?.source_elements || [])],
    translated_queries: translatedQueries.map((record) => ({...record})),
  };
}

module.exports = {
  VAGUE_MARKETPLACE_TERMS,
  buildProductSearchTokens,
  translateBlueprintSearchRequirement,
};
