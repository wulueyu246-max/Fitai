"use strict";

const {
  listStyleProfiles,
  resolveAestheticTargetProfile,
} = require("./style_intelligence");

const USER_INTENT_BRAIN_VERSION = "user_intent_brain.v1";
const EMPTY_SOURCE = "system";
const USER_SOURCE = "user";
const INFERENCE_SOURCE = "ai_inference";

const NEGATION_PATTERN = /(?:不要|不是|并非|不想|不穿|不喜欢|不接受|不考虑|不选择|不选|不走|不太|避免|拒绝|别)/u;
const EXPLICIT_STYLE_ALTERNATIVE_PATTERN = /(?:别的|其他)(?:风格|方向)/u;
const GENERIC_ALTERNATIVE_TRIAL_PATTERN = /(?:试(?:试|点)(?:别的|其他)|尝试(?:别的|其他))/gu;
const PRODUCT_SCOPE_PATTERN = /(?:鞋子?|鞋履|包包?|上衣|下装|裤子?|裙子?|连衣裙|配饰|饰品|袜子?|外套|内搭|单品|商品|颜色|材质|款式)/u;
const STYLE_MARKER_PATTERN = /(?:风格|穿搭|造型|风|想穿|想要|喜欢|偏好|偏向|偏)/u;
const AMBIGUOUS_STYLE_ALIASES = new Set([
  "正式", "高级", "精致高级", "简约", "运动", "通勤", "职场",
]);

function unique(values) {
  return [...new Set((Array.isArray(values) ? values : [values])
    .flat()
    .filter((value) => value !== null && typeof value !== "undefined")
    .map((value) => typeof value === "string" ? value.trim() : value)
    .filter((value) => typeof value !== "string" || value.length > 0))];
}

function clampConfidence(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(0, Math.min(1, number))
    : fallback;
}

