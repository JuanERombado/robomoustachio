"use strict";

const STATUS = Object.freeze({
  OK: "ok",
  DEGRADED: "degraded",
  ERROR: "error",
});

const VERDICT = Object.freeze({
  TRUSTED: "TRUSTED",
  CAUTION: "CAUTION",
  DANGEROUS: "DANGEROUS",
  UNKNOWN: "UNKNOWN",
});

const RECOMMENDATION = Object.freeze({
  PROCEED: "proceed",
  MANUAL_REVIEW: "manual_review",
  ABORT: "abort",
});

const SOURCE = Object.freeze({
  API_PAID: "api_paid",
  API_DEMO: "api_demo",
  TRUSTSCORE_CONTRACT: "trustscore_contract",
});

function resolveVerdict(score) {
  if (typeof score !== "number" || Number.isNaN(score)) {
    return VERDICT.UNKNOWN;
  }
  if (score > 700) {
    return VERDICT.TRUSTED;
  }
  if (score >= 400) {
    return VERDICT.CAUTION;
  }
  return VERDICT.DANGEROUS;
}

function resolveRecommendation(verdict) {
  if (verdict === VERDICT.TRUSTED) {
    return RECOMMENDATION.PROCEED;
  }
  if (verdict === VERDICT.CAUTION || verdict === VERDICT.UNKNOWN) {
    return RECOMMENDATION.MANUAL_REVIEW;
  }
  return RECOMMENDATION.ABORT;
}

function clampConfidence(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return Number(value.toFixed(4));
}

module.exports = {
  STATUS,
  VERDICT,
  RECOMMENDATION,
  SOURCE,
  resolveVerdict,
  resolveRecommendation,
  clampConfidence,
};

