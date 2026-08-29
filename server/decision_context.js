"use strict";

const crypto = require("node:crypto");

const DECISION_CONTEXT_VERSION = "decision_context.v1";
const LEGACY_BLUEPRINT_DECISION_ROLE = "LEGACY_EXECUTION_SPEC";
const MARKET_STATUS_NOT_CONNECTED = "NOT_CONNECTED";

const SOURCE_TYPES = Object.freeze({
  USER: "user",
  PROFILE: "profile",
  IMAGE: "image",
  HISTORY: "history",
  AI_INFERENCE: "ai_inference",
  MARKET: "market",
  STYLE_DEFAULT: "style_default",
  SYSTEM: "system",
});

const AUTHORITY_PRIORITY = Object.freeze({
  [SOURCE_TYPES.USER]: 700,
  [SOURCE_TYPES.PROFILE]: 600,
  high_confidence_body_fact: 500,
  [SOURCE_TYPES.HISTORY]: 400,
  [SOURCE_TYPES.AI_INFERENCE]: 300,
  low_confidence_body_fact: 290,
  [SOURCE_TYPES.MARKET]: 200,
  [SOURCE_TYPES.STYLE_DEFAULT]: 100,
  [SOURCE_TYPES.SYSTEM]: 0,
});

const BLOCKED_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const KNOWN_SOURCES = new Set(Object.values(SOURCE_TYPES));
const HIGH_CONFIDENCE_BODY_FACT_THRESHOLD = 0.75;

function isProductionRuntime(environment = process.env) {
  const nodeEnvironment = String(environment?.NODE_ENV || "")
    .trim()
    .toLowerCase();
  const renderEnvironment = String(environment?.RENDER || "")
    .trim()
    .toLowerCase();
  return nodeEnvironment === "production" ||
    ["1", "true", "yes", "on"].includes(renderEnvironment);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function clampConfidence(value, fallback = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, number));
}

function normalizeSource(value, fallback = SOURCE_TYPES.AI_INFERENCE) {
  const normalized = String(value || "").trim().toLowerCase();
  return KNOWN_SOURCES.has(normalized) ? normalized : fallback;
}

function sanitizeValue(value, stack = new WeakSet()) {
  if (value === null || typeof value === "string" ||
      typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "undefined" || typeof value === "function" ||
      typeof value === "symbol") {
    return undefined;
  }
  if (typeof value !== "object") {
    return String(value);
  }
  if (stack.has(value)) {
    return "[Circular]";
  }
  stack.add(value);
  let result;
  if (Array.isArray(value)) {
    result = value
      .map((item) => sanitizeValue(item, stack))
      .filter((item) => typeof item !== "undefined");
  } else {
    result = {};
    for (const key of Object.keys(value)) {
      if (BLOCKED_KEYS.has(key)) {
        continue;
      }
      const child = sanitizeValue(value[key], stack);
      if (typeof child !== "undefined") {
        result[key] = child;
      }
    }
  }
  stack.delete(value);
  return result;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const child of Object.values(value)) {
    deepFreeze(child, seen);
  }
  return Object.freeze(value);
}

function isPresent(value) {
  if (value === null || typeof value === "undefined") {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "object") {
    return Object.keys(value).length > 0;
  }
  return true;
}

function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
    );
  }
  if (typeof value === "string") {
    return value.trim().toLowerCase();
  }
  return value;
}

function valuesEqual(left, right) {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function authorityFor(candidate) {
  if (Number.isFinite(Number(candidate?.authority))) {
    return Number(candidate.authority);
  }
  const source = normalizeSource(candidate?.source);
  if (source === SOURCE_TYPES.IMAGE) {
    return clampConfidence(candidate?.confidence, 0) >=
      HIGH_CONFIDENCE_BODY_FACT_THRESHOLD
      ? AUTHORITY_PRIORITY.high_confidence_body_fact
      : AUTHORITY_PRIORITY.low_confidence_body_fact;
  }
  return AUTHORITY_PRIORITY[source] ?? AUTHORITY_PRIORITY[SOURCE_TYPES.SYSTEM];
}

function normalizeEvidence(input, defaultSource, defaultConfidence = 1) {
  if (input && typeof input === "object" && !Array.isArray(input) &&
      hasOwn(input, "value")) {
    const source = normalizeSource(input.source, defaultSource);
    return {
      value: sanitizeValue(input.value),
      source,
      confidence: clampConfidence(input.confidence, defaultConfidence),
      authority: authorityFor({
        source,
        confidence: input.confidence ?? defaultConfidence,
        authority: input.authority,
      }),
    };
  }
  const source = normalizeSource(defaultSource);
  return {
    value: sanitizeValue(input),
    source,
    confidence: clampConfidence(defaultConfidence),
    authority: authorityFor({source, confidence: defaultConfidence}),
  };
}

function resolveAuthoritativeValue({
  path,
  candidates = [],
  conflicts = [],
  overrides = [],
  fallback = null,
  fallbackSource = SOURCE_TYPES.SYSTEM,
  allowedWinnerSources,
} = {}) {
  const allowed = allowedWinnerSources
    ? new Set(allowedWinnerSources.map((source) => normalizeSource(source)))
    : null;
  const normalized = candidates
    .map((candidate, index) => {
      const nestedEvidence = candidate?.value &&
        typeof candidate.value === "object" &&
        !Array.isArray(candidate.value) &&
        hasOwn(candidate.value, "value")
        ? candidate.value
        : null;
      const source = candidate?.source ?? nestedEvidence?.source;
      const confidence = candidate?.confidence ?? nestedEvidence?.confidence;
      const authority = candidate?.authority ?? nestedEvidence?.authority;
      const evidence = normalizeEvidence(
        nestedEvidence || candidate?.value,
        source,
        confidence,
      );
      return {
        ...evidence,
        authority: authorityFor({source: evidence.source,
          confidence: evidence.confidence, authority}),
        source: evidence.source,
        confidence: evidence.confidence,
        index,
      };
    })
    .filter((candidate) => isPresent(candidate.value));

  const eligible = allowed
    ? normalized.filter((candidate) => allowed.has(candidate.source))
    : normalized;
  eligible.sort((left, right) =>
    right.authority - left.authority || left.index - right.index);
  const winner = eligible[0] || normalizeEvidence(fallback, fallbackSource, 1);

  for (const candidate of normalized) {
    if (candidate === winner || valuesEqual(candidate.value, winner.value)) {
      continue;
    }
    const record = {
      path: String(path || ""),
      kept: sanitizeValue(winner.value),
      kept_source: winner.source,
      rejected: sanitizeValue(candidate.value),
      rejected_source: candidate.source,
      reason: allowed && !allowed.has(candidate.source)
        ? "SOURCE_NOT_ALLOWED_IN_USER_TRUTH"
        : "HIGHER_AUTHORITY_SOURCE_WINS",
    };
    conflicts.push(record);
    overrides.push(record);
  }

  return {
    value: sanitizeValue(winner.value),
    source: winner.source,
    confidence: winner.confidence,
    authority: winner.authority,
  };
}

function normalizeStringList(value) {
  const values = Array.isArray(value) ? value : isPresent(value) ? [value] : [];
  const seen = new Set();
  const result = [];
  for (const item of values) {
    const normalized = String(item ?? "").trim();
    const key = normalized.toLowerCase();
    if (normalized && !seen.has(key)) {
      seen.add(key);
      result.push(normalized);
    }
  }
  return result;
}

function constraintKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/不想要|不需要|不要|不穿|避免|拒绝/g, "")
    .replace(/[\s，。、“”‘’：:；;、/\\_-]+/g, "");
}

