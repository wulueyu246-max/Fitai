"use strict";

const {
  normalizeGender,
  normalizeProductCategory,
  normalizeProductRequirement,
  semanticCategoryMatch,
} = require("./product_relevance");
const {
  canonicalizeAttribute,
  categoryForFamily,
  extractCanonicalAttributeValues,
  inferProductFamily,
} = require("./executable_product_requirement");

const MATCH_STATE = Object.freeze({PASS: "PASS", FAIL: "FAIL", UNKNOWN: "UNKNOWN"});
const SPEC_CONSISTENCY_STATUS = Object.freeze({PASS: "PASS", FAIL: "FAIL"});
const NO_PRODUCT_MEETS_CORE_SPEC = "NO_PRODUCT_MEETS_CORE_SPEC";

const SPORT_TERMS = Object.freeze([
  "运动鞋", "跑鞋", "跑步鞋", "训练鞋", "篮球鞋", "气垫", "运动休闲",
  "厚重运动鞋底", "厚底运动", "老爹鞋", "网面运动鞋",
  "sneaker", "running", "training", "basketball", "air cushion",
]);
const SPORT_CONFLICT_RULES = Object.freeze([
  Object.freeze({label: "跑步鞋", terms: Object.freeze(["跑步鞋", "跑鞋", "running"])}),
  Object.freeze({label: "训练鞋", terms: Object.freeze(["训练鞋", "training"])}),
  Object.freeze({label: "气垫", terms: Object.freeze(["气垫", "air cushion"])}),
  Object.freeze({label: "厚底运动鞋", terms: Object.freeze([
    "厚底运动", "厚重运动鞋底", "厚底运动鞋", "厚底运动玛丽珍",
  ])}),
  Object.freeze({label: "老爹鞋", terms: Object.freeze(["老爹鞋"])}),
  Object.freeze({label: "运动休闲鞋", terms: Object.freeze([
    "运动休闲鞋", "运动休闲", "休闲运动鞋",
  ])}),
  Object.freeze({label: "网面运动鞋", terms: Object.freeze(["网面运动鞋", "运动网面"])}),
]);
const NON_SPORT_POLICY_TERMS = Object.freeze([
  "非明显运动", "非运动", "运动感", "跑鞋结构", "厚底运动鞋", "老爹鞋",
  "跑步鞋", "训练鞋", "气垫", "运动休闲鞋", "网面运动鞋",
]);
const MARY_JANE_TERMS = Object.freeze(["玛丽珍", "mary jane", "mary-jane"]);
const EXPLICIT_NON_SPORT_SHOE_TERMS = Object.freeze([
  "皮质", "真皮", "单鞋", "高跟", "低跟", "猫跟", "平底", "乐福鞋",
]);
const GENDER_TERMS = Object.freeze({
  female: ["女士", "女鞋", "女款", "女装", "女性"],
  male: ["男士", "男鞋", "男款", "男装", "男性"],
});
const GENDER_CONFLICTS = Object.freeze({
  female: ["男士", "男鞋", "男款", "男装", "男子"],
  male: ["女士", "女鞋", "女款", "女装", "女子"],
});

function text(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalized(value) {
  return text(value).toLowerCase();
}

function list(value) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(values.map(text).filter(Boolean))];
}

function hasAny(evidence, terms) {
  const source = normalized(evidence);
  return terms.some((term) => source.includes(normalized(term)));
}

function isMaryJane(value) {
  return hasAny(value, MARY_JANE_TERMS);
}

function isNonSportConstraint(value) {
  return /非.*运动|不要.*运动|避免.*运动|不含.*运动|non.?sport/iu.test(text(value));
}

function classifyAttributes(requirement) {
  const required = list(requirement.required_attributes);
  const preferred = list(requirement.preferred_attributes);
  const avoid = list(requirement.avoid_attributes);
  const must = [];
  const should = [];
  const soft = [...preferred];

  // Required attributes already passed the upstream constraint compiler and are
  // the only aesthetic/body attributes allowed to become procurement hard gates.
  must.push(...required);
  should.push(...list(requirement.design_elements));
  if (requirement.fit) should.push(requirement.fit);
  if (requirement.material) should.push(requirement.material);
  if (requirement.color) soft.push(requirement.color);

  if (isMaryJane(requirement.product_type)) must.push("玛丽珍结构");
  if (required.some(isNonSportConstraint) || avoid.some((value) => /运动/u.test(value))) {
    must.push("非明显运动");
  }
  return {
    must: list(must),
    should: list(should).filter((value) => !must.includes(value)),
    preferred: list(soft).filter((value) => !must.includes(value)),
    avoid,
  };
}

