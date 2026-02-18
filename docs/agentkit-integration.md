# AgentKit Integration Guide

This guide shows how to consume Robomoustachio from Coinbase AgentKit-compatible flows using three modes:

1. `api_demo`: Free limited response (`?demo=true`)
2. `api_paid`: x402 paid response (headless signer)
3. `trustscore_contract`: Direct on-chain read fallback

## Install

```bash
npm install
```

## Environment

Add or update these values in `.env`:

```bash
AGENTKIT_DEFAULT_MODE=api_paid
AGENTKIT_TRUST_BASE_URL=https://robomoustach.io
AGENTKIT_ALLOW_DEMO_FALLBACK=true
AGENTKIT_ALLOW_ONCHAIN_FALLBACK=true
AGENTKIT_TIMEOUT_MS=8000
AGENTKIT_RPC_URL=https://mainnet.base.org
AGENTKIT_TRUST_SCORE_ADDRESS=0xa770C9232811bc551C19Dc41B36c7FFccE856e84
AGENTKIT_X402_PRIVATE_KEY=0x...
AGENTKIT_X402_MAX_PAYMENT_ATOMIC=20000
```

## Quick Demo

```bash
npm run agentkit:demo
```

This uses `src/agentkit/fixtures/agents.json` and prints a reproducible trust evaluation run.

## Optional Live Scan

```bash
AGENTKIT_LIVE_AGENT_IDS=1,2,3 npm run agentkit:live-scan
```

Use this for ad-hoc checks without changing curated demo fixtures.

## Programmatic Usage

```js
const { createAgentKitActions } = require("./src/agentkit");

async function main() {
  const actions = createAgentKitActions();
  const score = await actions.queryTrustScore("1");
  const report = await actions.queryTrustReport("1");
  const evalResult = await actions.evaluateAgentRisk("1");
  console.log({ score, report, evalResult });
}
```

## Structured Response Contract

Every action returns a normalized shape:

```json
{
  "status": "ok|degraded|error",
  "agentId": "1",
  "score": 800,
  "confidence": 0.2,
  "verdict": "TRUSTED|CAUTION|DANGEROUS|UNKNOWN",
  "recommendation": "proceed|manual_review|abort",
  "source": "api_paid|api_demo|trustscore_contract",
  "fallback": null,
  "error": null,
  "timingMs": 153,
  "timestamp": "2026-02-18T00:00:00.000Z",
  "correlationId": "uuid",
  "data": {}
}
```

## Fallback Behavior

- Input validation failure -> `fallback: "invalid_agent_id"`
- API timeout -> `fallback: "api_timeout"`
- x402/payment challenge failure -> `fallback: "payment_unavailable"`
- Contract/RPC failure -> `fallback: "rpc_unavailable"` or `oracle_unavailable`
- Missing score/report -> `fallback: "agent_not_found"`

When fallback succeeds (for example API fails but contract works), status is `degraded` and still includes a usable recommendation.

## Important Scope Clarification

On-chain fallback is scoped to `TrustScore` reads:

- `TrustScore.getScore(agentId)`
- `TrustScore.getDetailedReport(agentId)`

It does **not** recompute scores from raw ERC-8004 feedback events.

