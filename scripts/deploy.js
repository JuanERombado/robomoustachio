const fs = require("node:fs");
const path = require("node:path");

const hre = require("hardhat");

function isTrue(value) {
  return String(value || "").toLowerCase() === "true";
}

function parseBigInt(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return BigInt(value);
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

  const owner = process.env.DEPLOYER_ADDRESS || deployer.address;
  const updater = process.env.UPDATER_ADDRESS || owner;
  const useMockRegistry = isTrue(process.env.USE_MOCK_REGISTRY);
  const queryFeeWei = parseBigInt(process.env.QUERY_FEE_WEI, hre.ethers.parseEther("0.0001"));
  let nextNonce = await hre.ethers.provider.getTransactionCount(deployer.address, "pending");

  let identityRegistryAddress = process.env.IDENTITY_REGISTRY_ADDRESS;

  if (!identityRegistryAddress && useMockRegistry) {
    const MockIdentityRegistry = await hre.ethers.getContractFactory("MockIdentityRegistry");
    const mockIdentityRegistry = await MockIdentityRegistry.connect(deployer).deploy({
      nonce: nextNonce,
    });
    await mockIdentityRegistry.waitForDeployment();
    nextNonce += 1;
    identityRegistryAddress = await mockIdentityRegistry.getAddress();
    console.log("MockIdentityRegistry deployed to:", identityRegistryAddress);
  }

  if (!identityRegistryAddress) {
    throw new Error("IDENTITY_REGISTRY_ADDRESS is required (or set USE_MOCK_REGISTRY=true)");
  }

  const TrustScore = await hre.ethers.getContractFactory("TrustScore");
  const trustScore = await TrustScore.connect(deployer).deploy(owner, identityRegistryAddress, updater, queryFeeWei, {
    nonce: nextNonce,
  });

  await trustScore.waitForDeployment();
  const trustScoreAddress = await trustScore.getAddress();

  const networkName = hre.network.name;
  const deployment = {
    network: networkName,
    chainId: Number((await hre.ethers.provider.getNetwork()).chainId),
    deployer: deployer.address,
    owner,
    updater,
    identityRegistryAddress,
    trustScoreAddress,
    queryFeeWei: queryFeeWei.toString(),
    useMockRegistry,
    deployedAt: new Date().toISOString(),
  };

  const deploymentsDir = path.join(process.cwd(), "deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });
  const outPath = path.join(deploymentsDir, `${networkName}-trustscore.json`);
  fs.writeFileSync(outPath, `${JSON.stringify(deployment, null, 2)}\n`, "utf8");

  console.log("TrustScore deployed to:", trustScoreAddress);
  console.log("owner:", owner);
  console.log("updater:", updater);
  console.log("identityRegistry:", identityRegistryAddress);
  console.log("queryFeeWei:", queryFeeWei.toString());
  console.log("deployment file:", outPath);
  console.log(`TRUST_SCORE_ADDRESS=${trustScoreAddress}`);
  console.log(`IDENTITY_REGISTRY_ADDRESS=${identityRegistryAddress}`);
  console.log(`DEPLOYER_ADDRESS=${owner}`);
  console.log(`UPDATER_ADDRESS=${updater}`);

  const envPath = path.join(process.cwd(), ".env");
  const rpcUrlForEnv =
    networkName === "baseMainnet"
      ? process.env.BASE_MAINNET_RPC_URL || "https://mainnet.base.org"
      : process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";

  if (networkName === "baseMainnet") {
    upsertEnvValue(envPath, "BASE_MAINNET_RPC_URL", rpcUrlForEnv);
  } else if (networkName === "baseSepolia") {
    upsertEnvValue(envPath, "BASE_SEPOLIA_RPC_URL", rpcUrlForEnv);
  }

  upsertEnvValue(envPath, "API_RPC_URL", rpcUrlForEnv);
  upsertEnvValue(envPath, "TRUST_SCORE_ADDRESS", trustScoreAddress);
  upsertEnvValue(envPath, "IDENTITY_REGISTRY_ADDRESS", identityRegistryAddress);
  upsertEnvValue(envPath, "DEPLOYER_ADDRESS", owner);
  upsertEnvValue(envPath, "UPDATER_ADDRESS", updater);
  console.log(`Updated .env with deployment addresses and ${networkName} RPC URL`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
