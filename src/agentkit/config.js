"use strict";

const path = require("node:path");
const { SOURCE } = require("./types");

const DEFAULT_TRUST_SCORE_ADDRESS = "0xa770C9232811bc551C19Dc41B36c7FFccE856e84";

function toBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value || "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function toPositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizePrivateKey(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
}

function normalizeMode(rawMode) {
  const normalized = String(rawMode || "").trim().toLowerCase();
  if (normalized === SOURCE.API_DEMO) {
    return SOURCE.API_DEMO;
  }
  if (normalized === SOURCE.TRUSTSCORE_CONTRACT) {
    return SOURCE.TRUSTSCORE_CONTRACT;
  }
  return SOURCE.API_PAID;
}

function parseAtomicAmount(value, fallback) {
  const raw = String(value || "").trim();
  if (!raw) {
    return BigInt(fallback);
  }
  if (!/^\d+$/.test(raw)) {
    return BigInt(fallback);
  }
  return BigInt(raw);
}

function loadAgentKitConfig(env = process.env) {
  const baseUrl = String(env.AGENTKIT_TRUST_BASE_URL || env.TRUST_ORACLE_BASE_URL || "https://robomoustach.io")
    .trim()
    .replace(/\/+$/, "");

  const rpcUrl = String(env.AGENTKIT_RPC_URL || env.BASE_MAINNET_RPC_URL || "https://mainnet.base.org").trim();
  const trustScoreAddress = String(env.AGENTKIT_TRUST_SCORE_ADDRESS || env.TRUST_SCORE_ADDRESS || DEFAULT_TRUST_SCORE_ADDRESS).trim();

  return {
    baseUrl,
    defaultMode: normalizeMode(env.AGENTKIT_DEFAULT_MODE || SOURCE.API_PAID),
    allowDemoFallback: toBoolean(env.AGENTKIT_ALLOW_DEMO_FALLBACK, true),
    allowOnchainFallback: toBoolean(env.AGENTKIT_ALLOW_ONCHAIN_FALLBACK, true),
    timeoutMs: toPositiveInt(env.AGENTKIT_TIMEOUT_MS, 8000),
    rpcUrl,
    trustScoreAddress,
    confidenceThresholdFeedbackCount: toPositiveInt(env.AGENTKIT_CONFIDENCE_THRESHOLD_FEEDBACK_COUNT, 50),
    negativeFlagThresholdBps: toPositiveInt(env.AGENTKIT_NEGATIVE_FLAG_THRESHOLD_BPS, 2000),
    x402: {
      privateKey: normalizePrivateKey(env.AGENTKIT_X402_PRIVATE_KEY || env.X402_TEST_PRIVATE_KEY || env.PRIVATE_KEY),
      maxPaymentAtomic: parseAtomicAmount(env.AGENTKIT_X402_MAX_PAYMENT_ATOMIC || env.X402_MAX_PAYMENT_ATOMIC, 20_000),
    },
    fixturesPath: path.resolve(
      process.cwd(),
      String(env.AGENTKIT_FIXTURES_PATH || "./src/agentkit/fixtures/agents.json").trim()
    ),
    demoDelayMs: toPositiveInt(env.AGENTKIT_DEMO_DELAY_MS, 500),
  };
}

module.exports = {
  DEFAULT_TRUST_SCORE_ADDRESS,
  loadAgentKitConfig,
  normalizePrivateKey,
  normalizeMode,
};

