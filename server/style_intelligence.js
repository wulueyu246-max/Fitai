"use strict";

const fs = require("node:fs");
const path = require("node:path");

const STYLE_RECORDS = require("./fashion_brain/styles/styles.json");
const PROFILE_VARIANTS = require("./fashion_brain/styles/profile_variants.json");
const SCENE_PROFILES = require("./fashion_brain/occasions/scene_profiles.json");

const PROFILE_VERSION = "aesthetic_target_profile_v1";
const DEFAULT_STYLE_ID = "minimal";
const TARGET_DIMENSIONS = Object.freeze([
  "style_coherence",
  "occasion_fit",
  "formality",
  "silhouette",
  "body_proportion",
  "color_harmony",
  "color_intensity",
  "material_texture",
  "footwear_compatibility",
  "legwear_compatibility",
  "accessory_compatibility",
  "layering",
  "femininity_expression",
  "masculinity_expression",
  "brand_quality_value",
  "focal_hierarchy",
  "duplicate_diversity",
]);

const DEFAULT_WEIGHTS = Object.freeze({
  style_coherence: 0.12,
  occasion_fit: 0.08,
  formality: 0.06,
  silhouette: 0.08,
  body_proportion: 0.08,
  color_harmony: 0.07,
  color_intensity: 0.04,
  material_texture: 0.05,
  footwear_compatibility: 0.08,
  legwear_compatibility: 0.05,
  accessory_compatibility: 0.05,
  layering: 0.04,
  femininity_expression: 0.05,
  masculinity_expression: 0.05,
  brand_quality_value: 0.05,
  focal_hierarchy: 0.03,
  duplicate_diversity: 0.07,
});

const LEGACY_BY_ID = new Map(STYLE_RECORDS.map((profile) => [profile.id, profile]));
const SCENE_BY_ID = new Map(SCENE_PROFILES.map((scene) => [scene.id, scene]));

function normalizeText(value) {
  return String(value || "").trim().toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff]+/gu, "");
}

function clamp01(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
}

function unit(value, fallback = 0.5) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return clamp01(number > 1 ? number / 100 : number);
}

function rounded(value) {
  return Number(clamp01(value).toFixed(4));
}

function unique(values) {
  return [...new Set(values.flat().filter(Boolean).map(String))];
}

function weightedAverage(values, fallback = 0.5) {
  const valid = values.filter(({value, weight}) =>
    Number.isFinite(value) && Number.isFinite(weight) && weight > 0);
  const total = valid.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0) return fallback;
  return valid.reduce((sum, item) => sum + item.value * item.weight, 0) / total;
}

function legacyDimension(profile, name, fallback = 0.5) {
  return unit(profile?.dimensions?.[name], fallback);
}

