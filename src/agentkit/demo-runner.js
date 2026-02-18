"use strict";

const fs = require("node:fs/promises");
require("dotenv").config();

const { createAgentKitActions } = require("./actions");
const { loadAgentKitConfig } = require("./config");
const { STATUS } = require("./types");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function verdictGlyph(verdict) {
  if (verdict === "TRUSTED") {
    return "[OK]";
  }
  if (verdict === "CAUTION") {
    return "[WARN]";
  }
  if (verdict === "DANGEROUS") {
    return "[BLOCK]";
  }
  return "[INFO]";
}

async function loadFixtures(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`Fixture file is not an array: ${filePath}`);
  }
  return parsed;
}

async function main() {
  const config = loadAgentKitConfig(process.env);
  const fixtures = await loadFixtures(config.fixturesPath);
  const actions = createAgentKitActions({ config });

  console.log("=== Robomoustachio AgentKit Demo ===");
  console.log(`baseUrl: ${config.baseUrl}`);
  console.log(`mode: ${config.defaultMode}`);
  console.log(`fixtures: ${config.fixturesPath}`);
  console.log("");

  const summary = {
    total: 0,
    ok: 0,
    degraded: 0,
    error: 0,
  };

  for (const fixture of fixtures) {
    const agentId = String(fixture.agentId);
    const result = await actions.evaluateAgentRisk(agentId);
    summary.total += 1;
    if (result.status === STATUS.OK) {
      summary.ok += 1;
    } else if (result.status === STATUS.DEGRADED) {
      summary.degraded += 1;
    } else {
      summary.error += 1;
    }

    console.log(`Agent ${agentId} (${fixture.label})`);
    console.log(
      `${verdictGlyph(result.verdict)} score=${result.score ?? "N/A"} verdict=${result.verdict} recommendation=${result.recommendation}`
    );
    console.log(
      `status=${result.status} source=${result.source} fallback=${result.fallback || "none"} correlationId=${result.correlationId}`
    );
    console.log("");

    if (config.demoDelayMs > 0) {
      await sleep(config.demoDelayMs);
    }
  }

  console.log("=== Summary ===");
  console.log(
    `total=${summary.total} ok=${summary.ok} degraded=${summary.degraded} error=${summary.error}`
  );
}

main().catch((error) => {
  console.error(`[agentkit:demo] FAIL: ${error.message}`);
  process.exit(1);
});
