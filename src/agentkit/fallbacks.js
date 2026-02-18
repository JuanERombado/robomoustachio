"use strict";

const crypto = require("node:crypto");
const { RECOMMENDATION, STATUS, VERDICT } = require("./types");

const FALLBACK_CODE = Object.freeze({
  ORACLE_UNAVAILABLE: "oracle_unavailable",
  API_TIMEOUT: "api_timeout",
  PAYMENT_UNAVAILABLE: "payment_unavailable",
  RPC_UNAVAILABLE: "rpc_unavailable",
  AGENT_NOT_FOUND: "agent_not_found",
  INVALID_AGENT_ID: "invalid_agent_id",
});

function makeCorrelationId() {
  return crypto.randomUUID();
}

function toErrorMessage(error) {
  if (!error) {
    return "Unknown error";
  }
  if (typeof error.message === "string" && error.message.trim()) {
    return error.message.trim();
  }
  return String(error);
}

function isTimeoutError(error) {
  return (
    error &&
    (error.name === "AbortError" ||
      error.code === "ABORT_ERR" ||
      String(error.message || "").toLowerCase().includes("timeout"))
  );
}

function isRpcError(error) {
  const normalized = String(error?.message || error?.shortMessage || "").toLowerCase();
  return (
    normalized.includes("network") ||
    normalized.includes("socket") ||
    normalized.includes("connect") ||
    normalized.includes("rpc")
  );
}

function isCallException(error) {
  return (
    error &&
    (error.code === "CALL_EXCEPTION" ||
      String(error.message || "").toLowerCase().includes("execution reverted") ||
      String(error.shortMessage || "").toLowerCase().includes("execution reverted"))
  );
}

function mapApiFailure({ statusCode, error }) {
  if (statusCode === 404) {
    return FALLBACK_CODE.AGENT_NOT_FOUND;
  }
  if (statusCode === 402) {
    return FALLBACK_CODE.PAYMENT_UNAVAILABLE;
  }
  if (statusCode >= 500) {
    return FALLBACK_CODE.ORACLE_UNAVAILABLE;
  }
  if (isTimeoutError(error)) {
    return FALLBACK_CODE.API_TIMEOUT;
  }
  return FALLBACK_CODE.ORACLE_UNAVAILABLE;
}

function mapContractFailure(error) {
  if (isCallException(error)) {
    return FALLBACK_CODE.AGENT_NOT_FOUND;
  }
  if (isTimeoutError(error) || isRpcError(error)) {
    return FALLBACK_CODE.RPC_UNAVAILABLE;
  }
  return FALLBACK_CODE.ORACLE_UNAVAILABLE;
}

function buildStructuredFailure({
  agentId,
  source,
  fallback,
  timingMs,
  correlationId,
  status = STATUS.DEGRADED,
  message,
}) {
  return {
    status,
    agentId: agentId == null ? null : String(agentId),
    score: null,
    confidence: null,
    verdict: VERDICT.UNKNOWN,
    recommendation: RECOMMENDATION.MANUAL_REVIEW,
    source,
    fallback,
    error: {
      code: fallback,
      message: message || fallback,
    },
    timingMs: Number(timingMs || 0),
    timestamp: new Date().toISOString(),
    correlationId: correlationId || makeCorrelationId(),
  };
}

function withDegradedContext(response, fallbackCode, fallbackMessage) {
  return {
    ...response,
    status: STATUS.DEGRADED,
    fallback: fallbackCode,
    error: {
      code: fallbackCode,
      message: fallbackMessage || fallbackCode,
    },
  };
}

module.exports = {
  FALLBACK_CODE,
  makeCorrelationId,
  mapApiFailure,
  mapContractFailure,
  buildStructuredFailure,
  withDegradedContext,
  toErrorMessage,
};

