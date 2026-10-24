export const bountyShieldAbi = [
  "function depositBounty(bytes32 projectId) payable",
  "function claimReward(bytes32 reportHash, address payable hunter, uint256 amount, bytes signature)",
] as const;

export const contractAddress =
  process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ?? "0x0000000000000000000000000000000000000000";
