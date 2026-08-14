const assert = require("node:assert/strict");
const test = require("node:test");

const {
  STYLE_ANCHOR_STATUS,
  buildStyleAnchor,
  styleAnchorMatchAssessment,
} = require("../style_anchor");

function anchorFixture({
  core,
  variants = [],
  avoid = [],
}) {
  return buildStyleAnchor({
    semanticIntent: {
      style_direction: core,
      identity_impression: [core],
      emotional_tone: variants,
      must_express: [core, ...variants],
      must_avoid: avoid,
    },
    styleSemantics: {
      must_express: [core, ...variants],
      must_avoid: avoid,
    },
    styleProfile: {
      source_text: `${core}穿搭`,
      primary_style: core,
      secondary_styles: variants,
    },
    blueprint: {
      style_identity: core,
      visual_keywords: variants,
      avoid_items: avoid,
    },
  });
}

function look(direction) {
  return {
    style: direction,
    style_direction: direction,
    look_direction: {name: direction},
    items: [{
      product_type: "具体服装",
      style_role: direction,
      design_elements: [],
    }],
  };
}

test("Style Anchor keeps cute academic and French variants", () => {
  const anchor = anchorFixture({
    core: "可爱",
    variants: ["学院可爱", "法式可爱", "轻熟可爱"],
    avoid: ["纯成熟极简", "商务", "运动休闲"],
  });
  assert.equal(anchor.core_style_anchor, "可爱");
  assert.equal(anchor.anchor_strength, "strong");
  assert.deepEqual(
    anchor.allowed_style_variants,
    ["可爱", "学院可爱", "法式可爱", "轻熟可爱"],
  );
  assert.deepEqual(
    anchor.disallowed_style_drift,
    ["纯成熟极简", "商务", "运动休闲"],
  );
  assert.ok(anchor.anti_drift_evidence.every((entry) =>
    entry.evidence_domain === "explicit_user_avoid_style"));
  assert.ok(anchor.style_anchor_signature.style_traits.includes("可爱"));
  assert.deepEqual(
    styleAnchorMatchAssessment(look("学院可爱"), anchor).status,
    STYLE_ANCHOR_STATUS.MATCH,
  );
  assert.deepEqual(
    styleAnchorMatchAssessment(look("法式可爱"), anchor).status,
    STYLE_ANCHOR_STATUS.MATCH,
  );
});

test("Style Anchor rejects cute intent drifting to mature minimalism", () => {
  const anchor = anchorFixture({
    core: "可爱",
    variants: ["学院可爱", "法式可爱"],
    avoid: ["纯成熟极简", "商务", "运动休闲"],
  });
  const assessment = styleAnchorMatchAssessment(look("纯成熟极简"), anchor);
  assert.equal(assessment.allowed, false);
  assert.equal(assessment.score, 0);
  assert.deepEqual(assessment.conflict_drift, ["纯成熟极简"]);

  const unlistedDrift = styleAnchorMatchAssessment(
    look("成熟极简"),
    anchorFixture({
      core: "可爱",
      variants: ["浪漫", "学院可爱"],
      avoid: ["商务"],
    }),
  );
  assert.equal(unlistedDrift.allowed, true);
  assert.equal(unlistedDrift.status, STYLE_ANCHOR_STATUS.NEUTRAL);
  assert.ok(unlistedDrift.score >= 60);
});

test("Style Anchor ignores material and weather avoids as drift evidence", () => {
  const anchor = buildStyleAnchor({
    semanticIntent: {
      style_direction: "可爱",
      must_express: ["可爱"],
      must_avoid: ["成熟商务"],
    },
    styleProfile: {
      source_text: "可爱穿搭",
      primary_style: "可爱",
      must_avoid: ["皮革", "闷热", "高温", "黑色"],
      negative_keywords: ["棉", "真丝"],
    },
    blueprint: {
      style_identity: "可爱",
      avoid_items: ["皮革", "闷热", "高温", "透气", "棉", "真丝", "黑色"],
    },
  });
  const materialLook = structuredLook({
    direction: "轻盈日常",
    items: [{
      product_type: "黑色真丝上衣",
      product_family: "blouse",
      fit: "透气合身",
      materials: ["真丝", "皮革拼接"],
      design_elements: ["轻薄", "高温舒适"],
      style_role: "避免闷热",
    }],
  });
  const assessment = styleAnchorMatchAssessment(materialLook, anchor);
  assert.notEqual(assessment.status, STYLE_ANCHOR_STATUS.DRIFT);
  assert.equal(assessment.allowed, true);
  assert.deepEqual(assessment.conflict_drift, []);
  assert.deepEqual(
    anchor.anti_drift_evidence.map((entry) => entry.value),
    ["成熟商务"],
  );
});

