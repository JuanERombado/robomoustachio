"use strict";

function formatUsdPrice(price) {
  const normalized = `${price ?? ""}`.trim();
  if (!normalized) {
    return "$0.000";
  }
  return normalized.startsWith("$") ? normalized : `$${normalized}`;
}

function buildRegistrationDocument(env = process.env) {
  const port = Number(env.PORT) || 3000;
  const baseUrl = env.PUBLIC_BASE_URL || `http://localhost:${port}`;
  const scorePrice = formatUsdPrice(env.X402_SCORE_PRICE_USDC || "0.001");
  const reportPrice = formatUsdPrice(env.X402_REPORT_PRICE_USDC || "0.005");

  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: env.ORACLE_NAME || "AgentTrustScore",
    description:
      env.ORACLE_DESCRIPTION ||
      `Reputation scoring oracle for AI agents. Query trust scores before transacting. Pricing: ${scorePrice}/score, ${reportPrice}/detailed report.`,
    pricing: {
      protocol: "x402",
      currency: "USDC",
      score: scorePrice,
      report: reportPrice,
    },
    capabilities: [
      {
        name: "score",
        method: "GET",
        endpoint: "/score/:agentId",
        price: scorePrice,
        description: "Returns score, confidence, and last update timestamp.",
      },
      {
        name: "report",
        method: "GET",
        endpoint: "/report/:agentId",
        price: reportPrice,
        description: "Returns detailed trust report with risk factors.",
      },
      {
        name: "health",
        method: "GET",
        endpoint: "/health",
        price: "free",
        description: "Service health status.",
      },
      {
        name: "discover",
        method: "GET",
        endpoint: "/discover",
        price: "free",
        description: "Service registration and capability discovery document.",
      },
    ],
    services: [
      {
        name: "web",
        endpoint: baseUrl,
      },
      {
        name: "MCP",
        endpoint: `${baseUrl}/mcp`,
        version: "2025-06-18",
      },
    ],
    updatedAt: new Date().toISOString(),
  };
}

module.exports = {
  buildRegistrationDocument,
  formatUsdPrice,
};
