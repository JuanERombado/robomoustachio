const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { expect } = require("chai");
const { ethers } = require("hardhat");

const { scoreFeedbackDetailed } = require("../server/scoring");
const { loadCheckpoint, runIndexerCycle } = require("../server/indexer");

describe("Indexer integration", function () {
  it("updates TrustScore from mock feedback events and persists checkpoint", async function () {
    const [owner, updater, clientA, clientB] = await ethers.getSigners();

    const MockReputationRegistry = await ethers.getContractFactory("MockReputationRegistry");
    const registry = await MockReputationRegistry.deploy();
    await registry.waitForDeployment();

    await registry.setAgentOwner(1n, owner.address);
    await registry.setAgentOwner(2n, owner.address);

    const TrustScore = await ethers.getContractFactory("TrustScore");
    const trustScore = await TrustScore.deploy(owner.address, await registry.getAddress(), updater.address, 0n);
    await trustScore.waitForDeployment();

    const daySeconds = 24 * 60 * 60;
    const latestBlock = await ethers.provider.getBlock("latest");
    const baseTimestamp = Number(latestBlock.timestamp) + 10;
    const nowMsOverride = (baseTimestamp + 80 * daySeconds) * 1000;

    const expectedFeedbackByAgent = {
      1: [],
      2: [],
    };

    async function emitFeedback({ agentId, isPositive, timestamp, client }) {
      await ethers.provider.send("evm_setNextBlockTimestamp", [timestamp]);
      await registry.connect(client).postFeedback(BigInt(agentId), {
        value: isPositive ? 100n : -100n,
        valueDecimals: 0,
        tag1: "quality",
        tag2: "execution",
        endpoint: "https://agent.example",
        feedbackURI: "ipfs://feedback",
        feedbackHash: ethers.ZeroHash,
      });
      expectedFeedbackByAgent[agentId].push({
        isPositive,
        timestamp: timestamp * 1000,
      });
    }

    await emitFeedback({
      agentId: 1,
      isPositive: true,
      timestamp: baseTimestamp + 10 * daySeconds,
      client: clientA,
    });
    await emitFeedback({
      agentId: 1,
      isPositive: false,
      timestamp: baseTimestamp + 74 * daySeconds,
      client: clientA,
    });
    await emitFeedback({
      agentId: 2,
      isPositive: true,
      timestamp: baseTimestamp + 75 * daySeconds,
      client: clientB,
    });
    await emitFeedback({
      agentId: 1,
      isPositive: true,
      timestamp: baseTimestamp + 77 * daySeconds,
      client: clientA,
    });
    await emitFeedback({
      agentId: 2,
      isPositive: true,
      timestamp: baseTimestamp + 79 * daySeconds,
      client: clientA,
    });

    const scoringConfig = {
      decayWindowDays: 30,
      recentFeedbackWeight: 2,
      olderFeedbackWeight: 1,
      confidenceThresholdFeedbackCount: 50,
      confidenceMultiplier: 1.05,
      negativeFlagThresholdBps: 2000,
      recentNegativeWindowDays: 7,
      flaggedScoreMultiplier: 0.9,
      maxScore: 1000,
    };

    const checkpointDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-trust-indexer-"));
    const checkpointPath = path.join(checkpointDir, "checkpoint.json");

    try {
      const cycleResult = await runIndexerCycle(
        {
          provider: ethers.provider,
          updaterSigner: updater,
          trustScoreAddress: await trustScore.getAddress(),
          reputationRegistryAddress: await registry.getAddress(),
          checkpointPath,
          startBlock: 0,
          maxBatchSize: 100,
          scoringConfig,
          backoffStartMs: 1,
          backoffMaxMs: 10,
        },
        { nowMsOverride }
      );

      expect(cycleResult.processedAgentCount).to.equal(2);
      expect(cycleResult.queuedAgentCount).to.equal(0);
      expect(cycleResult.txHashes).to.have.length(1);

      const expectedOne = scoreFeedbackDetailed(expectedFeedbackByAgent[1], scoringConfig, nowMsOverride);
      const expectedTwo = scoreFeedbackDetailed(expectedFeedbackByAgent[2], scoringConfig, nowMsOverride);

      const onChainOne = await trustScore.getDetailedReport(1n);
      expect(onChainOne.score).to.equal(BigInt(expectedOne.score));
      expect(onChainOne.totalFeedback).to.equal(BigInt(expectedOne.totalFeedback));
      expect(onChainOne.positiveFeedback).to.equal(BigInt(expectedOne.positiveFeedback));

      const onChainTwo = await trustScore.getDetailedReport(2n);
      expect(onChainTwo.score).to.equal(BigInt(expectedTwo.score));
      expect(onChainTwo.totalFeedback).to.equal(BigInt(expectedTwo.totalFeedback));
      expect(onChainTwo.positiveFeedback).to.equal(BigInt(expectedTwo.positiveFeedback));

      const checkpoint = await loadCheckpoint(checkpointPath);
      expect(checkpoint.pendingAgentIds).to.deep.equal([]);
      expect(checkpoint.lastProcessedBlock).to.equal(cycleResult.latestBlock);

      const secondCycle = await runIndexerCycle(
        {
          provider: ethers.provider,
          updaterSigner: updater,
          trustScoreAddress: await trustScore.getAddress(),
          reputationRegistryAddress: await registry.getAddress(),
          checkpointPath,
          startBlock: 0,
          maxBatchSize: 100,
          scoringConfig,
          backoffStartMs: 1,
          backoffMaxMs: 10,
        },
        { nowMsOverride }
      );

      expect(secondCycle.processedAgentCount).to.equal(0);
      expect(secondCycle.txHashes).to.deep.equal([]);
    } finally {
      fs.rmSync(checkpointDir, { recursive: true, force: true });
    }
  });

  it("queues overflow agent updates when maxBatchSize is exceeded", async function () {
    const [owner, updater, clientA, clientB] = await ethers.getSigners();

    const MockReputationRegistry = await ethers.getContractFactory("MockReputationRegistry");
    const registry = await MockReputationRegistry.deploy();
    await registry.waitForDeployment();

    await registry.setAgentOwner(10n, owner.address);
    await registry.setAgentOwner(11n, owner.address);

    const TrustScore = await ethers.getContractFactory("TrustScore");
    const trustScore = await TrustScore.deploy(owner.address, await registry.getAddress(), updater.address, 0n);
    await trustScore.waitForDeployment();

    const latestBlock = await ethers.provider.getBlock("latest");
    const t1 = Number(latestBlock.timestamp) + 10;
    const t2 = t1 + 10;

    await ethers.provider.send("evm_setNextBlockTimestamp", [t1]);
    await registry.connect(clientA).postFeedback(10n, {
      value: 100n,
      valueDecimals: 0,
      tag1: "quality",
      tag2: "execution",
      endpoint: "https://agent.example",
      feedbackURI: "ipfs://feedback-1",
      feedbackHash: ethers.ZeroHash,
    });

    await ethers.provider.send("evm_setNextBlockTimestamp", [t2]);
    await registry.connect(clientB).postFeedback(11n, {
      value: -100n,
      valueDecimals: 0,
      tag1: "quality",
      tag2: "execution",
      endpoint: "https://agent.example",
      feedbackURI: "ipfs://feedback-2",
      feedbackHash: ethers.ZeroHash,
    });

    const scoringConfig = {
      decayWindowDays: 30,
      recentFeedbackWeight: 2,
      olderFeedbackWeight: 1,
      confidenceThresholdFeedbackCount: 50,
      confidenceMultiplier: 1.05,
      negativeFlagThresholdBps: 2000,
      recentNegativeWindowDays: 7,
      flaggedScoreMultiplier: 0.9,
      maxScore: 1000,
    };

    const checkpointDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-trust-indexer-queue-"));
    const checkpointPath = path.join(checkpointDir, "checkpoint.json");

    try {
      const firstCycle = await runIndexerCycle({
        provider: ethers.provider,
        updaterSigner: updater,
        trustScoreAddress: await trustScore.getAddress(),
        reputationRegistryAddress: await registry.getAddress(),
        checkpointPath,
        startBlock: 0,
        maxBatchSize: 1,
        scoringConfig,
        backoffStartMs: 1,
        backoffMaxMs: 10,
      });

      expect(firstCycle.processedAgentCount).to.equal(1);
      expect(firstCycle.queuedAgentCount).to.equal(1);
      expect(firstCycle.txHashes).to.have.length(1);

      const afterFirst = await loadCheckpoint(checkpointPath);
      expect(afterFirst.pendingAgentIds).to.have.length(1);

      const secondCycle = await runIndexerCycle({
        provider: ethers.provider,
        updaterSigner: updater,
        trustScoreAddress: await trustScore.getAddress(),
        reputationRegistryAddress: await registry.getAddress(),
        checkpointPath,
        startBlock: 0,
        maxBatchSize: 1,
        scoringConfig,
        backoffStartMs: 1,
        backoffMaxMs: 10,
      });

      expect(secondCycle.processedAgentCount).to.equal(1);
      expect(secondCycle.queuedAgentCount).to.equal(0);
      expect(secondCycle.txHashes).to.have.length(1);
    } finally {
      fs.rmSync(checkpointDir, { recursive: true, force: true });
    }
  });
});
