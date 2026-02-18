"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { createAgentKitClient } = require("../src/agentkit/client");
const { FALLBACK_CODE, mapApiFailure, mapContractFailure } = require("../src/agentkit/fallbacks");
const { RECOMMENDATION, SOURCE, STATUS, VERDICT, resolveRecommendation, resolveVerdict } = require("../src/agentkit/types");

function buildConfig(overrides = {}) {
  return {
    baseUrl: "https://robomoustach.io",
    defaultMode: SOURCE.API_PAID,
    allowDemoFallback: true,
    allowOnchainFallback: true,
    timeoutMs: 50,
    rpcUrl: "https://mainnet.base.org",
    trustScoreAddress: "0xa770C9232811bc551C19Dc41B36c7FFccE856e84",
    confidenceThresholdFeedbackCount: 50,
    negativeFlagThresholdBps: 2000,
    x402: {
      privateKey: "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      maxPaymentAtomic: 20000n,
    },
    fixturesPath: "",
    demoDelayMs: 0,
    ...overrides,
  };
}

function makeResponse(statusCode, body) {
  return {
    ok: statusCode >= 200 && statusCode < 300,
    status: statusCode,
    async text() {
      return body == null ? "" : JSON.stringify(body);
    },
  };
}

test("verdict and recommendation mapping", () => {
  assert.equal(resolveVerdict(900), VERDICT.TRUSTED);
  assert.equal(resolveVerdict(500), VERDICT.CAUTION);
  assert.equal(resolveVerdict(30), VERDICT.DANGEROUS);
  assert.equal(resolveVerdict(null), VERDICT.UNKNOWN);

  assert.equal(resolveRecommendation(VERDICT.TRUSTED), RECOMMENDATION.PROCEED);
  assert.equal(resolveRecommendation(VERDICT.CAUTION), RECOMMENDATION.MANUAL_REVIEW);
  assert.equal(resolveRecommendation(VERDICT.DANGEROUS), RECOMMENDATION.ABORT);
});

test("fallback code mappers cover key failure classes", () => {
  assert.equal(mapApiFailure({ statusCode: 404 }), FALLBACK_CODE.AGENT_NOT_FOUND);
  assert.equal(mapApiFailure({ statusCode: 402 }), FALLBACK_CODE.PAYMENT_UNAVAILABLE);
  assert.equal(mapApiFailure({ statusCode: 500 }), FALLBACK_CODE.ORACLE_UNAVAILABLE);
  assert.equal(mapApiFailure({ error: { name: "AbortError", message: "timeout" } }), FALLBACK_CODE.API_TIMEOUT);

  assert.equal(mapContractFailure({ code: "CALL_EXCEPTION", message: "execution reverted" }), FALLBACK_CODE.AGENT_NOT_FOUND);
  assert.equal(mapContractFailure({ message: "RPC network connection failed" }), FALLBACK_CODE.RPC_UNAVAILABLE);
});

test("queryTrustScore supports demo mode success", async () => {
  const fetchImpl = async (url) => {
    assert.equal(url, "https://robomoustach.io/score/2?demo=true");
    return makeResponse(200, {
      demo: true,
      agentId: "2",
      score: 950,
      confidenceBand: "high",
      verdict: "TRUSTED",
    });
  };

  const client = createAgentKitClient({
    config: buildConfig({ defaultMode: SOURCE.API_DEMO }),
    fetchImpl,
    contractReader: {
      async getDetailedReport() {
        throw new Error("contract should not be called in this test");
      },
    },
  });

  const response = await client.queryTrustScore("2");
  assert.equal(response.status, STATUS.OK);
  assert.equal(response.source, SOURCE.API_DEMO);
  assert.equal(response.score, 950);
  assert.equal(response.verdict, VERDICT.TRUSTED);
  assert.equal(response.recommendation, RECOMMENDATION.PROCEED);
});

test("queryTrustScore supports paid mode success", async () => {
  const paidFetch = async (url) => {
    assert.equal(url, "https://robomoustach.io/score/3");
    return makeResponse(200, {
      agentId: "3",
      score: 400,
      confidence: 0.4,
      lastUpdated: 1_771_085_895,
    });
  };

  const client = createAgentKitClient({
    config: buildConfig({ defaultMode: SOURCE.API_PAID }),
    fetchImpl: async () => {
      throw new Error("plain fetch should not be used for paid mode");
    },
    paidFetchFactory: () => paidFetch,
    contractReader: {
      async getDetailedReport() {
        throw new Error("contract should not be called in this test");
      },
    },
  });

  const response = await client.queryTrustScore("3");
  assert.equal(response.status, STATUS.OK);
  assert.equal(response.source, SOURCE.API_PAID);
  assert.equal(response.score, 400);
  assert.equal(response.verdict, VERDICT.CAUTION);
});

