"use strict";

const crypto = require("node:crypto");

function registerShoppingAgentDiagnosticsRoutes({
  app,
  store,
  token,
  enabled = false,
} = {}) {
  const configuredToken = String(token || "").trim();

  const authorize = (req, res) => {
    if (!enabled || !store?.writable) {
      sendError(res, 503, "SHOPPING_AGENT_DIAGNOSTICS_DISABLED",
        "Shopping Agent diagnostics are disabled");
      return false;
    }
    if (!configuredToken) {
      sendError(res, 503, "SHOPPING_AGENT_DIAGNOSTICS_TOKEN_NOT_CONFIGURED",
        "Shopping Agent diagnostics read access is unavailable");
      return false;
    }
    const actual = bearerToken(req.get("authorization"));
    if (!secretsMatch(actual, configuredToken)) {
      sendError(res, 403, "SHOPPING_AGENT_DIAGNOSTICS_ACCESS_DENIED",
        "Shopping Agent diagnostics access denied");
      return false;
    }
    return true;
  };

  app.get("/internal/shopping-agent-diagnostics/latest", async (req, res, next) => {
    if (!authorize(req, res)) return;
    try {
      const diagnostic = await store.latest();
      if (!diagnostic) return sendError(res, 404,
        "SHOPPING_AGENT_DIAGNOSTIC_NOT_FOUND", "No diagnostic trace was found");
      return res.json({diagnostic});
    } catch (error) {
      return next(error);
    }
  });

  app.get("/internal/shopping-agent-diagnostics/:request_id", async (req, res, next) => {
    if (!authorize(req, res)) return;
    const requestId = String(req.params.request_id || "").trim();
    if (!/^[A-Za-z0-9-]{1,128}$/.test(requestId)) {
      return sendError(res, 400, "INVALID_DIAGNOSTIC_REQUEST_ID",
        "Diagnostic request_id is invalid");
    }
    try {
      const diagnostic = await store.readByRequestId(requestId);
      if (!diagnostic) return sendError(res, 404,
        "SHOPPING_AGENT_DIAGNOSTIC_NOT_FOUND", "Diagnostic trace was not found");
      return res.json({diagnostic});
    } catch (error) {
      return next(error);
    }
  });
}

function bearerToken(value) {
  const match = /^Bearer\s+(.+)$/i.exec(String(value || "").trim());
  return match ? match[1].trim() : "";
}

function secretsMatch(actualValue, expectedValue) {
  const actual = Buffer.from(String(actualValue || ""));
  const expected = Buffer.from(String(expectedValue || ""));
  return actual.length > 0 && actual.length === expected.length &&
    crypto.timingSafeEqual(actual, expected);
}

function sendError(res, status, code, message) {
  return res.status(status).json({status, error: {code, message}});
}

module.exports = {bearerToken, registerShoppingAgentDiagnosticsRoutes, secretsMatch};