function constraintsConflict(left, right) {
  const leftKey = constraintKey(left);
  const rightKey = constraintKey(right);
  if (!leftKey || !rightKey) {
    return false;
  }
  return leftKey === rightKey || leftKey.includes(rightKey) || rightKey.includes(leftKey);
}

function mergeSourcedLists(path, groups, explicitAvoid, conflicts, overrides) {
  const values = [];
  const evidence = [];
  const seen = new Set();
  for (const group of groups) {
    for (const item of normalizeStringList(group?.values)) {
      if (group?.respectExplicitAvoid !== false &&
          explicitAvoid.some((avoid) => constraintsConflict(avoid, item))) {
        const record = {
          path,
          kept: sanitizeValue(explicitAvoid),
          kept_source: SOURCE_TYPES.USER,
          rejected: item,
          rejected_source: normalizeSource(group?.source),
          reason: "EXPLICIT_USER_AVOID_WINS",
        };
        conflicts.push(record);
        overrides.push(record);
        continue;
      }
      const key = item.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      values.push(item);
      evidence.push({
        value: item,
        source: normalizeSource(group?.source),
        confidence: clampConfidence(group?.confidence),
        authority: authorityFor(group),
      });
    }
  }
  return {values, evidence};
}

function readField(value, ...names) {
  for (const name of names) {
    if (hasOwn(value, name)) {
      return value[name];
    }
  }
  return undefined;
}

function bodyFactEntries(value, defaultSource, defaultConfidence) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value
      .map((fact) => {
        if (!fact || typeof fact !== "object") {
          return null;
        }
        const key = String(fact.key || fact.name || fact.field || "").trim();
        if (!key) {
          return null;
        }
        return [key, normalizeEvidence(
          hasOwn(fact, "value") ? fact.value : fact.fact,
          fact.source || defaultSource,
          fact.confidence ?? defaultConfidence,
        )];
      })
      .filter(Boolean);
  }
  if (typeof value !== "object") {
    return [];
  }
  return Object.entries(value)
    .filter(([key]) => !BLOCKED_KEYS.has(key))
    .map(([key, fact]) => [key, normalizeEvidence(
      fact,
      fact?.source || defaultSource,
      fact?.confidence ?? defaultConfidence,
    )]);
}

function imageScaleVerified(imageAnalysis) {
  return imageAnalysis?.reliable_scale === true ||
    imageAnalysis?.scale_reliable === true ||
    imageAnalysis?.has_reference_scale === true ||
    imageAnalysis?.measurement_scale_verified === true ||
    imageAnalysis?.scale?.verified === true;
}