const SPEC_ATTRIBUTE_CONFLICTS = Object.freeze({
  short_length: /(?:盖臀|过胯|长款|超长|常规长度)/u,
  high_waist: /(?:低腰|中低腰|普通腰线)/u,
  low_vamp: /(?:高帮|高鞋口|老爹鞋|运动鞋|跑鞋|训练鞋)/u,
  pointed_toe: /(?:圆头|方头|老爹鞋|运动鞋|跑鞋|训练鞋)/u,
  low_heel: /(?:超高跟|厚重高跟)/u,
});

function specificationEvidence(requirement) {
  return [
    requirement.product_type,
    requirement.product_family,
    requirement.fit,
    ...list(requirement.design_elements),
  ].filter(Boolean).join(" ");
}

function constraintSource(input, attribute) {
  const target = canonicalizeAttribute(attribute);
  const sources = Array.isArray(input.constraint_sources)
    ? input.constraint_sources
    : Array.isArray(input.constraintSources) ? input.constraintSources : [];
  const matched = sources.find((entry) => entry && typeof entry === "object" &&
    String(entry.level || "").toLowerCase() === "required" &&
    canonicalizeAttribute(entry.value) === target);
  return text(matched?.source) || "executable_contract";
}

function specificationConstraintSatisfied(attribute, evidence) {
  const target = canonicalizeAttribute(attribute);
  const canonicalEvidence = new Set(
    extractCanonicalAttributeValues(evidence).map(canonicalizeAttribute),
  );
  return normalized(evidence).includes(normalized(attribute)) ||
    canonicalEvidence.has(target) ||
    (normalized(attribute) === "玛丽珍结构" && isMaryJane(evidence));
}

function specificationConstraintContradicted(attribute, evidence, requirement) {
  const target = canonicalizeAttribute(attribute);
  const conflictPattern = SPEC_ATTRIBUTE_CONFLICTS[target];
  if (conflictPattern?.test(evidence)) return true;
  if (normalized(attribute) === "非明显运动" && hasAny(evidence, SPORT_TERMS)) {
    return true;
  }
  if (requirement.category === "shoes" &&
      ["pointed_toe", "low_vamp"].includes(target) &&
      requirement.product_family === "sneakers") {
    return true;
  }
  return false;
}

function assessPurchaseSpecificationConsistency(requirement, attributes, input = {}) {
  const evidence = specificationEvidence(requirement);
  const conflicts = [];
  const inferredFamily = inferProductFamily(
    requirement.category,
    requirement.product_type,
  );
  const familyCategory = categoryForFamily(requirement.product_family);
  if (familyCategory && familyCategory !== requirement.category) {
    conflicts.push({
      code: "CATEGORY_FAMILY_CONFLICT",
      product_family: requirement.product_family,
      category: requirement.category,
    });
  }
  if (inferredFamily && requirement.product_family &&
      inferredFamily !== requirement.product_family) {
    conflicts.push({
      code: "PRODUCT_TYPE_FAMILY_CONFLICT",
      product_type: requirement.product_type,
      product_family: requirement.product_family,
      inferred_family: inferredFamily,
    });
  }
  for (const attribute of attributes.must) {
    if (specificationConstraintSatisfied(attribute, evidence)) continue;
    if (!specificationConstraintContradicted(attribute, evidence, requirement)) continue;
    conflicts.push({
      code: "PRODUCT_TYPE_MUST_CONFLICT",
      attribute,
      source: constraintSource(input, attribute),
      product_type: requirement.product_type,
      fit: requirement.fit || "",
    });
  }
  for (const attribute of attributes.avoid) {
    if (!specificationConstraintSatisfied(attribute, evidence)) continue;
    conflicts.push({
      code: "PRODUCT_TYPE_AVOID_CONFLICT",
      attribute,
      product_type: requirement.product_type,
      fit: requirement.fit || "",
    });
  }
  return Object.freeze({
    status: conflicts.length > 0
      ? SPEC_CONSISTENCY_STATUS.FAIL
      : SPEC_CONSISTENCY_STATUS.PASS,
    conflicts: Object.freeze(conflicts.map((conflict) => Object.freeze(conflict))),
  });
}

