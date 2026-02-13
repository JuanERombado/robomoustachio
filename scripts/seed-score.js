const hre = require("hardhat");

function parseBigInt(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return BigInt(value);
}

async function tryRegisterAgent(identityRegistryAddress, signer, agentId, startingNonce) {
  let nextNonce = startingNonce;
  if (!identityRegistryAddress) {
    return { attempted: false, updated: false, nextNonce };
  }

  const identityAbi = [
    "function setOwner(uint256 tokenId,address owner) external",
    "function setAgentOwner(uint256 agentId,address owner) external",
    "function ownerOf(uint256 tokenId) view returns (address)",
  ];

  const identity = new hre.ethers.Contract(identityRegistryAddress, identityAbi, signer);

  try {
    const owner = await identity.ownerOf(agentId);
    if (owner && owner !== hre.ethers.ZeroAddress) {
      return { attempted: true, updated: false, owner, nextNonce };
    }
  } catch {
    // Continue to try mock setter methods.
  }

  try {
    const tx = await identity.setOwner(agentId, signer.address, { nonce: nextNonce });
    await tx.wait();
    nextNonce += 1;
    return { attempted: true, updated: true, method: "setOwner", nextNonce };
  } catch {
    // continue
  }

  try {
    const tx = await identity.setAgentOwner(agentId, signer.address, { nonce: nextNonce });
    await tx.wait();
    nextNonce += 1;
    return { attempted: true, updated: true, method: "setAgentOwner", nextNonce };
  } catch {
    return { attempted: true, updated: false, nextNonce };
  }
}

async function main() {
  const [signer] = await hre.ethers.getSigners();
  if (!signer) {
    throw new Error("No signer available. Configure DEPLOYER_PRIVATE_KEY/UPDATER_PRIVATE_KEY");
  }

  const trustScoreAddress = process.env.TRUST_SCORE_ADDRESS;
  if (!trustScoreAddress) {
    throw new Error("TRUST_SCORE_ADDRESS is required");
  }

  const agentId = parseBigInt(process.env.TEST_AGENT_ID, 1n);
  const score = parseBigInt(process.env.SEED_SCORE, 800n);
  const totalFeedback = parseBigInt(process.env.SEED_TOTAL_FEEDBACK, 10n);
  const positiveFeedback = parseBigInt(process.env.SEED_POSITIVE_FEEDBACK, 8n);

  const trustScoreAbi = [
    "function updateScore(uint256 agentId,uint256 newScore,uint256 totalFb,uint256 posFb) external",
    "function getDetailedReport(uint256 agentId) view returns (tuple(uint256 score,uint256 totalFeedback,uint256 positiveFeedback,uint256 lastUpdated,bool exists))",
  ];

  const trustScore = new hre.ethers.Contract(trustScoreAddress, trustScoreAbi, signer);

  let nextNonce = await hre.ethers.provider.getTransactionCount(signer.address, "pending");
  const registration = await tryRegisterAgent(process.env.IDENTITY_REGISTRY_ADDRESS, signer, agentId, nextNonce);
  nextNonce = registration.nextNonce;
  if (registration.attempted && registration.updated) {
    console.log("Agent registration updated in identity registry via", registration.method);
  } else if (registration.attempted) {
    console.log("Identity registry not writable by this signer; proceeding with score update attempt");
  }

  const tx = await trustScore.updateScore(agentId, score, totalFeedback, positiveFeedback, {
    nonce: nextNonce,
  });
  await tx.wait();

  const report = await trustScore.getDetailedReport(agentId);
  console.log("Seeded score tx hash:", tx.hash);
  console.log("agentId:", agentId.toString());
  console.log("score:", report.score.toString());
  console.log("totalFeedback:", report.totalFeedback.toString());
  console.log("positiveFeedback:", report.positiveFeedback.toString());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
