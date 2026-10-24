import { getBytes, solidityPackedKeccak256 } from "ethers";

export function signRewardPayload(
  signer,
  { contractAddress, chainId, reportHash, hunterAddress, amount },
) {
  const payloadHash = solidityPackedKeccak256(
    ["address", "uint256", "bytes32", "address", "uint256"],
    [contractAddress, chainId, reportHash, hunterAddress, amount],
  );
  return signer.signMessage(getBytes(payloadHash));
}
