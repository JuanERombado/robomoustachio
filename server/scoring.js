"use strict";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_SCORE = 1000;

const DEFAULT_SCORING_CONFIG = Object.freeze({
  decayWindowDays: 30,
  recentFeedbackWeight: 2,
  olderFeedbackWeight: 1,
  confidenceThresholdFeedbackCount: 50,
  confidenceMultiplier: 1.05,
  negativeFlagThresholdBps: 2000,
  recentNegativeWindowDays: 7,
  flaggedScoreMultiplier: 0.9,
  maxScore: DEFAULT_MAX_SCORE,
});

function toPositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toPositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function toBps(value, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  if (parsed < 0) {
    return 0;
  }
  if (parsed > 10_000) {
    return 10_000;
  }
  return parsed;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeConfig(input = {}) {
  return Object.freeze({
    decayWindowDays: toPositiveInt(input.decayWindowDays, DEFAULT_SCORING_CONFIG.decayWindowDays),
    recentFeedbackWeight: toPositiveNumber(
      input.recentFeedbackWeight,
      DEFAULT_SCORING_CONFIG.recentFeedbackWeight
    ),
    olderFeedbackWeight: toPositiveNumber(input.olderFeedbackWeight, DEFAULT_SCORING_CONFIG.olderFeedbackWeight),
    confidenceThresholdFeedbackCount: toPositiveInt(
      input.confidenceThresholdFeedbackCount,
      DEFAULT_SCORING_CONFIG.confidenceThresholdFeedbackCount
    ),
    confidenceMultiplier: toPositiveNumber(input.confidenceMultiplier, DEFAULT_SCORING_CONFIG.confidenceMultiplier),
    negativeFlagThresholdBps: toBps(input.negativeFlagThresholdBps, DEFAULT_SCORING_CONFIG.negativeFlagThresholdBps),
    recentNegativeWindowDays: toPositiveInt(
      input.recentNegativeWindowDays,
      DEFAULT_SCORING_CONFIG.recentNegativeWindowDays
    ),
    flaggedScoreMultiplier: toPositiveNumber(
      input.flaggedScoreMultiplier,
      DEFAULT_SCORING_CONFIG.flaggedScoreMultiplier
    ),
    maxScore: toPositiveInt(input.maxScore, DEFAULT_SCORING_CONFIG.maxScore),
  });
}

function loadScoringConfigFromEnv(env = process.env) {
  return normalizeConfig({
    decayWindowDays: env.DECAY_WINDOW_DAYS,
    recentFeedbackWeight: env.RECENT_FEEDBACK_WEIGHT,
    olderFeedbackWeight: env.OLDER_FEEDBACK_WEIGHT,
    confidenceThresholdFeedbackCount: env.CONFIDENCE_THRESHOLD_FEEDBACK_COUNT,
    confidenceMultiplier: env.CONFIDENCE_MULTIPLIER,
    negativeFlagThresholdBps: env.NEGATIVE_FLAG_THRESHOLD_BPS,
    recentNegativeWindowDays: env.RECENT_NEGATIVE_WINDOW_DAYS,
    flaggedScoreMultiplier: env.FLAGGED_SCORE_MULTIPLIER,
    maxScore: env.MAX_TRUST_SCORE,
  });
}

function parseFeedbackTimestampMs(feedback) {
  const raw = feedback.timestamp ?? feedback.createdAt ?? feedback.time;
  if (raw === undefined || raw === null) {
    throw new TypeError("Feedback entry is missing timestamp/createdAt/time");
  }

  if (raw instanceof Date) {
    const ms = raw.getTime();
    if (!Number.isFinite(ms)) {
      throw new TypeError("Feedback timestamp Date is invalid");
    }
    return ms;
  }

  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw <= 0) {
      throw new TypeError("Feedback timestamp number is invalid");
    }
    return raw < 1e12 ? raw * 1000 : raw;
  }

  if (typeof raw === "string") {
    const ms = Date.parse(raw);
    if (!Number.isFinite(ms)) {
      throw new TypeError("Feedback timestamp string is invalid");
    }
    return ms;
  }

  throw new TypeError("Feedback timestamp type is unsupported");
}

function parseFeedbackSentiment(feedback) {
  if (typeof feedback.isPositive === "boolean") {
    return feedback.isPositive;
  }

  if (typeof feedback.sentiment === "string") {
    const normalized = feedback.sentiment.trim().toLowerCase();
    if (normalized === "positive") {
      return true;
    }
    if (normalized === "negative") {
      return false;
    }
  }

  if (typeof feedback.rating === "number" && Number.isFinite(feedback.rating)) {
    return feedback.rating > 0;
  }

  throw new TypeError("Feedback entry must include isPositive boolean (or equivalent sentiment/rating)");
}