function preciseImageMeasurement(key, fact) {
  const value = fact && typeof fact === "object" && hasOwn(fact, "value")
    ? fact.value
    : fact;
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

function normalizeImageFactSource(imageAnalysis) {
  const facts = readField(imageAnalysis, "body_facts", "bodyFacts", "facts") || {};
  if (imageScaleVerified(imageAnalysis)) return facts;
  if (Array.isArray(facts)) {
    return facts.filter((fact) => !preciseImageMeasurement(
      fact?.key || fact?.name || fact?.field,
      hasOwn(fact, "value") ? fact.value : fact?.fact,
    ));
  }
  if (!facts || typeof facts !== "object") return {};
  return Object.fromEntries(Object.entries(facts).filter(([key, fact]) =>
    !preciseImageMeasurement(key, fact)));
}

function imageBodyFactEntries(value, imageConfidence) {
  const confidenceCeiling = clampConfidence(imageConfidence, 0);
  return bodyFactEntries(value, SOURCE_TYPES.IMAGE, confidenceCeiling)
    .map(([key, item]) => [key, normalizeEvidence(
      item.value,
      SOURCE_TYPES.IMAGE,
      Math.min(clampConfidence(item.confidence, confidenceCeiling),
        confidenceCeiling),
    )]);
}

function resolveBody(bodyInput, profile, contextSourceMap, conflicts, overrides) {
  const body = bodyInput && typeof bodyInput === "object" ? bodyInput : {};
  const profileBody = profile?.body && typeof profile.body === "object"
    ? profile.body
    : profile || {};
  const defaultBodySource = normalizeSource(body.source, SOURCE_TYPES.PROFILE);
  const defaultBodyConfidence = clampConfidence(body.confidence, 1);
  const imageAnalysis = sanitizeValue(
    readField(body, "image_analysis", "imageAnalysis") || {},
  );
  const hasImageAnalysis = isPresent(imageAnalysis);
  contextSourceMap["body.image_analysis"] = {
    source: hasImageAnalysis ? SOURCE_TYPES.IMAGE : SOURCE_TYPES.SYSTEM,
    confidence: hasImageAnalysis
      ? clampConfidence(imageAnalysis?.confidence, 0)
      : 0,
    authority: hasImageAnalysis
      ? authorityFor({
        source: SOURCE_TYPES.IMAGE,
        confidence: imageAnalysis?.confidence ?? 0,
      })
      : AUTHORITY_PRIORITY[SOURCE_TYPES.SYSTEM],
  };

  const resolveBodyScalar = (name) => {
    const resolved = resolveAuthoritativeValue({
      path: `body.${name}`,
      candidates: [
        {
          value: body[name],
          source: body[name]?.source || defaultBodySource,
          confidence: body[name]?.confidence ?? defaultBodyConfidence,
        },
        {value: profileBody[name], source: SOURCE_TYPES.PROFILE, confidence: 1},
      ],
      conflicts,
      overrides,
    });
    contextSourceMap[`body.${name}`] = {
      source: resolved.source,
      confidence: resolved.confidence,
      authority: resolved.authority,
    };
    return resolved.value;
  };

  const structured = readField(
    body,
    "structured_measurements",
    "structuredMeasurements",
    "measurements",
  ) || readField(
    profileBody,
    "structured_measurements",
    "structuredMeasurements",
    "measurements",
  ) || {};
  const directFacts = readField(body, "body_facts", "bodyFacts") || {};
  const factCandidates = new Map();
  const addFacts = (facts, source, confidence) => {
    for (const [key, evidence] of bodyFactEntries(facts, source, confidence)) {
      if (!factCandidates.has(key)) {
        factCandidates.set(key, []);
      }
      factCandidates.get(key).push(evidence);
    }
  };
  addFacts(structured, SOURCE_TYPES.PROFILE, 1);
  addFacts(directFacts, defaultBodySource, defaultBodyConfidence);
  for (const [key, evidence] of imageBodyFactEntries(
    normalizeImageFactSource(imageAnalysis),
    imageAnalysis?.confidence ?? 0,
  )) {
    if (!factCandidates.has(key)) factCandidates.set(key, []);
    factCandidates.get(key).push(evidence);
  }

  const structuredMeasurements = Object.fromEntries(
    bodyFactEntries(structured, SOURCE_TYPES.PROFILE, 1)
      .filter(([, evidence]) => isPresent(evidence.value))
      .map(([key, evidence]) => [key, sanitizeValue(evidence.value)]),
  );
  const bodyFacts = {};
  const factSources = {};
  const factConfidences = {};
  for (const [key, candidates] of factCandidates.entries()) {
    const resolved = resolveAuthoritativeValue({
      path: `body.body_facts.${key}`,
      candidates,
      conflicts,
      overrides,
    });
    bodyFacts[key] = {
      value: resolved.value,
      source: resolved.source,
      confidence: resolved.confidence,
    };
    factSources[key] = resolved.source;
    factConfidences[key] = resolved.confidence;
    contextSourceMap[`body.body_facts.${key}`] = {
      source: resolved.source,
      confidence: resolved.confidence,
      authority: resolved.authority,
    };
  }

  const height = resolveBodyScalar("height");
  const weight = resolveBodyScalar("weight");
  return {
    height,
    weight,
    structured_measurements: structuredMeasurements,
    image_analysis: imageAnalysis,
    body_facts: bodyFacts,
    source: {
      height: contextSourceMap["body.height"].source,
      weight: contextSourceMap["body.weight"].source,
      body_facts: factSources,
    },
    confidence: {
      height: contextSourceMap["body.height"].confidence,
      weight: contextSourceMap["body.weight"].confidence,
      body_facts: factConfidences,
    },
  };
}

function markLegacyBlueprint(blueprint) {
  const value = sanitizeValue(blueprint || {});
  return deepFreeze({
    ...value,
    decision_role: LEGACY_BLUEPRINT_DECISION_ROLE,
  });
}

function createDecisionContext(input = {}) {
  const requestId = String(input.requestId || input.request_id || "").trim();
  if (!requestId) {
    const error = new Error("DecisionContext requires request_id");
    error.code = "DECISION_CONTEXT_REQUEST_ID_REQUIRED";
    throw error;
  }
  const rawUserInput = String(
    input.rawUserInput ?? input.raw_user_input ?? "",
  );
  const userTruthInput = input.userTruth || input.user_truth || {};
  const profile = input.profile || {};
  const history = input.history || {};
  const aiInference = input.aiInference || input.ai_inference || {};
  const marketInput = input.market || {};
  const styleDefaults = input.styleDefaults || input.style_defaults || {};
  const contextSourceMap = {};
  const contextOverrides = [];
  const contextConflicts = [];
  contextSourceMap.raw_user_input = {
    source: SOURCE_TYPES.USER,
    confidence: 1,
    authority: AUTHORITY_PRIORITY[SOURCE_TYPES.USER],
  };

  const scalar = (field, candidates, options = {}) => {
    const resolved = resolveAuthoritativeValue({
      path: `user_truth.${field}`,
      candidates,
      conflicts: contextConflicts,
      overrides: contextOverrides,
      fallback: options.fallback ?? null,
      fallbackSource: options.fallbackSource || SOURCE_TYPES.SYSTEM,
      allowedWinnerSources: options.allowedWinnerSources,
    });
    contextSourceMap[`user_truth.${field}`] = {
      source: resolved.source,
      confidence: resolved.confidence,
      authority: resolved.authority,
    };
    return resolved.value;
  };

  const gender = scalar("gender", [
    {value: userTruthInput.gender, source: SOURCE_TYPES.USER},
    {value: profile.gender, source: SOURCE_TYPES.PROFILE},
    {value: history.gender, source: SOURCE_TYPES.HISTORY},
    {value: aiInference.gender, source: SOURCE_TYPES.AI_INFERENCE},
    {value: styleDefaults.gender, source: SOURCE_TYPES.STYLE_DEFAULT},
  ], {
    fallback: "unisex",
    allowedWinnerSources: [
      SOURCE_TYPES.USER,
      SOURCE_TYPES.PROFILE,
      SOURCE_TYPES.HISTORY,
    ],
  });
  const scene = scalar("scene", [
    {value: userTruthInput.scene, source: SOURCE_TYPES.USER},
    {value: profile.scene, source: SOURCE_TYPES.PROFILE},
    {value: history.scene, source: SOURCE_TYPES.HISTORY},
    {value: aiInference.scene, source: SOURCE_TYPES.AI_INFERENCE},
    {value: styleDefaults.scene, source: SOURCE_TYPES.STYLE_DEFAULT},
  ], {
    fallback: "",
    allowedWinnerSources: [
      SOURCE_TYPES.USER,
      SOURCE_TYPES.PROFILE,
      SOURCE_TYPES.HISTORY,
    ],
  });
  const budget = scalar("budget", [
    {value: userTruthInput.budget, source: SOURCE_TYPES.USER},
    {value: profile.budget, source: SOURCE_TYPES.PROFILE},
    {value: history.budget, source: SOURCE_TYPES.HISTORY},
    {value: aiInference.budget, source: SOURCE_TYPES.AI_INFERENCE},
    {value: marketInput.budget, source: SOURCE_TYPES.MARKET},
    {value: styleDefaults.budget, source: SOURCE_TYPES.STYLE_DEFAULT},
  ], {
    fallback: {},
    allowedWinnerSources: [
      SOURCE_TYPES.USER,
      SOURCE_TYPES.PROFILE,
      SOURCE_TYPES.HISTORY,
    ],
  });

  const marketStyle = readField(
    marketInput,
    "suggested_style",
    "suggestedStyle",
    "style",
  ) || (Array.isArray(marketInput.signals)
    ? marketInput.signals.find((signal) => signal?.style)?.style
    : undefined);
  const explicitStyle = scalar("explicit_style", [
    {
      value: readField(userTruthInput, "explicit_style", "explicitStyle", "style"),
      source: SOURCE_TYPES.USER,
    },
    {
      value: readField(profile, "explicit_style", "explicitStyle"),
      source: SOURCE_TYPES.PROFILE,
    },
    {value: marketStyle, source: SOURCE_TYPES.MARKET},
    {
      value: readField(styleDefaults, "style", "explicit_style"),
      source: SOURCE_TYPES.STYLE_DEFAULT,
    },
  ], {
    fallback: "",
    allowedWinnerSources: [SOURCE_TYPES.USER, SOURCE_TYPES.PROFILE],
  });

  const explicitRequirements = normalizeStringList(readField(
    userTruthInput,
    "explicit_requirements",
    "explicitRequirements",
    "requirements",
  ));
  const explicitAvoid = normalizeStringList(readField(
    userTruthInput,
    "explicit_avoid",
    "explicitAvoid",
    "avoid",
  ));
  const explicitPreferences = normalizeStringList(readField(
    userTruthInput,
    "explicit_preferences",
    "explicitPreferences",
    "preferences",
  ));
  for (const [field, value] of Object.entries({
    explicit_requirements: explicitRequirements,
    explicit_avoid: explicitAvoid,
    explicit_preferences: explicitPreferences,
  })) {
    contextSourceMap[`user_truth.${field}`] = {
      source: SOURCE_TYPES.USER,
      confidence: 1,
      authority: AUTHORITY_PRIORITY[SOURCE_TYPES.USER],
    };
  }

  const aiIntent = aiInference.intent || aiInference;
  const styleIntent = styleDefaults.intent || styleDefaults;
  const marketIntent = marketInput.intent || marketInput;
  const must = mergeSourcedLists("intent.must", [
    {values: explicitRequirements, source: SOURCE_TYPES.USER,
      respectExplicitAvoid: false},
    {values: aiIntent.must, source: SOURCE_TYPES.AI_INFERENCE},
    {values: marketIntent.must, source: SOURCE_TYPES.MARKET},
    {values: styleIntent.must, source: SOURCE_TYPES.STYLE_DEFAULT},
  ], explicitAvoid, contextConflicts, contextOverrides);
  const prefer = mergeSourcedLists("intent.prefer", [
    {values: explicitPreferences, source: SOURCE_TYPES.USER,
      respectExplicitAvoid: false},
    {values: profile.preferences, source: SOURCE_TYPES.PROFILE},
    {values: history.preferences, source: SOURCE_TYPES.HISTORY},
    {values: aiIntent.prefer, source: SOURCE_TYPES.AI_INFERENCE},
    {values: marketIntent.prefer || marketInput.preferences,
      source: SOURCE_TYPES.MARKET},
    {values: styleIntent.prefer || styleDefaults.preferences,
      source: SOURCE_TYPES.STYLE_DEFAULT},
  ], explicitAvoid, contextConflicts, contextOverrides);
  const avoid = mergeSourcedLists("intent.avoid", [
    {values: explicitAvoid, source: SOURCE_TYPES.USER,
      respectExplicitAvoid: false},
    {values: profile.avoid, source: SOURCE_TYPES.PROFILE,
      respectExplicitAvoid: false},
    {values: history.avoid, source: SOURCE_TYPES.HISTORY,
      respectExplicitAvoid: false},
    {values: aiIntent.avoid, source: SOURCE_TYPES.AI_INFERENCE,
      respectExplicitAvoid: false},
    {values: marketIntent.avoid, source: SOURCE_TYPES.MARKET,
      respectExplicitAvoid: false},
    {values: styleIntent.avoid, source: SOURCE_TYPES.STYLE_DEFAULT,
      respectExplicitAvoid: false},
  ], explicitAvoid, contextConflicts, contextOverrides);
  contextSourceMap["intent.must"] = must.evidence;
  contextSourceMap["intent.prefer"] = prefer.evidence;
  contextSourceMap["intent.avoid"] = avoid.evidence;

  const interpretedGoal = sanitizeValue(readField(
    aiIntent,
    "interpreted_goal",
    "interpretedGoal",
  ) || "");
  const latentPreferences = normalizeStringList(readField(
    aiIntent,
    "latent_preferences",
    "latentPreferences",
  ));
  const uncertainty = sanitizeValue(aiIntent.uncertainty || []);
  for (const [field, value] of Object.entries({
    interpreted_goal: interpretedGoal,
    latent_preferences: latentPreferences,
    uncertainty,
  })) {
    const source = isPresent(value)
      ? SOURCE_TYPES.AI_INFERENCE
      : SOURCE_TYPES.SYSTEM;
    contextSourceMap[`intent.${field}`] = {
      source,
      confidence: isPresent(value)
        ? clampConfidence(aiIntent.confidence, 0.5)
        : 0,
      authority: AUTHORITY_PRIORITY[source],
    };
  }

  const body = resolveBody(
    input.body || {},
    profile,
    contextSourceMap,
    contextConflicts,
    contextOverrides,
  );
  const concepts = sanitizeValue(input.concepts || []);
  const conceptDiversity = sanitizeValue(
    input.conceptDiversity || input.concept_diversity || {},
  );
  const conceptValidation = sanitizeValue(
    input.conceptValidation || input.concept_validation || {},
  );
  const styleTargets = sanitizeValue(input.styleTargets || input.style_targets || []);
  const conceptsSource = isPresent(concepts)
    ? normalizeSource(input.conceptsSource || input.concepts_source)
    : SOURCE_TYPES.SYSTEM;
  const styleTargetsSource = isPresent(styleTargets)
    ? normalizeSource(input.styleTargetsSource || input.style_targets_source)
    : SOURCE_TYPES.SYSTEM;
  contextSourceMap.concepts = {
    source: conceptsSource,
    confidence: isPresent(concepts)
      ? clampConfidence(input.conceptsConfidence, 0.5)
      : 0,
    authority: authorityFor({
      source: conceptsSource,
      confidence: input.conceptsConfidence,
    }),
  };
  contextSourceMap.concept_diversity = {
    source: conceptsSource,
    confidence: isPresent(conceptDiversity)
      ? clampConfidence(input.conceptsConfidence, 0.5)
      : 0,
    authority: authorityFor({
      source: conceptsSource,
      confidence: input.conceptsConfidence,
    }),
  };
  contextSourceMap.concept_validation = {
    source: SOURCE_TYPES.SYSTEM,
    confidence: isPresent(conceptValidation) ? 1 : 0,
    authority: AUTHORITY_PRIORITY[SOURCE_TYPES.SYSTEM],
  };
  contextSourceMap.style_targets = {
    source: styleTargetsSource,
    confidence: isPresent(styleTargets)
      ? clampConfidence(input.styleTargetsConfidence, 0.5)
      : 0,
    authority: authorityFor({
      source: styleTargetsSource,
      confidence: input.styleTargetsConfidence,
    }),
  };

  const recommendationInput = input.recommendationContext ||
    input.recommendation_context || {};
  const timestamp = String(recommendationInput.timestamp || input.timestamp ||
    new Date().toISOString());
  const decisionContextId = String(
    input.decisionContextId || input.decision_context_id ||
    `dc_${crypto.randomUUID()}`,
  );
  const legacyBlueprint = markLegacyBlueprint(
    input.legacyBlueprint || input.legacy_blueprint || {},
  );
  const aiInferenceSource = isPresent(aiInference)
    ? normalizeSource(input.aiInferenceSource || input.ai_inference_source)
    : SOURCE_TYPES.SYSTEM;
  const legacyBlueprintSource = Object.keys(legacyBlueprint).some((key) =>
    key !== "decision_role")
    ? normalizeSource(input.legacyBlueprintSource || input.legacy_blueprint_source)
    : SOURCE_TYPES.SYSTEM;
  contextSourceMap.ai_inference = {
    source: aiInferenceSource,
    confidence: isPresent(aiInference)
      ? clampConfidence(aiInference?.confidence, 0.5)
      : 0,
    authority: authorityFor({
      source: aiInferenceSource,
      confidence: aiInference?.confidence,
    }),
  };
  contextSourceMap.legacy_blueprint = {
    source: legacyBlueprintSource,
    confidence: legacyBlueprintSource === SOURCE_TYPES.SYSTEM
      ? 0
      : clampConfidence(aiInference?.confidence, 0.5),
    authority: authorityFor({
      source: legacyBlueprintSource,
      confidence: aiInference?.confidence,
    }),
  };
  contextSourceMap.market = {
    source: SOURCE_TYPES.MARKET,
    confidence: clampConfidence(marketInput.confidence, 0),
    authority: AUTHORITY_PRIORITY[SOURCE_TYPES.MARKET],
  };
  contextSourceMap.recommendation_context = {
    source: SOURCE_TYPES.SYSTEM,
    confidence: 1,
    authority: AUTHORITY_PRIORITY[SOURCE_TYPES.SYSTEM],
  };
  const bodyFitProfile = sanitizeValue(
    input.bodyFitProfile || input.body_fit_profile || {},
  );
  const initialBodyFitSource = isPresent(bodyFitProfile)
    ? normalizeSource(input.bodyFitSource || input.body_fit_source,
      SOURCE_TYPES.SYSTEM)
    : SOURCE_TYPES.SYSTEM;
  const initialBodyFitConfidence = isPresent(bodyFitProfile)
    ? clampConfidence(input.bodyFitConfidence ?? input.body_fit_confidence, 1)
    : 0;
  contextSourceMap.body_fit_profile = {
    source: initialBodyFitSource,
    confidence: initialBodyFitConfidence,
    authority: authorityFor({
      source: initialBodyFitSource,
      confidence: initialBodyFitConfidence,
    }),
  };
  const lineageInput = input.lineage || {};
  const lineage = {
    root_request_id: String(lineageInput.root_request_id || requestId),
    request_ids: Array.from(new Set([
      ...normalizeStringList(lineageInput.request_ids),
      requestId,
    ])),
    stages: Array.isArray(lineageInput.stages)
      ? sanitizeValue(lineageInput.stages)
      : [{stage: String(input.stage || "outfit"), request_id: requestId, timestamp}],
  };

  const context = {
    decision_context_id: decisionContextId,
    version: DECISION_CONTEXT_VERSION,
    request_id: requestId,
    raw_user_input: rawUserInput,
    user_truth: {
      gender,
      scene,
      budget,
      explicit_style: explicitStyle,
      explicit_requirements: explicitRequirements,
      explicit_avoid: explicitAvoid,
      explicit_preferences: explicitPreferences,
    },
    body,
    body_fit_profile: bodyFitProfile,
    intent: {
      interpreted_goal: interpretedGoal,
      latent_preferences: latentPreferences,
      must: must.values,
      prefer: prefer.values,
      avoid: avoid.values,
      uncertainty,
    },
    market: {
      status: String(marketInput.status || MARKET_STATUS_NOT_CONNECTED),
      signals: sanitizeValue(marketInput.signals || []),
      source: SOURCE_TYPES.MARKET,
      confidence: clampConfidence(marketInput.confidence, 0),
    },
    concepts,
    concept_diversity: conceptDiversity,
    concept_validation: conceptValidation,
    style_targets: styleTargets,
    recommendation_context: {
      locale: String(recommendationInput.locale || "zh-CN"),
      currency: String(recommendationInput.currency || "CNY"),
      provider: String(recommendationInput.provider || "unknown"),
      timestamp,
      version: String(recommendationInput.version || DECISION_CONTEXT_VERSION),
    },
    legacy_blueprint: legacyBlueprint,
    lineage,
    context_source_map: contextSourceMap,
    context_overrides: contextOverrides,
    context_conflicts: contextConflicts,
    ai_inference: sanitizeValue(aiInference),
  };
  return deepFreeze(context);
}

function uniqueTraceRecords(records) {
  const seen = new Set();
  return records.filter((record) => {
    const key = JSON.stringify(stableValue(record));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function enrichDecisionContext(context, {
  aiInference,
  aiSource = SOURCE_TYPES.AI_INFERENCE,
  aiConfidence = 0.5,
  userIntent,
  userIntentSource = SOURCE_TYPES.SYSTEM,
  userIntentConfidence = 1,
  bodyFitProfile,
  bodyFitSource = SOURCE_TYPES.SYSTEM,
  bodyFitConfidence = 1,
  bodyImageAnalysis,
  bodyImageConfidence = 0,
  legacyBlueprint,
  legacyBlueprintSource,
  styleTargets,
  styleTargetSource,
  concepts,
  conceptSource,
  conceptDiversity,
  conceptValidation,
  marketFashion,
  marketSource = SOURCE_TYPES.MARKET,
  marketConfidence = 0,
} = {}) {
  if (!validateDecisionContext(context)) {
    const error = new Error("Cannot enrich an invalid DecisionContext");
    error.code = "DECISION_CONTEXT_INVALID";
    throw error;
  }
  const hasAiInference = typeof aiInference !== "undefined" &&
    isPresent(aiInference);
  const hasUserIntent = typeof userIntent !== "undefined" &&
    isPresent(userIntent);
  const hasBodyFitProfile = typeof bodyFitProfile !== "undefined" &&
    isPresent(bodyFitProfile);
  const hasBodyImageAnalysis = typeof bodyImageAnalysis !== "undefined" &&
    isPresent(bodyImageAnalysis);
  const hasLegacyBlueprint = typeof legacyBlueprint !== "undefined";
  const hasStyleTargets = typeof styleTargets !== "undefined";
  const hasConcepts = typeof concepts !== "undefined";
  const hasConceptDiversity = typeof conceptDiversity !== "undefined";
  const hasConceptValidation = typeof conceptValidation !== "undefined";
  const hasMarketFashion = typeof marketFashion !== "undefined";
  if (!hasAiInference && !hasUserIntent && !hasBodyFitProfile &&
      !hasBodyImageAnalysis &&
      !hasLegacyBlueprint && !hasStyleTargets && !hasConcepts &&
      !hasConceptDiversity && !hasConceptValidation && !hasMarketFashion) {
    return context;
  }
  const normalizedAiSource = normalizeSource(aiSource, SOURCE_TYPES.AI_INFERENCE);
  const normalizedUserIntentSource = normalizeSource(
    userIntentSource,
    SOURCE_TYPES.SYSTEM,
  );
  const normalizedBodyFitSource = normalizeSource(
    bodyFitSource,
    SOURCE_TYPES.SYSTEM,
  );
  const normalizedLegacySource = normalizeSource(
    legacyBlueprintSource,
    normalizedAiSource,
  );
  const normalizedStyleSource = normalizeSource(
    styleTargetSource,
    normalizedAiSource,
  );
  const normalizedConceptSource = normalizeSource(
    conceptSource,
    normalizedAiSource,
  );
  const normalizedMarketSource = normalizeSource(
    marketSource,
    SOURCE_TYPES.MARKET,
  );
  const clone = sanitizeValue(context);
  clone.context_source_map = sanitizeValue(context.context_source_map || {});
  clone.context_overrides = sanitizeValue(
    Array.isArray(context.context_overrides) ? context.context_overrides : [],
  );
  clone.context_conflicts = sanitizeValue(
    Array.isArray(context.context_conflicts) ? context.context_conflicts : [],
  );
  clone.body.body_facts = sanitizeValue(context.body?.body_facts || {});
  clone.body.structured_measurements = sanitizeValue(
    context.body?.structured_measurements || {},
  );
  clone.body.source = sanitizeValue(context.body?.source || {});
  clone.body.source.body_facts = sanitizeValue(
    context.body?.source?.body_facts || {},
  );
  clone.body.confidence = sanitizeValue(context.body?.confidence || {});
  clone.body.confidence.body_facts = sanitizeValue(
    context.body?.confidence?.body_facts || {},
  );

  const evidenceFor = (source, confidence = aiConfidence) => ({
    source,
    confidence: clampConfidence(confidence, 0.5),
    authority: authorityFor({source, confidence}),
  });
  const appendEvidence = (path, evidence) => {
    const current = clone.context_source_map[path];
    const values = Array.isArray(current)
      ? current
      : current && typeof current === "object" && hasOwn(current, "source")
        ? [current]
        : [];
    clone.context_source_map[path] = uniqueTraceRecords([
      ...values,
      evidence,
    ]);
  };
  const appendConflict = (record) => {
    clone.context_conflicts = uniqueTraceRecords([
      ...clone.context_conflicts,
      record,
    ]);
    clone.context_overrides = uniqueTraceRecords([
      ...clone.context_overrides,
      record,
    ]);
  };

  if (hasUserIntent) {
    const sanitizedUserIntent = sanitizeValue(userIntent || {});
    clone.intent.user_intent_brain = sanitizedUserIntent;
    clone.context_source_map["intent.user_intent_brain"] = evidenceFor(
      normalizedUserIntentSource,
      userIntentConfidence,
    );
    for (const [field, item] of Object.entries(
      sanitizedUserIntent.source_map || {},
    )) {
      const source = normalizeSource(item?.source, SOURCE_TYPES.SYSTEM);
      const confidence = clampConfidence(item?.confidence, 0);
      clone.context_source_map[`intent.user_intent_brain.${field}`] = {
        source,
        confidence,
        authority: authorityFor({source, confidence}),
      };
    }
  }

  if (hasBodyFitProfile) {
    const sanitizedBodyFitProfile = sanitizeValue(bodyFitProfile || {});
    clone.body_fit_profile = sanitizedBodyFitProfile;
    clone.context_source_map.body_fit_profile = evidenceFor(
      normalizedBodyFitSource,
      bodyFitConfidence,
    );
    for (const [path, item] of Object.entries(
      sanitizedBodyFitProfile.source_map || {},
    )) {
      const source = normalizeSource(item?.source, SOURCE_TYPES.SYSTEM);
      const confidence = clampConfidence(item?.confidence, 0);
      clone.context_source_map[`body_fit_profile.${path}`] = {
        source,
        confidence,
        authority: authorityFor({source, confidence}),
      };
    }
  }

  if (hasAiInference) {
    const sanitizedAiInput = sanitizeValue(aiInference || {});
    const existingAi = sanitizeValue(context.ai_inference || {});
    clone.ai_inference = {
      ...existingAi,
      ...sanitizedAiInput,
      ...(isPresent(existingAi.intent) || isPresent(sanitizedAiInput.intent)
        ? {
            intent: {
              ...sanitizeValue(existingAi.intent || {}),
              ...sanitizeValue(sanitizedAiInput.intent || {}),
            },
          }
        : {}),
    };
    for (const key of Object.keys(sanitizedAiInput)) {
      clone.context_source_map[`ai_inference.${key}`] = evidenceFor(
        normalizedAiSource,
      );
    }
    appendEvidence("ai_inference", evidenceFor(normalizedAiSource));

    const aiIntent = sanitizedAiInput.intent || sanitizedAiInput;
    const explicitAvoid = normalizeStringList(
      context.user_truth?.explicit_avoid || [],
    );
    const mergeIntentValues = (field, inputNames, {filterAvoid = true} = {}) => {
      const incoming = normalizeStringList(readField(aiIntent, ...inputNames));
      if (incoming.length === 0) return;
      const accepted = [];
      for (const item of incoming) {
        const conflict = filterAvoid
          ? explicitAvoid.find((avoid) => constraintsConflict(avoid, item))
          : null;
        if (conflict) {
          appendConflict({
            path: `intent.${field}`,
            kept: conflict,
            kept_source: SOURCE_TYPES.USER,
            rejected: item,
            rejected_source: normalizedAiSource,
            reason: "EXPLICIT_USER_AVOID_WINS",
          });
        } else {
          accepted.push(item);
          appendEvidence(
            `intent.${field}`,
            {value: item, ...evidenceFor(normalizedAiSource)},
          );
        }
      }
      clone.intent[field] = normalizeStringList([
        ...(clone.intent?.[field] || []),
        ...accepted,
      ]);
    };
    mergeIntentValues("must", ["must"]);
    mergeIntentValues("prefer", ["prefer"]);
    mergeIntentValues("avoid", ["avoid"], {filterAvoid: false});
    mergeIntentValues(
      "latent_preferences",
      ["latent_preferences", "latentPreferences"],
      {filterAvoid: true},
    );

    const interpretedGoal = readField(
      aiIntent,
      "interpreted_goal",
      "interpretedGoal",
    );
    if (isPresent(interpretedGoal)) {
      clone.intent.interpreted_goal = sanitizeValue(interpretedGoal);
      clone.context_source_map["intent.interpreted_goal"] = evidenceFor(
        normalizedAiSource,
      );
    }
    if (hasOwn(aiIntent, "uncertainty")) {
      clone.intent.uncertainty = sanitizeValue(aiIntent.uncertainty || []);
      clone.context_source_map["intent.uncertainty"] = evidenceFor(
        normalizedAiSource,
      );
    }

    for (const [field, names] of Object.entries({
      gender: ["gender"],
      scene: ["scene"],
      budget: ["budget"],
      explicit_style: ["explicit_style", "explicitStyle", "style"],
    })) {
      const inferred = readField(sanitizedAiInput, ...names);
      const kept = context.user_truth?.[field];
      if (!isPresent(inferred) || valuesEqual(inferred, kept)) continue;
      appendConflict({
        path: `user_truth.${field}`,
        kept: sanitizeValue(kept),
        kept_source: context.context_source_map?.[`user_truth.${field}`]
          ?.source || SOURCE_TYPES.SYSTEM,
        rejected: sanitizeValue(inferred),
        rejected_source: normalizedAiSource,
        reason: "HIGHER_AUTHORITY_SOURCE_WINS",
      });
    }
  }

  if (hasBodyImageAnalysis) {
    const imageAnalysis = sanitizeValue(bodyImageAnalysis);
    clone.body.image_analysis = imageAnalysis;
    clone.context_source_map["body.image_analysis"] = {
      source: SOURCE_TYPES.IMAGE,
      confidence: clampConfidence(bodyImageConfidence, 0),
      authority: authorityFor({
        source: SOURCE_TYPES.IMAGE,
        confidence: bodyImageConfidence,
      }),
    };
    const imageFacts = normalizeImageFactSource(imageAnalysis);
    for (const [key, evidence] of imageBodyFactEntries(
      imageFacts,
      bodyImageConfidence,
    )) {
      const existing = context.body?.body_facts?.[key];
      const resolved = resolveAuthoritativeValue({
        path: `body.body_facts.${key}`,
        candidates: [
          ...(isPresent(existing) ? [{
            value: existing,
            source: existing?.source,
            confidence: existing?.confidence,
          }] : []),
          {value: evidence},
        ],
        conflicts: clone.context_conflicts,
        overrides: clone.context_overrides,
      });
      clone.body.body_facts[key] = {
        value: resolved.value,
        source: resolved.source,
        confidence: resolved.confidence,
      };
      clone.body.source.body_facts[key] = resolved.source;
      clone.body.confidence.body_facts[key] = resolved.confidence;
      clone.context_source_map[`body.body_facts.${key}`] = {
        source: resolved.source,
        confidence: resolved.confidence,
        authority: resolved.authority,
      };
    }
  }
  if (hasLegacyBlueprint) {
    clone.legacy_blueprint = sanitizeValue(markLegacyBlueprint(legacyBlueprint));
    clone.context_source_map.legacy_blueprint = evidenceFor(
      normalizedLegacySource,
    );
  }
  if (hasStyleTargets) {
    clone.style_targets = sanitizeValue(styleTargets || []);
    clone.context_source_map.style_targets = evidenceFor(
      normalizedStyleSource,
    );
  }
  if (hasConcepts) {
    clone.concepts = sanitizeValue(concepts || []);
    clone.context_source_map.concepts = evidenceFor(normalizedConceptSource);
  }
  if (hasConceptDiversity) {
    clone.concept_diversity = sanitizeValue(conceptDiversity || {});
    clone.context_source_map.concept_diversity = evidenceFor(
      normalizedConceptSource,
    );
  }
  if (hasConceptValidation) {
    clone.concept_validation = sanitizeValue(conceptValidation || {});
    clone.context_source_map.concept_validation = evidenceFor(
      SOURCE_TYPES.SYSTEM,
      1,
    );
  }
  if (hasMarketFashion) {
    clone.market = sanitizeValue(marketFashion || {});
    clone.context_source_map.market = evidenceFor(
      normalizedMarketSource,
      marketConfidence,
    );
  }
  return deepFreeze(clone);
}

function validateDecisionContext(context) {
  if (!context || typeof context !== "object") {
    return false;
  }
  return Boolean(
    String(context.decision_context_id || "").trim() &&
    String(context.request_id || "").trim() &&
    typeof context.raw_user_input === "string" &&
    context.user_truth &&
    context.body &&
    context.intent &&
    context.market &&
    Array.isArray(context.concepts) &&
    Array.isArray(context.style_targets) &&
    context.recommendation_context &&
    context.lineage,
  );
}

function appendDecisionContextLineage(context, {
  requestId,
  request_id: snakeRequestId,
  stage,
  timestamp = new Date().toISOString(),
} = {}) {
  if (!validateDecisionContext(context)) {
    const error = new Error("Cannot extend an invalid DecisionContext");
    error.code = "DECISION_CONTEXT_INVALID";
    throw error;
  }
  const nextRequestId = String(requestId || snakeRequestId || context.request_id).trim();
  const clone = sanitizeValue(context);
  clone.request_id = nextRequestId;
  clone.lineage.request_ids = Array.from(new Set([
    ...clone.lineage.request_ids,
    nextRequestId,
  ]));
  clone.lineage.stages.push({
    stage: String(stage || "unknown"),
    request_id: nextRequestId,
    timestamp: String(timestamp),
  });
  return deepFreeze(clone);
}

function assertDecisionContextLineage(left, right) {
  const leftId = String(left?.decision_context_id || "");
  const rightId = String(right?.decision_context_id || "");
  const leftRoot = String(left?.lineage?.root_request_id || "");
  const rightRoot = String(right?.lineage?.root_request_id || "");
  if (!leftId || leftId !== rightId || !leftRoot || leftRoot !== rightRoot) {
    const error = new Error("DecisionContext lineage does not match");
    error.code = "DECISION_CONTEXT_LINEAGE_MISMATCH";
    throw error;
  }
  return true;
}

function createDecisionContextTrace(context) {
  if (!validateDecisionContext(context)) {
    const error = new Error("Cannot trace an invalid DecisionContext");
    error.code = "DECISION_CONTEXT_INVALID";
    throw error;
  }
  return deepFreeze({
    decision_context_id: context.decision_context_id,
    request_id: context.request_id,
    lineage: sanitizeValue(context.lineage),
    raw_user_input: context.raw_user_input,
    explicit_user_truth: sanitizeValue(context.user_truth),
    body_facts: sanitizeValue(context.body.body_facts),
    body_fit_profile: sanitizeValue(context.body_fit_profile || null),
    user_intent_brain: sanitizeValue(context.intent.user_intent_brain || null),
    market_fashion_brain: sanitizeValue(context.market),
    market_scope: sanitizeValue(context.market?.market_scope || null),
    raw_market_signals: sanitizeValue(
      context.market?.raw_market_signals || [],
    ),
    normalized_signals: sanitizeValue(
      context.market?.normalized_signals || [],
    ),
    freshness_adjustment: sanitizeValue(
      context.market?.freshness_adjustment || [],
    ),
    user_preference_adjustment: sanitizeValue(
      context.market?.user_preference_adjustment || [],
    ),
    body_conflicts: sanitizeValue(context.market?.body_conflicts || []),
    intent_conflicts: sanitizeValue(context.market?.intent_conflicts || []),
    concept_enrichment: sanitizeValue(
      context.market?.concept_enrichment || [],
    ),
    ai_inference: sanitizeValue(context.ai_inference),
    legacy_blueprint: sanitizeValue(context.legacy_blueprint),
    new_look_concepts: sanitizeValue(context.concepts),
    concept_diversity: sanitizeValue(context.concept_diversity || {}),
    concept_validation: sanitizeValue(context.concept_validation || {}),
    style_targets: sanitizeValue(context.style_targets),
    style_target: sanitizeValue(context.style_targets),
    context_source_map: sanitizeValue(context.context_source_map),
    context_overrides: sanitizeValue(context.context_overrides),
    context_conflicts: sanitizeValue(context.context_conflicts),
  });
}

function serializeDecisionContext(context) {
  if (!validateDecisionContext(context)) {
    const error = new Error("Cannot serialize an invalid DecisionContext");
    error.code = "DECISION_CONTEXT_INVALID";
    throw error;
  }
  return JSON.stringify(sanitizeValue(context));
}

function deserializeDecisionContext(serialized) {
  let value;
  try {
    value = typeof serialized === "string" ? JSON.parse(serialized) : serialized;
  } catch (_error) {
    const error = new Error("DecisionContext payload is not valid JSON");
    error.code = "DECISION_CONTEXT_DESERIALIZATION_FAILED";
    throw error;
  }
  const sanitized = sanitizeValue(value);
  if (!validateDecisionContext(sanitized)) {
    const error = new Error("DecisionContext payload is invalid");
    error.code = "DECISION_CONTEXT_INVALID";
    throw error;
  }
  return deepFreeze(sanitized);
}

module.exports = {
  AUTHORITY_PRIORITY,
  DECISION_CONTEXT_VERSION,
  HIGH_CONFIDENCE_BODY_FACT_THRESHOLD,
  LEGACY_BLUEPRINT_DECISION_ROLE,
  MARKET_STATUS_NOT_CONNECTED,
  SOURCE_TYPES,
  appendDecisionContextLineage,
  assertDecisionContextLineage,
  createDecisionContext,
  createDecisionContextTrace,
  deserializeDecisionContext,
  enrichDecisionContext,
  isProductionRuntime,
  markLegacyBlueprint,
  resolveAuthoritativeValue,
  serializeDecisionContext,
  validateDecisionContext,
};
