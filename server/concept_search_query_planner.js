"use strict";

const {normalizeGender} = require("./product_relevance");
const {listStyleProfiles} = require("./style_intelligence");

const CONCEPT_SEARCH_QUERY_PLANNER_VERSION =
  "concept_search_query_planner.v2";
const MIN_QUERY_COUNT = 2;
const MAX_QUERY_COUNT = 3;
const MAX_QUERY_TERMS = 3;
const MAX_QUERY_LENGTH = 24;

function unique(values) {
  return [...new Set((Array.isArray(values) ? values : [values])
    .flat(Infinity)
    .map((value) => String(value ?? "").trim())
    .filter(Boolean))];
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function valueOf(evidence, fallback = null) {
  return evidence && typeof evidence === "object" &&
      Object.hasOwn(evidence, "value")
    ? evidence.value
    : evidence ?? fallback;
}

function valuesOf(evidence) {
  const value = valueOf(evidence, []);
  return unique(Array.isArray(value) ? value : value == null ? [] : [value]);
}

function audienceTerm(gender) {
  const normalized = normalizeGender(gender);
  if (normalized === "female") return "女";
  if (normalized === "male") return "男";
  return "中性";
}

function concreteCategoryTerm(slot, gender, direction) {
  const normalizedGender = normalizeGender(gender);
  const normalizedDirection = String(direction || "");
  if (slot === "top") {
    if (/(?:relaxed|easy|lightweight)/iu.test(normalizedDirection)) return "T恤";
    return normalizedGender === "female" ? "短袖上衣" :
      normalizedGender === "male" ? "T恤" : "上衣";
  }
  if (slot === "bottom") {
    if (/(?:easy|relaxed)/iu.test(normalizedDirection)) {
      return normalizedGender === "female" ? "阔腿裤" : "休闲裤";
    }
    if (/(?:supporting_shape|focal)/iu.test(normalizedDirection)) {
      return normalizedGender === "female" ? "半身裙" : "直筒裤";
    }
    return "直筒裤";
  }
  if (slot === "shoes") {
    if (normalizedGender === "female" &&
        /(?:refined|design_led|focal)/iu.test(normalizedDirection)) {
      return "单鞋";
    }
    return "休闲鞋";
  }
  const terms = {
    dress: "连衣裙",
    outerwear: "外套",
    bag: "包",
    accessory: "配饰",
    socks: "袜子",
  };
  return terms[String(slot || "").toLowerCase()] || String(slot || "服饰");
}

function broadCategoryTerm(slot) {
  return {
    top: "上衣",
    bottom: "裤子",
    shoes: "鞋",
    dress: "连衣裙",
    outerwear: "外套",
    bag: "包",
    accessory: "配饰",
    socks: "袜子",
  }[String(slot || "").toLowerCase()] || String(slot || "服饰");
}

function impressionCommerceTerms(brain) {
  const text = valuesOf(brain?.desired_impression).join(" ");
  const terms = [];
  if (/(?:年轻|减龄|青春)/u.test(text)) terms.push("年轻");
  if (/(?:设计感|辨识度|独特|特别)/u.test(text)) terms.push("设计感");
  if (/(?:干净|清爽|利落)/u.test(text)) terms.push("干净利落");
  if (/(?:时髦|时尚|潮流)/u.test(text)) terms.push("时髦");
  if (/(?:精致|高级)/u.test(text)) terms.push("精致");
  if (/(?:经典|耐看)/u.test(text)) terms.push("经典");
  return unique(terms);
}

function statementCommerceTerm(value) {
  const text = String(value || "");
  if (/high/iu.test(text)) return "设计感";
  if (/medium/iu.test(text)) return "时髦";
  if (/low/iu.test(text)) return "简约";
  return "";
}

function styleCommerceTerm(style, gender) {
  const canonical = String(style || "").trim();
  if (!canonical) return "";
  const component = canonical.split(/\s*\+\s*/u)[0];
  const normalizedGender = normalizeGender(gender);
  const profile = listStyleProfiles().find((entry) =>
    entry.id === component &&
    [normalizedGender, "unisex"].includes(String(entry.gender_variant)));
  const aliases = Array.isArray(profile?.aliases) ? profile.aliases : [];
  return aliases.find((alias) => /[\u3400-\u9fff]/u.test(alias)) || "";
}

function compactQuery(tokens) {
  const values = unique(tokens).slice(0, MAX_QUERY_TERMS);
  while (values.join(" ").length > MAX_QUERY_LENGTH && values.length > 2) {
    values.pop();
  }
  return values.join(" ");
}

function strongestSearchableSignal({
  impressions,
  direction,
  styleTerm,
  statement,
  slot,
}) {
  const values = unique(impressions);
  const normalizedDirection = String(direction || "");
  if (slot === "shoes") {
    if (/(?:design_led|defined_focal|focal)/iu.test(normalizedDirection)) {
      return "设计感";
    }
    if (/(?:relaxed|easy|lightweight)/iu.test(normalizedDirection)) {
      return "轻便";
    }
    return ["时髦", "年轻", "设计感", "精致", "经典"]
      .find((term) => values.includes(term)) || styleTerm || "百搭";
  }
  if (/(?:defined_focal|design_led|focal)/iu.test(normalizedDirection)) {
    return "设计感";
  }
  if (/(?:relaxed|easy|lightweight)/iu.test(normalizedDirection)) return "宽松";
  if (/(?:clean|structured|refined|precise)/iu.test(normalizedDirection)) {
    return ["时髦", "年轻", "干净利落", "设计感", "精致", "经典"]
      .find((term) => values.includes(term)) || styleTerm || "利落";
  }
  return values[0] || styleTerm || statementCommerceTerm(statement) || "百搭";
}

function queryCandidate({
  rank,
  queryId,
  queryType,
  execution,
  query,
  coreCategory,
  aestheticSignal,
  fallbackLevel = 0,
  fallbackReason = null,
  reasonCodes = [],
}) {
  return deepFreeze({
    rank,
    query_id: queryId,
    query_type: queryType,
    execution,
    query,
    core_category: coreCategory,
    aesthetic_signal: aestheticSignal || null,
    searchable_signal_budget: {
      core_category_terms: 1,
      aesthetic_terms: aestheticSignal ? 1 : 0,
      max_aesthetic_terms: 1,
    },
    fallback_level: fallbackLevel,
    fallback_reason: fallbackReason,
    reason_codes: unique(reasonCodes),
    source_elements: unique([coreCategory, aestheticSignal]),
  });
}

function conditionalCommerceNegatives({brain, formality, slot}) {
  const explicitAvoids = valuesOf(brain?.explicit_avoid);
  const impressions = impressionCommerceTerms(brain);
  const hard = [];
  const contextual = [];
  if (explicitAvoids.some((value) =>
    /(?:overly_corporate|office_like|上班|办公室|职场)/iu.test(value))) {
    hard.push("商务正装", "职业装", "工作装", "商务", "职业", "正装");
    if (slot === "top") hard.push("商务衬衫", "商务工装", "职业衬衫");
    if (slot === "bottom") hard.push("商务西裤", "职业西裤", "工作裤");
    if (slot === "shoes") hard.push("商务皮鞋", "正装皮鞋");
    if (impressions.some((value) => ["年轻", "时髦"].includes(value))) {
      contextual.push("中老年", "爸爸款", "爸爸鞋", "爸爸");
    }
  }
  if (explicitAvoids.some((value) =>
    /(?:leather_shoes|皮鞋|oxford|derby)/iu.test(value))) {
    hard.push("皮鞋", "牛津鞋", "德比鞋", "商务鞋");
  }
  if (/(?:relaxed|polished_casual)/iu.test(String(formality || "")) &&
      valueOf(brain?.formality_preference) === "relaxed") {
    contextual.push("商务正装", "职业装", "礼服");
  }
  if (impressions.includes("年轻")) {
    contextual.push("中老年", "爸爸款", "爸爸");
  }
  return {
    hard: unique(hard),
    contextual: unique(contextual.filter((value) => !hard.includes(value))),
  };
}

function slotDirection(concept, slot) {
  if (slot === "top") return concept?.silhouette_direction?.top;
  if (slot === "bottom") return concept?.silhouette_direction?.bottom;
  if (slot === "shoes") return concept?.footwear_direction?.preference;
  return concept?.silhouette_direction?.overall_proportion || "";
}

function planConceptSearchQueries({
  decisionContext = {},
  userIntentBrain,
  lookConcept = {},
  bodyFitProfile,
  slot,
  marketPreference,
} = {}) {
  const brain = userIntentBrain || decisionContext?.intent?.user_intent_brain || {};
  const gender = normalizeGender(decisionContext?.user_truth?.gender);
  const category = String(slot || "").trim().toLowerCase();
  if (!category) throw new TypeError("slot is required");
  const impressions = impressionCommerceTerms(brain);
  const scene = String(
    lookConcept?.scene_fit || valueOf(brain.scene_intent, ""),
  );
  const formality = String(
    lookConcept?.formality || valueOf(brain.formality_preference, ""),
  );
  const direction = String(slotDirection(lookConcept, category) || "");
  const style = String(
    lookConcept?.style_anchor?.value ||
    lookConcept?.style_anchor?.compatible_with || "",
  );
  const statement = String(
    valueOf(brain.statement_level, lookConcept?.statement_level || ""),
  );
  const styleTerm = styleCommerceTerm(style, gender);
  const audience = audienceTerm(gender);
  const categoryLabel = concreteCategoryTerm(category, gender, direction);
  const broadCategoryLabel = broadCategoryTerm(category);
  const aestheticSignal = strongestSearchableSignal({
    impressions,
    direction,
    styleTerm,
    statement,
    slot: category,
  });
  const negatives = conditionalCommerceNegatives({brain, formality, slot: category});
  const q1 = compactQuery([audience, categoryLabel]);
  const q2 = compactQuery([audience, categoryLabel, aestheticSignal]);
  const q3 = compactQuery([audience, broadCategoryLabel]);
  const queryCandidates = [
    queryCandidate({
      rank: 1,
      queryId: "Q1",
      queryType: "HIGH_RECALL",
      execution: "DEFAULT",
      query: q1,
      coreCategory: categoryLabel,
      reasonCodes: ["GENDER_AND_CONCRETE_CATEGORY"],
    }),
    queryCandidate({
      rank: 2,
      queryId: "Q2",
      queryType: "INTENT",
      execution: "DEFAULT",
      query: q2,
      coreCategory: categoryLabel,
      aestheticSignal,
      reasonCodes: ["ONE_STRONGEST_SEARCHABLE_SIGNAL"],
    }),
  ];
  if (queryCandidates.length < MIN_QUERY_COUNT) {
    throw new TypeError("Concept Search Query Plan requires at least two queries");
  }
  const fallbackQuery = queryCandidate({
    rank: 3,
    queryId: "Q3",
    queryType: "BROAD_CATEGORY_FALLBACK",
    execution: "ON_Q1_Q2_ZERO",
    query: q3,
    coreCategory: broadCategoryLabel,
    fallbackLevel: 2,
    fallbackReason: "INTENT_AND_HIGH_RECALL_ZERO",
    reasonCodes: ["BROAD_CATEGORY_FALLBACK"],
  });

  return deepFreeze({
    version: CONCEPT_SEARCH_QUERY_PLANNER_VERSION,
    concept_id: String(lookConcept?.concept_id || ""),
    slot: category,
    gender,
    scene,
    intent: {
      desired_impression: impressions,
      formality: valueOf(brain.formality_preference),
      avoid: valuesOf(brain.explicit_avoid),
      style_flexibility: valueOf(brain.style_flexibility),
      statement_level: valueOf(brain.statement_level, lookConcept?.statement_level),
    },
    query_candidates: queryCandidates,
    fallback_query: fallbackQuery,
    commerce_negatives: unique([...negatives.hard, ...negatives.contextual]),
    hard_gate_negatives: negatives.hard,
    contextual_negatives: negatives.contextual,
    trace: {
      semantic_compiler: "zh-CN_recall_precision_v2",
      abstract_tokens_sent: false,
      searchable_signal_budget: {
        core_category_required: true,
        max_aesthetic_terms: 1,
      },
      default_query_ids: ["Q1", "Q2"],
      fallback_query_id: "Q3",
      excluded_from_query: {
        avoid: valuesOf(brain.explicit_avoid),
        scene,
        formality,
        color: lookConcept?.color_direction || null,
        body_fit: bodyFitProfile?.version ? "DOWNSTREAM_SOFT_SIGNAL" : "UNAVAILABLE",
        quality: lookConcept?.quality_direction || null,
        market: marketPreference || valueOf(brain.trend_preference),
      },
      body_fit_signal: bodyFitProfile?.version ? "AVAILABLE_SOFT" : "UNAVAILABLE",
      market_preference: marketPreference || valueOf(brain.trend_preference),
      default_query_count: queryCandidates.length,
      maximum_query_count: queryCandidates.length + 1,
    },
  });
}

module.exports = {
  CONCEPT_SEARCH_QUERY_PLANNER_VERSION,
  MAX_QUERY_COUNT,
  MIN_QUERY_COUNT,
  planConceptSearchQueries,
};
