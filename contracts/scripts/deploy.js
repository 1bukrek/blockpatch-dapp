import hre from "hardhat";
import { ethers as ethersUtils } from "ethers";

const signerAddress = process.env.BACKEND_SIGNER_ADDRESS;
const maximumReward = process.env.MAX_REWARD_WEI || "1000000000000000";
const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY;

async function main() {
  if (!deployerPrivateKey || !/^0x[0-9a-fA-F]{64}$/.test(deployerPrivateKey)) {
    throw new Error(
      "Set DEPLOYER_PRIVATE_KEY to a 0x-prefixed, 64-character hex key for a funded Monad Testnet wallet.",
    );
  }
  if (!ethersUtils.isAddress(signerAddress) || signerAddress === ethersUtils.ZeroAddress) {
    throw new Error("Set BACKEND_SIGNER_ADDRESS to the backend signing wallet.");
  }
  if (BigInt(maximumReward) <= 0n) {
    throw new Error("MAX_REWARD_WEI must be positive.");
  }

  const { ethers } = await hre.network.create();
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== 10143n) {
    throw new Error(`Refusing deployment to chain ${network.chainId}; Monad Testnet is 10143.`);
  }

  const contract = await ethers.deployContract("BountyShield", [signerAddress, maximumReward]);
  await contract.waitForDeployment();
  console.log(`BountyShield deployed to ${await contract.getAddress()}`);
  console.log(`Backend signer: ${ethers.getAddress(signerAddress)}`);
  console.log(`Maximum reward: ${maximumReward} wei`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