function normalizeLegacyProfile(profile) {
  const femininity = legacyDimension(profile, "femininity");
  const masculinity = legacyDimension(profile, "masculinity");
  const luxury = legacyDimension(profile, "luxury");
  const minimalism = legacyDimension(profile, "minimalism");
  const romantic = legacyDimension(profile, "romantic");
  const structure = legacyDimension(profile, "structure");
  const sportiness = legacyDimension(profile, "sportiness");
  const sexiness = legacyDimension(profile, "sexiness");
  const casualness = legacyDimension(profile, "casualness");
  const formality = clamp01(0.68 * (1 - casualness) + 0.32 *
    legacyDimension(profile, "maturity"));
  const colorIntensity = clamp01(0.48 * (1 - minimalism) +
    0.22 * sexiness + 0.18 * legacyDimension(profile, "youthfulness") + 0.12);
  const quality = clamp01(0.72 * luxury + 0.18 * structure + 0.10);
  const focalStrength = clamp01(0.38 * (1 - minimalism) +
    0.28 * sexiness + 0.18 * romantic + 0.16 * structure);
  return Object.freeze({
    id: profile.id,
    aliases: Object.freeze(unique([profile.name, ...(profile.aliases || [])])),
    gender_expression: Object.freeze({
      feminine: rounded(femininity),
      masculine: rounded(masculinity),
      neutral: rounded(1 - Math.abs(femininity - masculinity)),
    }),
    formality: rounded(formality),
    color_intensity: rounded(colorIntensity),
    silhouette_profile: Object.freeze({
      structure: rounded(structure),
      waist_emphasis: rounded(0.48 * femininity + 0.28 * structure + 0.12),
      volume: rounded(0.72 - structure * 0.38 + casualness * 0.18),
      verticality: rounded(0.40 + structure * 0.34 + minimalism * 0.18),
    }),
    fit_profile: Object.freeze({
      tailoring: rounded(structure),
      relaxation: rounded(casualness),
      body_emphasis: rounded(0.52 * sexiness + 0.28 * femininity + 0.10),
    }),
    material_profile: Object.freeze({
      quality: rounded(quality),
      softness: rounded(0.52 * romantic + 0.28 * femininity + 0.10),
      texture: rounded(0.42 * (1 - minimalism) + 0.28 * luxury + 0.14),
      preferred: Object.freeze(unique(profile.preferred_materials || [])),
    }),
    footwear_profile: Object.freeze({
      formality: rounded(formality),
      femininity: rounded(femininity),
      masculinity: rounded(masculinity),
      visual_weight: rounded(0.30 + 0.42 * sportiness + 0.20 * masculinity),
      toe_refinement: rounded(0.35 + 0.36 * formality + 0.20 * luxury),
      heel_presence: rounded(0.12 + 0.40 * femininity + 0.18 * formality),
      material_quality: rounded(quality),
      sportiness: rounded(sportiness),
      preferred: Object.freeze(unique(profile.preferred_shoes || [])),
    }),
    legwear_profile: Object.freeze({
      type: Object.freeze(sportiness >= 0.65
        ? ["athletic_socks"]
        : formality >= 0.65
          ? ["fine_socks", "tights"]
          : ["socks", "tights"]),
      length: rounded(0.42 + formality * 0.18 + romantic * 0.12 - sportiness * 0.15),
      formality: rounded(formality),
      opacity: rounded(0.42 + formality * 0.20 - colorIntensity * 0.08),
      material: Object.freeze(sportiness >= 0.65
        ? ["technical_knit", "cotton"]
        : formality >= 0.65
          ? ["fine_knit", "silk_blend"]
          : ["cotton", "fine_knit"]),
      color: rounded(colorIntensity),
      pattern: rounded(0.18 + romantic * 0.34 + (1 - minimalism) * 0.18),
      color_intensity: rounded(colorIntensity),
      warmth: rounded(0.38 + casualness * 0.18 - formality * 0.08),
      style_expression: rounded(Math.max(femininity, masculinity)),
    }),
    accessory_profile: Object.freeze({
      formality: rounded(formality),
      statement_strength: rounded(focalStrength),
      quality: rounded(quality),
      utility: rounded(casualness * 0.55 + sportiness * 0.35),
      preferred: Object.freeze(unique(profile.preferred_accessories || [])),
    }),
    layering_profile: Object.freeze({
      complexity: rounded(0.25 + (1 - minimalism) * 0.40 + structure * 0.18),
      structure: rounded(structure),
    }),
    quality_tier: rounded(quality),
    focal_hierarchy: Object.freeze({
      strength: rounded(focalStrength),
      max_focal_points: focalStrength >= 0.68 ? 2 : 1,
    }),
    dimensions: Object.freeze({
      maturity: rounded(legacyDimension(profile, "maturity")),
      femininity: rounded(femininity),
      masculinity: rounded(masculinity),
      luxury: rounded(luxury),
      minimalism: rounded(minimalism),
      romantic: rounded(romantic),
      structure: rounded(structure),
      sportiness: rounded(sportiness),
      youthfulness: rounded(legacyDimension(profile, "youthfulness")),
      sexiness: rounded(sexiness),
      casualness: rounded(casualness),
    }),
  });
}

const NORMALIZED_LEGACY = new Map(
  STYLE_RECORDS.map((profile) => [profile.id, normalizeLegacyProfile(profile)]),
);

