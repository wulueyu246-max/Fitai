"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  fashionBrain,
  generatePhasedOutfitAnalysis,
} = require("../index");

const noKnowledgeBrain = Object.freeze({
  retrieve() {
    return Object.freeze({
      ofKind() {
        return [];
      },
      knowledgeContext: Object.freeze({
        semantic_signals: Object.freeze({}),
        knowledge: Object.freeze([]),
        knowledge_sources: Object.freeze([]),
      }),
      knowledgeSources: Object.freeze([]),
    });
  },
});

const dimensions = Object.freeze({
  maturity: 66,
  femininity: 82,
  masculinity: 18,
  structure: 61,
  minimalism: 43,
  romantic: 72,
  sportiness: 11,
  sexiness: 37,
  youthfulness: 58,
  luxury: 64,
  casualness: 32,
});

const cases = Object.freeze([
  Object.freeze({
    id: "sweet",
    requestedStyle: "甜妹穿搭",
    scene: "日常约会",
    height: 160,
    mustExpress: ["甜美", "女性化", "精致", "蕾丝细节"],
    expectWith: ["蕾丝", "百褶裙", "玛丽珍鞋"],
  }),
  Object.freeze({
    id: "mature",
    requestedStyle: "御姐约会",
    scene: "约会",
    height: 165,
    mustExpress: ["成熟", "利落", "有结构"],
    expectWith: ["真丝", "结构感", "尖头鞋"],
  }),
  Object.freeze({
    id: "short_legs",
    requestedStyle: "160cm腿短女生，希望通过穿搭优化比例",
    scene: "日常",
    height: 160,
    mustExpress: ["提高腰线", "延长腿部视觉比例"],
    expectWith: ["提高腰线", "高腰", "纵向延伸"],
  }),
  Object.freeze({
    id: "unknown",
    requestedStyle: "凌晨巴黎艺术展后的冷感女性",
    scene: "艺术展后酒会",
    height: 168,
    mustExpress: ["冷感", "艺术感", "夜间氛围"],
    expectWith: [],
  }),
]);

function cachedInterpretation(testCase) {
  return {
    style_semantics: {
      identity_impression: [testCase.requestedStyle],
      emotional_tone: ["清晰", "克制"],
      must_express: testCase.mustExpress,
      must_avoid: ["无关普通休闲"],
      style_atoms: [...testCase.mustExpress],
      confidence: 0.95,
      interpretation_summary: testCase.requestedStyle,
    },
    style_profile: {
      source_text: testCase.requestedStyle,
      intent_priority_score: 92,
      interpretation: testCase.requestedStyle,
      primary_style: testCase.requestedStyle,
      secondary_styles: [],
      blend_rationale: "保持用户原始意图并形成完整造型",
      dimensions,
      silhouette: "依据用户意图形成明确轮廓",
      preferred_items: [
        ...testCase.mustExpress,
        "女式上衣",
        "女式下装",
        "女鞋",
      ],
      preferred_colors: [],
      preferred_materials: [],
      must_have: [...testCase.mustExpress],
      must_avoid: ["无关普通休闲"],
      positive_keywords: [...testCase.mustExpress],
      negative_keywords: ["无关普通休闲"],
    },
  };
}

function evidenceBlueprint(testCase, knowledgeContext) {
  const knowledge = JSON.stringify(knowledgeContext || {});
  const enriched = [];
  if (testCase.id === "sweet") {
    if (/玛丽珍鞋/.test(knowledge)) enriched.push("玛丽珍鞋");
    if (/蕾丝/.test(knowledge)) enriched.push("蕾丝");
    if (/百褶裙/.test(knowledge)) enriched.push("百褶裙");
  } else if (testCase.id === "mature") {
    if (/真丝/.test(knowledge)) enriched.push("真丝");
    if (/结构/.test(knowledge)) enriched.push("结构感");
    if (/尖头鞋/.test(knowledge)) enriched.push("尖头鞋");
  } else if (testCase.id === "short_legs") {
    if (/提高腰线/.test(knowledge)) enriched.push("提高腰线", "高腰");
    if (/elongate_legs|延伸纵向比例|提高腿部起点/.test(knowledge)) {
      enriched.push("纵向延伸");
    }
  }

  const top = enriched.includes("蕾丝") ? "蕾丝上衣" : "合身上衣";
  const bottom = enriched.includes("百褶裙")
    ? "高腰百褶裙"
    : enriched.includes("高腰") ? "高腰直筒下装" : "直筒下装";
  const shoes = enriched.includes("玛丽珍鞋")
    ? "玛丽珍鞋"
    : enriched.includes("尖头鞋") ? "尖头鞋" : "简洁单鞋";
  const materials = enriched.filter((value) => ["蕾丝", "真丝"].includes(value));
  const silhouettes = enriched.filter((value) =>
    ["结构感", "提高腰线", "高腰", "纵向延伸"].includes(value));

  return {
    gender: "female",
    bodyProfile: "测试身体信息",
    style: testCase.requestedStyle,
    style_expression: "feminine",
    outfit_blueprint: {
      blueprint_source: "ai_generated",
      style_identity: testCase.requestedStyle,
      character_impression: testCase.mustExpress.join("、"),
      visual_keywords: [...testCase.mustExpress, ...enriched],
      core_elements: enriched.length > 0 ? enriched : ["保持原始风格意图"],
      silhouette_strategy: silhouettes.length > 0
        ? silhouettes
        : ["依据原始意图形成轮廓"],
      color_palette: ["协调色组"],
      material_direction: materials.length > 0 ? materials : ["适配场景的面料"],
      must_have_items: {
        top: [top],
        bottom: [bottom],
        shoes: [shoes],
      },
      avoid_items: ["无关普通休闲"],
      occasion_strategy: testCase.scene,
    },
  };
}

