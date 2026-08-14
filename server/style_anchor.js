const STYLE_GENERIC_TERMS = new Set([
  "风格",
  "穿搭",
  "造型",
  "感觉",
  "气质",
  "女性",
  "女性化",
  "精致",
  "日常",
  "约会",
  "适合",
]);

const STYLE_SUFFIXES = ["风格", "穿搭", "造型", "风", "感"];
const NON_STYLE_REQUEST_TERMS = Object.freeze([
  "帮我", "给我", "替我", "想要", "希望", "推荐", "生成", "设计",
  "搭配", "一套", "一个", "一些", "一点", "点的", "同时", "保持",
  "穿搭", "造型", "风格", "感觉", "适合", "女性化", "女性", "约会",
  "日常", "场景", "显高", "显瘦", "显腿长", "提高腰线", "改善比例",
  "比例优化", "身材优化", "保暖", "凉爽", "舒适",
]);
const STYLE_ANCHOR_STATUS = Object.freeze({
  MATCH: "MATCH",
  NEUTRAL: "NEUTRAL",
  DRIFT: "DRIFT",
});

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function list(value) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return [...new Set(values.map(text).filter(Boolean))];
}

function mergeLists(...values) {
  return [...new Set(values.flatMap(list))];
}

function normalize(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/gu, "");
}

function stripStyleSuffix(value) {
  let result = text(value);
  for (const suffix of STYLE_SUFFIXES) {
    if (result.length > suffix.length && result.endsWith(suffix)) {
      result = result.slice(0, -suffix.length).trim();
    }
  }
  return result;
}

function semanticTokens(value) {
  const source = text(value).toLowerCase();
  if (!source) return [];
  const result = new Set();
  const add = (candidate) => {
    const normalized = normalize(stripStyleSuffix(candidate));
    if (normalized.length < 2 || STYLE_GENERIC_TERMS.has(normalized)) return;
    result.add(normalized);
  };
  add(source);
  try {
    const segmenter = new Intl.Segmenter("zh-CN", {granularity: "word"});
    for (const segment of segmenter.segment(source)) {
      if (segment.isWordLike) add(segment.segment);
    }
  } catch {
    source.split(/[\s,，、/+|]+/u).forEach(add);
  }
  return [...result];
}