function buildVariantProfile(config) {
  const sources = Object.entries(config.sources || {}).flatMap(([id, weight]) => {
    const profile = NORMALIZED_LEGACY.get(id);
    return profile ? [{profile, weight: Number(weight) || 0}] : [];
  });
  if (sources.length === 0) {
    throw new TypeError(`Style variant ${config.gender}/${config.id} has no valid source`);
  }
  const scalar = (path, fallback = 0.5) => rounded(weightedAverage(
    sources.map(({profile, weight}) => ({value: readPath(profile, path), weight})),
    fallback,
  ));
  const object = (paths) => Object.freeze(Object.fromEntries(
    paths.map((name) => [name, scalar(name)]),
  ));
  const genderExpression = object([
    "gender_expression.feminine",
    "gender_expression.masculine",
    "gender_expression.neutral",
  ]);
  return Object.freeze({
    id: config.id,
    gender_variant: config.gender,
    aliases: Object.freeze(unique(config.aliases || [])),
    gender_expression: Object.freeze({
      feminine: genderExpression["gender_expression.feminine"],
      masculine: genderExpression["gender_expression.masculine"],
      neutral: genderExpression["gender_expression.neutral"],
    }),
    formality: scalar("formality"),
    color_intensity: scalar("color_intensity"),
    silhouette_profile: blendObject(sources, "silhouette_profile"),
    fit_profile: blendObject(sources, "fit_profile"),
    material_profile: blendObject(sources, "material_profile", ["preferred"]),
    footwear_profile: blendObject(sources, "footwear_profile", ["preferred"]),
    legwear_profile: blendObject(sources, "legwear_profile", ["type", "material"]),
    accessory_profile: blendObject(sources, "accessory_profile", ["preferred"]),
    layering_profile: blendObject(sources, "layering_profile"),
    quality_tier: scalar("quality_tier"),
    focal_hierarchy: Object.freeze({
      strength: scalar("focal_hierarchy.strength"),
      max_focal_points: Math.max(1, Math.round(weightedAverage(sources.map(
        ({profile, weight}) => ({
          value: readPath(profile, "focal_hierarchy.max_focal_points"),
          weight,
        })), 1))),
    }),
    compatible_styles: Object.freeze(unique(config.compatible_styles || [])),
    conflicting_styles: Object.freeze(unique(config.conflicting_styles || [])),
    dimensions: blendObject(sources, "dimensions"),
    source_profiles: Object.freeze({...config.sources}),
    blend_priority: Number(config.blend_priority) || 0.5,
  });
}

function readPath(value, pathValue) {
  return String(pathValue).split(".").reduce((current, key) => current?.[key], value);
}

function blendObject(sources, key, listKeys = []) {
  const keys = unique(sources.flatMap(({profile}) => Object.keys(profile[key] || {})))
    .filter((name) => !listKeys.includes(name));
  const result = Object.fromEntries(keys.map((name) => [name, rounded(weightedAverage(
    sources.map(({profile, weight}) => ({value: Number(profile[key]?.[name]), weight})),
    0.5,
  ))]));
  for (const listKey of listKeys) {
    result[listKey] = Object.freeze(unique(sources.flatMap(({profile}) =>
      profile[key]?.[listKey] || [])));
  }
  return Object.freeze(result);
}

const STYLE_PROFILES = Object.freeze(PROFILE_VARIANTS.map(buildVariantProfile));

function listStyleProfiles({gender} = {}) {
  const normalizedGender = normalizeGender(gender);
  return STYLE_PROFILES.filter((profile) =>
    !normalizedGender || profile.gender_variant === normalizedGender);
}

function listSceneProfiles() {
  return SCENE_PROFILES.map((scene) => Object.freeze(structuredClone(scene)));
}