function clientFor(testCase, capturedRequests) {
  return {
    chat: {
      completions: {
        async create(request) {
          capturedRequests.push(request);
          const system = String(request.messages[0].content || "");
          if (system.includes("Phase 2 only")) {
            throw new Error("AB_TEST_LOOK_SKIPPED");
          }
          const content = request.messages[1].content;
          const blueprintInput = JSON.parse(content[0].text);
          return {
            choices: [{
              message: {
                content: JSON.stringify(evidenceBlueprint(
                  testCase,
                  blueprintInput.knowledge_context,
                )),
              },
            }],
          };
        },
      },
    },
  };
}

async function runVariant(testCase, brain) {
  const capturedRequests = [];
  const requestId = `fashion-brain-ab-${testCase.id}`;
  const result = await generatePhasedOutfitAnalysis({
    outfitRequest: {
      requestId,
      request: testCase.requestedStyle,
      gender: "female",
      scene: testCase.scene,
      height: testCase.height,
      weight: 50,
      itemBudget: "200-500",
      outfitBudget: "800-1500",
      images: {},
    },
    requestContext: {requestId, gender: "female"},
    userContent: [{type: "text", text: testCase.requestedStyle}],
    cachedStyleInterpretation: cachedInterpretation(testCase),
    sourceText: testCase.requestedStyle,
    client: clientFor(testCase, capturedRequests),
    fashionBrainInstance: brain,
    blueprintTimeoutMs: 1_000,
    lookTimeoutMs: 1_000,
  });
  return {
    blueprint: result.analysis.outfit_blueprint,
    blueprintRequest: capturedRequests[0],
  };
}

function blueprintSubset(blueprint) {
  return {
    core_elements: blueprint.core_elements,
    must_have_items: blueprint.must_have_items,
    avoid_items: blueprint.avoid_items,
    material_direction: blueprint.material_direction,
    silhouette_strategy: blueprint.silhouette_strategy,
  };
}

for (const testCase of cases) {
  test(`Fashion Brain Blueprint A/B: ${testCase.id}`, async () => {
    const withoutBrain = await runVariant(testCase, noKnowledgeBrain);
    const withBrain = await runVariant(testCase, fashionBrain);
    const withoutSubset = blueprintSubset(withoutBrain.blueprint);
    const withSubset = blueprintSubset(withBrain.blueprint);
    const withRequestInput = JSON.parse(
      withBrain.blueprintRequest.messages[1].content[0].text,
    );

    assert.equal(
      withBrain.blueprintRequest.messages[0].content.includes(
        "concretize that evidence",
      ),
      true,
    );
    assert.equal(
      withRequestInput.semantic_intent.style_direction,
      testCase.requestedStyle,
    );
    assert.ok(Array.isArray(withRequestInput.knowledge_context.knowledge));

    if (testCase.expectWith.length > 0) {
      assert.notDeepEqual(withSubset, withoutSubset);
      const enrichedBlueprint = JSON.stringify(withSubset);
      for (const expected of testCase.expectWith) {
        assert.match(enrichedBlueprint, new RegExp(expected));
      }
      assert.ok(withBrain.blueprint.knowledge_sources.length > 0);
      assert.equal(withoutBrain.blueprint.knowledge_sources.length, 0);
      if (testCase.id === "short_legs") {
        const sourceNames = withBrain.blueprint.knowledge_sources
          .map((source) => source.name);
        assert.ok(sourceNames.includes("腿短"));
        assert.equal(sourceNames.includes("腿长"), false);
      }
    } else {
      assert.equal(withBrain.blueprint.blueprint_source, "ai_generated");
      assert.equal(withBrain.blueprint.style_identity, testCase.requestedStyle);
      assert.ok(withBrain.blueprint.must_have_items.top.length > 0);
      assert.ok(withBrain.blueprint.must_have_items.bottom.length > 0);
      assert.ok(withBrain.blueprint.must_have_items.shoes.length > 0);
    }
  });
}
