"use strict";

const {resolveAuthoritativeValue} = require("./decision_context");

const BODY_FIT_INTELLIGENCE_VERSION = "body_fit_intelligence.v1";
const UNKNOWN = "unknown";
const SYSTEM_SOURCE = "system";
const INFERENCE_SOURCE = "ai_inference";
const DEFAULT_SOURCE = "style_default";

const BODY_FACT_FIELDS = Object.freeze({
  height: ["height"],
  weight: ["weight"],
  shoulder_relation: ["shoulder_relation", "shoulder", "shoulder_width"],
  torso_length: ["torso_length", "torso_relation", "upper_body_length"],
  leg_length_relation: [
    "leg_length_relation",
    "leg_length",
    "leg_ratio",
    "leg_body_ratio",
  ],
  waist_position: ["waist_position", "waistline_position"],
  hip_relation: ["hip_relation", "hip_width", "hip"],
  frame: ["frame", "body_frame", "bone_structure"],
  body_shape: ["body_shape", "body_type", "shape"],
});

function deepClone(value) {
  return value == null ? value : structuredClone(value);
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function clampConfidence(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(0, Math.min(1, number))
    : fallback;
}

function isPresent(value) {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function sanitize(value, stack = new WeakSet()) {
  if (value == null || typeof value === "string" ||
      typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "object") return String(value);
  if (stack.has(value)) return "[Circular]";
  stack.add(value);
  const result = Array.isArray(value)
    ? value.map((item) => sanitize(item, stack))
    : Object.fromEntries(Object.entries(value)
      .filter(([key]) => !["__proto__", "prototype", "constructor"].includes(key))
      .map(([key, item]) => [key, sanitize(item, stack)]));
  stack.delete(value);
  return result;
}

function evidence(value, source = SYSTEM_SOURCE, confidence = 0) {
  return deepFreeze({
    value: deepClone(value),
    source: String(source || SYSTEM_SOURCE),
    confidence: clampConfidence(confidence),
  });
}

function unknownEvidence() {
  return evidence(UNKNOWN, SYSTEM_SOURCE, 0);
}

function normalizedText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function canonicalRelation(field, value) {
  if (value == null || value === "") return UNKNOWN;
  if (["height", "weight"].includes(field)) {
    const number = Number(value);
    return Number.isFinite(number) ? number : UNKNOWN;
  }
  const raw = normalizedText(value);
  if (!raw || /^(?:unknown|未知|无法判断|不确定|none|null)$/u.test(raw)) {
    return UNKNOWN;
  }
  if (/(?:不是|并非|并不|不属于|不算|不要|避免|拒绝|没有|未见|否认|无明显|不明显|不突出|不像|不太像|不完全是|不[偏较]?[宽窄长短高低大小]|非(?!常)|\bnot\b|\bnon[-_ ])/u
    .test(raw)) {
    return UNKNOWN;
  }
  const mappings = {
    shoulder_relation: [
      [/^(?:narrow|窄|较窄|偏窄)$/u, "narrow"],
      [/(?:窄肩|肩(?:线|部|宽)?(?:视觉)?(?:比例)?(?:相对)?(?:较|偏)?窄)/u,
        "narrow"],
      [/^(?:wide|broad|较宽|偏宽)$/u, "wide"],
      [/(?:宽肩|肩(?:线|部|宽)?(?:视觉)?(?:比例)?(?:相对)?(?:较|偏)?宽)/u,
        "wide"],
      [/^(?:normal|balanced|average|正常|适中|均衡)$/u, "balanced"],
      [/(?:肩(?:线|部|宽)?(?:视觉)?(?:比例)?(?:正常|适中|均衡))/u,
        "balanced"],
    ],
    torso_length: [
      [/^(?:long|较长|偏长)$/u, "long"],
      [/(?:上半身|躯干)(?:视觉)?(?:比例)?(?:相对)?(?:较|偏)?长/u, "long"],
      [/^(?:short|较短|偏短)$/u, "short"],
      [/(?:上半身|躯干)(?:视觉)?(?:比例)?(?:相对)?(?:较|偏)?短/u, "short"],
      [/^(?:normal|balanced|average|正常|适中|均衡)$/u, "balanced"],
      [/(?:上半身|躯干)(?:视觉)?(?:比例)?(?:正常|适中|均衡)/u, "balanced"],
    ],
    leg_length_relation: [
      [/^(?:short|较短|偏短)$/u, "short"],
      [/(?:腿身比|腿部(?:视觉)?比例|腿长(?:视觉)?比例)(?:相对)?(?:较|偏)?短/u,
        "short"],
      [/^(?:long|较长|偏长)$/u, "long"],
      [/(?:腿身比|腿部(?:视觉)?比例|腿长(?:视觉)?比例)(?:相对)?(?:较|偏)?长/u,
        "long"],
      [/^(?:normal|balanced|average|正常|适中|均衡)$/u, "balanced"],
      [/(?:腿身比|腿部(?:视觉)?比例|腿长(?:视觉)?比例)(?:正常|适中|均衡)/u,
        "balanced"],
    ],
    waist_position: [
      [/(?:high|较高|偏高|高腰位)/u, "high"],
      [/(?:low|较低|偏低|低腰位)/u, "low"],
      [/^(?:normal|natural|balanced|正常|自然|适中)$/u, "natural"],
      [/(?:腰线|腰位)(?:正常|自然|适中)/u, "natural"],
    ],
    hip_relation: [
      [/(?:narrow|较窄|偏窄)/u, "narrow"],
      [/^(?:normal|balanced|average|正常|适中|均衡)$/u, "balanced"],
      [/(?:髋部|胯部)(?:比例)?(?:正常|适中|均衡)/u, "balanced"],
      [/(?:wide|broad|prominent|较宽|偏宽)/u, "wide"],
    ],
    frame: [
      [/(?:small|petite|fine|小骨架|纤细骨架)/u, "small"],
      [/(?:large|broad|大骨架|较大骨架)/u, "large"],
      [/(?:medium|normal|balanced|中等|正常|适中)/u, "medium"],
    ],
    body_shape: [
      [/(?:hourglass|沙漏)/u, "hourglass"],
      [/(?:pear|梨形)/u, "pear"],
      [/(?:inverted[_ -]?triangle|倒三角)/u, "inverted_triangle"],
      [/(?:rectangle|straight|h型|直筒型)/u, "rectangle"],
      [/(?:apple|苹果)/u, "apple"],
      [/(?:balanced|average|均衡|匀称|标准)/u, "balanced"],
    ],
  };
  for (const [pattern, canonical] of mappings[field] || []) {
    if (pattern.test(raw)) return canonical;
  }
  return UNKNOWN;
}

function bodyFactEvidence(context, alias, fact) {
  const body = context?.body || {};
  return {
    value: fact && typeof fact === "object" &&
      Object.hasOwn(fact, "value") ? fact.value : fact,
    source: fact?.source || body?.source?.body_facts?.[alias] ||
      context?.context_source_map?.[`body.body_facts.${alias}`]?.source ||
      SYSTEM_SOURCE,
    confidence: fact?.confidence ?? body?.confidence?.body_facts?.[alias] ??
      context?.context_source_map?.[`body.body_facts.${alias}`]?.confidence ?? 0,
    authority:
      context?.context_source_map?.[`body.body_facts.${alias}`]?.authority,
  };
}

function bodyFactCandidate(context, field, aliases, extractedImageFacts,
  conflicts) {
  const body = context?.body || {};
  if (field === "height" || field === "weight") {
    const value = canonicalRelation(field, body[field]);
    if (value === UNKNOWN) return unknownEvidence();
    return evidence(
      value,
      body?.source?.[field] ||
        context?.context_source_map?.[`body.${field}`]?.source || SYSTEM_SOURCE,
      body?.confidence?.[field] ??
        context?.context_source_map?.[`body.${field}`]?.confidence ?? 0,
    );
  }
  const candidates = [];
  for (const alias of aliases) {
    const fact = body?.body_facts?.[alias];
    if (!isPresent(fact)) continue;
    const rawEvidence = bodyFactEvidence(context, alias, fact);
    if (rawEvidence.source === "image" &&
        clampConfidence(rawEvidence.confidence, 0) <= 0) {
      continue;
    }
    const value = canonicalRelation(field, rawEvidence.value);
    if (value === UNKNOWN) continue;
    candidates.push({...rawEvidence, value});
  }
  if (extractedImageFacts[field]) {
    candidates.push(extractedImageFacts[field]);
  }
  if (candidates.length === 0) return unknownEvidence();
  const resolved = resolveAuthoritativeValue({
    path: `body.body_facts.${field}`,
    candidates,
    conflicts,
  });
  return evidence(resolved.value, resolved.source, resolved.confidence);
}

function resolvedBodyFacts(context) {
  const extractedImageFacts = extractImageSummaryFacts(context);
  const conflicts = [];
  const facts = Object.fromEntries(Object.entries(BODY_FACT_FIELDS).map(
    ([field, aliases]) => {
      return [field, bodyFactCandidate(
        context,
        field,
        aliases,
        extractedImageFacts,
        conflicts,
      )];
    },
  ));
  return {facts, conflicts};
}

function structuredImageBodyFacts(context) {
  const image = context?.body?.image_analysis || {};
  const facts = image.body_facts || image.bodyFacts || image.facts || {};
  if (!facts || typeof facts !== "object" || Array.isArray(facts)) return {};
  const scaleVerified = image.reliable_scale === true ||
    image.scale_reliable === true || image.has_reference_scale === true ||
    image.measurement_scale_verified === true || image.scale?.verified === true;
  const confidenceCeiling = clampConfidence(
    context?.context_source_map?.["body.image_analysis"]?.confidence ??
      image.confidence,
    0,
  );
  return sanitize(Object.fromEntries(Object.entries(facts)
    .filter(([key, fact]) => scaleVerified ||
      !unreliablePreciseImageMeasurement(key, fact))
    .map(([key, fact]) => {
    const value = fact && typeof fact === "object" &&
      Object.hasOwn(fact, "value") ? fact.value : fact;
    const confidence = fact && typeof fact === "object"
      ? Math.min(clampConfidence(fact.confidence, confidenceCeiling),
        confidenceCeiling)
      : confidenceCeiling;
    return [key, evidence(value, "image", confidence)];
    })));
}

function unreliablePreciseImageMeasurement(key, fact) {
  const value = fact && typeof fact === "object" &&
    Object.hasOwn(fact, "value") ? fact.value : fact;
  if (typeof value === "string" &&
      /\d+(?:\.\d+)?\s*(?:cm|centimet(?:er|re)s?|厘米|公分|mm|millimet(?:er|re)s?|毫米|公厘|kg|公斤|千克|lb|磅)/iu
        .test(value)) {
    return true;
  }
  const normalizedKey = String(key || "")
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .replace(/[^a-z0-9]+/giu, "_")
    .toLowerCase();
  const measurementKey = /(?:^|_)(?:cm|mm|kg|lb)$/u.test(normalizedKey) ||
    /^(?:height|weight|shoulder(?:_width)?|chest|bust|waist(?:_circumference)?|hip(?:_width|_circumference)?|inseam|arm_length|leg_length|torso_length)(?:_(?:cm|mm|kg|lb))?$/u
      .test(normalizedKey);
  return measurementKey &&
    (Number.isFinite(value) || /\d/u.test(String(value || "")));
}

function unreliableImageMeasurementConflicts(context) {
  const image = context?.body?.image_analysis || {};
  const scaleVerified = image.reliable_scale === true ||
    image.scale_reliable === true || image.has_reference_scale === true ||
    image.measurement_scale_verified === true || image.scale?.verified === true;
  if (scaleVerified) return [];
  const facts = image.body_facts || image.bodyFacts || image.facts || {};
  if (!facts || typeof facts !== "object" || Array.isArray(facts)) return [];
  return Object.entries(facts)
    .filter(([key, fact]) => unreliablePreciseImageMeasurement(key, fact))
    .map(([key]) => ({
      path: `body.image_analysis.body_facts.${key}`,
      kept: UNKNOWN,
      kept_source: SYSTEM_SOURCE,
      rejected: "[REDACTED_PRECISE_MEASUREMENT]",
      rejected_source: "image",
      reason: "UNRELIABLE_PRECISE_IMAGE_MEASUREMENT",
    }));
}

function extractImageSummaryFacts(context) {
  const image = context?.body?.image_analysis || {};
  const summary = String(image.summary || image.body_profile ||
    image.bodyProfile || "").trim();
  if (!summary) return {};
  const confidence = Math.min(0.7, clampConfidence(
    context?.context_source_map?.["body.image_analysis"]?.confidence ??
      image.confidence,
    0,
  ));
  if (confidence <= 0) return {};
  const facts = {};
  const setFact = (field, value) => {
    if (!facts[field]) facts[field] = evidence(value, "image", confidence);
  };
  for (const clause of summary.split(/[，。；,;\n]+/u)) {
    if (!clause.trim() ||
        /(?:建议|选择|适合|通过|优化|提升|显高|拉长|修饰|穿搭|版型|避免|设计|改善|推荐|衣服|服装|上衣|外套|裤|裙|鞋)/u
          .test(clause) ||
        /(?:无法|不能|难以|不确定|看不清|信息不足|未能判断|不是|并非|并不|不属于|不算|不要|没有|未见|否认|无明显|不明显|不突出|不像|不太像|不完全是|不[偏较]?[宽窄长短高低大小]|非(?!常)|\bnot\b|\bnon[-_ ])/u
          .test(clause) ||
        /\d+(?:\.\d+)?\s*(?:cm|centimet(?:er|re)s?|厘米|公分|mm|millimet(?:er|re)s?|毫米|公厘|kg|公斤|千克|lb|磅)/iu
          .test(clause)) {
      continue;
    }
    if (/(?:肩(?:线|部|宽)?(?:视觉)?(?:比例)?(?:相对)?(?:较|偏)?窄|窄肩)/u
      .test(clause)) {
      setFact("shoulder_relation", "narrow");
    } else if (/(?:肩(?:线|部|宽)?(?:视觉)?(?:比例)?(?:相对)?(?:较|偏)?宽|宽肩)/u
      .test(clause)) {
      setFact("shoulder_relation", "wide");
    } else if (/(?:肩(?:线|部|宽)?(?:视觉)?(?:比例)?(?:正常|适中|均衡))/u
      .test(clause)) {
      setFact("shoulder_relation", "balanced");
    }
    if (/(?:上半身|躯干)(?:视觉)?(?:比例)?(?:相对)?(?:较|偏)?长/u
      .test(clause)) {
      setFact("torso_length", "long");
    } else if (/(?:上半身|躯干)(?:视觉)?(?:比例)?(?:相对)?(?:较|偏)?短/u
      .test(clause)) {
      setFact("torso_length", "short");
    }
    if (/(?:腿身比|腿部(?:视觉)?比例|腿长(?:视觉)?比例)(?:相对)?(?:较|偏)?短/u
      .test(clause)) {
      setFact("leg_length_relation", "short");
    } else if (/(?:腿身比|腿部(?:视觉)?比例|腿长(?:视觉)?比例)(?:相对)?(?:较|偏)?长/u
      .test(clause)) {
      setFact("leg_length_relation", "long");
    }
    if (/(?:腰线|腰位)(?:相对)?(?:较|偏)?高/u.test(clause)) {
      setFact("waist_position", "high");
    } else if (/(?:腰线|腰位)(?:相对)?(?:较|偏)?低/u.test(clause)) {
      setFact("waist_position", "low");
    }
    if (/(?:髋部|胯部)(?:相对)?(?:较|偏)?宽/u.test(clause)) {
      setFact("hip_relation", "wide");
    } else if (/(?:髋部|胯部)(?:相对)?(?:较|偏)?窄/u.test(clause)) {
      setFact("hip_relation", "narrow");
    }
    if (/(?:小骨架|骨架(?:相对)?(?:较|偏)?小)/u.test(clause)) {
      setFact("frame", "small");
    } else if (/(?:大骨架|骨架(?:相对)?(?:较|偏)?大)/u.test(clause)) {
      setFact("frame", "large");
    }
    const shapeMatch = clause.match(/(?:沙漏|梨形|倒三角|h型|直筒型|苹果)/iu);
    if (shapeMatch) {
      const value = canonicalRelation("body_shape", shapeMatch[0]);
      if (value !== UNKNOWN) setFact("body_shape", value);
    }
  }
  return facts;
}

function imageBodyFacts(context) {
  return sanitize({
    ...extractImageSummaryFacts(context),
    ...structuredImageBodyFacts(context),
  });
}

function bodyConflicts(context, aliasConflicts = []) {
  const conflicts = (context?.context_conflicts || []).filter(({path}) =>
    String(path || "").startsWith("body."));
  return sanitize([
    ...conflicts,
    ...aliasConflicts,
    ...unreliableImageMeasurementConflicts(context),
  ]);
}

function intentDescriptor(context) {
  const brain = context?.intent?.user_intent_brain || {};
  const evidenceValues = (item) => (Array.isArray(item?.value)
    ? item.value
    : []).map((value) => String(value).trim()).filter(Boolean);
  const uniqueValues = (values) => [...new Set(values
    .map((value) => String(value).trim())
    .filter(Boolean))];
  const rawClauses = String(context?.raw_user_input || "")
    .split(/[，。；,;\n]+/u)
    .map((value) => value.trim())
    .filter(Boolean);
  const rawAvoids = rawClauses.filter((value) =>
    /(?:不要|不想|不穿|不喜欢|不接受|避免|拒绝)/u.test(value));
  const rawRequirements = rawClauses.filter((value) =>
    /(?:必须|务必|一定要|需要|要有|不能少)/u.test(value));
  const rawPreferences = rawClauses.filter((value) =>
    /(?:想要|想穿|喜欢|偏好)/u.test(value) &&
    !/(?:不要|不想|不穿|不喜欢|不接受|避免|拒绝)/u.test(value));
  const normalized = brain?.normalized_style?.value ||
    brain?.explicit_style?.value || "";
  const components = String(normalized || "")
    .split(/\s*\+\s*/u)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const styleSource = brain?.normalized_style?.source ||
    brain?.explicit_style?.source || SYSTEM_SOURCE;
  const styleConfidence = brain?.normalized_style?.confidence ??
    brain?.explicit_style?.confidence ?? 0;
  const scene = String(brain?.scene_intent?.value ||
    context?.user_truth?.scene || "").trim().toLowerCase();
  const contains = (values) => components.some((component) =>
    values.some((value) => component.includes(value)));
  return {
    components,
    style_source: styleSource,
    style_confidence: clampConfidence(styleConfidence),
    scene,
    explicit_requirements: uniqueValues([
      ...evidenceValues(brain.explicit_requirements),
      ...(context?.user_truth?.explicit_requirements || []),
      ...rawRequirements,
    ]),
    explicit_preferences: uniqueValues([
      ...evidenceValues(brain.explicit_preferences),
      ...(context?.user_truth?.explicit_preferences || []),
      ...rawPreferences,
    ]),
    explicit_avoid: uniqueValues([
      ...evidenceValues(brain.explicit_avoid),
      ...(context?.user_truth?.explicit_avoid || []),
      ...rawAvoids,
    ]),
    relaxed_volume: contains(["street", "cityboy", "american_vintage"]),
    clean_structure: contains([
      "clean_fit", "minimal", "business_casual", "formal", "elegant",
    ]),
    shaped_expression: contains(["sweet", "dark_sweet", "sweet_cool", "korean"]),
  };
}

function createPreferenceState() {
  const goal = (value) => evidence(value, DEFAULT_SOURCE, 0.35);
  const preference = (value) => evidence(value, DEFAULT_SOURCE, 0.3);
  return {
    proportion_goals: {
      vertical_balance: goal("preserve_natural_vertical_balance"),
      upper_lower_balance: goal("balanced_upper_lower_relationship"),
      waistline_goal: goal("natural_waistline"),
      leg_line_goal: goal("unconstrained_leg_line"),
      shoulder_balance: goal("preserve_natural_shoulder_line"),
      volume_distribution: goal("balanced_volume_distribution"),
    },
    garment_preferences: {
      top: {
        preferred_length: preference("style_and_scene_led"),
        preferred_fit: preference("comfortable_non_restrictive_fit"),
        neckline: preference("style_and_scene_led"),
        shoulder_structure: preference("natural_shoulder_line"),
        hem_position: preference("contextual_hem_position"),
      },
      bottom: {
        rise: preference("natural_or_mid_rise"),
        leg_shape: preference("style_led_leg_shape"),
        length: preference("clean_non_dragging_finish"),
        volume: preference("balanced_volume"),
        waist_structure: preference("comfortable_stable_waist"),
      },
      dress: {
        waist_position: preference("style_led_waist_position"),
        length: preference("scene_led_length"),
        silhouette: preference("style_led_silhouette"),
      },
      outerwear: {
        length: preference("scene_led_length"),
        shoulder: preference("natural_shoulder_line"),
        volume: preference("balanced_volume"),
      },
      shoes: {
        visual_weight: preference("balanced_visual_weight"),
        toe_shape: preference("style_led_toe_shape"),
        sole_weight: preference("moderate_sole_weight"),
        shaft_height: preference("contextual_shaft_height"),
      },
    },
  };
}

function derivedEvidence(value, supports, ceiling = 0.84) {
  const supportItems = (Array.isArray(supports) ? supports : [supports])
    .filter((item) => item != null);
  const confidences = supportItems
    .map((item) => clampConfidence(item?.confidence, 0.55));
  const confidence = supportItems.length > 0
    ? Math.min(ceiling, Math.min(...confidences) * 0.9)
    : 0.35;
  return evidence(value, INFERENCE_SOURCE, confidence);
}

function buildSourceMap(bodyFacts, proportionGoals, garmentPreferences,
  fitPrefer, fitAvoid, uncertainty) {
  const entries = {};
  const append = (path, item) => {
    entries[path] = {source: item.source, confidence: item.confidence};
  };
  for (const [field, item] of Object.entries(bodyFacts)) {
    append(`body_facts.${field}`, item);
  }
  for (const [field, item] of Object.entries(proportionGoals)) {
    append(`proportion_goals.${field}`, item);
  }
  for (const [slot, preferences] of Object.entries(garmentPreferences)) {
    for (const [field, item] of Object.entries(preferences)) {
      append(`garment_preferences.${slot}.${field}`, item);
    }
  }
  const sourcePriority = {
    user: 700,
    profile: 600,
    image: 500,
    history: 400,
    ai_inference: 300,
    market: 200,
    style_default: 100,
    system: 0,
  };
  const summarizeList = (items) => {
    if (items.length === 0) return {source: SYSTEM_SOURCE, confidence: 0};
    const winner = [...items].sort((left, right) =>
      (sourcePriority[right.source] || 0) -
      (sourcePriority[left.source] || 0) ||
      right.confidence - left.confidence)[0];
    return {
      source: winner.source,
      confidence: winner.confidence,
      sources: [...new Set(items.map(({source}) => source))],
    };
  };
  entries.fit_prefer = summarizeList(fitPrefer);
  entries.fit_avoid = summarizeList(fitAvoid);
  entries.uncertainty = uncertainty.length > 0
    ? {source: SYSTEM_SOURCE, confidence: 1}
    : {source: SYSTEM_SOURCE, confidence: 0};
  return entries;
}

function buildBodyFitProfile(context = {}) {
  const bodyResolution = resolvedBodyFacts(context);
  const bodyFacts = bodyResolution.facts;
  const intent = intentDescriptor(context);
  const state = createPreferenceState();
  const goals = state.proportion_goals;
  const garments = state.garment_preferences;
  const fitPrefer = [];
  const fitAvoid = [];
  const intentAdjustments = [];
  const prefer = (value, supports) => fitPrefer.push(deepFreeze({
    ...derivedEvidence(value, supports),
    hard_requirement: false,
  }));
  const avoid = (value, supports) => fitAvoid.push(deepFreeze({
    ...derivedEvidence(value, supports),
    hard_gate: false,
  }));
  const intentSupport = {
    confidence: intent.style_confidence || 0.65,
  };
  const intentText = (values) => values.join(" ").toLowerCase();
  const explicitAvoidText = intentText(intent.explicit_avoid);
  const explicitRequirementText = intentText([
    ...intent.explicit_requirements,
    ...intent.explicit_preferences,
  ]);

  if (intent.relaxed_volume) {
    goals.volume_distribution = derivedEvidence(
      "intentional_relaxed_volume_with_proportion_control",
      intentSupport,
    );
    garments.top.preferred_fit = derivedEvidence(
      "relaxed_with_controlled_structure",
      intentSupport,
    );
    garments.bottom.leg_shape = derivedEvidence(
      "relaxed_or_wide_with_controlled_drape",
      intentSupport,
    );
    garments.bottom.length = derivedEvidence(
      "clean_break_or_full_length_without_dragging",
      intentSupport,
    );
    garments.shoes.visual_weight = derivedEvidence(
      "balanced_with_bottom_volume",
      intentSupport,
    );
    intentAdjustments.push("RELAXED_VOLUME_PRESERVED_WITH_PROPORTION_CONTROL");
  } else if (intent.clean_structure) {
    garments.top.preferred_fit = derivedEvidence(
      "clean_relaxed_or_tailored_not_skin_tight",
      intentSupport,
    );
    garments.bottom.leg_shape = derivedEvidence(
      "clean_straight_or_gently_tapered",
      intentSupport,
    );
    garments.shoes.visual_weight = derivedEvidence(
      "low_to_moderate_visual_weight",
      intentSupport,
    );
    intentAdjustments.push("CLEAN_STRUCTURE_PRESERVED");
  }

  if (intent.shaped_expression) {
    garments.dress.silhouette = derivedEvidence(
      "defined_or_flowing_shape_consistent_with_style",
      intentSupport,
    );
    garments.dress.waist_position = derivedEvidence(
      "visible_but_not_mandatory_waist_definition",
      intentSupport,
    );
    intentAdjustments.push("SHAPED_EXPRESSION_AVAILABLE_NOT_REQUIRED");
  }

  const legRelation = bodyFacts.leg_length_relation;
  const torsoLength = bodyFacts.torso_length;
  if (legRelation.value === "short" || torsoLength.value === "long") {
    const support = legRelation.value === "short" ? legRelation : torsoLength;
    goals.vertical_balance = derivedEvidence(
      "visually_extend_lower_body_line",
      support,
    );
    goals.upper_lower_balance = derivedEvidence(
      "reduce_visual_torso_dominance",
      support,
    );
    goals.waistline_goal = derivedEvidence(
      "raise_visual_waistline",
      support,
    );
    goals.leg_line_goal = derivedEvidence(
      "maintain_continuous_lower_body_line",
      support,
    );
    garments.top.preferred_length = derivedEvidence(
      intent.relaxed_volume
        ? "regular_or_cropped_with_controlled_hem"
        : "waist_skimming_or_reasonably_short",
      [support, intentSupport],
    );
    garments.top.hem_position = derivedEvidence(
      "near_visual_waist_without_forced_cropping",
      support,
    );
    garments.bottom.rise = derivedEvidence("mid_to_high_rise", support);
    garments.bottom.length = derivedEvidence(
      intent.relaxed_volume
        ? "full_length_with_clean_non_dragging_break"
        : "ankle_or_full_length_with_unbroken_line",
      [support, intentSupport],
    );
    garments.dress.waist_position = derivedEvidence(
      "natural_to_slightly_raised_visual_waist",
      support,
    );
    garments.shoes.visual_weight = derivedEvidence(
      intent.relaxed_volume
        ? "balanced_with_bottom_volume"
        : "light_to_moderate_visual_weight",
      [support, intentSupport],
    );
    prefer("visible_or_supported_waistline", support);
    prefer("continuous_lower_body_line", support);
    avoid("dragging_hem_that_breaks_leg_line", support);
  }

  const shoulder = bodyFacts.shoulder_relation;
  if (shoulder.value === "wide") {
    goals.shoulder_balance = derivedEvidence(
      "balance_shoulder_line_without_compression",
      shoulder,
    );
    goals.volume_distribution = derivedEvidence(
      "distribute_volume_without_overloading_upper_body",
      shoulder,
    );
    garments.top.preferred_fit = derivedEvidence(
      intent.relaxed_volume
        ? "relaxed_with_controlled_shoulder_seam"
        : "relaxed_tailored_not_tight",
      [shoulder, intentSupport],
    );
    garments.top.neckline = derivedEvidence(
      "open_or_clean_neckline",
      shoulder,
    );
    garments.top.shoulder_structure = derivedEvidence(
      "natural_or_gently_structured_shoulder",
      shoulder,
    );
    garments.outerwear.shoulder = derivedEvidence(
      "natural_or_gently_structured_shoulder",
      shoulder,
    );
    prefer("upper_body_ease_without_forced_oversizing", shoulder);
    avoid("extreme_narrow_shoulder_line", shoulder);
    avoid("overly_tight_upper_body", shoulder);
  } else if (shoulder.value === "narrow") {
    goals.shoulder_balance = derivedEvidence(
      "support_visual_shoulder_definition",
      shoulder,
    );
    garments.top.shoulder_structure = derivedEvidence(
      "natural_to_gently_defined_shoulder",
      shoulder,
    );
    garments.outerwear.shoulder = derivedEvidence(
      "gently_defined_without_exaggeration",
      shoulder,
    );
  }

  const frame = bodyFacts.frame;
  if (frame.value === "small") {
    goals.volume_distribution = derivedEvidence(
      intent.relaxed_volume
        ? "intentional_volume_with_visible_structure"
        : "controlled_volume_without_visual_overload",
      [frame, intentSupport],
    );
    garments.outerwear.volume = derivedEvidence(
      intent.relaxed_volume
        ? "relaxed_but_structurally_controlled"
        : "light_to_moderate_volume",
      [frame, intentSupport],
    );
  }

  const topLengthSignal = /(?:上衣|衬衫|针织|毛衣|外套|top|shirt|jacket)/iu;
  const shortSignal = /(?:短款|露腰|cropped?|crop\s*top)/iu;
  const longSignal = /(?:长款|长版|longline|long\s*top)/iu;
  const avoidsShortTop = shortSignal.test(explicitAvoidText) &&
    (topLengthSignal.test(explicitAvoidText) ||
      /(?:不要|避免|拒绝|不想|不穿)/u.test(explicitAvoidText));
  const requiresLongTop = longSignal.test(explicitRequirementText) &&
    (topLengthSignal.test(explicitRequirementText) ||
      /(?:必须|务必|一定要|需要|想要|想穿|偏好)/u
        .test(explicitRequirementText));
  if (avoidsShortTop || requiresLongTop) {
    garments.top.preferred_length = evidence(
      requiresLongTop
        ? "longline_as_explicitly_requested"
        : "non_cropped_user_compatible_length",
      "user",
      1,
    );
    fitAvoid.push(deepFreeze({
      ...evidence("cropped_or_short_top", "user", 1),
      hard_gate: false,
    }));
    intentAdjustments.push(requiresLongTop
      ? "EXPLICIT_LONG_TOP_REQUIREMENT_PRESERVED"
      : "EXPLICIT_AVOID_SHORT_TOP_PRESERVED");
  }
  const waistEmphasisSignal = /(?:强调|突出|凸显|收紧|收腰|明显|露出)/u;
  const waistAreaSignal = /(?:腰线|腰部|腰身)/u;
  const avoidsWaistEmphasis = waistEmphasisSignal.test(explicitAvoidText) &&
    waistAreaSignal.test(explicitAvoidText);
  if (avoidsWaistEmphasis) {
    goals.waistline_goal = evidence(
      "do_not_emphasize_waistline_as_requested",
      "user",
      1,
    );
    garments.top.hem_position = evidence(
      "style_led_without_waist_emphasis",
      "user",
      1,
    );
    garments.bottom.rise = evidence(
      "style_led_without_waist_emphasis",
      "user",
      1,
    );
    garments.dress.waist_position = evidence(
      "style_led_without_waist_emphasis",
      "user",
      1,
    );
    for (let index = fitPrefer.length - 1; index >= 0; index -= 1) {
      if (fitPrefer[index].value === "visible_or_supported_waistline") {
        fitPrefer.splice(index, 1);
      }
    }
    fitAvoid.push(deepFreeze({
      ...evidence("explicit_waistline_emphasis", "user", 1),
      hard_gate: false,
    }));
    intentAdjustments.push("EXPLICIT_AVOID_WAIST_EMPHASIS_PRESERVED");
  }
  const highRiseSignal = /(?:高腰|高腰线|high[-_ ]?rise)/iu;
  const lowRiseSignal = /(?:低腰|低腰线|low[-_ ]?rise)/iu;
  const avoidsHighRise = highRiseSignal.test(explicitAvoidText);
  const requiresLowRise = lowRiseSignal.test(explicitRequirementText);
  if (avoidsHighRise || requiresLowRise) {
    garments.bottom.rise = evidence(
      requiresLowRise
        ? "low_rise_as_explicitly_requested"
        : "non_high_rise_user_compatible",
      "user",
      1,
    );
    garments.dress.waist_position = evidence(
      "non_raised_user_compatible_waist",
      "user",
      1,
    );
    fitAvoid.push(deepFreeze({
      ...evidence("high_rise_or_raised_waist", "user", 1),
      hard_gate: false,
    }));
    intentAdjustments.push(requiresLowRise
      ? "EXPLICIT_LOW_RISE_REQUIREMENT_PRESERVED"
      : "EXPLICIT_AVOID_HIGH_RISE_PRESERVED");
  }
  const bottomSignal = /(?:裤|下装|bottom|trousers?|pants?)/iu;
  const wideBottomSignal = /(?:宽松|阔腿|宽腿|oversized|wide|relaxed)/iu;
  const avoidsWideBottom = wideBottomSignal.test(explicitAvoidText) &&
    bottomSignal.test(explicitAvoidText);
  if (avoidsWideBottom) {
    garments.bottom.leg_shape = evidence(
      "non_wide_user_compatible_leg_shape",
      "user",
      1,
    );
    garments.bottom.volume = evidence(
      "controlled_volume_as_explicitly_requested",
      "user",
      1,
    );
    fitAvoid.push(deepFreeze({
      ...evidence("wide_or_relaxed_trouser", "user", 1),
      hard_gate: false,
    }));
    intentAdjustments.push("EXPLICIT_AVOID_WIDE_BOTTOM_PRESERVED");
  }

  const uncertainty = Object.entries(bodyFacts)
    .filter(([, item]) => item.value === UNKNOWN)
    .map(([field]) => deepFreeze({
      code: `${field.toUpperCase()}_UNKNOWN`,
      field,
      source: SYSTEM_SOURCE,
      confidence: 1,
    }));
  if (Object.keys(imageBodyFacts(context)).length === 0) {
    uncertainty.push(deepFreeze({
      code: "IMAGE_BODY_FACTS_UNAVAILABLE",
      field: "image_analysis",
      source: SYSTEM_SOURCE,
      confidence: 1,
    }));
  }
  const sourceMap = buildSourceMap(
    bodyFacts,
    goals,
    garments,
    fitPrefer,
    fitAvoid,
    uncertainty,
  );
  const trace = {
    structured_body_input: sanitize(context?.body?.structured_measurements || {}),
    image_body_facts: imageBodyFacts(context),
    accepted_body_facts: sanitize(bodyFacts),
    rejected_conflicts: bodyConflicts(context, bodyResolution.conflicts),
    body_uncertainty: sanitize(uncertainty),
    proportion_goals: sanitize(goals),
    fit_prefer: sanitize(fitPrefer),
    fit_avoid: sanitize(fitAvoid),
    garment_preferences: sanitize(garments),
    intent_adjustments: intentAdjustments,
    source_map: sourceMap,
  };
  return deepFreeze({
    version: BODY_FIT_INTELLIGENCE_VERSION,
    decision_policy: "SOFT_OPTIMIZATION_ONLY",
    body_facts: bodyFacts,
    proportion_goals: goals,
    garment_preferences: garments,
    fit_avoid: fitAvoid,
    fit_prefer: fitPrefer,
    uncertainty,
    source_map: sourceMap,
    trace,
  });
}

function createBodyFitTrace(profile = {}) {
  return deepFreeze(sanitize(profile.trace || {}));
}

class BodyFitIntelligence {
  interpret(context) {
    return buildBodyFitProfile(context);
  }
}

module.exports = {
  BODY_FIT_INTELLIGENCE_VERSION,
  BodyFitIntelligence,
  buildBodyFitProfile,
  createBodyFitTrace,
};