function queryTokens(specification, {includeShould = true, includePreferred = true} = {}) {
  const gender = specification.gender === "female" ? "女士" :
    specification.gender === "male" ? "男士" : "";
  const should = includeShould ? specification.should_attributes.slice(0, 2) : [];
  const preferred = includePreferred ? specification.preferred_attributes.slice(0, 2) : [];
  return list([
    gender,
    ...preferred,
    ...should,
    specification.product_type,
  ]).join(" ");
}

function buildSpecificationSearchQueries(specification) {
  return list([
    queryTokens(specification),
    queryTokens(specification, {includePreferred: false}),
    queryTokens(specification, {includeShould: false, includePreferred: false}),
  ]).slice(0, 3);
}

function compilePurchaseSpecification(input = {}, context = {}) {
  const requirement = normalizeProductRequirement(input, context);
  const attributes = classifyAttributes(requirement);
  const consistency = assessPurchaseSpecificationConsistency(
    requirement,
    attributes,
    input,
  );
  const specification = {
    request_id: requirement.request_id || text(context.requestId || context.request_id),
    look_id: requirement.look_id,
    slot_key: requirement.slot_key,
    category: requirement.category,
    gender: normalizeGender(requirement.gender),
    product_type: requirement.product_type || requirement.item_name,
    product_family: requirement.product_family,
    must_attributes: attributes.must,
    should_attributes: attributes.should,
    preferred_attributes: attributes.preferred,
    avoid_attributes: attributes.avoid,
    spec_consistency_status: consistency.status,
    spec_conflicts: consistency.conflicts,
    style_roles: list(requirement.style_role),
    search_queries: [],
    relaxation_policy: {
      order: ["preferred_attributes", "should_attributes"],
      immutable: ["category", "gender", "product_type", "product_family",
        "must_attributes", "avoid_attributes"],
      maximum_level: 2,
    },
  };
  specification.search_queries = consistency.status === SPEC_CONSISTENCY_STATUS.PASS
    ? buildSpecificationSearchQueries(specification)
    : [];
  return Object.freeze(specification);
}

function attributeState(evidence, attribute) {
  const target = normalized(attribute);
  if (!target) return MATCH_STATE.UNKNOWN;
  if (target === "玛丽珍结构") {
    return isMaryJane(evidence) ? MATCH_STATE.PASS : MATCH_STATE.FAIL;
  }
  if (target === "非明显运动") {
    if (hasAny(evidence, SPORT_TERMS)) return MATCH_STATE.FAIL;
    return hasAny(evidence, EXPLICIT_NON_SPORT_SHOE_TERMS)
      ? MATCH_STATE.PASS : MATCH_STATE.UNKNOWN;
  }
  if (normalized(evidence).includes(target)) return MATCH_STATE.PASS;
  return MATCH_STATE.UNKNOWN;
}

function hasNonSportPolicy(specification) {
  return [...specification.must_attributes, ...specification.avoid_attributes]
    .some((attribute) => hasAny(attribute, NON_SPORT_POLICY_TERMS));
}

function matchedSportConflicts(evidence, specification) {
  if (!hasNonSportPolicy(specification)) return [];
  return SPORT_CONFLICT_RULES
    .filter((rule) => hasAny(evidence, rule.terms))
    .map((rule) => rule.label);
}