test("Style Anchor accepts mature structured boss style and rejects student sweet", () => {
  const anchor = anchorFixture({
    core: "御姐",
    variants: ["成熟结构感", "利落女性化"],
    avoid: ["学生甜妹", "运动休闲"],
  });
  assert.equal(
    styleAnchorMatchAssessment(look("成熟结构感御姐"), anchor).allowed,
    true,
  );
  assert.equal(
    styleAnchorMatchAssessment(look("学生甜妹"), anchor).allowed,
    false,
  );
  assert.equal(
    styleAnchorMatchAssessment(look("学生甜妹"), anchor).status,
    STYLE_ANCHOR_STATUS.DRIFT,
  );
});

test("Style Anchor accepts sport casual as a sport substyle", () => {
  const anchor = anchorFixture({
    core: "运动",
    variants: ["运动休闲", "轻户外运动"],
    avoid: ["正式商务"],
  });
  const assessment = styleAnchorMatchAssessment(look("运动休闲"), anchor);
  assert.equal(assessment.allowed, true);
  assert.ok(assessment.score >= 85);
});

test("Style Anchor preserves an explicit user phrase when Blueprint drifts", () => {
  const anchor = buildStyleAnchor({
    styleProfile: {
      source_text: "帮我搭配一套可爱点的",
      primary_style: "成熟极简",
      secondary_styles: ["轻商务"],
    },
    styleSemantics: {
      must_express: ["利落", "克制"],
      must_avoid: ["运动休闲"],
    },
    blueprint: {
      style_identity: "成熟极简",
      visual_keywords: ["轻商务"],
      avoid_items: ["运动休闲"],
    },
  });
  assert.equal(anchor.core_style_anchor, "可爱");
  assert.equal(anchor.allowed_style_variants.includes("成熟极简"), false);
  assert.equal(
    styleAnchorMatchAssessment(look("成熟极简"), anchor).allowed,
    false,
  );
});

function structuredLook({direction, items}) {
  return {
    style: "女性化约会",
    style_direction: direction,
    look_direction: {
      name: direction,
      silhouette: items.map((item) => item.fit).filter(Boolean).join(" "),
    },
    styling_goal: "保持女性化约会感",
    items: items.map((item) => ({
      style_role: item.style_role || "保持利落女性化",
      product_type: item.product_type,
      product_family: item.product_family,
      fit: item.fit,
      materials: item.materials || [],
      design_elements: item.design_elements || [],
      required_attributes: item.required_attributes || [],
      preferred_attributes: item.preferred_attributes || [],
    })),
  };
}

test("Style Anchor uses structured mature-date evidence without requiring the anchor label", () => {
  const anchor = buildStyleAnchor({
    semanticIntent: {
      identity_impression: ["成熟", "女性化", "利落"],
      emotional_tone: ["自信", "克制"],
      style_direction: "御姐约会",
      must_express: ["成熟", "结构感", "利落女性化"],
      must_avoid: ["学生甜妹", "强运动休闲"],
    },
    styleProfile: {
      source_text: "御姐约会穿搭",
      primary_style: "御姐",
      silhouette: "修身或结构感轮廓，强调腰线",
      preferred_items: ["包臀铅笔半身裙", "高腰垂感阔腿裤", "尖头鞋"],
      preferred_materials: ["真丝", "醋酸", "精纺"],
      positive_keywords: ["成熟", "利落", "结构感"],
      must_avoid: ["学生甜妹", "强运动休闲"],
      dimensions: {maturity: 88, femininity: 84, structure: 82, sportiness: 12},
    },
    blueprint: {
      style_identity: "成熟利落的女性化约会",
      character_impression: "自信克制",
      visual_keywords: ["结构感", "强调腰线"],
      core_elements: ["修身轮廓", "高腰", "尖头鞋"],
      silhouette_strategy: ["强调腰线", "利落纵向线条"],
      material_direction: ["真丝", "醋酸", "精纺"],
      must_have_items: {
        top: ["修身上衣"],
        bottom: ["包臀铅笔半身裙", "高腰垂感阔腿裤"],
        shoes: ["尖头浅口低跟鞋"],
      },
      avoid_items: ["学生甜妹", "强运动休闲"],
    },
  });
  const skirt = styleAnchorMatchAssessment(structuredLook({
    direction: "高腰裙装比例优化",
    items: [
      {product_type: "蕾丝短款修身上衣", product_family: "blouse", fit: "短款修身"},
      {product_type: "高腰包臀铅笔半身裙", product_family: "skirt", fit: "高腰包臀"},
      {product_type: "尖头浅口低跟鞋", product_family: "pointed_heel", fit: "尖头浅口低跟"},
    ],
  }), anchor);
  const trousers = styleAnchorMatchAssessment(structuredLook({
    direction: "高腰阔腿裤纵向延伸",
    items: [
      {product_type: "短款修身针织衫", product_family: "knitwear", fit: "短款修身"},
      {product_type: "高腰垂感阔腿裤", product_family: "wide_leg_pants", fit: "高腰垂感"},
      {product_type: "尖头浅口低跟鞋", product_family: "pointed_heel", fit: "尖头浅口低跟"},
    ],
  }), anchor);
  assert.equal(skirt.allowed, true);
  assert.equal(skirt.status, STYLE_ANCHOR_STATUS.MATCH);
  assert.equal(trousers.allowed, true);
  assert.equal(trousers.status, STYLE_ANCHOR_STATUS.MATCH);
});