function deepClone(value) {
  return value == null ? value : structuredClone(value);
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function evidence(value, source = EMPTY_SOURCE, confidence = 0) {
  return deepFreeze({
    value: deepClone(value),
    source,
    confidence: clampConfidence(confidence),
  });
}

function isPresent(value) {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function sourceFor(context, path, fallback = USER_SOURCE) {
  const entry = context?.context_source_map?.[path];
  if (Array.isArray(entry)) {
    return entry.find((item) => item?.source)?.source || fallback;
  }
  return entry?.source || fallback;
}

function confidenceFor(context, path, fallback = 1) {
  const entry = context?.context_source_map?.[path];
  if (Array.isArray(entry)) {
    const item = entry.find((candidate) => Number.isFinite(candidate?.confidence));
    return clampConfidence(item?.confidence, fallback);
  }
  return clampConfidence(entry?.confidence, fallback);
}

function normalizedText(value) {
  return String(value || "").trim().toLowerCase();
}

function regexEscape(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function styleEntries() {
  const entries = [];
  const seen = new Set();
  for (const profile of listStyleProfiles()) {
    for (const alias of unique([profile.id, ...(profile.aliases || [])])) {
      const key = `${profile.id}:${normalizedText(alias)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({
        canonical: profile.id,
        alias: String(alias),
        gender: profile.gender_variant,
      });
    }
  }
  return entries.sort((left, right) =>
    right.alias.length - left.alias.length || left.alias.localeCompare(right.alias));
}

const STYLE_ENTRIES = Object.freeze(styleEntries());

function mentionIsNegated(raw, index) {
  const prefix = raw.slice(Math.max(0, index - 10), index);
  return NEGATION_PATTERN.test(prefix);
}

function mentionHasStyleContext(raw, index, alias) {
  const start = Math.max(0, index - 12);
  const end = Math.min(raw.length, index + alias.length + 12);
  const window = raw.slice(start, end);
  return STYLE_MARKER_PATTERN.test(window) ||
    /^[A-Za-z][A-Za-z0-9_ -]*$/u.test(alias) ||
    normalizedText(raw) === normalizedText(alias);
}

function hasStyleAlternativeSignal(rawInput) {
  const raw = String(rawInput || "");
  if (EXPLICIT_STYLE_ALTERNATIVE_PATTERN.test(raw)) return true;
  for (const match of raw.matchAll(GENERIC_ALTERNATIVE_TRIAL_PATTERN)) {
    const before = raw.slice(0, match.index);
    const clauseStart = Math.max(
      before.lastIndexOf("，"),
      before.lastIndexOf(","),
      before.lastIndexOf("。"),
      before.lastIndexOf("；"),
      before.lastIndexOf(";"),
    );
    const clausePrefix = before.slice(clauseStart + 1);
    if (!PRODUCT_SCOPE_PATTERN.test(clausePrefix)) return true;
  }
  return false;
}

function stylePreferenceRole(rawInput, mentions = [], fallbackRaw = "") {
  const raw = String(rawInput || "");
  if (hasStyleAlternativeSignal(raw)) return true;
  const ranges = mentions.length > 0
    ? mentions.map(({index, end}) => [index, end])
    : (() => {
        const value = String(fallbackRaw || "");
        const index = value ? raw.toLowerCase().indexOf(value.toLowerCase()) : -1;
        return index >= 0 ? [[index, index + value.length]] : [];
      })();
  return ranges.some(([start, end]) => {
    const prefix = raw.slice(Math.max(0, start - 6), start);
    const suffix = raw.slice(end, Math.min(raw.length, end + 6));
    return /(?:偏|偏向|有点|稍微)\s*$/u.test(prefix) ||
      /^\s*(?:一点|一些|些|为主|倾向)/u.test(suffix);
  });
}

function explicitStyleMentions(rawInput) {
  const raw = String(rawInput || "");
  const lower = raw.toLowerCase();
  const mentions = [];
  const occupied = [];
  for (const entry of STYLE_ENTRIES) {
    const needle = entry.alias.toLowerCase();
    let from = 0;
    while (needle && from < lower.length) {
      const index = lower.indexOf(needle, from);
      if (index < 0) break;
      const end = index + needle.length;
      const overlaps = occupied.some(([left, right]) => index < right && end > left);
      if (!overlaps && !mentionIsNegated(raw, index) &&
          mentionHasStyleContext(raw, index, entry.alias)) {
        mentions.push({...entry, index, end});
        occupied.push([index, end]);
      }
      from = Math.max(end, index + 1);
    }
  }
  const hasUnambiguousMention = mentions.some(({alias}) =>
    !AMBIGUOUS_STYLE_ALIASES.has(alias));
  return mentions.filter(({alias, end}) => {
    if (!AMBIGUOUS_STYLE_ALIASES.has(alias)) return true;
    if (hasUnambiguousMention) return true;
    const suffix = raw.slice(end, Math.min(raw.length, end + 4));
    return /^(?:风格|风)/u.test(suffix) ||
      new RegExp(`^${regexEscape(alias)}$`, "iu").test(raw.trim());
  }).sort((left, right) => left.index - right.index);
}

function negatedStyleCanonicals(rawInput) {
  const raw = String(rawInput || "");
  const lower = raw.toLowerCase();
  const canonicals = new Set();
  for (const entry of STYLE_ENTRIES) {
    const needle = entry.alias.toLowerCase();
    let from = 0;
    while (needle && from < lower.length) {
      const index = lower.indexOf(needle, from);
      if (index < 0) break;
      if (mentionIsNegated(raw, index) &&
          mentionHasStyleContext(raw, index, entry.alias)) {
        canonicals.add(entry.canonical);
      }
      from = Math.max(index + needle.length, index + 1);
    }
  }
  return canonicals;
}

function acceptableStyleResolution(target) {
  const reason = target?.resolution_trace?.resolution_reason;
  return [
    "EXACT_CANONICAL",
    "EXACT_ALIAS",
    "EXPLICIT_MULTI_STYLE_BLEND",
  ].includes(reason);
}

function resolveExplicitStyle(styleText, gender) {
  const value = String(styleText || "").trim();
  if (!value) return null;
  for (const variant of unique([gender, "unisex"])) {
    const target = resolveAestheticTargetProfile({
      gender: variant || "unisex",
      style: value,
      scene: "daily",
    });
    if (!acceptableStyleResolution(target)) continue;
    const components = target.resolution_trace.final_profile_components
      .map(({id}) => id);
    return deepFreeze({
      canonical: components.join(" + "),
      components,
      resolution_trace: deepClone(target.resolution_trace),
    });
  }
  return null;
}

function unnormalizedExplicitStyle(rawInput, declaredStyle) {
  const declared = String(declaredStyle || "").trim();
  if (declared) return declared;
  const raw = String(rawInput || "").trim();
  const introduced = raw.match(
    /(?:想穿|想要|喜欢|偏好|偏向)[：:\s]*([^，。；,;]{1,20}?)(?:风格|风)(?=$|去|参加|但|[，。；,;\s])/u,
  );
  const declaredByLabel = raw.match(
    /风格(?:是|为)[：:\s]*([^，。；,;]{1,20}?)(?=$|[，。；,;\s])/u,
  );
  const introducedValueIndex = introduced
    ? introduced.index + introduced[0].indexOf(introduced[1])
    : -1;
  const declaredValueIndex = declaredByLabel
    ? declaredByLabel.index + declaredByLabel[0].indexOf(declaredByLabel[1])
    : -1;
  const positiveIntroduced = introduced &&
    !mentionIsNegated(raw, introducedValueIndex) ? introduced : null;
  const positiveDeclaredByLabel = declaredByLabel &&
    !mentionIsNegated(raw, declaredValueIndex) ? declaredByLabel : null;
  const introducedValue = (
    positiveIntroduced?.[1] || positiveDeclaredByLabel?.[1] || ""
  ).trim();
  if (introducedValue && !NEGATION_PATTERN.test(introducedValue)) {
    return introducedValue.replace(/(?:一点|一些|些)$/u, "").trim();
  }
  const standalone = raw.match(/^([^，。；,;\s]{1,12}?)(?:风格|风)$/u);
  const standaloneValue = standalone?.[1]?.trim() || "";
  if (!standaloneValue || NEGATION_PATTERN.test(standaloneValue) ||
      /(?:我|想|帮|搭|适合|穿)/u.test(standaloneValue)) {
    return "";
  }
  return standaloneValue;
}

function styleSignal(context, rawInput) {
  const gender = String(context?.user_truth?.gender || "unisex");
  const declaredStyle = String(context?.user_truth?.explicit_style || "").trim();
  const declaredSource = sourceFor(
    context,
    "user_truth.explicit_style",
    EMPTY_SOURCE,
  );
  const declaredConfidence = confidenceFor(
    context,
    "user_truth.explicit_style",
    declaredSource === EMPTY_SOURCE ? 0 : 1,
  );
  const mentions = explicitStyleMentions(rawInput);
  const mentionStyle = unique(mentions.map(({canonical}) => canonical)).join(" + ");
  const mentionResolution = resolveExplicitStyle(mentionStyle, gender);
  const rawUnnormalizedStyle = unnormalizedExplicitStyle(rawInput, "");
  const declaredIsLegacyWholeSentence = declaredStyle &&
    normalizedText(declaredStyle) === normalizedText(rawInput) &&
    !mentionResolution && !rawUnnormalizedStyle;
  const initialDeclaredStyle = declaredIsLegacyWholeSentence ? "" : declaredStyle;
  const initialDeclaredResolution = resolveExplicitStyle(initialDeclaredStyle, gender);
  const negatedCanonicals = negatedStyleCanonicals(rawInput);
  const declaredStyleSuppressed = Boolean(
    initialDeclaredResolution?.components.some((component) =>
      negatedCanonicals.has(component)),
  );
  const usableDeclaredStyle = declaredStyleSuppressed ? "" : initialDeclaredStyle;
  const declaredResolution = declaredStyleSuppressed
    ? null : initialDeclaredResolution;
  const hasRawStyleSignal = Boolean(mentionResolution || rawUnnormalizedStyle);
  const resolution = hasRawStyleSignal
    ? mentionResolution
    : declaredResolution;
  const signalSource = hasRawStyleSignal ? USER_SOURCE : declaredSource;
  const signalConfidence = hasRawStyleSignal ? 1 : declaredConfidence;
  const unresolvedStyle = resolution
    ? ""
    : rawUnnormalizedStyle || usableDeclaredStyle;
  if (!resolution) {
    if (unresolvedStyle) {
      const preference = signalSource !== USER_SOURCE ||
        stylePreferenceRole(rawInput, [], unresolvedStyle);
      return deepFreeze({
        raw: unresolvedStyle,
        role: preference ? "preference" : "lock",
        normalized: null,
        source: signalSource,
        confidence: signalConfidence,
        components: [],
        resolution_trace: {
          raw_style_input: [unresolvedStyle],
          normalized_tokens: [],
          exact_canonical_match: null,
          exact_alias_match: null,
          semantic_candidates: [],
          blend_components: [],
          final_profile_components: [],
          resolution_reason: "EXPLICIT_STYLE_UNNORMALIZED",
        },
        mentions: [],
        declared_style_suppressed: declaredStyleSuppressed,
      });
    }
    return deepFreeze({
      raw: null,
      role: null,
      normalized: null,
      source: EMPTY_SOURCE,
      confidence: 0,
      components: [],
      resolution_trace: {
        raw_style_input: [],
        normalized_tokens: [],
        exact_canonical_match: null,
        exact_alias_match: null,
        semantic_candidates: [],
        blend_components: [],
        final_profile_components: [],
        resolution_reason: "NO_EXPLICIT_STYLE_SIGNAL",
      },
      mentions: [],
      declared_style_suppressed: declaredStyleSuppressed,
    });
  }
  const preference = signalSource !== USER_SOURCE ||
    stylePreferenceRole(rawInput, mentions, declaredStyle);
  const rawStyle = hasRawStyleSignal
    ? mentions.length > 0
      ? mentions.map(({alias}) => alias).join(" + ")
      : rawUnnormalizedStyle
    : declaredStyle;
  return deepFreeze({
    raw: rawStyle,
    role: preference ? "preference" : "lock",
    normalized: resolution.canonical,
    source: signalSource,
    confidence: signalConfidence,
    components: resolution.components,
    resolution_trace: resolution.resolution_trace,
    mentions: mentions.map(({alias, canonical, index}) => ({alias, canonical, index})),
    declared_style_suppressed: declaredStyleSuppressed,
  });
}

function canonicalAvoids(context, rawInput) {
  const rawAvoids = unique(context?.user_truth?.explicit_avoid || []);
  const avoids = [];
  const clauses = unique([
    ...String(rawInput || "").split(/[，。；,;\n]+/u),
    ...rawAvoids,
  ]);
  for (const clause of clauses) {
    if (!NEGATION_PATTERN.test(clause)) continue;
    if (/皮鞋/u.test(clause)) avoids.push("leather_shoes");
    if (/(?:上班|办公室|职场)/u.test(clause)) {
      avoids.push("overly_corporate", "office_like");
    }
  }
  for (const item of rawAvoids) {
    if (/皮鞋/u.test(item)) {
      avoids.push("leather_shoes");
      continue;
    }
    if (/(?:上班|办公室|职场)/u.test(item)) {
      avoids.push("overly_corporate", "office_like");
      continue;
    }
    avoids.push(item);
  }
  return unique(avoids);
}

function lookCountConstraint(rawInput) {
  const match = String(rawInput || "").match(/([一二两三四五六七八九十\d]+)\s*套/u);
  if (!match) return null;
  const chinese = {
    一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
    六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
  };
  const value = Number(match[1]) || chinese[match[1]];
  return Number.isInteger(value) && value > 0
    ? {type: "look_count", value}
    : null;
}

function inferSceneFromRaw(rawInput) {
  const raw = String(rawInput || "");
  if (/(?:喝酒|酒吧|夜店|KTV|夜生活)/iu.test(raw)) return "nightlife_social";
  if (/(?:约会|见对象)/u.test(raw)) return "date";
  if (/(?:上班|通勤|工作)/u.test(raw)) return "commute";
  if (/(?:旅行|旅游|出游|出去玩)/u.test(raw)) return "travel";
  if (/(?:聚会|派对|party)/iu.test(raw)) return "party";
  return null;
}

function sceneKey(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (/(?:喝酒|酒吧|夜店|ktv|夜生活|nightlife|bar)/iu.test(raw)) {
    return "nightlife_social";
  }
  if (/(?:约会|date)/iu.test(raw)) return "date";
  if (/(?:上班|通勤|工作|commute|work)/iu.test(raw)) return "commute";
  if (/(?:旅行|旅游|出游|出去玩|travel)/iu.test(raw)) return "travel";
  if (/(?:聚会|派对|party)/iu.test(raw)) return "party";
  if (/(?:日常|daily)/iu.test(raw)) return "daily";
  return raw;
}

function primaryGoal(scene, rawInput, sceneSource, sceneConfidence) {
  const inferredScene = inferSceneFromRaw(rawInput);
  const authoritativeScene = sceneKey(scene);
  const inferredSceneKey = sceneKey(inferredScene);
  const conflictsWithStructuredScene = Boolean(
    inferredSceneKey && authoritativeScene && inferredSceneKey !== authoritativeScene,
  );
  const normalized = conflictsWithStructuredScene || !authoritativeScene
    ? inferredSceneKey || authoritativeScene
    : authoritativeScene;
  const goals = {
    nightlife_social: "适合夜生活社交",
    nightlife: "适合夜生活社交",
    bar: "适合夜生活社交",
    ktv: "适合夜生活社交",
    date: "适合约会场景",
    commute: "适合通勤场景",
    work: "适合工作场景",
    travel: "适合出行活动",
    daily: "适合日常穿着",
    party: "适合聚会社交",
  };
  if (!normalized) return evidence(null);
  const value = goals[normalized] || `适合${scene || inferredScene}场景`;
  if (conflictsWithStructuredScene || (!authoritativeScene && inferredSceneKey)) {
    return evidence(value, INFERENCE_SOURCE, 0.75);
  }
  return evidence(
    value,
    sceneSource || EMPTY_SOURCE,
    sceneSource === EMPTY_SOURCE ? 0 : sceneConfidence,
  );
}

function desiredImpression(rawInput) {
  const raw = String(rawInput || "");
  const values = [];
  if (/(?:年轻一点|显年轻|减龄|年轻感|青春感)/u.test(raw)) {
    values.push("年轻");
  }
  if (/(?:有点设计感|有设计感|设计感|有辨识度)/u.test(raw)) {
    values.push("有设计感");
  }
  if (/(?:干净|清爽利落|清爽)/u.test(raw)) values.push("干净利落");
  if (/(?:时髦|时尚一点|时尚感)/u.test(raw)) values.push("时髦");
  if (/(?:高级|精致)/u.test(raw)) values.push("精致高级");
  if (/(?:特别|独特|不烂大街|不要烂大街)/u.test(raw)) values.push("有辨识度");
  if (/(?:大胆|吸睛|亮眼)/u.test(raw)) values.push("更大胆醒目");
  if (/(?:经典|耐看)/u.test(raw)) values.push("经典耐看");
  return values.length > 0 ? evidence(unique(values), USER_SOURCE, 1) : evidence([]);
}

function formalityPreference(rawInput) {
  const raw = String(rawInput || "");
  if (/(?:正式一点|更正式|正式些|偏正式)/u.test(raw)) {
    return evidence("elevated", USER_SOURCE, 1);
  }
  if (/(?:不要太正式|不想太正式|别太正式|休闲一点|轻松一点)/u.test(raw)) {
    return evidence("relaxed", USER_SOURCE, 1);
  }
  return evidence(null);
}

function statementLevel(rawInput) {
  const raw = String(rawInput || "");
  if (/(?:大胆|吸睛|亮眼|强烈表达|非常有设计感)/u.test(raw)) {
    return evidence("high", USER_SOURCE, 1);
  }
  if (/(?:有点设计感|有设计感|时髦|有辨识度|有点特别)/u.test(raw)) {
    return evidence("medium", USER_SOURCE, 1);
  }
  if (/(?:低调|克制|简简单单|不要太抢眼)/u.test(raw)) {
    return evidence("low", USER_SOURCE, 1);
  }
  return evidence(null);
}

function styleFlexibility(rawInput, style, freedom) {
  if (style.role === "lock") return evidence("low", style.source, style.confidence);
  if (freedom.creativeFreedom.value === "high") {
    return evidence("high", USER_SOURCE, 1);
  }
  if (style.role === "preference" || hasStyleAlternativeSignal(rawInput)) {
    return evidence("medium", USER_SOURCE, 1);
  }
  return evidence("high", INFERENCE_SOURCE, 0.6);
}

function trendPreference(rawInput) {
  const raw = String(rawInput || "");
  if (/(?:最近很火|现在流行|当下流行|流行一点|潮流一点)/u.test(raw)) {
    return evidence("current", USER_SOURCE, 1);
  }
  if (/(?:经典一点|经典款|耐看一点)/u.test(raw)) {
    return evidence("classic", USER_SOURCE, 1);
  }
  return evidence(null);
}

function mainstreamPreference(rawInput) {
  const raw = String(rawInput || "");
  const mainstream = /(?:不要太小众|别太小众|主流一点|大众一点)/u.test(raw);
  const niche = /(?:不要烂大街|不想烂大街|小众一点|想小众|有点特别|独特一点)/u.test(raw);
  if (mainstream && niche) return evidence("balanced", USER_SOURCE, 0.75);
  if (mainstream) return evidence("mainstream", USER_SOURCE, 1);
  if (niche) return evidence("niche", USER_SOURCE, 1);
  return evidence(null);
}

function experimentationLevel(rawInput, mainstream) {
  const raw = String(rawInput || "");
  if (/(?:大胆一点|有点特别|突破一点)/u.test(raw) ||
      mainstream === "niche") {
    return evidence("high", USER_SOURCE, 1);
  }
  if (/(?:经典一点|稳妥一点|保守一点|不要冒险)/u.test(raw)) {
    return evidence("low", USER_SOURCE, 1);
  }
  if (hasStyleAlternativeSignal(raw)) {
    return evidence("medium", USER_SOURCE, 1);
  }
  return evidence(null);
}

function freedomSignals(rawInput, style) {
  const raw = String(rawInput || "");
  const high = /(?:随便|自由发挥|你决定|都可以)/u.test(raw);
  const open = hasStyleAlternativeSignal(raw);
  const count = lookCountConstraint(raw);
  const diversity = count?.value > 1 || /(?:几套|多套|不同(?:方向|风格|感觉))/u.test(raw);
  const creativeFreedom = high ? "high" : open ? "medium" : style.role === "lock"
    ? "low" : "medium";
  const creativeSource = high || open || style.role === "lock"
    ? USER_SOURCE : INFERENCE_SOURCE;
  const creativeConfidence = creativeSource === USER_SOURCE ? 1 : 0.55;
  const styleConstraint = !style.raw
    ? "low" : style.role === "preference" ? "medium" : "high";
  const styleConstraintSource = style.raw ? style.source : high
    ? USER_SOURCE : INFERENCE_SOURCE;
  return {
    creativeFreedom: evidence(
      creativeFreedom,
      creativeSource,
      creativeConfidence,
    ),
    styleConstraint: evidence(
      styleConstraint,
      styleConstraintSource,
      styleConstraintSource === USER_SOURCE ? 1 : 0.6,
    ),
    portfolioDiversity: evidence(
      diversity || high ? "high" : "medium",
      diversity || high ? USER_SOURCE : INFERENCE_SOURCE,
      diversity || high ? 1 : 0.55,
    ),
    count,
  };
}

function buildSourceMap(fields) {
  return deepFreeze(Object.fromEntries(Object.entries(fields).map(([key, item]) => [
    key,
    {source: item.source, confidence: item.confidence},
  ])));
}

function signal(kind, raw, normalized, source = USER_SOURCE, confidence = 1) {
  return deepFreeze({kind, raw, normalized, source, confidence});
}

function interpretUserIntent(context = {}) {
  const rawInput = String(context.raw_user_input || "");
  const style = styleSignal(context, rawInput);
  const rawRequirements = unique(context?.user_truth?.explicit_requirements || []);
  const avoids = canonicalAvoids(context, rawInput);
  const stylePreferences = style.role === "preference" && style.normalized
    ? [`style:${style.normalized}`]
    : style.role === "preference" && style.raw
      ? [`style:${style.raw}`]
    : [];
  const explicitPreferenceValues = unique(
    context?.user_truth?.explicit_preferences || [],
  );
  const preferences = unique([
    ...explicitPreferenceValues,
    ...stylePreferences,
  ]);
  const preferenceSource = explicitPreferenceValues.length > 0
    ? sourceFor(context, "user_truth.explicit_preferences", USER_SOURCE)
    : stylePreferences.length > 0 ? style.source : EMPTY_SOURCE;
  const preferenceConfidence = explicitPreferenceValues.length > 0
    ? confidenceFor(context, "user_truth.explicit_preferences", 1)
    : stylePreferences.length > 0 ? style.confidence : 0;
  const sceneValue = String(context?.user_truth?.scene || "").trim() ||
    inferSceneFromRaw(rawInput);
  const sceneSource = context?.user_truth?.scene
    ? sourceFor(context, "user_truth.scene")
    : sceneValue ? INFERENCE_SOURCE : EMPTY_SOURCE;
  const sceneConfidence = sceneSource === EMPTY_SOURCE ? 0
    : sceneSource === USER_SOURCE ? confidenceFor(context, "user_truth.scene", 1)
      : 0.7;
  const formality = formalityPreference(rawInput);
  const trend = trendPreference(rawInput);
  const mainstream = mainstreamPreference(rawInput);
  const experimentation = experimentationLevel(rawInput, mainstream.value);
  const freedom = freedomSignals(rawInput, style);
  const desired = desiredImpression(rawInput);
  const statement = statementLevel(rawInput);
  const flexibility = styleFlexibility(rawInput, style, freedom);
  const constraints = unique([
    ...(freedom.count ? [freedom.count] : []),
    ...(isPresent(context?.user_truth?.budget)
      ? [{type: "budget", value: deepClone(context.user_truth.budget)}]
      : []),
    ...rawRequirements.map((value) => ({type: "must", value})),
    ...avoids.map((value) => ({type: "avoid", value})),
  ]);
  const uncertainty = [];
  if (!style.raw) uncertainty.push("STYLE_DIRECTION_UNSPECIFIED");
  if (style.raw && !style.normalized) {
    uncertainty.push("STYLE_NORMALIZATION_UNRESOLVED");
  }
  if (freedom.creativeFreedom.value === "high") {
    uncertainty.push("MULTIPLE_LOOK_DIRECTIONS_EXPECTED");
  }
  if (style.role === "preference") {
    uncertainty.push("ALTERNATIVE_STYLE_DIRECTIONS_ALLOWED");
  }
  if (desired.value.length === 0) {
    uncertainty.push("DESIRED_IMPRESSION_UNSPECIFIED");
  }
  const explicitSignals = [];
  if (style.raw && style.source === USER_SOURCE) {
    explicitSignals.push(signal(
      style.role === "preference" ? "style_preference" : "explicit_style",
      style.raw,
      style.normalized || style.raw,
    ));
  }
  for (const value of avoids) {
    explicitSignals.push(signal("avoid", rawInput, value));
  }
  if (trend.value) explicitSignals.push(signal("trend", rawInput, trend.value));
  if (mainstream.value) {
    explicitSignals.push(signal("mainstream_vs_niche", rawInput, mainstream.value));
  }
  if (formality.value) {
    explicitSignals.push(signal("formality", rawInput, formality.value));
  }
  for (const value of desired.value) {
    explicitSignals.push(signal("desired_impression", rawInput, value));
  }
  if (statement.value) {
    explicitSignals.push(signal("statement_level", rawInput, statement.value));
  }
  if (freedom.creativeFreedom.source === USER_SOURCE) {
    explicitSignals.push(signal(
      "creative_freedom",
      rawInput,
      freedom.creativeFreedom.value,
    ));
  }
  const inferredSignals = [];
  const goal = primaryGoal(
    sceneValue,
    rawInput,
    sceneSource,
    sceneConfidence,
  );
  if (goal.source !== USER_SOURCE && goal.value) {
    inferredSignals.push(signal(
      "primary_goal",
      rawInput,
      goal.value,
      goal.source,
      goal.confidence,
    ));
  }
  for (const value of uncertainty) {
    inferredSignals.push(signal(
      "uncertainty",
      rawInput,
      value,
      INFERENCE_SOURCE,
      0.7,
    ));
  }
  if (style.raw && style.source !== USER_SOURCE) {
    inferredSignals.push(signal(
      "context_style_preference",
      style.raw,
      style.normalized || style.raw,
      style.source,
      style.confidence,
    ));
  }
  const explicitStyle = style.role === "lock"
    ? evidence(style.normalized || style.raw, style.source, style.confidence)
    : evidence(null);
  const normalizedStyle = style.normalized
    ? evidence(style.normalized, style.source, style.confidence)
    : evidence(null);
  const fields = {
    primary_goal: goal,
    explicit_style: explicitStyle,
    explicit_requirements: rawRequirements.length > 0
      ? evidence(rawRequirements, USER_SOURCE, 1) : evidence([]),
    explicit_avoid: avoids.length > 0
      ? evidence(avoids, USER_SOURCE, 1) : evidence([]),
    explicit_preferences: preferences.length > 0
      ? evidence(preferences, preferenceSource, preferenceConfidence) : evidence([]),
    desired_impression: desired,
    scene_intent: evidence(sceneValue || null, sceneSource, sceneConfidence),
    formality_preference: formality,
    trend_preference: trend,
    mainstream_vs_niche: mainstream,
    experimentation_level: experimentation,
    creative_freedom: freedom.creativeFreedom,
    style_constraint: freedom.styleConstraint,
    style_flexibility: flexibility,
    statement_level: statement,
    portfolio_diversity_preference: freedom.portfolioDiversity,
    constraints: constraints.length > 0
      ? evidence(constraints, USER_SOURCE, 1) : evidence([]),
    uncertainty: uncertainty.length > 0
      ? evidence(uncertainty, INFERENCE_SOURCE, 0.7) : evidence([]),
    normalized_style: normalizedStyle,
  };
  const conflicts = [];
  const inferredScene = inferSceneFromRaw(rawInput);
  if (context?.user_truth?.scene && inferredScene &&
      sceneKey(context.user_truth.scene) !== sceneKey(inferredScene)) {
    conflicts.push({
      field: "scene_intent",
      kept: {
        value: context.user_truth.scene,
        source: sceneSource,
      },
      observed: {
        value: inferredScene,
        source: INFERENCE_SOURCE,
      },
      reason: "STRUCTURED_SCENE_AND_RAW_GOAL_DIFFER",
    });
  }
  if (mainstream.value === "balanced") {
    conflicts.push({
      field: "mainstream_vs_niche",
      reason: "EXPLICIT_SIGNALS_REQUIRE_BALANCE",
      resolution: "balanced",
    });
  }
  if (style.declared_style_suppressed) {
    conflicts.push({
      field: "explicit_style",
      kept: {value: null, source: USER_SOURCE},
      observed: {
        value: context?.user_truth?.explicit_style || null,
        source: sourceFor(context, "user_truth.explicit_style", EMPTY_SOURCE),
      },
      reason: "RAW_USER_NEGATION_OVERRIDES_LEGACY_STYLE_EXTRACTION",
    });
  }
  const sourceMap = buildSourceMap(fields);
  const trace = deepFreeze({
    raw_user_input: rawInput,
    explicit_signals: explicitSignals,
    inferred_signals: inferredSignals,
    normalized_style: style.normalized
      ? {
          canonical: style.normalized,
          role: style.role,
          source: style.source,
          confidence: style.confidence,
          resolution_reason: style.resolution_trace.resolution_reason,
        }
      : null,
    must: rawRequirements,
    prefer: preferences,
    avoid: avoids,
    creative_freedom: freedom.creativeFreedom.value,
    style_flexibility: flexibility.value,
    statement_level: statement.value,
    trend_preference: trend.value,
    mainstream_vs_niche: mainstream.value,
    uncertainty,
    source_map: sourceMap,
    conflicts,
  });
  return deepFreeze({
    version: USER_INTENT_BRAIN_VERSION,
    ...fields,
    explicit_signals: explicitSignals,
    inferred_signals: inferredSignals,
    style_resolution: deepFreeze({
      raw_style_input: style.raw,
      role: style.role,
      source: style.source,
      confidence: style.confidence,
      ...deepClone(style.resolution_trace),
    }),
    source_map: sourceMap,
    conflicts,
    trace,
  });
}

function createUserIntentTrace(result = {}) {
  if (!result || result.version !== USER_INTENT_BRAIN_VERSION) {
    const error = new Error("UserIntentBrain result is invalid");
    error.code = "USER_INTENT_BRAIN_RESULT_INVALID";
    throw error;
  }
  return deepFreeze(deepClone(result.trace));
}

class UserIntentBrain {
  interpret(context) {
    return interpretUserIntent(context);
  }
}

module.exports = {
  USER_INTENT_BRAIN_VERSION,
  UserIntentBrain,
  createUserIntentTrace,
  interpretUserIntent,
};
