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
const STYLE_ANCHOR_DRIFT_DOMAINS = Object.freeze([
  "style",
  "persona",
  "aesthetic_direction",
  "explicit_user_avoid_style",
]);
const STYLE_ANCHOR_DRIFT_DOMAIN_SET = new Set(STYLE_ANCHOR_DRIFT_DOMAINS);

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

function typedEvidence(values, evidenceDomain, source) {
  if (!STYLE_ANCHOR_DRIFT_DOMAIN_SET.has(evidenceDomain)) return [];
  return list(values).map((value) => Object.freeze({
    value,
    evidence_domain: evidenceDomain,
    source,
  }));
}

function normalizeTypedEvidence(values) {
  const source = Array.isArray(values) ? values : [];
  const result = [];
  const seen = new Set();
  for (const candidate of source) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      continue;
    }
    const value = text(candidate.value || candidate.term);
    const evidenceDomain = text(
      candidate.evidence_domain || candidate.evidenceDomain,
    );
    const evidenceSource = text(candidate.source);
    if (!value || !STYLE_ANCHOR_DRIFT_DOMAIN_SET.has(evidenceDomain)) continue;
    const key = `${evidenceDomain}\u0000${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(Object.freeze({
      value,
      evidence_domain: evidenceDomain,
      source: evidenceSource,
    }));
  }
  return result;
}

function mergeTypedEvidence(...values) {
  return normalizeTypedEvidence(values.flat());
}

function normalize(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/gu, "");
}

function canonicalStyleDirectionForms(value) {
  const source = text(value).normalize("NFKC").toLowerCase();
  if (!source) return [];
  const parenthetical = [...source.matchAll(/\(([^()]*)\)/gu)]
    .map((match) => match[1]);
  const withoutParenthetical = source.replace(/\([^()]*\)/gu, " ");
  return [...new Set([
    source,
    withoutParenthetical,
    ...parenthetical,
  ].map(stripStyleSuffix).map(normalize).filter(Boolean))];
}

function styleDirectionsEquivalent(left, right) {
  const leftForms = canonicalStyleDirectionForms(left);
  const rightForms = new Set(canonicalStyleDirectionForms(right));
  return leftForms.some((value) => rightForms.has(value));
}

function styleDirectionsCompatible(left, right) {
  if (styleDirectionsEquivalent(left, right)) return true;
  const leftForms = canonicalStyleDirectionForms(left);
  const rightForms = canonicalStyleDirectionForms(right);
  return leftForms.some((leftValue) => rightForms.some((rightValue) => {
    const shorterLength = Math.min(leftValue.length, rightValue.length);
    return shorterLength >= 4 && (
      leftValue.includes(rightValue) || rightValue.includes(leftValue)
    );
  }));
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
    semanticIntent?.selected_aesthetic_direction,
    semanticIntent?.selectedAestheticDirection,
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
  const selectionMode = text(
    semanticIntent?.style_selection_mode || semanticIntent?.styleSelectionMode,
  );
  if (selectionMode === "explicit") return "strong";
  if (selectionMode === "stylist_selected") return "weak";
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
  antiDriftEvidence,
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
    anti_drift: Object.freeze(mergeLists(disallowedStyleDrift)),
    anti_drift_evidence: Object.freeze(normalizeTypedEvidence(
      antiDriftEvidence,
    )),
  });
}

function buildStyleAnchor({
  semanticIntent = {},
  stylingConstitution = {},
  styleSemantics = {},
  styleProfile = {},
  blueprint = {},
  knowledgeContext = {},
} = {}) {
  const selectedAestheticDirection = text(
    semanticIntent.selected_aesthetic_direction ||
    semanticIntent.selectedAestheticDirection ||
    stylingConstitution.selected_aesthetic_direction ||
    stylingConstitution.selectedAestheticDirection,
  );
  const coreStyleAnchor = chooseCoreAnchor({
    semanticIntent,
    styleSemantics,
    styleProfile,
    blueprint,
  });
  const semanticVariants = [
    ...list(selectedAestheticDirection),
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
  const semanticAvoid = list(
    semanticIntent.must_avoid || semanticIntent.mustAvoid,
  );
  // Only the semantic intent parser's explicit user style exclusions are
  // trusted as style drift evidence. Blueprint/style-profile avoid fields can
  // also contain materials, weather, comfort, colours, construction, or body
  // tactics and therefore remain downstream constraints rather than anchors.
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
  const records = knowledgeRecords(knowledgeContext);
  const existingAnchor = blueprint?.style_anchor || blueprint?.styleAnchor || {};
  const existingSignature = existingAnchor.style_anchor_signature ||
    existingAnchor.styleAnchorSignature || {};
  const antiDriftEvidence = mergeTypedEvidence(
    typedEvidence(
      semanticAvoid,
      "explicit_user_avoid_style",
      "semantic_intent.must_avoid",
    ),
    typedEvidence(
      contradictoryDownstream,
      "aesthetic_direction",
      "downstream_style_identity_conflict",
    ),
    typedEvidence(
      recordValues(records, ["incompatible_styles", "avoid_styles"]),
      "style",
      "fashion_brain.style_relation",
    ),
    normalizeTypedEvidence(
      existingAnchor.anti_drift_evidence || existingAnchor.antiDriftEvidence,
    ),
    normalizeTypedEvidence(
      existingSignature.anti_drift_evidence ||
      existingSignature.antiDriftEvidence,
    ),
  );
  const disallowedStyleDrift = antiDriftEvidence.map(({value}) => value);
  const styleAnchorSignature = buildStyleAnchorSignature({
    coreStyleAnchor,
    allowedStyleVariants,
    disallowedStyleDrift,
    antiDriftEvidence,
    semanticIntent,
    styleSemantics,
    styleProfile,
    blueprint,
    knowledgeContext,
  });

  return Object.freeze({
    core_style_anchor: coreStyleAnchor,
    selected_aesthetic_direction: selectedAestheticDirection,
    anchor_strength: anchorStrength,
    allowed_style_variants: Object.freeze(allowedStyleVariants),
    disallowed_style_drift: Object.freeze(disallowedStyleDrift),
    anti_drift_evidence: Object.freeze(antiDriftEvidence),
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

function styleAnchorSelfContradictions(anchor = {}, selectedDirection = "") {
  const selected = text(
    selectedDirection ||
    anchor.selected_aesthetic_direction ||
    anchor.selectedAestheticDirection,
  );
  if (!selected) return Object.freeze([]);
  const signature = normalizeSignature(anchor);
  const typed = mergeTypedEvidence(
    normalizeTypedEvidence(
      anchor.anti_drift_evidence || anchor.antiDriftEvidence,
    ),
    normalizeTypedEvidence(
      signature.anti_drift_evidence || signature.antiDriftEvidence,
    ),
  );
  const typedValues = new Set(typed.map(({value}) => value));
  const legacy = list(
    anchor.disallowed_style_drift || anchor.disallowedStyleDrift,
  ).filter((value) => !typedValues.has(value)).map((value) => Object.freeze({
    value,
    evidence_domain: "style",
    source: "style_anchor.disallowed_style_drift",
  }));
  return Object.freeze([...typed, ...legacy].filter(({value}) =>
    styleDirectionsEquivalent(selected, value)));
}

function styleAnchorMatchAssessment(look = {}, anchor = {}) {
  const core = text(anchor.core_style_anchor || anchor.coreStyleAnchor);
  const strength = text(anchor.anchor_strength || anchor.anchorStrength) || "weak";
  const allowed = list(
    anchor.allowed_style_variants || anchor.allowedStyleVariants,
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
  const antiDriftEvidence = mergeTypedEvidence(
    normalizeTypedEvidence(
      anchor.anti_drift_evidence || anchor.antiDriftEvidence,
    ),
    normalizeTypedEvidence(
      signature.anti_drift_evidence || signature.antiDriftEvidence,
    ),
  );
  const positiveDirections = mergeLists(core, allowed);
  const conflictEvidence = antiDriftEvidence.filter(({value}) =>
    containsExplicitConflict(evidence.text, value) &&
    !positiveDirections.some((direction) =>
      styleDirectionsEquivalent(direction, value)));
  const conflicts = conflictEvidence.map(({value}) => value);
  const evidenceDirections = evidence.style_traits;
  const directionMatches = (direction) => evidenceDirections.some((candidate) =>
    styleDirectionsCompatible(candidate, direction) ||
    containsSemanticPhrase(candidate, direction));
  const coreMatched = core && directionMatches(core);
  const matchedVariant = allowed.find((value) => {
    const normalized = normalize(stripStyleSuffix(value));
    if (normalized.length < 4 && normalized !== normalize(core)) return false;
    return directionMatches(value);
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
    conflict_drift_evidence: Object.freeze(conflictEvidence),
  });
}

module.exports = {
  STYLE_ANCHOR_STATUS,
  STYLE_ANCHOR_DRIFT_DOMAINS,
  buildStyleAnchor,
  buildStyleAnchorSignature,
  lookStyleEvidence,
  styleAnchorSelfContradictions,
  styleAnchorMatchAssessment,
};
