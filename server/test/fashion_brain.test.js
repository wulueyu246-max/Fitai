"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  FashionBrain,
  KNOWLEDGE_FILES,
  KNOWLEDGE_KINDS,
  STYLE_DIMENSIONS,
} = require("../fashion_brain");

const brain = FashionBrain.load();

test("loads all Fashion Brain V1 JSON files and validates style dimensions", () => {
  assert.equal(KNOWLEDGE_FILES.length, 7);

  const count = (kind) =>
    brain.records.filter((record) => record.kind === kind).length;
  assert.equal(count(KNOWLEDGE_KINDS.STYLE), 30);
  assert.equal(count(KNOWLEDGE_KINDS.ITEM), 33);
  assert.equal(count(KNOWLEDGE_KINDS.BODY), 13);
  assert.equal(count(KNOWLEDGE_KINDS.OCCASION), 7);
  assert.equal(count(KNOWLEDGE_KINDS.WEATHER), 5);
  assert.equal(count(KNOWLEDGE_KINDS.BRAND), 15);
  assert.equal(count(KNOWLEDGE_KINDS.MATERIAL), 10);

  for (const style of brain.records.filter(
    (record) => record.kind === KNOWLEDGE_KINDS.STYLE,
  )) {
    assert.deepEqual(
      Object.keys(style.data.dimensions).sort(),
      [...STYLE_DIMENSIONS].sort(),
      style.name,
    );
  }
});

test("returns style knowledge_context for a matching style description", () => {
  const context = brain.retrieve("甜妹穿搭");
  const styleNames = context.ofKind(KNOWLEDGE_KINDS.STYLE)
    .map((match) => match.record.name);

  assert.ok(styleNames.includes("甜妹"));
  assert.ok(context.knowledgeContext.knowledge.length > 0);
  assert.ok(context.knowledgeContext.knowledge_sources.some(
    (source) => source.type === "style_reference" && source.name === "甜妹",
  ));
});

test("returns body knowledge_context from height and proportion wording", () => {
  const context = brain.retrieve("160cm腿短女生");
  const bodyNames = context.ofKind(KNOWLEDGE_KINDS.BODY)
    .map((match) => match.record.name);

  assert.equal(context.knowledgeContext.semantic_signals.height_cm, 160);
  assert.ok(bodyNames.includes("小个子"));
  assert.ok(bodyNames.includes("腿短"));
  assert.ok(context.knowledgeContext.knowledge_sources.some(
    (source) => source.type === "body_reference",
  ));
});

test("returns occasion and weather knowledge_context without AI calls", () => {
  const context = brain.retrieve("18℃雨天约会");
  const occasionNames = context.ofKind(KNOWLEDGE_KINDS.OCCASION)
    .map((match) => match.record.name);
  const weatherNames = context.ofKind(KNOWLEDGE_KINDS.WEATHER)
    .map((match) => match.record.name);

  assert.equal(context.knowledgeContext.semantic_signals.temperature_c, 18);
  assert.ok(occasionNames.includes("约会"));
  assert.ok(weatherNames.includes("雨天"));
  assert.ok(context.knowledgeContext.knowledge_sources.some(
    (source) => source.type === "occasion_reference",
  ));
});

test("unknown style descriptions remain valid queries rather than a whitelist error", () => {
  const context = brain.retrieve("月球植物学家晚宴");

  assert.equal(context.query, "月球植物学家晚宴");
  assert.ok(Array.isArray(context.knowledgeContext.knowledge));
  assert.ok(Array.isArray(context.knowledgeContext.knowledge_sources));
});
