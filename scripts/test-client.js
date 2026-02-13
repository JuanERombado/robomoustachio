"use strict";

require("dotenv").config();

const DEFAULT_BASE_URL = `http://localhost:${process.env.PORT || 3000}`;
const BASE_URL = process.env.API_BASE_URL || DEFAULT_BASE_URL;
const TEST_AGENT_ID = process.env.TEST_AGENT_ID || "1";

async function parseResponseBody(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

async function request(pathname, options = {}) {
  const url = `${BASE_URL}${pathname}`;
  const startedAt = Date.now();

  const response = await fetch(url, options);
  const body = await parseResponseBody(response);
  const responseTimeMs = Date.now() - startedAt;

  return {
    url,
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body,
    responseTimeMs,
  };
}

function printResult(title, result) {
  console.log(`\n=== ${title} ===`);
  console.log(`URL: ${result.url}`);
  console.log(`Status: ${result.status}`);
  console.log(`Response Time: ${result.responseTimeMs}ms`);
  console.log("Body:", JSON.stringify(result.body, null, 2));
}

async function requestPaid(pathname) {
  const baseHeaders = {
    accept: "application/json",
    "x-agent-client": "agentkit-style-local-test",
  };

  const firstAttempt = await request(pathname, {
    method: "GET",
    headers: baseHeaders,
  });

  if (firstAttempt.status !== 402) {
    return firstAttempt;
  }

  console.log(`Received 402 for ${pathname}. Retrying with simulated payment headers...`);
  return request(pathname, {
    method: "GET",
    headers: {
      ...baseHeaders,
      "x-payment-status": "paid",
      "x-payment-proof": "local-test-proof",
    },
  });
}

async function main() {
  console.log(`Using API base URL: ${BASE_URL}`);
  console.log(`Testing agentId: ${TEST_AGENT_ID}`);

  const health = await request("/health");
  printResult("GET /health", health);

  const discover = await request("/discover");
  printResult("GET /discover", discover);

  const score = await requestPaid(`/score/${TEST_AGENT_ID}`);
  printResult("GET /score/:agentId", score);

  const report = await requestPaid(`/report/${TEST_AGENT_ID}`);
  printResult("GET /report/:agentId", report);
}

main().catch((error) => {
  console.error("test-client failed:", error.stack || error.message);
  process.exitCode = 1;
});