/**
 * Computes full scoring output from raw feedback entries.
 * This is a pure function with respect to its inputs.
 *
 * @param {Array<object>} feedbacks
 * @param {object} [config]
 * @param {number} [nowMs]
 * @returns {{
 *   score:number,
 *   baseScore:number,
 *   confidenceAdjustedScore:number,
 *   flagged:boolean,
 *   totalFeedback:number,
 *   positiveFeedback:number,
 *   recentNegativeRateBps:number,
 *   recentFeedbackCount:number,
 *   confidenceApplied:boolean
 * }}
 */
function scoreFeedbackDetailed(feedbacks, config = DEFAULT_SCORING_CONFIG, nowMs = Date.now()) {
  if (!Array.isArray(feedbacks)) {
    throw new TypeError("feedbacks must be an array");
  }

  const cfg = normalizeConfig(config);
  const decayCutoffMs = nowMs - cfg.decayWindowDays * DAY_MS;
  const recentNegativeCutoffMs = nowMs - cfg.recentNegativeWindowDays * DAY_MS;

  let weightedPositive = 0;
  let weightedTotal = 0;
  let totalFeedback = 0;
  let positiveFeedback = 0;
  let recentFeedbackCount = 0;
  let recentNegativeCount = 0;

  for (const feedback of feedbacks) {
    const timestampMs = parseFeedbackTimestampMs(feedback);
    const isPositive = parseFeedbackSentiment(feedback);
    const weight = timestampMs >= decayCutoffMs ? cfg.recentFeedbackWeight : cfg.olderFeedbackWeight;

    weightedTotal += weight;
    totalFeedback += 1;

    if (isPositive) {
      weightedPositive += weight;
      positiveFeedback += 1;
    }

    if (timestampMs >= recentNegativeCutoffMs) {
      recentFeedbackCount += 1;
      if (!isPositive) {
        recentNegativeCount += 1;
      }
    }
  }

  if (weightedTotal === 0) {
    return {
      score: 0,
      baseScore: 0,
      confidenceAdjustedScore: 0,
      flagged: false,
      totalFeedback: 0,
      positiveFeedback: 0,
      recentNegativeRateBps: 0,
      recentFeedbackCount: 0,
      confidenceApplied: false,
    };
  }

  const baseScoreRaw = (weightedPositive / weightedTotal) * cfg.maxScore;
  const confidenceApplied = totalFeedback >= cfg.confidenceThresholdFeedbackCount;
  const confidenceAdjustedRaw = confidenceApplied ? baseScoreRaw * cfg.confidenceMultiplier : baseScoreRaw;

  const recentNegativeRateBps =
    recentFeedbackCount === 0 ? 0 : Math.round((recentNegativeCount / recentFeedbackCount) * 10_000);
  const flagged = recentFeedbackCount > 0 && recentNegativeRateBps > cfg.negativeFlagThresholdBps;

  const penalizedRaw = flagged ? confidenceAdjustedRaw * cfg.flaggedScoreMultiplier : confidenceAdjustedRaw;
  const score = Math.round(clamp(penalizedRaw, 0, cfg.maxScore));

  return {
    score,
    baseScore: Math.round(clamp(baseScoreRaw, 0, cfg.maxScore)),
    confidenceAdjustedScore: Math.round(clamp(confidenceAdjustedRaw, 0, cfg.maxScore)),
    flagged,
    totalFeedback,
    positiveFeedback,
    recentNegativeRateBps,
    recentFeedbackCount,
    confidenceApplied,
  };
}

/**
 * Pure score function for unit tests and indexer use.
 *
 * @param {Array<object>} feedbacks
 * @param {object} [config]
 * @param {number} [nowMs]
 * @returns {number}
 */
function scoreFeedback(feedbacks, config = DEFAULT_SCORING_CONFIG, nowMs = Date.now()) {
  return scoreFeedbackDetailed(feedbacks, config, nowMs).score;
}

function scoreFeedbackFromEnv(feedbacks, env = process.env, nowMs = Date.now()) {
  return scoreFeedback(feedbacks, loadScoringConfigFromEnv(env), nowMs);
}

module.exports = {
  DEFAULT_SCORING_CONFIG,
  normalizeConfig,
  loadScoringConfigFromEnv,
  scoreFeedbackDetailed,
  scoreFeedback,
  scoreFeedbackFromEnv,
};
