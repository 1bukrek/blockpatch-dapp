export const bountyShieldAbi = [
  "function depositBounty(bytes32 projectId) payable",
  "function projectBalances(bytes32 projectId) view returns (uint256)",
  "function claimReward(bytes32 projectId, bytes32 reportHash, address payable hunter, uint256 amount, uint256 expiresAt, bytes signature)",
  "event BountyDeposited(bytes32 indexed projectId, address indexed owner, uint256 amount)",
] as const;

export const contractAddress =
  process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ?? "";