function resolveAestheticTargetProfile(input = {}) {
  const gender = normalizeGender(input.gender) || "unisex";
  const primaryStyleInputs = [
    input.style,
    input.style_profile?.source_text,
    input.styleProfile?.sourceText,
    input.style_profile?.primary_style,
    input.styleProfile?.primaryStyle,
  ].flat().filter(Boolean).map(String);
  const fallbackStyleInputs = [input.request].flat().filter(Boolean).map(String);
  const rawStyleInputs = primaryStyleInputs.length > 0
    ? primaryStyleInputs
    : fallbackStyleInputs;
  const styleText = [...primaryStyleInputs, ...fallbackStyleInputs].join(" ");
  const explicitDimensions = input.style_profile?.dimensions ||
    input.styleProfile?.dimensions || {};
  const resolution = resolveStyleMatches({
    rawStyleInputs,
    styleText,
    gender,
    semanticDimensions: explicitDimensions,
  });
  const selected = resolution.matches.length > 0
    ? resolution.matches.slice(0, 2)
    : [fallbackMatch(gender)];
  const blend = normalizeMatchWeights(selected);
  const blended = blendProfiles(blend);
  const dimensions = Object.freeze({...blended.dimensions});
  const mergedDimensions = Object.freeze(Object.fromEntries(
    Object.entries(dimensions).map(([name, value]) => [
      name,
      explicitDimensions[name] == null ? value : rounded(unit(explicitDimensions[name], value)),
    ]),
  ));
  const scene = resolveSceneProfile(input.scene || input.occasion);
  const formalityTarget = applyModifier(blended.formality, scene, "formality");
  const colorIntensity = applyModifier(
    explicitDimensions.color_intensity == null
      ? blended.color_intensity
      : unit(explicitDimensions.color_intensity),
    scene,
    "color_intensity",
  );
  const baseQualityTarget = applyModifier(
    blended.quality_tier,
    scene,
    "material_quality",
  );
  const budgetContext = resolveBudgetContext(input);
  const qualityTarget = rounded(baseQualityTarget + budgetContext.quality_modifier);
  const weatherWarmthModifier = resolveWeatherWarmthModifier(input.weather);
  const sportinessTarget = applyModifier(
    mergedDimensions.sportiness,
    scene,
    "sportiness",
  );
  const targetWeights = expressionAwareWeights(DEFAULT_WEIGHTS, blended.gender_expression);
  const mappingConfidence = selected[0].fallback === true
    ? 0.25
    : Math.min(1, selected.reduce((sum, item) => sum + item.score, 0) /
      Math.max(1, selected.length));
  return Object.freeze({
    version: PROFILE_VERSION,
    source_text: styleText,
    mapping: Object.freeze({
      method: mappingMethod(selected, resolution.reason),
      confidence: Number(mappingConfidence.toFixed(3)),
      conflict_resolutions: Object.freeze(blend.conflictResolutions),
    }),
    resolution_trace: Object.freeze({
      raw_style_input: Object.freeze([...rawStyleInputs]),
      normalized_tokens: Object.freeze([...resolution.normalizedTokens]),
      exact_canonical_match: resolution.exactCanonicalMatch,
      exact_alias_match: resolution.exactAliasMatch == null
        ? null
        : Object.freeze({...resolution.exactAliasMatch}),
      semantic_candidates: Object.freeze(resolution.semanticCandidates.map((item) =>
        Object.freeze({...item}))),
      blend_components: Object.freeze(selected.map((item) => Object.freeze({
        id: item.profile.id,
        method: item.method,
        matched_alias: item.matchedAlias || null,
        score: Number(item.score.toFixed(3)),
      }))),
      final_profile_components: Object.freeze(blend.items.map(({profile, weight}) =>
        Object.freeze({
          id: profile.id,
          gender_variant: profile.gender_variant,
          weight: Number(weight.toFixed(3)),
        }))),
      resolution_reason: selected[0].fallback === true
        ? "NEUTRAL_DEFAULT"
        : resolution.reason,
    }),
    style_targets: Object.freeze(blend.items.map(({profile, weight}) => Object.freeze({
      id: profile.id,
      gender_variant: profile.gender_variant,
      weight: Number(weight.toFixed(3)),
    }))),
    scene: scene.id,
    scene_modifiers: Object.freeze({...scene.modifiers}),
    gender_expression: blended.gender_expression,
    formality_target: rounded(formalityTarget),
    silhouette_targets: blended.silhouette_profile,
    fit_targets: blended.fit_profile,
    color_targets: Object.freeze({
      intensity: rounded(colorIntensity),
      max_main_colors: scene.color.max_main_colors,
      harmony: Object.freeze([...scene.color.harmony]),
      contrast: rounded(scene.color.contrast),
    }),
    material_targets: Object.freeze({
      ...blended.material_profile,
      quality: rounded(qualityTarget),
    }),
    footwear_targets: Object.freeze({
      ...blended.footwear_profile,
      formality: rounded((blended.footwear_profile.formality + formalityTarget) / 2),
      sportiness: rounded(sportinessTarget),
    }),
    legwear_targets: Object.freeze({
      ...blended.legwear_profile,
      warmth: rounded(blended.legwear_profile.warmth + weatherWarmthModifier),
    }),
    accessory_targets: Object.freeze({
      ...blended.accessory_profile,
      statement_strength: applyModifier(
        blended.accessory_profile.statement_strength,
        scene,
        "focal_strength",
      ),
    }),
    layering_targets: blended.layering_profile,
    quality_target: rounded(qualityTarget),
    budget_context: budgetContext,
    focal_hierarchy: Object.freeze({
      ...blended.focal_hierarchy,
      strength: applyModifier(
        blended.focal_hierarchy.strength,
        scene,
        "focal_strength",
      ),
    }),
    dimensions: Object.freeze({
      ...mergedDimensions,
      sportiness: rounded(sportinessTarget),
      formality: rounded(formalityTarget),
      color_intensity: rounded(colorIntensity),
      quality: rounded(qualityTarget),
    }),
    weights: targetWeights,
    compatible_styles: blended.compatible_styles,
    conflicting_styles: blended.conflicting_styles,
  });
}

