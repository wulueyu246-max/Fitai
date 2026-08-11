"use strict";

const fs = require("node:fs");
const path = require("node:path");

const KNOWLEDGE_KINDS = Object.freeze({
  STYLE: "style",
  ITEM: "item",
  BODY: "body",
  OCCASION: "occasion",
  WEATHER: "weather",
  BRAND: "brand",
  MATERIAL: "material",
});

const KNOWLEDGE_FILES = Object.freeze([
  {kind: KNOWLEDGE_KINDS.STYLE, file: "styles/styles.json"},
  {kind: KNOWLEDGE_KINDS.ITEM, file: "items/items.json"},
  {kind: KNOWLEDGE_KINDS.BODY, file: "body/body_rules.json"},
  {kind: KNOWLEDGE_KINDS.OCCASION, file: "occasions/occasions.json"},
  {
    kind: KNOWLEDGE_KINDS.WEATHER,
    file: "occasions/weather_contexts.json",
  },
  {kind: KNOWLEDGE_KINDS.BRAND, file: "brands/brands.json"},
  {kind: KNOWLEDGE_KINDS.MATERIAL, file: "materials/materials.json"},
]);

const REQUIRED_FIELDS = Object.freeze({
  [KNOWLEDGE_KINDS.STYLE]: new Set([
    "id",
    "name",
    "aliases",
    "visual_identity",
    "personality",
    "dimensions",
    "silhouette_preferences",
    "preferred_items",
    "preferred_colors",
    "preferred_materials",
    "preferred_shoes",
    "preferred_accessories",
    "avoid_elements",
    "compatible_occasions",
  ]),
  [KNOWLEDGE_KINDS.ITEM]: new Set([
    "item_name",
    "category",
    "visual_effect",
    "compatible_styles",
    "incompatible_styles",
    "body_effect",
    "silhouette_effect",
    "season",
    "occasion",
    "material_preferences",
  ]),
  [KNOWLEDGE_KINDS.BODY]: new Set([
    "body_condition",
    "visual_goal",
    "recommended_strategy",
    "recommended_items",
    "avoid_items",
  ]),
  [KNOWLEDGE_KINDS.OCCASION]: new Set([
    "dress_level",
    "preferred_styles",
    "avoid_styles",
    "recommended_items",
  ]),
  [KNOWLEDGE_KINDS.WEATHER]: new Set([
    "name",
    "recommended_strategy",
    "recommended_items",
    "avoid_items",
  ]),
  [KNOWLEDGE_KINDS.BRAND]: new Set([
    "brand",
    "positioning",
    "price_level",
    "style_alignment",
    "avoid_contexts",
  ]),
  [KNOWLEDGE_KINDS.MATERIAL]: new Set([
    "material",
    "visual_meaning",
    "suitable_styles",
    "avoid_contexts",
  ]),
});

const STYLE_DIMENSIONS = Object.freeze([
  "maturity",
  "femininity",
  "masculinity",
  "luxury",
  "minimalism",
  "romantic",
  "structure",
  "sportiness",
  "youthfulness",
  "sexiness",
  "casualness",
]);

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
}

function queryTerms(value) {
  const terms = new Set();
  const matches = String(value || "").toLowerCase()
    .match(/[a-z0-9]+|[\u4e00-\u9fff]+/g) || [];
  for (const token of matches) {
    if (/^[\u4e00-\u9fff]+$/.test(token)) {
      for (let index = 0; index < token.length - 1; index += 1) {
        terms.add(token.slice(index, index + 2));
      }
    } else if (token.length >= 2) {
      terms.add(token);
    }
  }
  return terms;
}

function flatten(value, output = []) {
  if (Array.isArray(value)) {
    for (const item of value) flatten(item, output);
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      output.push(key);
      flatten(item, output);
    }
  } else if (value !== null && value !== undefined) {
    output.push(String(value));
  }
  return output;
}

function slug(value) {
  return normalizeText(value).replace(/-+/g, "-");
}

function parseMeasurements(query) {
  const source = String(query || "");
  const heightMatch = source.match(
    /(?<!\d)(1[3-9]\d|2[0-1]\d)\s*(?:cm|厘米)?/i,
  );
  const temperatureMatch = source.match(
    /(-?\d{1,2})\s*(?:℃|°c|摄氏度)/i,
  );
  return {
    heightCm: heightMatch ? Number.parseInt(heightMatch[1], 10) : null,
    temperatureC: temperatureMatch
      ? Number.parseInt(temperatureMatch[1], 10)
      : null,
  };
}

function validateRecord(file, kind, record) {
  const missing = [...REQUIRED_FIELDS[kind]].filter(
    (field) => !Object.hasOwn(record, field),
  );
  if (missing.length > 0) {
    throw new TypeError(`${file} entry is missing: ${missing.join(", ")}`);
  }

  if (kind !== KNOWLEDGE_KINDS.STYLE) return;
  const dimensions = record.dimensions;
  const dimensionKeys = dimensions && typeof dimensions === "object" &&
    !Array.isArray(dimensions)
    ? Object.keys(dimensions)
    : [];
  const validKeys = dimensionKeys.length === STYLE_DIMENSIONS.length &&
    STYLE_DIMENSIONS.every((name) => dimensionKeys.includes(name));
  const validValues = validKeys && Object.values(dimensions).every(
    (value) => Number.isFinite(value) && value >= 0 && value <= 100,
  );
  if (!validValues) {
    throw new TypeError(
      `${file} style ${record.id} has invalid 0-100 dimensions`,
    );
  }
}

