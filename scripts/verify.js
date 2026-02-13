const fs = require("node:fs");
const path = require("node:path");

const hre = require("hardhat");

function parseBigInt(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return BigInt(value);
}

function loadDeploymentFile() {
  const filePath = path.join(process.cwd(), "deployments", `${hre.network.name}-trustscore.json`);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return { filePath, data };
}

async function main() {
  const deployment = loadDeploymentFile();
  const contractAddress = process.env.TRUST_SCORE_ADDRESS || deployment?.data?.trustScoreAddress;
  const owner = process.env.DEPLOYER_ADDRESS || deployment?.data?.owner;
  const updater = process.env.UPDATER_ADDRESS || deployment?.data?.updater || owner;
  const identityRegistry = process.env.IDENTITY_REGISTRY_ADDRESS || deployment?.data?.identityRegistryAddress;
  const queryFeeWei = parseBigInt(
    process.env.QUERY_FEE_WEI || deployment?.data?.queryFeeWei,
    hre.ethers.parseEther("0.0001")
  );

  if (!contractAddress || !owner || !identityRegistry) {
    throw new Error(
      "TRUST_SCORE_ADDRESS, DEPLOYER_ADDRESS, and IDENTITY_REGISTRY_ADDRESS are required"
    );
  }

  if (!process.env.BASESCAN_API_KEY) {
    throw new Error("BASESCAN_API_KEY is required for verification");
  }

  await hre.run("verify:verify", {
    address: contractAddress,
    constructorArguments: [owner, identityRegistry, updater, queryFeeWei],
  });

  if (deployment?.filePath) {
    console.log("verification used deployment file:", deployment.filePath);
  }
  console.log("Verified contract:", contractAddress);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
