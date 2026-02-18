"use strict";

const { ethers } = require("ethers");
const { createWalletClient, http } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { base } = require("viem/chains");
const { wrapFetchWithPayment } = require("x402-fetch");

const { parseAgentIdParam } = require("../../server/validation");
const { loadAgentKitConfig } = require("./config");
const {
  FALLBACK_CODE,
  buildStructuredFailure,
  makeCorrelationId,
  mapApiFailure,
  mapContractFailure,
  toErrorMessage,
  withDegradedContext,
} = require("./fallbacks");
const { SOURCE, STATUS, VERDICT, clampConfidence, resolveRecommendation, resolveVerdict } = require("./types");

const TRUST_SCORE_ABI = [
  "function getScore(uint256 agentId) view returns (uint256)",
  "function getDetailedReport(uint256 agentId) view returns (tuple(uint256 score,uint256 totalFeedback,uint256 positiveFeedback,uint256 lastUpdated,bool exists))",
];

function toNumber(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function toNonNegativeNumber(value) {
  const parsed = toNumber(value);
  if (parsed === null || parsed < 0) {
    return null;
  }
  return parsed;
}

function confidenceFromBand(band) {
  const normalized = String(band || "").trim().toLowerCase();
  if (normalized === "high") {
    return 1;
  }
  if (normalized === "low") {
    return 0.4;
  }
  if (normalized === "none") {
    return 0;
  }
  return null;
}

function deriveConfidence(totalFeedback, threshold) {
  const total = toNonNegativeNumber(totalFeedback);
  if (total === null) {
    return null;
  }
  if (threshold <= 0) {
    return 1;
  }
  return clampConfidence(total / threshold);
}

function parseDetailedRecord(rawRecord) {
  const score = Number(rawRecord.score ?? rawRecord[0]);
  const totalFeedback = Number(rawRecord.totalFeedback ?? rawRecord[1]);
  const positiveFeedback = Number(rawRecord.positiveFeedback ?? rawRecord[2]);
  const lastUpdated = Number(rawRecord.lastUpdated ?? rawRecord[3]);
  const exists = Boolean(rawRecord.exists ?? rawRecord[4]);
  return {
    score: Number.isFinite(score) ? score : 0,
    totalFeedback: Number.isFinite(totalFeedback) ? totalFeedback : 0,
    positiveFeedback: Number.isFinite(positiveFeedback) ? positiveFeedback : 0,
    lastUpdated: Number.isFinite(lastUpdated) ? lastUpdated : 0,
    exists,
  };
}

function buildReportAnalytics(record, config) {
  const total = record.totalFeedback;
  const positive = Math.max(0, Math.min(record.positiveFeedback, total));
  const negative = Math.max(0, total - positive);
  const negativeRateBps = total === 0 ? 0 : Math.round((negative / total) * 10_000);
  const flagged = total > 0 && negativeRateBps > config.negativeFlagThresholdBps;
  const riskFactors = [];
  if (total < config.confidenceThresholdFeedbackCount) {
    riskFactors.push("low_feedback_volume");
  }
  if (flagged) {
    riskFactors.push("high_negative_feedback_ratio");
  }
  if (record.score < 500) {
    riskFactors.push("low_trust_score");
  }
  return {
    negativeRateBps,
    flagged,
    riskFactors,
  };
}

function buildSuccessResponse({
  agentId,
  score,
  confidence,
  source,
  timingMs,
  correlationId,
  status = STATUS.OK,
  fallback = null,
  error = null,
  data = {},
}) {
  const normalizedScore = toNonNegativeNumber(score);
  const normalizedConfidence = clampConfidence(toNumber(confidence));
  const hasNoHistory =
    normalizedScore === 0 &&
    ((toNonNegativeNumber(data.totalFeedback) === 0 && toNonNegativeNumber(data.positiveFeedback) === 0) ||
      normalizedConfidence === 0);
  const verdict = hasNoHistory ? VERDICT.UNKNOWN : resolveVerdict(normalizedScore);
  return {
    status,
    agentId: String(agentId),
    score: normalizedScore,
    confidence: normalizedConfidence,
    verdict,
    recommendation: resolveRecommendation(verdict),
    source,
    fallback,
    error,
    timingMs: Number(timingMs || 0),
    timestamp: new Date().toISOString(),
    correlationId,
    data,
  };
}

function buildHttpError(statusCode, body) {
  const message =
    (body && typeof body === "object" && (body.error || body.details || body.message)) ||
    `HTTP ${statusCode}`;
  const error = new Error(String(message));
  error.statusCode = statusCode;
  error.body = body;
  return error;
}

function parseJsonBody(text) {
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function resolveSequence(requestedMode, config, overrides = {}) {
  const baseMode = requestedMode || config.defaultMode;
  const allowDemoFallback = overrides.allowDemoFallback ?? config.allowDemoFallback;
  const allowOnchainFallback = overrides.allowOnchainFallback ?? config.allowOnchainFallback;

  if (baseMode === SOURCE.TRUSTSCORE_CONTRACT) {
    return [SOURCE.TRUSTSCORE_CONTRACT];
  }
  if (baseMode === SOURCE.API_DEMO) {
    const list = [SOURCE.API_DEMO];
    if (allowOnchainFallback) {
      list.push(SOURCE.TRUSTSCORE_CONTRACT);
    }
    return list;
  }

  const list = [SOURCE.API_PAID];
  if (allowDemoFallback) {
    list.push(SOURCE.API_DEMO);
  }
  if (allowOnchainFallback) {
    list.push(SOURCE.TRUSTSCORE_CONTRACT);
  }
  return list;
}

function createContractReader(config) {
  if (!config.trustScoreAddress) {
    throw new Error("AGENTKIT_TRUST_SCORE_ADDRESS (or TRUST_SCORE_ADDRESS) is required for on-chain fallback");
  }
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const contract = new ethers.Contract(config.trustScoreAddress, TRUST_SCORE_ABI, provider);
  return {
    async getScore(agentId) {
      return contract.getScore(agentId);
    },
    async getDetailedReport(agentId) {
      return contract.getDetailedReport(agentId);
    },
  };
}

function createPaidFetch(config, fetchImpl = fetch) {
  if (!config.x402.privateKey) {
    const error = new Error("AGENTKIT_X402_PRIVATE_KEY is required for api_paid mode");
    error.statusCode = 402;
    throw error;
  }
  const account = privateKeyToAccount(config.x402.privateKey);
  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(config.rpcUrl),
  });
  return wrapFetchWithPayment(fetchImpl, walletClient, config.x402.maxPaymentAtomic);
}

