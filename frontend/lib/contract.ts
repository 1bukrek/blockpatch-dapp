export const bountyShieldAbi = [
  "function depositBounty(bytes32 projectId) payable",
  "function claimReward(bytes32 projectId, bytes32 reportHash, address payable hunter, uint256 amount, uint256 expiresAt, bytes signature)",
] as const;

export const contractAddress =
  process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ?? "";
