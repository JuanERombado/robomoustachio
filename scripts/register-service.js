const hre = require("hardhat");

const IDENTITY_REGISTRY_ABI = [
  "function register(string agentURI) returns (uint256)",
  "event AgentRegistered(uint256 indexed agentId,address indexed owner,string agentURI)",
];

async function main() {
  const [signer] = await hre.ethers.getSigners();
  if (!signer) {
    throw new Error("No signer available. Configure DEPLOYER_PRIVATE_KEY/UPDATER_PRIVATE_KEY");
  }

  const identityRegistryAddress = process.env.IDENTITY_REGISTRY_ADDRESS;
  if (!identityRegistryAddress) {
    throw new Error("IDENTITY_REGISTRY_ADDRESS is required");
  }

  const code = await hre.ethers.provider.getCode(identityRegistryAddress);
  if (!code || code === "0x") {
    throw new Error(
      `No contract code at IDENTITY_REGISTRY_ADDRESS=${identityRegistryAddress}. If ERC-8004 Identity Registry is not yet deployed on this network, rerun when address is available.`
    );
  }

  const port = Number(process.env.PORT || "3000");
  const publicBaseUrl = process.env.PUBLIC_BASE_URL || `http://localhost:${port}`;
  const agentURI = process.env.AGENT_REGISTRATION_URI || `${publicBaseUrl}/discover`;

  const identityRegistry = new hre.ethers.Contract(identityRegistryAddress, IDENTITY_REGISTRY_ABI, signer);

  const tx = await identityRegistry["register(string)"](agentURI);
  const receipt = await tx.wait();

  let agentId = null;
  for (const log of receipt.logs || []) {
    try {
      const parsed = identityRegistry.interface.parseLog(log);
      if (parsed && parsed.name === "AgentRegistered") {
        agentId = parsed.args.agentId.toString();
      }
    } catch {
      // ignore unrelated logs
    }
  }

  console.log("Service registration tx hash:", tx.hash);
  console.log("identityRegistry:", identityRegistryAddress);
  console.log("agentURI:", agentURI);
  console.log("agentId:", agentId || "not parsed (check explorer logs)");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
