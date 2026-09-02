"use strict";

const FEMALE_NIGHTLIFE_SCORING_CONTRACT = Object.freeze({
  contract_id: "female_nightlife",
  version: "female_nightlife.production_scoring.v1",
  calibration_status: "PRODUCTION_ENABLED",
  gender: "female",
  scene: "nightlife",
  required_intent_dimensions: Object.freeze([
    "scene_expression_strength",
    "desired_impression_coverage",
    "design_interest",
    "styling_distinction",
    "overall_memorability",
  ]),
});

function resolveFemaleNightlifeScoringContract(intent = {}) {
  const gender = canonical(intent.gender);
  const scene = canonicalSceneFamily(intent.scene);
  const enabled = gender === FEMALE_NIGHTLIFE_SCORING_CONTRACT.gender &&
    scene === FEMALE_NIGHTLIFE_SCORING_CONTRACT.scene;

  if (!enabled) {
    return Object.freeze({
      enabled: false,
      contract_id: null,
      version: null,
      calibration_status: "SCENE_PENDING_CALIBRATION",
      required_intent_dimensions: Object.freeze([]),
      activation_reason: "EXACT_CALIBRATED_SCENE_NOT_MATCHED",
    });
  }

  return Object.freeze({
    enabled: true,
    ...FEMALE_NIGHTLIFE_SCORING_CONTRACT,
    activation_reason: "EXACT_GENDER_AND_SCENE_MATCH",
  });
}

function applyFemaleNightlifeScoringContract(
  requiredIntentDimensions = [],
  intent = {},
) {
  const sceneContract = resolveFemaleNightlifeScoringContract(intent);
  return Object.freeze({
    scene_contract: sceneContract,
    required_intent_dimensions: Object.freeze(unique([
      ...array(requiredIntentDimensions).map(String),
      ...sceneContract.required_intent_dimensions,
    ])),
  });
}

function canonical(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function canonicalSceneFamily(value) {
  const scene = canonical(value);
  return scene === "nightlife_social" ? "nightlife" : scene;
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(values)];
}

module.exports = {
  FEMALE_NIGHTLIFE_SCORING_CONTRACT,
  applyFemaleNightlifeScoringContract,
  resolveFemaleNightlifeScoringContract,
};
