function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function flattenText(value) {
  if (Array.isArray(value)) return value.flatMap(flattenText);
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(flattenText);
  }
  const text = String(value || "").trim();
  return text ? [text] : [];
}

function bodyStrategyEvidence(blueprint = {}, context = {}) {
  const stylingStrategy = context.styling_strategy || context.stylingStrategy ||
    context.outfit_plan?.styling_strategy ||
    context.recommendation_context?.styling_strategy || {};
  return flattenText([
    blueprint.core_elements,
    blueprint.visual_keywords,
    blueprint.silhouette_strategy,
    blueprint.must_have_items,
    blueprint.avoid_items,
    stylingStrategy.visual_goals,
    stylingStrategy.waistline_strategy,
    stylingStrategy.top_length_strategy,
    stylingStrategy.bottom_strategy,
    stylingStrategy.shoe_strategy,
    stylingStrategy.silhouette_strategy,
  ]).join(" ").toLowerCase();
}

function productEvidence(product = {}, requirement = {}) {
  return [
    product.title,
    product.brand,
    product.material,
    product.style,
    requirement.item_name,
    requirement.fit,
  ].filter(Boolean).join(" ").toLowerCase();
}

function bodyStrategyMatchAssessment(
  product = {},
  requirement = {},
  blueprint = {},
  context = {},
) {
  const strategy = bodyStrategyEvidence(blueprint, context);
  const evidence = productEvidence(product, requirement);
  const category = String(requirement.category || product.category || "").toLowerCase();
  const raiseWaistline = /提高腰线|高腰|显腿长|延长腿|腿部延长|纵向延伸|elongate_legs|raise_visual_waistline|create_vertical_line/u
    .test(strategy);
  if (!raiseWaistline) {
    return Object.freeze({
      configured: false,
      score: 60,
      matched_elements: Object.freeze([]),
      conflict_elements: Object.freeze([]),
    });
  }

  let score = 60;
  const matched = [];
  const conflicts = [];
  const reward = (pattern, label, points) => {
    if (!pattern.test(evidence)) return;
    score += points;
    matched.push(label);
  };
  const penalize = (pattern, label, points) => {
    if (!pattern.test(evidence)) return;
    score -= points;
    conflicts.push(label);
  };

  if (category === "top") {
    reward(/短款|露腰/u, "短款上衣", 20);
    reward(/合身|修身|收腰/u, "合身收腰", 15);
    penalize(/盖臀|遮臀/u, "盖臀长上衣", 45);
    if (/长款|中长款/u.test(evidence) && /宽松|oversize|廓形/u.test(evidence)) {
      score -= 35;
      conflicts.push("宽松长款上衣");
    }
  } else if (category === "bottom") {
    reward(/高腰|中高腰/u, "高腰", 30);
    reward(/直筒|垂坠|纵向|显腿长/u, "纵向延伸", 15);
    reward(/a字|收腰/u, "腰线塑造", 10);
    penalize(/低腰/u, "低腰", 55);
    penalize(/拖地/u, "拖地裤", 25);
  } else if (category === "shoes") {
    reward(/浅口/u, "浅口", 15);
    reward(/尖头|杏仁头/u, "延长鞋头", 15);
    reward(/低跟|中低跟|3cm|4cm|5cm|6cm/u, "适度跟高", 10);
    if (/高帮/u.test(evidence) && /厚重|笨重|重型|厚底/u.test(evidence)) {
      score -= 50;
      conflicts.push("厚重高帮鞋");
    }
  }

  return Object.freeze({
    configured: true,
    score: clampScore(score),
    matched_elements: Object.freeze([...new Set(matched)]),
    conflict_elements: Object.freeze([...new Set(conflicts)]),
  });
}

module.exports = {
  bodyStrategyEvidence,
  bodyStrategyMatchAssessment,
};