class KnowledgeRecord {
  constructor(kind, data) {
    const name = data.name ?? data.item_name ?? data.body_condition ??
      data.occasion ?? data.brand ?? data.material;
    this.kind = kind;
    this.id = String(data.id ?? `${kind}:${slug(name)}`);
    this.name = String(name ?? "");
    this.aliases = Array.isArray(data.aliases)
      ? data.aliases.map(String)
      : [];
    this.data = data;
  }

  get searchableText() {
    return flatten(this.data).join(" ");
  }

  toSourceJson(score) {
    return {
      type: `${this.kind}_reference`,
      id: this.id,
      name: this.name,
      ...(Number.isFinite(score)
        ? {score: Number(score.toFixed(3))}
        : {}),
    };
  }
}

class FashionContext {
  constructor(query, matches, semanticSignals) {
    this.query = query;
    this.matches = matches;
    this.semanticSignals = semanticSignals;
  }

  ofKind(kind) {
    return this.matches.filter((match) => match.record.kind === kind);
  }

  get knowledgeSources() {
    return this.matches.map((match) =>
      match.record.toSourceJson(match.score));
  }

  get knowledgeContext() {
    return this.toPromptJson();
  }

  toPromptJson() {
    return {
      semantic_signals: {...this.semanticSignals},
      knowledge: this.matches.map((match) => match.record.data),
      knowledge_sources: this.knowledgeSources,
    };
  }
}

class FashionBrain {
  constructor(records) {
    this._records = records;
  }

  static load({baseDir = path.join(__dirname, "fashion_brain")} = {}) {
    const records = [];
    for (const {kind, file} of KNOWLEDGE_FILES) {
      const fullPath = path.join(baseDir, ...file.split("/"));
      const decoded = JSON.parse(fs.readFileSync(fullPath, "utf8"));
      if (!Array.isArray(decoded)) {
        throw new TypeError(`${file} must contain a JSON array`);
      }
      for (const value of decoded) {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          throw new TypeError(`${file} contains a non-object entry`);
        }
        validateRecord(file, kind, value);
        records.push(new KnowledgeRecord(kind, value));
      }
    }
    return new FashionBrain(records);
  }

  get records() {
    return [...this._records];
  }

  retrieve(query) {
    const sourceQuery = String(query || "");
    const normalizedQuery = normalizeText(sourceQuery);
    const measurements = parseMeasurements(sourceQuery);
    const matches = [];

    for (const record of this._records) {
      const scored = this._score(record, normalizedQuery, measurements);
      if (scored.score >= 10) {
        matches.push({record, score: scored.score, reasons: scored.reasons});
      }
    }
    matches.sort((left, right) => right.score - left.score);

    const limited = [];
    const counts = new Map();
    for (const match of matches) {
      const count = counts.get(match.record.kind) || 0;
      const limit = match.record.kind === KNOWLEDGE_KINDS.STYLE ? 3 : 2;
      if (count < limit) {
        limited.push(match);
        counts.set(match.record.kind, count + 1);
      }
    }

    return new FashionContext(
      sourceQuery,
      limited,
      {
        ...(measurements.heightCm !== null
          ? {height_cm: measurements.heightCm}
          : {}),
        ...(measurements.temperatureC !== null
          ? {temperature_c: measurements.temperatureC}
          : {}),
      },
    );
  }

  _score(record, query, measurements) {
    let score = 0;
    const reasons = [];
    let primaryMatched = false;
    let heightMatched = false;
    const primaryTerms = [record.name, ...record.aliases]
      .map(normalizeText)
      .filter((term) => term.length >= 2);

    for (const term of primaryTerms) {
      if (query.includes(term)) {
        primaryMatched = true;
        score += 20 + Math.min(term.length, 10);
        reasons.push(`matched:${term}`);
      }
    }

    const terms = queryTerms(query);
    const searchable = normalizeText(record.searchableText);
    const overlaps = [...terms].filter((term) => searchable.includes(term));
    score += new Set(overlaps).size * 2;
    if (overlaps.length > 0) {
      reasons.push(`semantic:${[...new Set(overlaps)].join(",")}`);
    }

    if (record.kind === KNOWLEDGE_KINDS.BODY &&
        measurements.heightCm !== null) {
      const constraints = record.data.constraints;
      if (constraints && typeof constraints === "object") {
        const height = measurements.heightCm;
        const min = Number.isFinite(constraints.min_height_cm)
          ? constraints.min_height_cm
          : null;
        const max = Number.isFinite(constraints.max_height_cm)
          ? constraints.max_height_cm
          : null;
        if ((min === null || height >= min) &&
            (max === null || height <= max)) {
          heightMatched = true;
          score += 16;
          reasons.push(`height_range:${height}`);
        }
      }
    }

    if (record.kind === KNOWLEDGE_KINDS.BODY &&
        !primaryMatched && !heightMatched) {
      return {score: 0, reasons: []};
    }

    return {score, reasons};
  }
}

module.exports = {
  FashionBrain,
  FashionContext,
  KNOWLEDGE_FILES,
  KNOWLEDGE_KINDS,
  STYLE_DIMENSIONS,
};
