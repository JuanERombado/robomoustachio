const hre = require("hardhat");

const TRUST_SCORE_ABI = [
  "function updater() view returns (address)",
  "function batchUpdateScores(uint256[] agentIds,uint256[] scores,uint256[] totals,uint256[] positives) external",
  "function getDetailedReport(uint256 agentId) view returns (tuple(uint256 score,uint256 totalFeedback,uint256 positiveFeedback,uint256 lastUpdated,bool exists))",
];

const IDENTITY_REGISTRY_ABI = ["function ownerOf(uint256 tokenId) view returns (address)"];

const SEED_DATA = [
  { agentId: 2n, score: 950n, totalFeedback: 100n, positiveFeedback: 98n, label: "excellent reputation" },
  { agentId: 3n, score: 400n, totalFeedback: 20n, positiveFeedback: 8n, label: "sketchy" },
  { agentId: 4n, score: 700n, totalFeedback: 50n, positiveFeedback: 35n, label: "decent but flagged" },
  { agentId: 5n, score: 100n, totalFeedback: 5n, positiveFeedback: 0n, label: "avoid at all costs" },
  { agentId: 6n, score: 0n, totalFeedback: 0n, positiveFeedback: 0n, label: "brand new, no history" },
];

function normalizeHexKey(value) {
  const normalized = String(value || "").trim().replace(/^0x/i, "");
  return normalized ? `0x${normalized}` : "";
}

async function main() {
  const trustScoreAddress = process.env.TRUST_SCORE_ADDRESS;
  const identityRegistryAddress = process.env.IDENTITY_REGISTRY_ADDRESS;
  const updaterPrivateKey = normalizeHexKey(process.env.UPDATER_PRIVATE_KEY);

  if (!trustScoreAddress) {
    throw new Error("TRUST_SCORE_ADDRESS is required");
  }
  if (!identityRegistryAddress) {
    throw new Error("IDENTITY_REGISTRY_ADDRESS is required");
  }
  if (!updaterPrivateKey) {
    throw new Error("UPDATER_PRIVATE_KEY is required");
  }

  const provider = hre.ethers.provider;
  const updaterSigner = new hre.ethers.Wallet(updaterPrivateKey, provider);

  const trustScore = new hre.ethers.Contract(trustScoreAddress, TRUST_SCORE_ABI, updaterSigner);
  const identityRegistry = new hre.ethers.Contract(identityRegistryAddress, IDENTITY_REGISTRY_ABI, provider);

  const configuredUpdater = await trustScore.updater();
  if (configuredUpdater.toLowerCase() !== updaterSigner.address.toLowerCase()) {
    throw new Error(
      `Signer ${updaterSigner.address} is not the configured updater (${configuredUpdater}). Run setUpdater first.`
    );
  }

  for (const row of SEED_DATA) {
    const owner = await identityRegistry.ownerOf(row.agentId);
    if (!owner || owner === hre.ethers.ZeroAddress) {
      throw new Error(`Agent ${row.agentId.toString()} is not registered in identity registry`);
    }
  }

  const agentIds = SEED_DATA.map((row) => row.agentId);
  const scores = SEED_DATA.map((row) => row.score);
  const totals = SEED_DATA.map((row) => row.totalFeedback);
  const positives = SEED_DATA.map((row) => row.positiveFeedback);

  const tx = await trustScore.batchUpdateScores(agentIds, scores, totals, positives);
  const receipt = await tx.wait();

  console.log("Seed batch tx hash:", tx.hash);
  console.log("Seed batch block:", receipt.blockNumber);
  console.log("Seeded agents:", agentIds.map(String).join(", "));

  for (const row of SEED_DATA) {
    const report = await trustScore.getDetailedReport(row.agentId);
    console.log(
      [
        `agentId=${row.agentId.toString()}`,
        `score=${report.score.toString()}`,
        `totalFeedback=${report.totalFeedback.toString()}`,
        `positiveFeedback=${report.positiveFeedback.toString()}`,
        `exists=${report.exists}`,
        `lastUpdated=${report.lastUpdated.toString()}`,
        `note=${row.label}`,
      ].join(" ")
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