function requestedStylePhrase(value) {
  const source = text(value)
    .replace(/[“”"'‘’]/gu, "")
    .replace(/^(?:请|麻烦)?(?:帮我|给我|替我|想要|希望)?\s*/u, "")
    .replace(/^(?:搭配|推荐|生成|设计)\s*/u, "")
    .replace(/^(?:一套|一个|一些)\s*/u, "")
    .trim();
  const degreeMatch = /^(.{2,20}?)(?:一点|点的|一些)(?:穿搭|搭配|风格|感觉)?$/u
    .exec(source);
  if (degreeMatch) return stripStyleSuffix(degreeMatch[1]);
  return "";
}

function containsSemanticPhrase(evidence, phrase) {
  const normalizedEvidence = normalize(evidence);
  const normalizedPhrase = normalize(stripStyleSuffix(phrase));
  if (!normalizedPhrase || STYLE_GENERIC_TERMS.has(normalizedPhrase)) return false;
  if (normalizedEvidence.includes(normalizedPhrase)) return true;
  return semanticTokens(phrase).some((token) =>
    token.length >= 2 && normalizedEvidence.includes(token));
}

function containsExplicitConflict(evidence, phrase) {
  const normalizedEvidence = normalize(evidence);
  const normalizedPhrase = normalize(stripStyleSuffix(phrase));
  if (!normalizedPhrase) return false;
  if (normalizedEvidence.includes(normalizedPhrase)) return true;
  const withoutIntensity = normalizedPhrase.replace(
    /^(?:明显|严重|强烈|强|纯粹|纯)/u,
    "",
  );
  if (withoutIntensity.length >= 2 &&
      normalizedEvidence.includes(withoutIntensity)) {
    return true;
  }
  const tokens = semanticTokens(phrase).filter((token) =>
    !/^(?:明显|严重|强烈|强|纯粹|纯)$/u.test(token));
  return tokens.length > 0 && tokens.every((token) =>
    normalizedEvidence.includes(token));
}

function explicitStyleResidue(value) {
  let residue = normalize(value);
  for (const term of [...NON_STYLE_REQUEST_TERMS]
    .sort((left, right) => right.length - left.length)) {
    residue = residue.split(normalize(term)).join("");
  }
  return residue;
}

function chooseCoreAnchor({semanticIntent, styleSemantics, styleProfile, blueprint}) {
  const sourceText = text(styleProfile?.source_text || styleProfile?.sourceText);
  const mustExpress = list(
    semanticIntent?.must_express || semanticIntent?.mustExpress ||
      styleSemantics?.must_express || styleSemantics?.mustExpress,
  );
  const sourceNormalized = normalize(sourceText);
  const explicit = mustExpress
    .map(stripStyleSuffix)
    .find((candidate) => {
      const normalized = normalize(candidate);
      return normalized.length >= 2 && !STYLE_GENERIC_TERMS.has(normalized) &&
        sourceNormalized.includes(normalized);
    });
  if (explicit) return explicit;
  const requestedPhrase = requestedStylePhrase(sourceText);
  if (requestedPhrase) return requestedPhrase;

  const candidates = [
    semanticIntent?.style_direction,
    semanticIntent?.styleDirection,
    styleProfile?.primary_style,
    styleProfile?.primaryStyle,
    blueprint?.style_identity,
    blueprint?.styleIdentity,
    styleSemantics?.interpretation_summary,
    styleSemantics?.interpretationSummary,
    ...mustExpress,
  ].map(stripStyleSuffix).filter(Boolean);
  return candidates.find((candidate) => {
    const normalized = normalize(candidate);
    return normalized.length >= 2 && !STYLE_GENERIC_TERMS.has(normalized);
  }) || "";
}

function determineAnchorStrength({
  coreStyleAnchor,
  semanticIntent,
  styleProfile,
} = {}) {
  const sourceText = text(styleProfile?.source_text || styleProfile?.sourceText);
  if (requestedStylePhrase(sourceText)) return "strong";
  const structuredSignals = [
    semanticIntent?.style_direction,
    semanticIntent?.styleDirection,
    styleProfile?.primary_style,
    styleProfile?.primaryStyle,
  ].filter(Boolean);
  if (structuredSignals.some((value) => explicitStyleResidue(value).length >= 2)) {
    return "strong";
  }
  const sourceResidue = explicitStyleResidue(sourceText);
  const anchorResidue = explicitStyleResidue(coreStyleAnchor);
  return sourceResidue.length >= 2 && anchorResidue.length >= 2
    ? "strong"
    : "weak";
}

function blueprintItems(blueprint = {}) {
  const source = blueprint.must_have_items || blueprint.mustHaveItems;
  if (!source || typeof source !== "object" || Array.isArray(source)) return [];
  return Object.values(source).flatMap(list);
}

function knowledgeRecords(knowledgeContext = {}) {
  const source = knowledgeContext && typeof knowledgeContext === "object" &&
      !Array.isArray(knowledgeContext)
    ? knowledgeContext
    : {};
  return Array.isArray(source.knowledge)
    ? source.knowledge.filter((record) => record && typeof record === "object" &&
      !Array.isArray(record))
    : [];
}

function recordValues(records, fields) {
  return mergeLists(...records.flatMap((record) =>
    fields.map((field) => record[field])));
}

function signatureDimensions(styleProfile = {}, records = [], existing = {}) {
  const result = {};
  const profileDimensions = styleProfile.dimensions &&
    typeof styleProfile.dimensions === "object" &&
    !Array.isArray(styleProfile.dimensions)
    ? styleProfile.dimensions
    : {};
  const existingDimensions = existing.dimensions &&
    typeof existing.dimensions === "object" &&
    !Array.isArray(existing.dimensions)
    ? existing.dimensions
    : {};
  const names = new Set([
    ...Object.keys(existingDimensions),
    ...Object.keys(profileDimensions),
    ...records.flatMap((record) => record.dimensions &&
      typeof record.dimensions === "object" && !Array.isArray(record.dimensions)
      ? Object.keys(record.dimensions)
      : []),
  ]);
  for (const name of names) {
    const profileValue = Number(profileDimensions[name]);
    if (Number.isFinite(profileValue)) {
      result[name] = Math.round(Math.max(0, Math.min(100, profileValue)));
      continue;
    }
    const existingValue = Number(existingDimensions[name]);
    if (Number.isFinite(existingValue)) {
      result[name] = Math.round(Math.max(0, Math.min(100, existingValue)));
      continue;
    }
    const values = records.map((record) => Number(record.dimensions?.[name]))
      .filter(Number.isFinite);
    if (values.length > 0) {
      result[name] = Math.round(
        values.reduce((sum, value) => sum + value, 0) / values.length,
      );
    }
  }
  return Object.freeze(result);
}

function buildStyleAnchorSignature({
  coreStyleAnchor,
  allowedStyleVariants,
  disallowedStyleDrift,
  semanticIntent = {},
  styleSemantics = {},
  styleProfile = {},
  blueprint = {},
  knowledgeContext = {},
} = {}) {
  const records = knowledgeRecords(knowledgeContext);
  const existing = blueprint?.style_anchor?.style_anchor_signature ||
    blueprint?.styleAnchor?.styleAnchorSignature || {};
  return Object.freeze({
    style_traits: Object.freeze(mergeLists(
      coreStyleAnchor,
      allowedStyleVariants,
      semanticIntent.identity_impression || semanticIntent.identityImpression,
      semanticIntent.emotional_tone || semanticIntent.emotionalTone,
      semanticIntent.style_direction || semanticIntent.styleDirection,
      semanticIntent.must_express || semanticIntent.mustExpress,
      styleSemantics.identity_impression || styleSemantics.identityImpression,
      styleSemantics.emotional_tone || styleSemantics.emotionalTone,
      styleSemantics.visual_personality || styleSemantics.visualPersonality,
      styleSemantics.social_signal || styleSemantics.socialSignal,
      styleSemantics.must_express || styleSemantics.mustExpress,
      styleSemantics.style_atoms || styleSemantics.styleAtoms,
      styleProfile.interpretation,
      styleProfile.primary_style || styleProfile.primaryStyle,
      styleProfile.secondary_styles || styleProfile.secondaryStyles,
      styleProfile.positive_keywords || styleProfile.positiveKeywords,
      blueprint.style_identity || blueprint.styleIdentity,
      blueprint.character_impression || blueprint.characterImpression,
      blueprint.visual_keywords || blueprint.visualKeywords,
      existing.style_traits || existing.styleTraits,
      recordValues(records, [
        "name", "aliases", "visual_identity", "personality",
        "compatible_styles", "preferred_styles",
      ]),
    )),
    silhouette_tendencies: Object.freeze(mergeLists(
      styleProfile.silhouette,
      blueprint.silhouette_strategy || blueprint.silhouetteStrategy,
      existing.silhouette_tendencies || existing.silhouetteTendencies,
      recordValues(records, [
        "silhouette_preferences", "silhouette_effect", "body_effect",
        "recommended_strategy", "visual_goal",
      ]),
    )),
    material_tendencies: Object.freeze(mergeLists(
      styleProfile.preferred_materials || styleProfile.preferredMaterials,
      blueprint.material_direction || blueprint.materialDirection,
      existing.material_tendencies || existing.materialTendencies,
      recordValues(records, [
        "preferred_materials", "material_preferences", "material",
        "visual_meaning",
      ]),
    )),
    design_directions: Object.freeze(mergeLists(
      styleProfile.preferred_items || styleProfile.preferredItems,
      styleProfile.must_have || styleProfile.mustHave,
      blueprint.core_elements || blueprint.coreElements,
      blueprintItems(blueprint),
      existing.design_directions || existing.designDirections,
      recordValues(records, [
        "preferred_items", "preferred_shoes", "preferred_accessories",
        "item_name", "recommended_items",
      ]),
    )),
    dimensions: signatureDimensions(styleProfile, records, existing),
    anti_drift: Object.freeze(mergeLists(
      disallowedStyleDrift,
      semanticIntent.must_avoid || semanticIntent.mustAvoid,
      styleSemantics.must_avoid || styleSemantics.mustAvoid,
      styleProfile.must_avoid || styleProfile.mustAvoid,
      styleProfile.negative_keywords || styleProfile.negativeKeywords,
      blueprint.avoid_items || blueprint.avoidItems,
      existing.anti_drift || existing.antiDrift,
      recordValues(records, [
        "avoid_elements", "incompatible_styles", "avoid_styles",
        "avoid_items", "avoid_contexts",
      ]),
    )),
  });
}

function buildStyleAnchor({
  semanticIntent = {},
  styleSemantics = {},
  styleProfile = {},
  blueprint = {},
  knowledgeContext = {},
} = {}) {
  const coreStyleAnchor = chooseCoreAnchor({
    semanticIntent,
    styleSemantics,
    styleProfile,
    blueprint,
  });
  const semanticVariants = [
    ...list(semanticIntent.identity_impression || semanticIntent.identityImpression),
    ...list(semanticIntent.emotional_tone || semanticIntent.emotionalTone),
    ...list(semanticIntent.style_direction || semanticIntent.styleDirection),
    ...list(semanticIntent.must_express || semanticIntent.mustExpress),
  ];
  const downstreamCandidates = [
    ...list(styleProfile.secondary_styles || styleProfile.secondaryStyles),
    ...list(styleSemantics.identity_impression || styleSemantics.identityImpression),
    ...list(styleSemantics.emotional_tone || styleSemantics.emotionalTone),
    ...list(styleSemantics.must_express || styleSemantics.mustExpress),
    ...list(blueprint.style_identity || blueprint.styleIdentity),
    ...list(blueprint.visual_keywords || blueprint.visualKeywords),
  ];
  const downstreamVariants = downstreamCandidates.filter((variant) =>
    !coreStyleAnchor || containsSemanticPhrase(variant, coreStyleAnchor));
  const allowedStyleVariants = [...new Set([
    coreStyleAnchor,
    ...semanticVariants,
    ...downstreamVariants,
  ].map(stripStyleSuffix).filter(Boolean))];
  const explicitAvoid = [...new Set([
    ...list(semanticIntent.must_avoid || semanticIntent.mustAvoid),
    ...list(styleSemantics.must_avoid || styleSemantics.mustAvoid),
    ...list(styleProfile.must_avoid || styleProfile.mustAvoid),
    ...list(styleProfile.negative_keywords || styleProfile.negativeKeywords),
    ...list(blueprint.avoid_items || blueprint.avoidItems),
  ].map(stripStyleSuffix).filter(Boolean))];
  const anchorStrength = determineAnchorStrength({
    coreStyleAnchor,
    semanticIntent,
    styleProfile,
  });
  const positiveSemanticValues = mergeLists(coreStyleAnchor, semanticVariants);
  const contradictoryDownstream = anchorStrength === "strong"
    ? [
      styleProfile.primary_style || styleProfile.primaryStyle,
      blueprint.style_identity || blueprint.styleIdentity,
    ].map(stripStyleSuffix).filter((value) => value && coreStyleAnchor &&
      !containsSemanticPhrase(value, coreStyleAnchor) &&
      !positiveSemanticValues.some((positive) =>
        containsSemanticPhrase(positive, value) ||
        containsSemanticPhrase(value, positive)))
    : [];
  const disallowedStyleDrift = mergeLists(explicitAvoid, contradictoryDownstream);
  const styleAnchorSignature = buildStyleAnchorSignature({
    coreStyleAnchor,
    allowedStyleVariants,
    disallowedStyleDrift,
    semanticIntent,
    styleSemantics,
    styleProfile,
    blueprint,
    knowledgeContext,
  });

  return Object.freeze({
    core_style_anchor: coreStyleAnchor,
    anchor_strength: anchorStrength,
    allowed_style_variants: Object.freeze(allowedStyleVariants),
    disallowed_style_drift: Object.freeze(disallowedStyleDrift),
    style_anchor_signature: styleAnchorSignature,
  });
}

function lookStyleEvidence(look = {}) {
  const direction = look.look_direction || look.lookDirection || {};
  const items = Array.isArray(look.items) ? look.items : [];
  const styleTraits = mergeLists(
    look.style,
    look.style_direction,
    look.styleDirection,
    typeof direction === "string" ? direction : direction.name,
    look.styling_goal,
    look.stylingGoal,
    ...items.flatMap((item) => [
      item?.style_role,
      item?.styleRole,
      item?.style,
    ]),
  );
  const silhouettes = mergeLists(
    look.proportion_strategy,
    look.proportionStrategy,
    look.silhouette_strategy,
    look.silhouetteStrategy,
    typeof direction === "object" ? direction.silhouette : "",
    typeof direction === "object" ? direction.waistline : "",
    typeof direction === "object" ? direction.length_strategy : "",
    typeof direction === "object" ? direction.lengthStrategy : "",
    typeof direction === "object" ? direction.shoe_shape : "",
    typeof direction === "object" ? direction.shoeShape : "",
    ...items.flatMap((item) => [
      item?.fit,
      item?.silhouette,
      item?.required_attributes,
      item?.requiredAttributes,
      item?.preferred_attributes,
      item?.preferredAttributes,
    ]),
  );
  const materials = mergeLists(...items.flatMap((item) => [
    item?.materials,
    item?.material,
  ]));
  const designDirections = mergeLists(...items.flatMap((item) => [
    item?.product_type,
    item?.productType,
    item?.product_family,
    item?.productFamily,
    item?.item_name,
    item?.itemName,
    item?.design_elements,
    item?.designElements,
    item?.fit,
  ]));
  const all = mergeLists(styleTraits, silhouettes, materials, designDirections);
  return Object.freeze({
    style_traits: Object.freeze(styleTraits),
    silhouette_tendencies: Object.freeze(silhouettes),
    material_tendencies: Object.freeze(materials),
    design_directions: Object.freeze(designDirections),
    all: Object.freeze(all),
    text: all.join(" "),
  });
}

function matchingValues(values, evidenceText) {
  return list(values).filter((value) => containsSemanticPhrase(evidenceText, value));
}

function normalizeSignature(anchor = {}) {
  const source = anchor.style_anchor_signature || anchor.styleAnchorSignature;
  return source && typeof source === "object" && !Array.isArray(source)
    ? source
    : {};
}

function styleAnchorMatchAssessment(look = {}, anchor = {}) {
  const core = text(anchor.core_style_anchor || anchor.coreStyleAnchor);
  const strength = text(anchor.anchor_strength || anchor.anchorStrength) || "weak";
  const allowed = list(
    anchor.allowed_style_variants || anchor.allowedStyleVariants,
  );
  const disallowed = list(
    anchor.disallowed_style_drift || anchor.disallowedStyleDrift,
  );
  const signature = normalizeSignature(anchor);
  const configured = Boolean(core || allowed.length > 0 ||
    Object.keys(signature).length > 0);
  if (!configured) {
    return Object.freeze({
      configured: false,
      allowed: true,
      status: STYLE_ANCHOR_STATUS.NEUTRAL,
      anchor_strength: "weak",
      score: 70,
      matched_anchor: "",
      matched_variant: "",
      matched_signature: Object.freeze({}),
      conflict_drift: Object.freeze([]),
    });
  }

  const evidence = lookStyleEvidence(look);
  const antiDrift = mergeLists(
    disallowed,
    signature.anti_drift || signature.antiDrift,
  );
  const conflicts = list(antiDrift).filter((value) =>
    containsExplicitConflict(evidence.text, value));
  const coreMatched = core && containsSemanticPhrase(evidence.text, core);
  const matchedVariant = allowed.find((value) => {
    const normalized = normalize(stripStyleSuffix(value));
    if (normalized.length < 4 && normalized !== normalize(core)) return false;
    return containsSemanticPhrase(evidence.text, value);
  }) || "";
  const matchedSignature = Object.freeze({
    style_traits: Object.freeze(matchingValues(
      signature.style_traits || signature.styleTraits,
      evidence.style_traits.join(" "),
    )),
    silhouette_tendencies: Object.freeze(matchingValues(
      signature.silhouette_tendencies || signature.silhouetteTendencies,
      evidence.silhouette_tendencies.join(" "),
    )),
    material_tendencies: Object.freeze(matchingValues(
      signature.material_tendencies || signature.materialTendencies,
      evidence.material_tendencies.join(" "),
    )),
    design_directions: Object.freeze(matchingValues(
      signature.design_directions || signature.designDirections,
      evidence.design_directions.join(" "),
    )),
  });
  const matchedGroups = Object.values(matchedSignature)
    .filter((values) => values.length > 0).length;
  const hasStyleSupport = matchedSignature.style_traits.length > 0;
  const status = conflicts.length > 0
    ? STYLE_ANCHOR_STATUS.DRIFT
    : coreMatched || matchedVariant || hasStyleSupport || matchedGroups >= 2
      ? STYLE_ANCHOR_STATUS.MATCH
      : STYLE_ANCHOR_STATUS.NEUTRAL;
  const score = status === STYLE_ANCHOR_STATUS.DRIFT
    ? 0
    : coreMatched ? 100
      : matchedVariant ? 92
        : status === STYLE_ANCHOR_STATUS.MATCH ? 84
          : strength === "strong" ? 65 : 72;
  return Object.freeze({
    configured: true,
    allowed: status !== STYLE_ANCHOR_STATUS.DRIFT,
    status,
    anchor_strength: strength,
    score,
    matched_anchor: coreMatched ? core : "",
    matched_variant: matchedVariant,
    matched_signature: matchedSignature,
    conflict_drift: Object.freeze(conflicts),
  });
}

module.exports = {
  STYLE_ANCHOR_STATUS,
  buildStyleAnchor,
  buildStyleAnchorSignature,
  lookStyleEvidence,
  styleAnchorMatchAssessment,
};