test("Style Anchor treats missing positive evidence as neutral, not drift", () => {
  const anchor = buildStyleAnchor({
    semanticIntent: {
      style_direction: "可爱",
      must_express: ["可爱"],
      must_avoid: ["成熟商务", "强运动训练"],
    },
    styleProfile: {source_text: "可爱一点", primary_style: "可爱"},
    blueprint: {style_identity: "可爱"},
  });
  const neutral = styleAnchorMatchAssessment(structuredLook({
    direction: "轻盈日常组合",
    items: [
      {product_type: "修身针织衫", product_family: "knitwear", fit: "合身"},
      {product_type: "高腰半身裙", product_family: "skirt", fit: "高腰"},
      {product_type: "浅口单鞋", product_family: "flat", fit: "浅口"},
    ],
  }), anchor);
  assert.equal(neutral.status, STYLE_ANCHOR_STATUS.NEUTRAL);
  assert.equal(neutral.allowed, true);
  assert.ok(neutral.score >= 60);

  const drift = styleAnchorMatchAssessment(look("成熟商务"), anchor);
  assert.equal(drift.status, STYLE_ANCHOR_STATUS.DRIFT);
  assert.equal(drift.allowed, false);
});

test("Style Anchor canonical comparison prevents a selected direction from conflicting with itself", () => {
  const anchor = {
    core_style_anchor: "Clean Fit（利落合身）",
    anchor_strength: "strong",
    allowed_style_variants: ["Clean Fit（利落合身）"],
    anti_drift_evidence: [{
      value: "clean-fit",
      evidence_domain: "aesthetic_direction",
      source: "downstream_style_identity_conflict",
    }],
    style_anchor_signature: {
      style_traits: ["Clean Fit（利落合身）"],
      anti_drift_evidence: [],
    },
  };
  const assessment = styleAnchorMatchAssessment(structuredLook({
    direction: "都市 Clean Fit（日常子方向）",
    items: [
      {product_type: "短款修身针织衫", product_family: "knitwear", fit: "短款修身"},
      {product_type: "高腰直筒裤", product_family: "straight_pants", fit: "高腰直筒"},
      {product_type: "尖头浅口低跟鞋", product_family: "pointed_heel", fit: "尖头浅口低跟"},
    ],
  }), anchor);

  assert.equal(assessment.status, STYLE_ANCHOR_STATUS.MATCH);
  assert.equal(assessment.allowed, true);
  assert.equal(assessment.matched_anchor, "Clean Fit（利落合身）");
  assert.deepEqual(assessment.conflict_drift, []);
});

test("Style Anchor marks generic feminine proportion requests as weak", () => {
  const anchor = buildStyleAnchor({
    semanticIntent: {
      identity_impression: ["女性化"],
      emotional_tone: ["约会"],
      style_direction: "女性化约会",
      must_express: ["女性化", "提高腰线"],
      must_avoid: ["明显反向比例"],
    },
    styleProfile: {
      source_text: "女性化约会，显高显腿长",
      primary_style: "女性化约会",
    },
    blueprint: {style_identity: "女性化约会，显高显腿长"},
  });
  assert.equal(anchor.anchor_strength, "weak");
  const assessment = styleAnchorMatchAssessment(structuredLook({
    direction: "高腰比例优化",
    items: [
      {product_type: "短款上衣", product_family: "top", fit: "短款"},
      {product_type: "高腰直筒裤", product_family: "straight_pants", fit: "高腰"},
      {product_type: "浅口低跟鞋", product_family: "heel", fit: "浅口低跟"},
    ],
  }), anchor);
  assert.equal(assessment.allowed, true);
  assert.notEqual(assessment.status, STYLE_ANCHOR_STATUS.DRIFT);
});

test("Style Anchor signature includes existing Fashion Brain evidence", () => {
  const anchor = buildStyleAnchor({
    semanticIntent: {style_direction: "成熟约会", must_express: ["成熟"]},
    styleProfile: {source_text: "成熟约会穿搭", primary_style: "成熟约会"},
    blueprint: {style_identity: "成熟约会"},
    knowledgeContext: {
      knowledge: [{
        name: "成熟女性化",
        visual_identity: ["利落结构感"],
        silhouette_preferences: ["强调腰线"],
        preferred_materials: ["真丝"],
        preferred_items: ["结构感衬衫"],
        avoid_styles: ["学生感"],
        dimensions: {maturity: 90, sportiness: 10},
      }],
    },
  });
  assert.ok(anchor.style_anchor_signature.style_traits.includes("利落结构感"));
  assert.ok(anchor.style_anchor_signature.silhouette_tendencies.includes("强调腰线"));
  assert.ok(anchor.style_anchor_signature.material_tendencies.includes("真丝"));
  assert.ok(anchor.style_anchor_signature.design_directions.includes("结构感衬衫"));
  assert.ok(anchor.style_anchor_signature.anti_drift.includes("学生感"));
  assert.equal(anchor.style_anchor_signature.dimensions.maturity, 90);
});