function resolveStyleMatches({
  rawStyleInputs = [],
  styleText = "",
  gender = "unisex",
  semanticDimensions = {},
} = {}) {
  const candidates = STYLE_PROFILES.filter((profile) =>
    gender === "unisex" || profile.gender_variant === gender);
  const exact = exactStyleMatches(rawStyleInputs, candidates);
  if (exact.matches.length > 0) return exact;
  const aliasMatches = matchStyleProfiles(styleText, candidates);
  if (aliasMatches.length > 0) {
    return {
      matches: aliasMatches,
      normalizedTokens: normalizeStyleTokens(rawStyleInputs),
      exactCanonicalMatch: null,
      exactAliasMatch: null,
      semanticCandidates: [],
      reason: aliasMatches.length > 1 ? "ALIAS_PROFILE_BLEND" : "ALIAS_MATCH",
    };
  }
  const semanticMatches = nearestSemanticProfiles(candidates, semanticDimensions);
  return {
    matches: semanticMatches,
    normalizedTokens: normalizeStyleTokens(rawStyleInputs),
    exactCanonicalMatch: null,
    exactAliasMatch: null,
    semanticCandidates: semanticMatches.map(({profile, score}) => ({
      id: profile.id,
      score: Number(score.toFixed(3)),
    })),
    reason: semanticMatches.length > 0
      ? "SEMANTIC_NEAREST_BLEND"
      : "NEUTRAL_DEFAULT",
  };
}

function exactStyleMatches(rawStyleInputs, candidates) {
  const rawValues = rawStyleInputs.map((value) => String(value || "").trim())
    .filter(Boolean);
  const normalizedTokens = normalizeStyleTokens(rawValues);
  if (rawValues.length === 0) return emptyExactResolution(normalizedTokens);

  const wholeMatches = rawValues.map((value) => exactStyleMatch(value, candidates));
  if (wholeMatches.every(Boolean)) {
    return exactResolution(wholeMatches, normalizedTokens);
  }

  const explicitTokens = rawValues.flatMap(splitExplicitStyleTokens);
  if (explicitTokens.length > rawValues.length || rawValues.length > 1) {
    const tokenMatches = explicitTokens.map((value) => exactStyleMatch(value, candidates));
    if (tokenMatches.length > 0 && tokenMatches.every(Boolean)) {
      return exactResolution(tokenMatches, explicitTokens.map(normalizeText));
    }
  }

  // A repeated canonical plus its localized alias (for example
  // "dark_sweet 暗黑甜") is still one explicit style, not a blend. Full aliases
  // such as "business casual" or "sweet cool" have already matched above.
  if (rawValues.length === 1 && /\s/u.test(rawValues[0])) {
    const whitespaceTokens = rawValues[0].split(/\s+/u).filter(Boolean);
    const tokenMatches = whitespaceTokens.map((value) =>
      exactStyleMatch(value, candidates));
    if (tokenMatches.length > 1 && tokenMatches.every(Boolean) &&
        new Set(tokenMatches.map(({profile}) =>
          `${profile.gender_variant}:${profile.id}`)).size === 1) {
      return exactResolution(tokenMatches, whitespaceTokens.map(normalizeText));
    }
  }
  return emptyExactResolution(normalizedTokens);
}

