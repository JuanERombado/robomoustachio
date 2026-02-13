const fs = require("node:fs");
const path = require("node:path");

const hre = require("hardhat");

function isTrue(value) {
  return String(value || "").toLowerCase() === "true";
}

function upsertEnvValue(filePath, key, value) {
  const line = `${key}=${value}`;
  let content = "";
  if (fs.existsSync(filePath)) {
    content = fs.readFileSync(filePath, "utf8");
  }

  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(content)) {
    content = content.replace(pattern, line);
  } else {
    if (content.length > 0 && !content.endsWith("\n")) {
      content += "\n";
    }
    content += `${line}\n`;
  }

  fs.writeFileSync(filePath, content, "utf8");
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) {
    throw new Error("No deployer account available. Configure DEPLOYER_PRIVATE_KEY in .env");
  }

  let nonce = await hre.ethers.provider.getTransactionCount(deployer.address, "pending");

  const MockIdentityRegistry = await hre.ethers.getContractFactory("MockIdentityRegistry");
  const identityRegistry = await MockIdentityRegistry.connect(deployer).deploy({ nonce });
  await identityRegistry.waitForDeployment();
  nonce += 1;

  const identityRegistryAddress = await identityRegistry.getAddress();
  console.log("MockIdentityRegistry deployed to:", identityRegistryAddress);

  const trustScoreAddress = process.env.TRUST_SCORE_ADDRESS || "";
  if (trustScoreAddress && isTrue(process.env.UPDATE_TRUSTSCORE_IDENTITY || "true")) {
    const trustScore = await hre.ethers.getContractAt("TrustScore", trustScoreAddress, deployer);
    const tx = await trustScore.setIdentityRegistry(identityRegistryAddress, { nonce });
    await tx.wait();
    console.log("Updated TrustScore identity registry:");
    console.log("  trustScore:", trustScoreAddress);
    console.log("  tx:", tx.hash);
  } else {
    console.log("Skipped TrustScore identity registry update (missing TRUST_SCORE_ADDRESS or toggle disabled)");
  }

  const networkName = hre.network.name;
  const deployment = {
    network: networkName,
    chainId: Number((await hre.ethers.provider.getNetwork()).chainId),
    deployer: deployer.address,
    identityRegistryAddress,
    trustScoreAddress: trustScoreAddress || null,
    updatedTrustScoreIdentity: Boolean(trustScoreAddress && isTrue(process.env.UPDATE_TRUSTSCORE_IDENTITY || "true")),
    deployedAt: new Date().toISOString(),
  };

  const deploymentsDir = path.join(process.cwd(), "deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });
  const outPath = path.join(deploymentsDir, `${networkName}-mock-identity.json`);
  fs.writeFileSync(outPath, `${JSON.stringify(deployment, null, 2)}\n`, "utf8");

  const envPath = path.join(process.cwd(), ".env");
  upsertEnvValue(envPath, "IDENTITY_REGISTRY_ADDRESS", identityRegistryAddress);
  upsertEnvValue(envPath, "USE_MOCK_REGISTRY", "true");

  console.log("deployment file:", outPath);
  console.log(`IDENTITY_REGISTRY_ADDRESS=${identityRegistryAddress}`);
  console.log("Updated .env to use mock identity registry");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
