"use strict";

const {normalizeGender} = require("./product_relevance");
const {listStyleProfiles} = require("./style_intelligence");

const CONCEPT_SEARCH_QUERY_PLANNER_VERSION =
  "concept_search_query_planner.v1";
const MIN_QUERY_COUNT = 2;
const MAX_QUERY_COUNT = 4;
const MAX_QUERY_TERMS = 7;
const MAX_QUERY_LENGTH = 48;

const SCENE_TERMS = Object.freeze([
  [/(?:nightlife|bar|ktv|party|夜生活|酒吧|聚会)/iu, "聚会"],
  [/(?:date|约会)/iu, "约会"],
  [/(?:travel|旅行|出游)/iu, "出游"],
  [/(?:commute|work|通勤|工作)/iu, "通勤"],
  [/(?:daily|日常)/iu, "日常"],
]);

const FORMALITY_TERMS = Object.freeze([
  [/(?:^|_)(?:relaxed)(?:$|_)/iu, "休闲"],
  [/(?:polished_casual)/iu, "休闲时髦"],
  [/(?:elevated)/iu, "精致利落"],
  [/(?:formal)/iu, "正式"],
]);

const VISUAL_DIRECTION_TERMS = Object.freeze([
  [/(?:clean_or_gently_defined|clean_vertical|precise_proportion)/iu, "利落合身"],
  [/(?:structured_with_clear_line)/iu, "直筒有型"],
  [/(?:refined_low_visual_noise)/iu, "简约精致"],
  [/(?:relaxed_with_visible_structure)/iu, "宽松有型"],
  [/(?:easy_line_with_controlled_length)/iu, "松弛直线"],
  [/(?:lightweight_relaxed)/iu, "轻便休闲"],
  [/(?:defined_focal_shape)/iu, "设计感廓形"],
  [/(?:supporting_shape_with_clear_proportion)/iu, "比例利落"],
  [/(?:design_led_but_wearable)/iu, "设计感"],
  [/(?:balanced_everyday_shape|versatile_balanced_line)/iu, "日常有型"],
  [/(?:versatile_scene_compatible)/iu, "百搭"],
]);

const COLOR_TERMS = Object.freeze([
  [/(?:restrained_harmonious|low_to_medium)/iu, "低饱和"],
  [/(?:soft_harmonious)/iu, "柔和色系"],
  [/(?:focused_accent|medium_to_high)/iu, "重点色"],
  [/(?:versatile_neutral)/iu, "中性色"],
]);

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

function firstMappedTerm(value, rules) {
  const text = String(value || "");
  return rules.find(([pattern]) => pattern.test(text))?.[1] || "";
}

function audienceTerm(gender) {
  const normalized = normalizeGender(gender);
  if (normalized === "female") return "女士";
  if (normalized === "male") return "男士";
  return "中性";
}

function categoryTerm(slot, gender) {
  const normalizedGender = normalizeGender(gender);
  const terms = {
    top: normalizedGender === "female" ? "女装上衣" :
      normalizedGender === "male" ? "男装上衣" : "上衣",
    bottom: normalizedGender === "female" ? "女装下装" :
      normalizedGender === "male" ? "男装裤子" : "下装",
    shoes: normalizedGender === "female" ? "女鞋" :
      normalizedGender === "male" ? "男鞋" : "鞋",
    dress: "连衣裙",
    outerwear: normalizedGender === "female" ? "女装外套" :
      normalizedGender === "male" ? "男装外套" : "外套",
    bag: normalizedGender === "male" ? "男包" :
      normalizedGender === "female" ? "女包" : "包",
    accessory: "配饰",
    socks: "袜子",
  };
  return terms[String(slot || "").toLowerCase()] || String(slot || "服饰");
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
  while (values.join(" ").length > MAX_QUERY_LENGTH && values.length > 3) {
    values.splice(values.length - 2, 1);
  }
  return values.join(" ");
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
  const sceneTerm = firstMappedTerm(scene, SCENE_TERMS);
  const formalityTerm = firstMappedTerm(formality, FORMALITY_TERMS);
  const directionTerm = firstMappedTerm(direction, VISUAL_DIRECTION_TERMS);
  const colorTerm = firstMappedTerm(
    `${lookConcept?.color_direction?.palette || ""} ` +
    `${lookConcept?.color_direction?.intensity || ""}`,
    COLOR_TERMS,
  );
  const statement = String(
    valueOf(brain.statement_level, lookConcept?.statement_level || ""),
  );
  const statementTerm = statementCommerceTerm(statement);
  const styleTerm = styleCommerceTerm(style, gender);
  const audience = audienceTerm(gender);
  const categoryLabel = categoryTerm(category, gender);
  const negatives = conditionalCommerceNegatives({brain, formality, slot: category});

  const records = [
    {
      query: compactQuery([
        audience,
        ...impressions.slice(0, 2),
        styleTerm,
        directionTerm || statementTerm,
        categoryLabel,
      ]),
      reason_codes: unique([
        impressions.length > 0 ? "USER_DESIRED_IMPRESSION" : "",
        styleTerm ? "STYLE_ANCHOR_NORMALIZED" : "",
        directionTerm ? "CONCEPT_VISUAL_DIRECTION" : "CONCEPT_STATEMENT_LEVEL",
      ]),
    },
    {
      query: compactQuery([
        audience,
        sceneTerm,
        formalityTerm,
        directionTerm,
        colorTerm,
        categoryLabel,
      ]),
      reason_codes: unique([
        sceneTerm ? "SCENE_INTENT" : "",
        formalityTerm ? "FORMALITY" : "",
        directionTerm ? "SILHOUETTE_OR_FOOTWEAR_DIRECTION" : "",
        colorTerm ? "COLOR_DIRECTION" : "",
      ]),
    },
  ].filter((record, index, all) => record.query &&
    all.findIndex((item) => item.query === record.query) === index);

  if (records.length < MIN_QUERY_COUNT) {
    records.push({
      query: compactQuery([audience, sceneTerm, statementTerm, categoryLabel]),
      reason_codes: ["SAFE_COMMERCE_FALLBACK"],
    });
  }
  const queryCandidates = records.slice(0, MAX_QUERY_COUNT).map((record, index) =>
    deepFreeze({
      rank: index + 1,
      query: record.query,
      reason_codes: record.reason_codes,
      source_elements: unique([
        ...impressions,
        sceneTerm,
        formalityTerm,
        directionTerm,
        colorTerm,
        styleTerm,
      ]),
    }));
  if (queryCandidates.length < MIN_QUERY_COUNT) {
    throw new TypeError("Concept Search Query Plan requires at least two queries");
  }

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
    commerce_negatives: unique([...negatives.hard, ...negatives.contextual]),
    hard_gate_negatives: negatives.hard,
    contextual_negatives: negatives.contextual,
    trace: {
      semantic_compiler: "zh-CN_commerce_v1",
      abstract_tokens_sent: false,
      body_fit_signal: bodyFitProfile?.version ? "AVAILABLE_SOFT" : "UNAVAILABLE",
      market_preference: marketPreference || valueOf(brain.trend_preference),
      query_count: queryCandidates.length,
    },
  });
}

module.exports = {
  CONCEPT_SEARCH_QUERY_PLANNER_VERSION,
  MAX_QUERY_COUNT,
  MIN_QUERY_COUNT,
  planConceptSearchQueries,
};
