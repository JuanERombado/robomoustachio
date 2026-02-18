"use strict";

require("dotenv").config();

const { createAgentKitActions } = require("./actions");
const { loadAgentKitConfig } = require("./config");

function parseAgentIds(rawValue) {
  const ids = [];
  const seen = new Set();
  for (const part of String(rawValue || "").split(",")) {
    const candidate = part.trim();
    if (!/^\d+$/.test(candidate)) {
      continue;
    }
    if (seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    ids.push(candidate);
  }
  return ids;
}

async function main() {
  const config = loadAgentKitConfig(process.env);
  const agentIds = parseAgentIds(process.env.AGENTKIT_LIVE_AGENT_IDS);
  if (agentIds.length === 0) {
    throw new Error("Set AGENTKIT_LIVE_AGENT_IDS (comma-separated uint256 ids) before running live scan");
  }

  const actions = createAgentKitActions({ config });
  const results = [];
  for (const agentId of agentIds) {
    const result = await actions.evaluateAgentRisk(agentId);
    results.push({
      agentId,
      status: result.status,
      score: result.score,
      verdict: result.verdict,
      recommendation: result.recommendation,
      source: result.source,
      fallback: result.fallback,
    });
  }

  console.log(JSON.stringify({ scanned: agentIds.length, results }, null, 2));
}

main().catch((error) => {
  console.error(`[agentkit:live-scan] FAIL: ${error.message}`);
  process.exit(1);
});