function exactStyleMatch(value, candidates) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const canonical = candidates.find((profile) =>
    normalizeText(profile.id) === normalized);
  if (canonical) {
    return {
      profile: canonical,
      score: 1,
      matchedAlias: canonical.id,
      method: "exact_canonical",
    };
  }
  for (const profile of candidates) {
    const alias = profile.aliases.find((candidate) =>
      normalizeText(candidate) === normalized);
    if (alias) {
      return {
        profile,
        score: 1,
        matchedAlias: alias,
        method: "exact_alias",
      };
    }
  }
  return null;
}

function exactResolution(matches, normalizedTokens) {
  const uniqueMatches = [];
  const seen = new Set();
  for (const match of matches) {
    const key = `${match.profile.gender_variant}:${match.profile.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueMatches.push(match);
  }
  const single = uniqueMatches.length === 1;
  const first = uniqueMatches[0];
  return {
    matches: uniqueMatches,
    normalizedTokens,
    exactCanonicalMatch: single && first.method === "exact_canonical"
      ? first.profile.id
      : null,
    exactAliasMatch: single && first.method === "exact_alias"
      ? {alias: first.matchedAlias, canonical: first.profile.id}
      : null,
    semanticCandidates: [],
    reason: single
      ? first.method === "exact_canonical" ? "EXACT_CANONICAL" : "EXACT_ALIAS"
      : "EXPLICIT_MULTI_STYLE_BLEND",
  };
}

function emptyExactResolution(normalizedTokens) {
  return {
    matches: [],
    normalizedTokens,
    exactCanonicalMatch: null,
    exactAliasMatch: null,
    semanticCandidates: [],
    reason: "NO_EXACT_MATCH",
  };
}

function splitExplicitStyleTokens(value) {
  return String(value || "").split(/\s*(?:\+|\/|、|,|，|&|\band\b|和|与)\s*/iu)
    .map((token) => token.trim())
    .filter(Boolean);
}

function normalizeStyleTokens(values) {
  return values.flatMap(splitExplicitStyleTokens).map(normalizeText).filter(Boolean);
}

function mappingMethod(selected, resolutionReason) {
  if (selected[0]?.fallback === true) return "neutral_default";
  if (resolutionReason === "EXACT_CANONICAL") return "exact_canonical";
  if (resolutionReason === "EXACT_ALIAS") return "exact_alias";
  if (resolutionReason === "SEMANTIC_NEAREST_BLEND") return "semantic_nearest_blend";
  return selected.length > 1 ? "profile_blend" : "alias";
}

function matchStyleProfiles(styleText, candidates) {
  const normalized = normalizeText(styleText);
  const occurrences = [];
  if (normalized) {
    for (const profile of candidates) {
      for (const alias of [profile.id, ...profile.aliases]) {
        const term = normalizeText(alias);
        if (term.length >= 2) {
          const aliasScore = Math.min(1, 0.62 + term.length * 0.04);
          let start = normalized.indexOf(term);
          while (start >= 0) {
            occurrences.push({
              profile,
              score: aliasScore,
              matchedAlias: alias,
              method: "alias",
              start,
              end: start + term.length,
              termLength: term.length,
            });
            start = normalized.indexOf(term, start + 1);
          }
        }
      }
    }
  }
  const accepted = [];
  const occupied = [];
  const seenProfiles = new Set();
  for (const occurrence of occurrences.sort((left, right) =>
    right.termLength - left.termLength ||
    right.score - left.score ||
    left.start - right.start ||
    left.profile.id.localeCompare(right.profile.id))) {
    const profileKey = `${occurrence.profile.gender_variant}:${occurrence.profile.id}`;
    if (seenProfiles.has(profileKey)) continue;
    if (occupied.some(({start, end}) =>
      occurrence.start < end && occurrence.end > start)) continue;
    seenProfiles.add(profileKey);
    occupied.push({start: occurrence.start, end: occurrence.end});
    accepted.push(occurrence);
  }
  return sortMatches(accepted.map(({start, end, termLength, ...match}) => match));
}

function nearestSemanticProfiles(candidates, semanticDimensions) {
  const keys = Object.keys(semanticDimensions || {}).filter((key) =>
    Number.isFinite(Number(semanticDimensions[key])) &&
    candidates.some((profile) => Number.isFinite(Number(profile.dimensions?.[key]))));
  if (keys.length < 3) return [];
  const matches = candidates.map((profile) => {
    const distance = Math.sqrt(average(keys.map((key) => {
      const delta = unit(semanticDimensions[key]) - Number(profile.dimensions[key]);
      return delta * delta;
    })));
    return {
      profile,
      score: clamp01(1 - distance),
      matchedAlias: "semantic_dimensions",
      method: "semantic_nearest",
    };
  });
  return sortMatches(matches).slice(0, 2);
}

function sortMatches(matches) {
  return matches.sort((left, right) => right.score - left.score ||
    right.profile.blend_priority - left.profile.blend_priority ||
    left.profile.id.localeCompare(right.profile.id));
}

function fallbackMatch(gender) {
  const profile = STYLE_PROFILES.find((item) =>
    item.id === DEFAULT_STYLE_ID && item.gender_variant ===
      (gender === "male" ? "male" : "female")) || STYLE_PROFILES[0];
  return {profile, score: 0.25, matchedAlias: "", method: "fallback", fallback: true};
}

function average(values) {
  const valid = values.filter(Number.isFinite);
  return valid.length > 0
    ? valid.reduce((sum, value) => sum + value, 0) / valid.length
    : 0;
}

function normalizeMatchWeights(matches) {
  const hasConflict = matches.length > 1 && matches.some((item) =>
    item.profile.conflicting_styles.includes(matches.find((other) => other !== item)?.profile.id));
  const raw = matches.map((match, index) => {
    let weight = match.score * match.profile.blend_priority;
    if (hasConflict && index === 0) weight *= 1.45;
    if (hasConflict && index > 0) weight *= 0.70;
    return {...match, weight};
  });
  const total = raw.reduce((sum, item) => sum + item.weight, 0) || 1;
  return {
    items: raw.map((item) => ({...item, weight: item.weight / total})),
    conflictResolutions: hasConflict
      ? [`dominant:${raw[0].profile.id}`]
      : [],
  };
}

function blendProfiles(blend) {
  const sources = blend.items.map(({profile, weight}) => ({profile, weight}));
  const scalar = (pathValue, fallback = 0.5) => rounded(weightedAverage(
    sources.map(({profile, weight}) => ({value: Number(readPath(profile, pathValue)), weight})),
    fallback,
  ));
  return Object.freeze({
    gender_expression: Object.freeze({
      feminine: scalar("gender_expression.feminine"),
      masculine: scalar("gender_expression.masculine"),
      neutral: scalar("gender_expression.neutral"),
    }),
    formality: scalar("formality"),
    color_intensity: scalar("color_intensity"),
    silhouette_profile: blendObject(sources, "silhouette_profile"),
    fit_profile: blendObject(sources, "fit_profile"),
    material_profile: blendObject(sources, "material_profile", ["preferred"]),
    footwear_profile: blendObject(sources, "footwear_profile", ["preferred"]),
    legwear_profile: blendObject(sources, "legwear_profile", ["type", "material"]),
    accessory_profile: blendObject(sources, "accessory_profile", ["preferred"]),
    layering_profile: blendObject(sources, "layering_profile"),
    quality_tier: scalar("quality_tier"),
    focal_hierarchy: Object.freeze({
      strength: scalar("focal_hierarchy.strength"),
      max_focal_points: Math.max(1, Math.round(weightedAverage(sources.map(
        ({profile, weight}) => ({
          value: profile.focal_hierarchy.max_focal_points,
          weight,
        })), 1))),
    }),
    dimensions: blendObject(sources, "dimensions"),
    compatible_styles: Object.freeze(unique(sources.flatMap(({profile}) =>
      profile.compatible_styles))),
    conflicting_styles: Object.freeze(unique(sources.flatMap(({profile}) =>
      profile.conflicting_styles))),
  });
}

function resolveSceneProfile(sceneValue) {
  const normalized = normalizeText(sceneValue);
  if (!normalized) return SCENE_BY_ID.get("daily");
  return SCENE_PROFILES.find((scene) => [scene.id, ...scene.aliases]
    .some((alias) => normalized.includes(normalizeText(alias)))) ||
    SCENE_BY_ID.get("daily");
}

function applyModifier(value, scene, key) {
  return rounded(clamp01(Number(value) + Number(scene.modifiers?.[key] || 0)));
}

function resolveBudgetContext(input = {}) {
  const configured = input.budget || input.budget_context ||
    input.user_requirements?.budget || {};
  const itemBudget = positiveNumber(
    input.item_budget ?? input.itemBudget ?? configured.item ?? configured.item_budget,
  );
  const outfitBudget = positiveNumber(
    input.outfit_budget ?? input.outfitBudget ?? configured.outfit ??
      configured.outfit_budget,
  );
  const powers = [];
  if (itemBudget != null) powers.push(clamp01(itemBudget / 1600));
  if (outfitBudget != null) powers.push(clamp01(outfitBudget / 4800));
  const purchasingPower = powers.length > 0 ? Math.max(...powers) : null;
  const qualityModifier = purchasingPower == null ? 0 : (purchasingPower - 0.5) * 0.12;
  return Object.freeze({
    item_budget: itemBudget,
    outfit_budget: outfitBudget,
    purchasing_power: purchasingPower == null ? null : rounded(purchasingPower),
    quality_modifier: Number(qualityModifier.toFixed(4)),
  });
}

function resolveWeatherWarmthModifier(weather) {
  const temperature = positiveOrNegativeNumber(
    weather?.temperature ?? weather?.temperature_c ?? weather?.temperatureC,
  );
  if (temperature == null) return 0;
  return Math.max(-0.18, Math.min(0.18, (18 - temperature) / 80));
}

function positiveNumber(value) {
  const number = positiveOrNegativeNumber(value);
  return number != null && number > 0 ? number : null;
}

function positiveOrNegativeNumber(value) {
  if (value == null || value === "") return null;
  const number = typeof value === "number"
    ? value
    : Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(number) ? number : null;
}

function expressionAwareWeights(weights, expression) {
  const result = {...weights};
  const feminine = expression.feminine;
  const masculine = expression.masculine;
  if (feminine < 0.58) result.femininity_expression = 0;
  if (masculine < 0.58) result.masculinity_expression = 0;
  const total = Object.values(result).reduce((sum, value) => sum + value, 0) || 1;
  return Object.freeze(Object.fromEntries(Object.entries(result)
    .map(([key, value]) => [key, Number((value / total).toFixed(4))])));
}

function normalizeGender(value) {
  const normalized = normalizeText(value);
  if (/^(female|woman|women)$/.test(normalized) || normalized.includes("女")) {
    return "female";
  }
  if (/^(male|man|men)$/.test(normalized) || normalized.includes("男")) {
    return "male";
  }
  return normalized === "unisex" || normalized.includes("中性") ? "unisex" : "";
}

function loadStyleIntelligenceData({baseDir = __dirname} = {}) {
  const files = [
    "fashion_brain/styles/styles.json",
    "fashion_brain/styles/profile_variants.json",
    "fashion_brain/occasions/scene_profiles.json",
  ];
  return Object.freeze(Object.fromEntries(files.map((file) => [
    file,
    JSON.parse(fs.readFileSync(path.join(baseDir, ...file.split("/")), "utf8")),
  ])));
}

module.exports = {
  DEFAULT_WEIGHTS,
  PROFILE_VERSION,
  TARGET_DIMENSIONS,
  listSceneProfiles,
  listStyleProfiles,
  loadStyleIntelligenceData,
  resolveAestheticTargetProfile,
};
