"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SLOT_KEYS = Object.freeze(["top", "bottom", "shoes"]);

async function fetchDiagnostic({baseUrl, requestId, token, fetchImpl = fetch} = {}) {
  const normalizedBaseUrl = String(baseUrl || "").trim().replace(/\/+$/, "");
  const normalizedToken = String(token || "").trim();
  const normalizedRequestId = String(requestId || "").trim();
  if (!normalizedBaseUrl) throw new Error("Diagnostics base URL is required");
  if (!normalizedToken) throw new Error("SHOPPING_AGENT_DIAGNOSTICS_TOKEN is required");
  if (!normalizedRequestId) throw new Error("request_id is required");
  const response = await fetchImpl(
    `${normalizedBaseUrl}/internal/shopping-agent-diagnostics/` +
      encodeURIComponent(normalizedRequestId),
    {headers: {authorization: `Bearer ${normalizedToken}`}},
  );
  if (!response.ok) {
    const error = new Error(`Diagnostics read failed with HTTP ${response.status}`);
    error.code = `DIAGNOSTICS_HTTP_${response.status}`;
    throw error;
  }
  const payload = await response.json();
  if (!payload?.diagnostic || payload.diagnostic.request_id !== normalizedRequestId) {
    const error = new Error("Diagnostics response does not match request_id");
    error.code = "DIAGNOSTICS_REQUEST_ID_MISMATCH";
    throw error;
  }
  return payload.diagnostic;
}

function buildRealCandidates(trace) {
  const slots = Array.isArray(trace?.slots) ? trace.slots : [];
  const output = {request_id: trace?.request_id || "", top: [], bottom: [], shoes: []};
  for (const slotKey of SLOT_KEYS) {
    const slot = slots.find((item) => item?.category === slotKey ||
      item?.slot_key === slotKey);
    const gateById = new Map((slot?.candidate_gate?.decisions || [])
      .filter((decision) => decision?.candidate?.candidate_id)
      .map((decision) => [decision.candidate.candidate_id, {
        status: decision.status || null,
        reason_codes: decision.reason_codes || [],
      }]));
    const selectorById = new Map((slot?.selector?.assessments || [])
      .filter((assessment) => assessment?.candidate_id)
      .map((assessment) => [assessment.candidate_id, {
        status: assessment.status || null,
        selection_tier: assessment.selection_tier || null,
        scores: assessment.scores || {},
        reason_codes: assessment.reason_codes || [],
      }]));
    const candidates = Array.isArray(slot?.recall?.candidates)
      ? slot.recall.candidates : [];
    output[slotKey] = candidates.slice(0, 10).map((candidate) => ({
      ...candidate,
      slot: slotKey,
      candidate_gate: gateById.get(candidate.candidate_id) || null,
      selector: selectorById.get(candidate.candidate_id) || null,
    }));
  }
  return output;
}

async function exportDiagnostic({baseUrl, requestId, token, outputDirectory,
  fetchImpl = fetch, fsImpl = fs} = {}) {
  const diagnostic = await fetchDiagnostic({baseUrl, requestId, token, fetchImpl});
  const destination = outputDirectory || path.join(os.homedir(), "FitAI-Agent-Exchange");
  fsImpl.mkdirSync(destination, {recursive: true});
  const candidatesPath = path.join(destination, "LATEST_REAL_CANDIDATES.json");
  const sourcePath = path.join(destination, "LATEST_DIAGNOSTIC_ANALYSIS_SOURCE.json");
  fsImpl.writeFileSync(candidatesPath,
    `${JSON.stringify(buildRealCandidates(diagnostic), null, 2)}\n`, "utf8");
  fsImpl.writeFileSync(sourcePath, `${JSON.stringify(diagnostic, null, 2)}\n`, "utf8");
  return {request_id: diagnostic.request_id, candidatesPath, sourcePath};
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--request-id") values.requestId = argv[++index];
    else if (argv[index] === "--base-url") values.baseUrl = argv[++index];
    else if (argv[index] === "--output-directory") values.outputDirectory = argv[++index];
  }
  return values;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const result = await exportDiagnostic({
    requestId: args.requestId,
    baseUrl: args.baseUrl || process.env.FITAI_API_BASE_URL ||
      process.env.API_BASE_URL,
    token: process.env.SHOPPING_AGENT_DIAGNOSTICS_TOKEN,
    outputDirectory: args.outputDirectory,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.code || "DIAGNOSTICS_EXPORT_FAILED"}: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {buildRealCandidates, exportDiagnostic, fetchDiagnostic, parseArguments};
