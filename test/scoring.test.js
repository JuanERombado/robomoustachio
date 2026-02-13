const { expect } = require("chai");

const {
  DEFAULT_SCORING_CONFIG,
  loadScoringConfigFromEnv,
  scoreFeedback,
  scoreFeedbackDetailed,
} = require("../server/scoring");

describe("scoring.js", function () {
  const nowMs = Date.UTC(2026, 1, 12, 0, 0, 0, 0);
  const oneDayMs = 24 * 60 * 60 * 1000;

  function feedback(isPositive, ageDays) {
    return {
      isPositive,
      timestamp: nowMs - ageDays * oneDayMs,
    };
  }

  it("returns 0 score for empty feedback list", function () {
    expect(scoreFeedback([], DEFAULT_SCORING_CONFIG, nowMs)).to.equal(0);
    expect(scoreFeedbackDetailed([], DEFAULT_SCORING_CONFIG, nowMs)).to.deep.equal({
      score: 0,
      baseScore: 0,
      confidenceAdjustedScore: 0,
      flagged: false,
      totalFeedback: 0,
      positiveFeedback: 0,
      recentNegativeRateBps: 0,
      recentFeedbackCount: 0,
      confidenceApplied: false,
    });
  });

  it("applies recent-vs-old weighting from config", function () {
    const feedbacks = [feedback(true, 40), feedback(false, 2)];
    const config = {
      ...DEFAULT_SCORING_CONFIG,
      decayWindowDays: 30,
      recentFeedbackWeight: 2,
      olderFeedbackWeight: 1,
      confidenceThresholdFeedbackCount: 100,
      flaggedScoreMultiplier: 1,
      negativeFlagThresholdBps: 10_000,
    };

    // Weighted positive ratio: 1 / (1 + 2) = 0.333...
    expect(scoreFeedback(feedbacks, config, nowMs)).to.equal(333);
  });

  it("applies confidence multiplier at threshold feedback count", function () {
    const feedbacks = [
      ...Array.from({ length: 30 }, () => feedback(true, 10)),
      ...Array.from({ length: 20 }, () => feedback(false, 10)),
    ];

    const config = {
      ...DEFAULT_SCORING_CONFIG,
      recentFeedbackWeight: 1,
      olderFeedbackWeight: 1,
      confidenceThresholdFeedbackCount: 50,
      confidenceMultiplier: 1.1,
      flaggedScoreMultiplier: 1,
      negativeFlagThresholdBps: 10_000,
    };

    // Base = 600, confidence-adjusted = 660
    const details = scoreFeedbackDetailed(feedbacks, config, nowMs);
    expect(details.baseScore).to.equal(600);
    expect(details.confidenceApplied).to.equal(true);
    expect(details.score).to.equal(660);
  });

  it("flags and penalizes score when recent negative rate is above threshold", function () {
    const feedbacks = [
      feedback(true, 1),
      feedback(true, 1),
      feedback(true, 1),
      feedback(true, 1),
      feedback(true, 1),
      feedback(false, 1),
      feedback(false, 1),
    ];

    const config = {
      ...DEFAULT_SCORING_CONFIG,
      recentFeedbackWeight: 1,
      olderFeedbackWeight: 1,
      confidenceThresholdFeedbackCount: 999,
      negativeFlagThresholdBps: 2000,
      flaggedScoreMultiplier: 0.8,
    };

    // Base ~714, flagged penalty => ~571
    const details = scoreFeedbackDetailed(feedbacks, config, nowMs);
    expect(details.flagged).to.equal(true);
    expect(details.recentNegativeRateBps).to.equal(2857);
    expect(details.baseScore).to.equal(714);
    expect(details.score).to.equal(571);
  });

  it("parses scoring constants from environment with fallback defaults", function () {
    const env = {
      DECAY_WINDOW_DAYS: "45",
      RECENT_FEEDBACK_WEIGHT: "3",
      OLDER_FEEDBACK_WEIGHT: "1",
      CONFIDENCE_THRESHOLD_FEEDBACK_COUNT: "80",
      CONFIDENCE_MULTIPLIER: "1.2",
      NEGATIVE_FLAG_THRESHOLD_BPS: "1500",
      RECENT_NEGATIVE_WINDOW_DAYS: "5",
      FLAGGED_SCORE_MULTIPLIER: "0.75",
      MAX_TRUST_SCORE: "1000",
    };

    const config = loadScoringConfigFromEnv(env);
    expect(config).to.deep.equal({
      decayWindowDays: 45,
      recentFeedbackWeight: 3,
      olderFeedbackWeight: 1,
      confidenceThresholdFeedbackCount: 80,
      confidenceMultiplier: 1.2,
      negativeFlagThresholdBps: 1500,
      recentNegativeWindowDays: 5,
      flaggedScoreMultiplier: 0.75,
      maxScore: 1000,
    });
  });

  it("throws on invalid feedback entries", function () {
    expect(() => scoreFeedback([{ isPositive: true }], DEFAULT_SCORING_CONFIG, nowMs)).to.throw(
      "missing timestamp"
    );
    expect(() =>
      scoreFeedback([{ timestamp: nowMs, sentiment: "neutral" }], DEFAULT_SCORING_CONFIG, nowMs)
    ).to.throw("must include isPositive boolean");
  });
});
