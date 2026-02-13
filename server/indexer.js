"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { ethers } = require("ethers");

const { loadScoringConfigFromEnv, normalizeConfig, scoreFeedbackDetailed } = require("./scoring");

const DEFAULT_CHECKPOINT_PATH = path.join(__dirname, ".indexer-checkpoint.json");
const DEFAULT_POLL_INTERVAL_MS = 900_000;
const DEFAULT_BACKOFF_START_MS = 1_000;
const DEFAULT_BACKOFF_MAX_MS = 60_000;
const DEFAULT_MAX_BATCH_SIZE = 100;

// Includes both event names for compatibility while keeping one payload shape.
const REPUTATION_REGISTRY_ABI = [
  "event FeedbackPosted(uint256 indexed agentId,address indexed clientAddress,uint64 feedbackIndex,int128 value,uint8 valueDecimals,string indexed indexedTag1,string tag1,string tag2,string endpoint,string feedbackURI,bytes32 feedbackHash)",
  "event NewFeedback(uint256 indexed agentId,address indexed clientAddress,uint64 feedbackIndex,int128 value,uint8 valueDecimals,string indexed indexedTag1,string tag1,string tag2,string endpoint,string feedbackURI,bytes32 feedbackHash)",
];

const TRUST_SCORE_ABI = [
  "function batchUpdateScores(uint256[] agentIds,uint256[] scores,uint256[] totals,uint256[] positives) external",
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toPositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function toNonNegativeInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function isTrue(value) {
  return String(value || "").toLowerCase() === "true";
}

function normalizeAgentIdString(value) {
  try {
    const asBigInt = typeof value === "bigint" ? value : BigInt(value);
    if (asBigInt < 0n) {
      return null;
    }
    return asBigInt.toString();
  } catch {
    return null;
  }
}

function isRpcError(error) {
  if (!error) {
    return false;
  }

  const code = error.code;
  if (typeof code === "number" && (code === -32000 || code === -32005 || code === -32603)) {
    return true;
  }

  const knownCodes = new Set(["NETWORK_ERROR", "SERVER_ERROR", "TIMEOUT", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND"]);
  if (typeof code === "string" && knownCodes.has(code)) {
    return true;
  }

  const message = `${error.message || ""} ${error.shortMessage || ""}`.toLowerCase();
  const retryHints = [
    "timeout",
    "timed out",
    "429",
    "rate limit",
    "network error",
    "missing response",
    "temporarily unavailable",
    "socket hang up",
    "gateway timeout",
  ];
  if (retryHints.some((token) => message.includes(token))) {
    return true;
  }

  if (error.error && error.error !== error) {
    return isRpcError(error.error);
  }
  if (error.cause && error.cause !== error) {
    return isRpcError(error.cause);
  }

  return false;
}

async function withExponentialBackoff(operation, options = {}) {
  const initialDelayMs = toPositiveInt(options.initialDelayMs, DEFAULT_BACKOFF_START_MS);
  const maxDelayMs = toPositiveInt(options.maxDelayMs, DEFAULT_BACKOFF_MAX_MS);
  const maxRetries = options.maxRetries === undefined ? Infinity : toNonNegativeInt(options.maxRetries, Infinity);
  const isRetryable = options.isRetryable || isRpcError;
  const onRetry = typeof options.onRetry === "function" ? options.onRetry : null;

  let attempts = 0;
  let delayMs = initialDelayMs;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (!isRetryable(error)) {
        throw error;
      }
      if (attempts >= maxRetries) {
        throw error;
      }

      attempts += 1;
      if (onRetry) {
        onRetry({ attempts, delayMs, error });
      }
      await sleep(delayMs);
      delayMs = Math.min(delayMs * 2, maxDelayMs);
    }
  }
}

function normalizeCheckpoint(raw) {
  const lastProcessedBlock = Number.isInteger(raw?.lastProcessedBlock) && raw.lastProcessedBlock >= 0
    ? raw.lastProcessedBlock
    : null;

  const pendingAgentIds = [];
  const seen = new Set();
  for (const id of raw?.pendingAgentIds || []) {
    const normalized = normalizeAgentIdString(id);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    pendingAgentIds.push(normalized);
  }

  return { lastProcessedBlock, pendingAgentIds };
}

async function loadCheckpoint(checkpointPath) {
  try {
    const content = await fs.readFile(checkpointPath, "utf8");
    return normalizeCheckpoint(JSON.parse(content));
  } catch (error) {
    if (error.code === "ENOENT") {
      return { lastProcessedBlock: null, pendingAgentIds: [] };
    }
    throw error;
  }
}

async function saveCheckpoint(checkpointPath, checkpoint) {
  const normalized = normalizeCheckpoint(checkpoint);
  await fs.mkdir(path.dirname(checkpointPath), { recursive: true });
  const tmpPath = `${checkpointPath}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  await fs.rename(tmpPath, checkpointPath);
}

function buildIndexerConfigFromEnv(env = process.env) {
  const useMockRegistry = isTrue(env.USE_MOCK_REGISTRY);
  const reputationRegistryAddress = useMockRegistry
    ? env.MOCK_REPUTATION_REGISTRY_ADDRESS || env.REPUTATION_REGISTRY_ADDRESS || ""
    : env.REPUTATION_REGISTRY_ADDRESS || "";

  return {
    rpcUrl: env.BASE_SEPOLIA_RPC_URL || env.BASE_MAINNET_RPC_URL || "http://127.0.0.1:8545",
    updaterPrivateKey: env.UPDATER_PRIVATE_KEY || env.DEPLOYER_PRIVATE_KEY || "",
    trustScoreAddress: env.TRUST_SCORE_ADDRESS || "",
    reputationRegistryAddress,
    checkpointPath: env.CHECKPOINT_FILE || DEFAULT_CHECKPOINT_PATH,
    startBlock: toNonNegativeInt(env.INDEXER_START_BLOCK, 0),
    maxBatchSize: toPositiveInt(env.MAX_BATCH_SIZE, DEFAULT_MAX_BATCH_SIZE),
    pollIntervalMs: toPositiveInt(env.INDEXER_POLL_INTERVAL_MS, DEFAULT_POLL_INTERVAL_MS),
    backoffStartMs: toPositiveInt(env.RPC_BACKOFF_START_MS, DEFAULT_BACKOFF_START_MS),
    backoffMaxMs: toPositiveInt(env.RPC_BACKOFF_MAX_MS, DEFAULT_BACKOFF_MAX_MS),
    scoringConfig: loadScoringConfigFromEnv(env),
  };
}

function resolveRuntimeConfig(inputConfig = {}) {
  const base = buildIndexerConfigFromEnv(process.env);
  const config = {
    ...base,
    ...inputConfig,
  };

  if (!config.provider) {
    config.provider = new ethers.JsonRpcProvider(config.rpcUrl);
  }

  if (!config.updaterSigner) {
    if (!config.updaterPrivateKey) {
      throw new Error("Missing updater signer configuration (UPDATER_PRIVATE_KEY or updaterSigner)");
    }
    config.updaterSigner = new ethers.Wallet(config.updaterPrivateKey, config.provider);
  }

  if (!config.trustScoreAddress) {
    throw new Error("Missing trustScoreAddress / TRUST_SCORE_ADDRESS");
  }
  if (!config.reputationRegistryAddress) {
    throw new Error("Missing reputationRegistryAddress / REPUTATION_REGISTRY_ADDRESS");
  }

  config.scoringConfig = normalizeConfig(config.scoringConfig || {});
  config.maxBatchSize = toPositiveInt(config.maxBatchSize, DEFAULT_MAX_BATCH_SIZE);
  config.pollIntervalMs = toPositiveInt(config.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS);
  config.backoffStartMs = toPositiveInt(config.backoffStartMs, DEFAULT_BACKOFF_START_MS);
  config.backoffMaxMs = toPositiveInt(config.backoffMaxMs, DEFAULT_BACKOFF_MAX_MS);
  config.startBlock = toNonNegativeInt(config.startBlock, 0);
  config.checkpointPath = config.checkpointPath || DEFAULT_CHECKPOINT_PATH;

  return config;
}

function feedbackDedupKey(log) {
  const args = log.args || {};
  return [
    normalizeAgentIdString(args.agentId) || "",
    String(args.clientAddress || ""),
    String(args.feedbackIndex || ""),
    String(args.value || ""),
    String(args.valueDecimals || ""),
    String(args.tag1 || ""),
    String(args.tag2 || ""),
    String(args.endpoint || ""),
    String(args.feedbackURI || ""),
    String(args.feedbackHash || ""),
    String(log.blockNumber || ""),
    String(log.transactionHash || ""),
  ].join("|");
}

function sortLogs(logs) {
  return [...logs].sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) {
      return Number(a.blockNumber) - Number(b.blockNumber);
    }
    return Number(a.index || 0) - Number(b.index || 0);
  });
}

function dedupeLogs(logs) {
  const seen = new Set();
  const deduped = [];
  for (const log of logs) {
    const key = feedbackDedupKey(log);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(log);
  }
  return sortLogs(deduped);
}

async function queryFeedbackLogs(reputationRegistry, fromBlock, toBlock, rpcCall) {
  if (fromBlock > toBlock) {
    return [];
  }

  const logs = [];
  const filters = [
    reputationRegistry.filters.FeedbackPosted(),
    reputationRegistry.filters.NewFeedback(),
  ];

  for (const filter of filters) {
    const filteredLogs = await rpcCall(
      () => reputationRegistry.queryFilter(filter, fromBlock, toBlock),
      "query feedback logs"
    );
    logs.push(...filteredLogs);
  }

  return dedupeLogs(logs);
}

async function queryFeedbackLogsForAgent(reputationRegistry, agentId, fromBlock, toBlock, rpcCall) {
  if (fromBlock > toBlock) {
    return [];
  }

  const logs = [];
  const filters = [
    reputationRegistry.filters.FeedbackPosted(agentId, null, null),
    reputationRegistry.filters.NewFeedback(agentId, null, null),
  ];

  for (const filter of filters) {
    const filteredLogs = await rpcCall(
      () => reputationRegistry.queryFilter(filter, fromBlock, toBlock),
      `query feedback logs for agent ${agentId.toString()}`
    );
    logs.push(...filteredLogs);
  }

  return dedupeLogs(logs);
}

async function collectFeedbackForAgent({
  reputationRegistry,
  provider,
  agentId,
  fromBlock,
  toBlock,
  rpcCall,
  blockTimestampCache,
}) {
  const logs = await queryFeedbackLogsForAgent(reputationRegistry, agentId, fromBlock, toBlock, rpcCall);
  const feedback = [];

  for (const log of logs) {
    const blockNumber = Number(log.blockNumber);
    if (!blockTimestampCache.has(blockNumber)) {
      const block = await rpcCall(() => provider.getBlock(blockNumber), `get block ${blockNumber}`);
      if (!block) {
        throw new Error(`Missing block ${blockNumber} while processing feedback logs`);
      }
      blockTimestampCache.set(blockNumber, Number(block.timestamp) * 1000);
    }

    const value = BigInt(log.args.value);
    feedback.push({
      isPositive: value > 0n,
      timestamp: blockTimestampCache.get(blockNumber),
    });
  }

  return feedback;
}

async function runIndexerCycle(configOverrides = {}, options = {}) {
  const config = resolveRuntimeConfig(configOverrides);
  const nowMs = options.nowMsOverride || Date.now();

  const rpcCall = (operation, label) =>
    withExponentialBackoff(operation, {
      initialDelayMs: config.backoffStartMs,
      maxDelayMs: config.backoffMaxMs,
      isRetryable: isRpcError,
      onRetry: ({ attempts, delayMs, error }) => {
        console.warn(
          `[indexer] RPC retry for ${label} (attempt ${attempts}, waiting ${delayMs}ms): ${error.message}`
        );
      },
    });

  const reputationRegistry = new ethers.Contract(
    config.reputationRegistryAddress,
    REPUTATION_REGISTRY_ABI,
    config.provider
  );
  const trustScore = new ethers.Contract(config.trustScoreAddress, TRUST_SCORE_ABI, config.updaterSigner);

  const checkpoint = await loadCheckpoint(config.checkpointPath);
  const baselineLastProcessed = checkpoint.lastProcessedBlock ?? Math.max(config.startBlock - 1, 0);
  const fromBlock = baselineLastProcessed + 1;
  const latestBlock = await rpcCall(() => config.provider.getBlockNumber(), "get latest block");

  const newlyObservedLogs =
    fromBlock <= latestBlock ? await queryFeedbackLogs(reputationRegistry, fromBlock, latestBlock, rpcCall) : [];

  const dirtyAgentIds = new Set(checkpoint.pendingAgentIds);
  for (const log of newlyObservedLogs) {
    const normalized = normalizeAgentIdString(log.args.agentId);
    if (normalized) {
      dirtyAgentIds.add(normalized);
    }
  }

  const sortedDirtyAgents = Array.from(dirtyAgentIds, (id) => BigInt(id)).sort((a, b) => (a < b ? -1 : 1));
  const agentsToProcess = sortedDirtyAgents.slice(0, config.maxBatchSize);
  const queuedAgentIds = sortedDirtyAgents.slice(config.maxBatchSize).map((id) => id.toString());

  const agentIds = [];
  const scores = [];
  const totals = [];
  const positives = [];
  const blockTimestampCache = new Map();

  for (const agentId of agentsToProcess) {
    const feedbackEntries = await collectFeedbackForAgent({
      reputationRegistry,
      provider: config.provider,
      agentId,
      fromBlock: config.startBlock,
      toBlock: latestBlock,
      rpcCall,
      blockTimestampCache,
    });

    const details = scoreFeedbackDetailed(feedbackEntries, config.scoringConfig, nowMs);

    agentIds.push(agentId);
    scores.push(BigInt(details.score));
    totals.push(BigInt(details.totalFeedback));
    positives.push(BigInt(details.positiveFeedback));
  }

  const txHashes = [];
  if (agentIds.length > 0) {
    const tx = await rpcCall(
      () => trustScore.batchUpdateScores(agentIds, scores, totals, positives),
      "submit batchUpdateScores"
    );
    txHashes.push(tx.hash);
    console.log(`[indexer] batch update tx hash: ${tx.hash} (agents=${agentIds.length})`);
    await rpcCall(() => tx.wait(), "wait batchUpdateScores receipt");
  }

  await saveCheckpoint(config.checkpointPath, {
    lastProcessedBlock: latestBlock,
    pendingAgentIds: queuedAgentIds,
  });

  return {
    fromBlock,
    latestBlock,
    newEventCount: newlyObservedLogs.length,
    dirtyAgentCount: sortedDirtyAgents.length,
    processedAgentCount: agentIds.length,
    queuedAgentCount: queuedAgentIds.length,
    processedAgentIds: agentIds.map((id) => id.toString()),
    queuedAgentIds,
    txHashes,
  };
}

async function startIndexer(configOverrides = {}) {
  const config = resolveRuntimeConfig(configOverrides);
  console.log(
    `[indexer] started poll loop (interval=${config.pollIntervalMs}ms, checkpoint=${config.checkpointPath})`
  );

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const result = await runIndexerCycle(config);
      console.log(
        `[indexer] cycle complete: newEvents=${result.newEventCount}, processedAgents=${result.processedAgentCount}, queuedAgents=${result.queuedAgentCount}`
      );
    } catch (error) {
      console.error(`[indexer] cycle failed: ${error.stack || error.message}`);
    }

    await sleep(config.pollIntervalMs);
  }
}

module.exports = {
  REPUTATION_REGISTRY_ABI,
  TRUST_SCORE_ABI,
  DEFAULT_CHECKPOINT_PATH,
  buildIndexerConfigFromEnv,
  loadCheckpoint,
  saveCheckpoint,
  isRpcError,
  withExponentialBackoff,
  runIndexerCycle,
  startIndexer,
};

if (require.main === module) {
  startIndexer().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
