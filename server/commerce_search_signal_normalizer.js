"use strict";

// This lexicon is intentionally limited to compact, searchable commerce
// concepts. It removes conversational degree wording at the query boundary;
// upstream intent evidence remains unchanged.
const COMMERCE_SIGNAL_RULES = Object.freeze([
  Object.freeze({canonical: "设计感", pattern: /(?:设计|design)/iu}),
  Object.freeze({canonical: "年轻", pattern: /(?:年轻|减龄|青春|young|youth)/iu}),
  Object.freeze({canonical: "时髦", pattern: /(?:时髦|时尚|潮流|fashion)/iu}),
  Object.freeze({canonical: "宽松", pattern: /(?:宽松|松弛|loose|relaxed)/iu}),
]);

function normalizeCommerceSearchSignal(value) {
  const input = String(value || "").trim();
  if (!input) return "";
  const compact = input
    .replace(/^(?:更(?:加)?|比较|稍微|有点|有些|偏|想要|希望|要)\s*/u, "")
    .replace(/\s*(?:一点|一些|一点点|一些些)$/u, "")
    .trim();
  const rule = COMMERCE_SIGNAL_RULES.find(({pattern}) =>
    pattern.test(compact));
  return rule?.canonical || compact;
}

module.exports = {
  normalizeCommerceSearchSignal,
};
