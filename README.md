# AgentTrustScore

AgentTrustScore is a reputation oracle for autonomous agents on Base. It reads ERC-8004-style feedback, computes trust scores, and serves those scores through:

1. An on-chain smart contract (`TrustScore`) for direct agent reads.
2. An off-chain HTTP API with x402-ready payment middleware.

The current Base Sepolia setup uses a mock identity registry for end-to-end testing. Official ERC-8004 registry addresses can be swapped in for mainnet deployment.

## Architecture

```mermaid
flowchart TD
    A[Agent Clients<br/>AgentKit / Virtuals ACP] -->|On-chain read| B[TrustScore.sol<br/>Base]
    A -->|HTTP query<br/>x402-gated| C[Express API]
    C -->|Read score/report| B

    D[Indexer] -->|Query feedback events| E[Reputation Registry]
    D -->|Compute score via scoring.js| F[Scoring Engine]
    F -->|batchUpdateScores| B

    C -->|Discovery JSON| G[/discover endpoint]
```

## Contract Addresses (Base Sepolia)

| Component | Address | Notes |
|---|---|---|
| TrustScore | `0x031314c30537077b6fF63E2881522E6f51b6A5cA` | Verified on BaseScan |
| Identity Registry (mock) | `0xc69A921Ca99e634705Bc5EEa30E116AAE93EEd28` | Used for Phase 6 test registration flow |
| Reputation Registry (configured reference) | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | Swap to official live flow as needed |

Verified contract:
- https://sepolia.basescan.org/address/0x031314c30537077b6fF63E2881522E6f51b6A5cA#code

## API Quickstart

### 1) Install and configure

```bash
npm install
cp .env.example .env
```

Set at minimum:
- `API_RPC_URL=https://sepolia.base.org`
- `TRUST_SCORE_ADDRESS=0x031314c30537077b6fF63E2881522E6f51b6A5cA`
- `PORT=3000`

### 2) Start API

```bash
npm run start:api
```

### 3) Query `/score` and `/report`

```bash
curl "http://localhost:3000/score/1"
```

```bash
curl "http://localhost:3000/report/1"
```

Example response (`/score/1`):

```json
{
  "agentId": "1",
  "score": 800,
  "confidence": 0.2,
  "lastUpdated": 1770943790
}
```

Example response (`/report/1`):

```json
{
  "agentId": "1",
  "score": 800,
  "confidence": 0.2,
  "totalFeedback": 10,
  "positiveFeedback": 8,
  "recentTrend": "caution",
  "flagged": false,
  "riskFactors": ["low_feedback_volume"],
  "negativeRateBps": 2000,
  "lastUpdated": 1770943790
}
```

### Discovery endpoint

The service exposes ERC-8004-style registration metadata at:

```bash
curl "http://localhost:3000/discover"
```

## Integration with AgentKit or Virtuals ACP Agents

### AgentKit pattern

Use trust checks as a pre-transaction guard:

1. Call `/discover` to read capabilities and pricing.
2. Query `/score/:agentId` before a high-value action.
3. Enforce local policy, for example: block if `score < 600` or `flagged=true`.
4. Escalate to `/report/:agentId` for richer risk factors when needed.

Minimal Node example:

```js
const baseUrl = process.env.TRUST_ORACLE_URL || "http://localhost:3000";
const agentId = "1";

const scoreRes = await fetch(`${baseUrl}/score/${agentId}`);
if (!scoreRes.ok) throw new Error(`Score query failed: ${scoreRes.status}`);
const score = await scoreRes.json();

if (score.score < 600) {
  throw new Error(`Rejected counterparty ${agentId}: low trust score ${score.score}`);
}
```

### Virtuals ACP pattern

Embed the same trust gate in your task/intent execution pipeline:

1. Resolve counterpart agent ID.
2. Query trust oracle.
3. Apply policy thresholds.
4. Continue or abort action.

Suggested policy defaults:
- minimum score: `600`
- deny if flagged: `true`
- require confidence: `>= 0.3` for larger-value actions

## Commands

```bash
# Test suites
npm test

# API + client smoke test
npm run start:api
npm run test:client

# Deploy / verify (Base Sepolia)
npm run deploy:base-sepolia
npm run verify:base-sepolia

# Seed and register service
npm run seed:score:base-sepolia
npm run register:service:base-sepolia
```

## Notes

- Current Sepolia registration flow is validated with a mock identity registry.
- Keep official ERC-8004 registry addresses in env for mainnet rollout.
- Do not commit secrets (`DEPLOYER_PRIVATE_KEY`, API keys) to source control.
