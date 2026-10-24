import test from "node:test";
import assert from "node:assert/strict";
import {
  getBytes,
  hashMessage,
  recoverAddress,
  solidityPackedKeccak256,
  Wallet,
} from "ethers";
import { signRewardPayload } from "./signing.js";

test("signs a claim payload recoverable by the contract's signer address", async () => {
  const signer = Wallet.createRandom();
  const payload = {
    contractAddress: "0x0000000000000000000000000000000000000002",
    chainId: 11155111,
    reportHash: `0x${"11".repeat(32)}`,
    hunterAddress: "0x0000000000000000000000000000000000000001",
    amount: "500000000000000",
  };
  const signature = await signRewardPayload(signer, payload);
  const payloadHash = solidityPackedKeccak256(
    ["address", "uint256", "bytes32", "address", "uint256"],
    [
      payload.contractAddress,
      payload.chainId,
      payload.reportHash,
      payload.hunterAddress,
      payload.amount,
    ],
  );
  assert.equal(recoverAddress(hashMessage(getBytes(payloadHash)), signature), signer.address);
});