test("queryTrustReport supports trustscore contract direct mode", async () => {
  const client = createAgentKitClient({
    config: buildConfig({ defaultMode: SOURCE.TRUSTSCORE_CONTRACT }),
    fetchImpl: async () => {
      throw new Error("HTTP should not be used for direct contract mode");
    },
    contractReader: {
      async getDetailedReport(agentId) {
        assert.equal(agentId.toString(), "5");
        return {
          score: 100n,
          totalFeedback: 5n,
          positiveFeedback: 0n,
          lastUpdated: 1_771_085_895n,
          exists: true,
        };
      },
    },
  });

  const response = await client.queryTrustReport("5");
  assert.equal(response.status, STATUS.OK);
  assert.equal(response.source, SOURCE.TRUSTSCORE_CONTRACT);
  assert.equal(response.score, 100);
  assert.equal(response.data.totalFeedback, 5);
  assert.equal(response.data.flagged, true);
});

test("api failure degrades to trustscore fallback with structured context", async () => {
  const fetchImpl = async () => makeResponse(500, { error: "upstream exploded" });
  const client = createAgentKitClient({
    config: buildConfig({
      defaultMode: SOURCE.API_PAID,
      allowDemoFallback: false,
      allowOnchainFallback: true,
    }),
    fetchImpl,
    paidFetchFactory: () => fetchImpl,
    contractReader: {
      async getDetailedReport() {
        return {
          score: 800n,
          totalFeedback: 80n,
          positiveFeedback: 70n,
          lastUpdated: 1_771_085_895n,
          exists: true,
        };
      },
    },
  });

  const response = await client.queryTrustScore("1");
  assert.equal(response.status, STATUS.DEGRADED);
  assert.equal(response.source, SOURCE.TRUSTSCORE_CONTRACT);
  assert.equal(response.fallback, FALLBACK_CODE.ORACLE_UNAVAILABLE);
  assert.equal(response.score, 800);
});

test("api timeout degrades to trustscore fallback", async () => {
  const timeoutFetch = async (_url, options) =>
    new Promise((resolve, reject) => {
      if (options?.signal) {
        options.signal.addEventListener("abort", () => {
          const abortError = new Error("aborted");
          abortError.name = "AbortError";
          reject(abortError);
        });
      } else {
        setTimeout(() => resolve(makeResponse(200, {})), 1000);
      }
    });

  const client = createAgentKitClient({
    config: buildConfig({
      timeoutMs: 5,
      allowDemoFallback: false,
      allowOnchainFallback: true,
    }),
    fetchImpl: timeoutFetch,
    paidFetchFactory: () => timeoutFetch,
    contractReader: {
      async getDetailedReport() {
        return {
          score: 700n,
          totalFeedback: 60n,
          positiveFeedback: 35n,
          lastUpdated: 1_771_085_895n,
          exists: true,
        };
      },
    },
  });

  const response = await client.queryTrustScore("1");
  assert.equal(response.status, STATUS.DEGRADED);
  assert.equal(response.fallback, FALLBACK_CODE.API_TIMEOUT);
  assert.equal(response.source, SOURCE.TRUSTSCORE_CONTRACT);
});

test("invalid agentId returns structured error", async () => {
  const client = createAgentKitClient({
    config: buildConfig(),
    fetchImpl: async () => makeResponse(200, {}),
    paidFetchFactory: () => async () => makeResponse(200, {}),
    contractReader: {
      async getDetailedReport() {
        return {
          score: 0n,
          totalFeedback: 0n,
          positiveFeedback: 0n,
          lastUpdated: 0n,
          exists: false,
        };
      },
    },
  });

  const response = await client.queryTrustScore("abc");
  assert.equal(response.status, STATUS.ERROR);
  assert.equal(response.fallback, FALLBACK_CODE.INVALID_AGENT_ID);
  assert.equal(response.recommendation, RECOMMENDATION.MANUAL_REVIEW);
});

test("agent not found is returned as structured error when no fallbacks succeed", async () => {
  const fetchImpl = async () => makeResponse(404, { error: "not found" });
  const client = createAgentKitClient({
    config: buildConfig({
      defaultMode: SOURCE.API_DEMO,
      allowOnchainFallback: false,
    }),
    fetchImpl,
    contractReader: {
      async getDetailedReport() {
        throw new Error("should not be called");
      },
    },
  });

  const response = await client.queryTrustScore("999");
  assert.equal(response.status, STATUS.ERROR);
  assert.equal(response.fallback, FALLBACK_CODE.AGENT_NOT_FOUND);
  assert.equal(response.score, null);
});

