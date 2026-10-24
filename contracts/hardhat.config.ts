import { createRequire } from "node:module";
import { defineConfig } from "hardhat/config";
import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatEthersChaiMatchers from "@nomicfoundation/hardhat-ethers-chai-matchers";
import hardhatMocha from "@nomicfoundation/hardhat-mocha";

const require = createRequire(import.meta.url);
const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY;

if (deployerPrivateKey && !/^0x[0-9a-fA-F]{64}$/.test(deployerPrivateKey)) {
  throw new Error(
    "DEPLOYER_PRIVATE_KEY must be a 0x-prefixed, 64-character hex private key. Do not include quotes or a placeholder.",
  );
}

export default defineConfig({
  plugins: [hardhatEthers, hardhatEthersChaiMatchers, hardhatMocha],
  solidity: {
    version: "0.8.38",
    path: require.resolve("solc/soljson.js"),
  },
  paths: {
    sources: "./src",
    tests: "./test",
  },
  networks: {
    monadTestnet: {
      type: "http",
      chainType: "l1",
      url: process.env.MONAD_TESTNET_RPC_URL || "https://testnet-rpc.monad.xyz",
      chainId: 10143,
      accounts: deployerPrivateKey ? [deployerPrivateKey] : [],
    },
  },
});