function createAgentKitClient(options = {}) {
  const config = options.config || loadAgentKitConfig(options.env || process.env);
  const fetchImpl = options.fetchImpl || fetch;
  const paidFetchFactory = options.paidFetchFactory || createPaidFetch;
  const contractReader = options.contractReader || createContractReader(config);

  let paidFetch;

  function getPaidFetch() {
    if (!paidFetch) {
      paidFetch = paidFetchFactory(config, fetchImpl);
    }
    return paidFetch;
  }

  async function requestJson(url, { usePaid }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const caller = usePaid ? getPaidFetch() : fetchImpl;
      const response = await caller(url, {
        method: "GET",
        headers: {
          accept: "application/json",
          "user-agent": "robomoustachio-agentkit/1.0",
        },
        signal: controller.signal,
      });
      const text = await response.text();
      const body = parseJsonBody(text);
      if (!response.ok) {
        throw buildHttpError(response.status, body);
      }
      return body;
    } finally {
      clearTimeout(timer);
    }
  }

  async function queryApi(kind, agentId, source) {
    const endpoint = kind === "score" ? "/score/" : "/report/";
    const querySuffix = source === SOURCE.API_DEMO ? "?demo=true" : "";
    const url = `${config.baseUrl}${endpoint}${agentId}${querySuffix}`;
    const body = await requestJson(url, { usePaid: source === SOURCE.API_PAID });

    if (kind === "score") {
      const confidence =
        toNumber(body?.confidence) ??
        confidenceFromBand(body?.confidenceBand) ??
        deriveConfidence(body?.totalFeedback, config.confidenceThresholdFeedbackCount);

      return {
        score: toNonNegativeNumber(body?.score),
        confidence,
        data: {
          lastUpdated: body?.lastUpdated ?? null,
          demo: Boolean(body?.demo),
          note: body?.note ?? null,
          meta: body?.meta ?? null,
        },
      };
    }

    const totalFeedback = toNonNegativeNumber(body?.totalFeedback);
    const positiveFeedback = toNonNegativeNumber(body?.positiveFeedback);
    const confidence =
      toNumber(body?.confidence) ??
      confidenceFromBand(body?.confidenceBand) ??
      deriveConfidence(totalFeedback, config.confidenceThresholdFeedbackCount);

    return {
      score: toNonNegativeNumber(body?.score),
      confidence,
      data: {
        totalFeedback,
        positiveFeedback,
        recentTrend: body?.recentTrend ?? "unknown",
        flagged: typeof body?.flagged === "boolean" ? body.flagged : null,
        riskFactors: Array.isArray(body?.riskFactors) ? body.riskFactors : [],
        negativeRateBps: toNonNegativeNumber(body?.negativeRateBps),
        lastUpdated: body?.lastUpdated ?? null,
        demo: Boolean(body?.demo),
        note: body?.note ?? null,
        meta: body?.meta ?? null,
      },
    };
  }

  async function queryContract(kind, agentId) {
    const rawRecord = await contractReader.getDetailedReport(BigInt(agentId));
    const record = parseDetailedRecord(rawRecord);
    const analytics = buildReportAnalytics(record, config);
    const confidence = deriveConfidence(record.totalFeedback, config.confidenceThresholdFeedbackCount);

    if (kind === "score") {
      return {
        score: record.score,
        confidence,
        data: {
          lastUpdated: record.lastUpdated,
          demo: false,
          note: "Direct TrustScore contract read fallback.",
          meta: null,
        },
      };
    }

    return {
      score: record.score,
      confidence,
      data: {
        totalFeedback: record.totalFeedback,
        positiveFeedback: record.positiveFeedback,
        recentTrend: "unknown",
        flagged: analytics.flagged,
        riskFactors: analytics.riskFactors,
        negativeRateBps: analytics.negativeRateBps,
        lastUpdated: record.lastUpdated,
        demo: false,
        note: "Direct TrustScore contract read fallback.",
        meta: null,
      },
    };
  }

  async function queryTrust(kind, rawAgentId, options = {}) {
    const correlationId = options.correlationId || makeCorrelationId();
    const startedAt = Date.now();
    const requestedMode = options.mode || config.defaultMode;
    const sequence = resolveSequence(requestedMode, config, options);

    let agentId;
    try {
      agentId = parseAgentIdParam(String(rawAgentId)).toString();
    } catch (error) {
      return buildStructuredFailure({
        agentId: rawAgentId,
        source: sequence[0] || requestedMode || SOURCE.API_PAID,
        fallback: FALLBACK_CODE.INVALID_AGENT_ID,
        message: toErrorMessage(error),
        timingMs: Date.now() - startedAt,
        status: STATUS.ERROR,
        correlationId,
      });
    }

    let priorFailure = null;
    for (const source of sequence) {
      const attemptStartedAt = Date.now();
      try {
        const result =
          source === SOURCE.TRUSTSCORE_CONTRACT
            ? await queryContract(kind, agentId)
            : await queryApi(kind, agentId, source);

        const response = buildSuccessResponse({
          agentId,
          score: result.score,
          confidence: result.confidence,
          source,
          timingMs: Date.now() - attemptStartedAt,
          correlationId,
          data: result.data,
        });

        if (priorFailure) {
          return withDegradedContext(response, priorFailure.code, priorFailure.message);
        }
        return response;
      } catch (error) {
        const fallbackCode =
          source === SOURCE.TRUSTSCORE_CONTRACT
            ? mapContractFailure(error)
            : mapApiFailure({ statusCode: error.statusCode, error });

        priorFailure = {
          code: fallbackCode,
          message: toErrorMessage(error),
        };
      }
    }

    return buildStructuredFailure({
      agentId,
      source: sequence[sequence.length - 1] || SOURCE.API_PAID,
      fallback: priorFailure?.code || FALLBACK_CODE.ORACLE_UNAVAILABLE,
      message: priorFailure?.message || "No available trust data source succeeded",
      timingMs: Date.now() - startedAt,
      status: priorFailure?.code === FALLBACK_CODE.AGENT_NOT_FOUND ? STATUS.ERROR : STATUS.DEGRADED,
      correlationId,
    });
  }

  return {
    config,
    queryTrustScore(agentId, options = {}) {
      return queryTrust("score", agentId, options);
    },
    queryTrustReport(agentId, options = {}) {
      return queryTrust("report", agentId, options);
    },
  };
}

module.exports = {
  TRUST_SCORE_ABI,
  createAgentKitClient,
  createContractReader,
  createPaidFetch,
};
