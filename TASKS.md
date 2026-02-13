# AgentTrustScore Implementation Tasks

## Locked Product Decisions (Do Not Punt)

1. Scoring constants are configurable, not hardcoded.
   - `DECAY_WINDOW_DAYS` (start: `30`)
   - `CONFIDENCE_THRESHOLD_FEEDBACK_COUNT` (start: `50`)
   - `NEGATIVE_FLAG_THRESHOLD_BPS` (start: `2000`, i.e. 20%)
   - These must be environment variables (off-chain) and/or constructor params (on-chain where relevant).
   - Tune from production data later.
2. Update cadence and batching:
   - Indexer cron interval: every `15` minutes.
   - Cap on-chain writes to `100` score updates per transaction.
   - Queue overflow for next cycle.
3. API pricing starts at:
   - `/score`: `$0.001`
   - `/report`: `$0.005`
   - Keep configurable via env.
4. Registry integration:
   - Use mock contracts by default in development.
   - Add config flag to switch to live ERC-8004 addresses.
   - Live addresses sourced from official deployment announcements.

## Phase 1: Smart Contract (Start Here)

- [x] Initialize Hardhat JS project (`hardhat`, `@nomicfoundation/hardhat-toolbox`, `ethers`, `openzeppelin`).
- [x] Implement `contracts/interfaces/IERC8004ReputationRegistry.sol` (minimal read interface).
- [x] Implement `contracts/TrustScore.sol` with:
  - [x] `TrustScore` storage mapping by `agentId`
  - [x] Struct fields: `score`, `totalFeedback`, `positiveFeedback`, `lastUpdated`, `exists`
  - [x] `owner`, `updater`, `queryFee`, registry address
  - [x] `getScore(agentId)` view
  - [x] `getDetailedReport(agentId)` view
  - [x] `updateScore(...)` onlyUpdater
  - [x] `batchUpdateScores(...)` onlyUpdater
  - [x] `setUpdater`, `setFee`, `withdraw`, optional registry setter
  - [x] Payable query path that emits `ScoreQueried`
  - [x] OpenZeppelin `Ownable`, custom errors, NatSpec docs
- [x] Add `contracts/mocks/MockIdentityRegistry.sol` for local/testing.
- [x] Add `test/TrustScore.test.js`:
  - [x] access control
  - [x] score bounds and feedback consistency checks
  - [x] batch update behavior and length mismatch reverts
  - [x] paid query and fee withdrawal
  - [x] agent registration validation with mock registry
- [x] Add `scripts/deploy.js` for Base Sepolia deployment.
- [x] Add `scripts/verify.js` scaffold for BaseScan verification.
- [ ] Exit criteria:
  - [x] all contract tests pass locally
  - [ ] deployment script runs against local network

## Phase 2: Scoring Engine (Pure Off-chain Logic)

- [x] Implement `server/scoring.js` pure deterministic function.
- [x] Inputs include all tunable constants from env/config.
- [x] Algorithm:
  - [x] base ratio score (0-1000)
  - [x] recent feedback weighted 2x for last 30 days (configurable window)
  - [x] confidence multiplier if feedback count >= threshold
  - [x] recent negative-rate flag (7-day window + threshold bps)
- [x] Add `test/scoring.test.js` for edge cases and parameterized fixtures.
- [ ] Exit criteria:
  - [x] full unit test pass
  - [x] constants can be changed without code edits

## Phase 3: Indexer

- [x] Implement `server/indexer.js`:
  - [x] connect to Base RPC
  - [x] read feedback events incrementally
  - [x] checkpoint `lastProcessedBlock`
  - [x] aggregate dirty `agentId`s
  - [x] compute scores via `scoring.js`
  - [x] write via `batchUpdateScores` with max 100 updates/tx
  - [x] queue overflow for next cycle
  - [x] retry/backoff + logging
- [x] Add config switch `USE_MOCK_REGISTRY` and address map per network.
- [x] Add integration test with mock registry and local chain.
- [ ] Exit criteria:
  - [x] event -> score update e2e path verified
  - [x] resumable after restart