function evaluateCandidateAgainstSpecification(product, specification) {
  const evidence = [
    product?.title, product?._category_text, product?.category, product?.material,
    product?.style, product?.product_type, product?.product_family,
  ].filter(Boolean).join(" ");
  const category = semanticCategoryMatch(product, specification)
    ? MATCH_STATE.PASS : MATCH_STATE.FAIL;
  const genderConflict = hasAny(evidence, GENDER_CONFLICTS[specification.gender] || []);
  const genderPass = hasAny(evidence, GENDER_TERMS[specification.gender] || []);
  const gender = genderConflict ? MATCH_STATE.FAIL :
    genderPass || specification.gender === "unisex" ? MATCH_STATE.PASS : MATCH_STATE.UNKNOWN;
  const must = Object.fromEntries(specification.must_attributes.map((attribute) => [
    attribute, attributeState(evidence, attribute),
  ]));
  const avoidMatches = specification.avoid_attributes.filter((attribute) =>
    normalized(evidence).includes(normalized(attribute)) ||
    (/运动/u.test(attribute) && hasAny(evidence, SPORT_TERMS)));
  const sportConflicts = matchedSportConflicts(evidence, specification);
  const matchedConflicts = list([...avoidMatches, ...sportConflicts]);
  const avoidConflict = matchedConflicts.length > 0 ? MATCH_STATE.FAIL : "NONE";
  const fail = category === MATCH_STATE.FAIL || gender === MATCH_STATE.FAIL ||
    Object.values(must).includes(MATCH_STATE.FAIL) || avoidConflict === MATCH_STATE.FAIL;
  const unknown = gender === MATCH_STATE.UNKNOWN ||
    Object.values(must).includes(MATCH_STATE.UNKNOWN);
  const report = {
    status: fail ? MATCH_STATE.FAIL : unknown ? MATCH_STATE.UNKNOWN : MATCH_STATE.PASS,
    reason: avoidConflict === MATCH_STATE.FAIL ? "avoid_conflict" :
      category === MATCH_STATE.FAIL ? "category_conflict" :
        gender === MATCH_STATE.FAIL ? "gender_conflict" :
          Object.values(must).includes(MATCH_STATE.FAIL) ? "must_conflict" : "",
    matched_conflict: matchedConflicts,
    product_type: category,
    gender,
    must_attributes: must,
    avoid_conflict: avoidConflict,
    matched_avoid_attributes: avoidMatches,
    needs_visual_verification: !fail && unknown,
  };
  return {state: fail ? MATCH_STATE.FAIL : unknown ? MATCH_STATE.UNKNOWN : MATCH_STATE.PASS, report};
}

function gateCandidates(products, specification) {
  return (Array.isArray(products) ? products : []).flatMap((product) => {
    const assessment = evaluateCandidateAgainstSpecification(product, specification);
    if (assessment.state === MATCH_STATE.FAIL) return [];
    return [{
      ...product,
      candidate_gate_state: assessment.state,
      candidate_match_report: assessment.report,
      needs_visual_verification: assessment.report.needs_visual_verification,
    }];
  });
}

function relaxedSpecification(specification, level) {
  const safeLevel = Math.max(0, Math.min(Number(level) || 0, 2));
  return {
    ...specification,
    preferred_attributes: safeLevel >= 1 ? [] : [...specification.preferred_attributes],
    should_attributes: safeLevel >= 2 ? [] : [...specification.should_attributes],
    must_attributes: [...specification.must_attributes],
    avoid_attributes: [...specification.avoid_attributes],
    search_queries: buildSpecificationSearchQueries({
      ...specification,
      preferred_attributes: safeLevel >= 1 ? [] : specification.preferred_attributes,
      should_attributes: safeLevel >= 2 ? [] : specification.should_attributes,
    }),
    relaxation_level: safeLevel,
  };
}

function procurementResult(products, specification) {
  const accepted = gateCandidates(products, specification);
  return {
    products: accepted,
    result_status: accepted.length > 0 ? "success" : "empty",
    reason: accepted.length > 0 ? "" : NO_PRODUCT_MEETS_CORE_SPEC,
  };
}

module.exports = {
  MATCH_STATE,
  NO_PRODUCT_MEETS_CORE_SPEC,
  SPEC_CONSISTENCY_STATUS,
  assessPurchaseSpecificationConsistency,
  buildSpecificationSearchQueries,
  compilePurchaseSpecification,
  evaluateCandidateAgainstSpecification,
  gateCandidates,
  procurementResult,
  relaxedSpecification,
};
