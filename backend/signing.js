import { getBytes, solidityPackedKeccak256 } from "ethers";

export function signRewardPayload(
  signer,
  { contractAddress, chainId, projectId, reportHash, hunterAddress, amount, expiresAt },
) {
  const payloadHash = solidityPackedKeccak256(
    ["address", "uint256", "bytes32", "bytes32", "address", "uint256", "uint256"],
    [contractAddress, chainId, projectId, reportHash, hunterAddress, amount, expiresAt],
  );
  return signer.signMessage(getBytes(payloadHash));
}