## Phase 4: x402 API

- [x] Implement `server/server.js` with Express.
- [x] Add x402 middleware pricing via env:
  - [x] `GET /score/:agentId` (`$0.001` default)
  - [x] `GET /report/:agentId` (`$0.005` default)
- [x] Add free `GET /health`.
- [x] Add free `GET /discover` for agent capability discovery JSON.
- [x] Read score/report data from deployed contract.
- [x] Add request validation + error handling.
- [x] Add request analytics logging (agentId, timestamp, payment status, response time) to file.
- [x] Add local API test client script (`scripts/test-client.js`) for `/health`, `/score`, `/report`.
- [ ] Exit criteria:
  - [x] paid and free routes behave correctly
  - [x] API schemas are stable and documented

## Phase 4.5: AgentKit Client Proof-of-Concept (Required)

- [ ] Create minimal Coinbase AgentKit bot client in `examples/agentkit-client/`.
- [ ] Bot flow:
  - [ ] discover endpoint config
  - [ ] call `/score/:agentId`
  - [ ] handle `402 Payment Required`
  - [ ] complete x402 payment
  - [ ] receive paid response
- [ ] Add scriptable e2e test command for demo run.
- [ ] Exit criteria:
  - [ ] autonomous agent can pay and consume oracle endpoint end-to-end

## Phase 5: Registration and Discovery

- [x] Create ERC-8004 registration JSON.
- [ ] Host metadata (IPFS + pinning).
- [x] Register oracle service in Identity Registry (mock Base Sepolia flow complete).
- [ ] Exit criteria:
  - [x] service is discoverable with valid metadata and endpoints (via `/discover` + mock registry)

## Phase 6: Deploy + Ops

- [x] Prepare Base Sepolia deploy script with `.env` writeback for deployed addresses.
- [x] Prepare score-seeding script for live API smoke tests.
- [x] Prepare Identity Registry registration script (executes once registry address is available).
- [x] Deploy to Base Sepolia (mainnet deployment pending).
- [x] Verify contracts on BaseScan (Sepolia done).
- [ ] Add monitoring:
  - [ ] indexer lag
  - [ ] tx failures
  - [ ] API latency/error rates
  - [ ] payment success rates
- [ ] Add runbooks for key rotation, incident rollback, and missed-index recovery.

## Environment Variables Checklist

- [ ] `BASE_SEPOLIA_RPC_URL`
- [ ] `BASE_MAINNET_RPC_URL`
- [ ] `API_RPC_URL`
- [ ] `DEPLOYER_PRIVATE_KEY`
- [ ] `UPDATER_PRIVATE_KEY`
- [ ] `BASESCAN_API_KEY`
- [ ] `CDP_API_KEY_NAME`
- [ ] `CDP_API_KEY_PRIVATE`
- [ ] `PORT`
- [ ] `PUBLIC_BASE_URL`
- [ ] `REQUEST_LOG_FILE`
- [ ] `DECAY_WINDOW_DAYS=30`
- [ ] `CONFIDENCE_THRESHOLD_FEEDBACK_COUNT=50`
- [ ] `NEGATIVE_FLAG_THRESHOLD_BPS=2000`
- [ ] `INDEXER_CRON_MINUTES=15`
- [ ] `MAX_BATCH_SIZE=100`
- [ ] `USE_MOCK_REGISTRY=true`
- [ ] `INDEXER_POLL_INTERVAL_MS=900000`
- [ ] `CHECKPOINT_FILE=./server/.indexer-checkpoint.json`
- [ ] `RPC_BACKOFF_START_MS=1000`
- [ ] `RPC_BACKOFF_MAX_MS=60000`
- [ ] `X402_MODE=auto`
- [ ] `X402_STUB_ENFORCE=false`
- [ ] `X402_NETWORK=base`
- [ ] `X402_SCORE_PRICE_USDC=0.001`
- [ ] `X402_REPORT_PRICE_USDC=0.005`
