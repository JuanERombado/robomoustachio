"use strict";

const { createAgentKitClient } = require("./client");
const { RECOMMENDATION, VERDICT } = require("./types");

function createAgentKitActions(options = {}) {
  const client = options.client || createAgentKitClient(options);

  async function evaluateAgentRisk(agentId, requestOptions = {}) {
    const report = await client.queryTrustReport(agentId, requestOptions);
    return {
      ...report,
      evaluation: {
        verdict: report.verdict || VERDICT.UNKNOWN,
        recommendation: report.recommendation || RECOMMENDATION.MANUAL_REVIEW,
        flagged: typeof report.data?.flagged === "boolean" ? report.data.flagged : null,
        riskFactors: Array.isArray(report.data?.riskFactors) ? report.data.riskFactors : [],
      },
    };
  }

  return {
    queryTrustScore: (agentId, requestOptions = {}) => client.queryTrustScore(agentId, requestOptions),
    queryTrustReport: (agentId, requestOptions = {}) => client.queryTrustReport(agentId, requestOptions),
    evaluateAgentRisk,
    getConfig: () => client.config,
  };
}

module.exports = {
  createAgentKitActions,
};

