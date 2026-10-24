import { expect } from "chai";
import hre from "hardhat";

const { ethers } = await hre.network.create();

const maximumReward = ethers.parseEther("1");
const projectA = ethers.id("project-a");
const projectB = ethers.id("project-b");

async function signClaim(signer, {
  contractAddress,
  chainId,
  projectId = projectA,
  reportHash,
  hunterAddress,
  amount,
  expiresAt,
}) {
  const payloadHash = ethers.solidityPackedKeccak256(
    ["address", "uint256", "bytes32", "bytes32", "address", "uint256", "uint256"],
    [contractAddress, chainId, projectId, reportHash, hunterAddress, amount, expiresAt],
  );
  return signer.signMessage(ethers.getBytes(payloadHash));
}

describe("BountyShield", function () {
  let contract;
  let backendSigner;
  let hunter;
  let relayer;

  beforeEach(async function () {
    [, backendSigner, hunter, relayer] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("BountyShield");
    contract = await factory.deploy(backendSigner.address, maximumReward);
    await contract.waitForDeployment();
  });

  async function futureExpiry() {
    const block = await ethers.provider.getBlock("latest");
    return block.timestamp + 300;
  }

  async function signedClaim({ projectId = projectA, amount, reportHash, hunterAddress = hunter.address, expiresAt }) {
    const hash = reportHash || ethers.keccak256(ethers.toUtf8Bytes(`report-${Math.random()}`));
    const expiry = expiresAt ?? await futureExpiry();
    const { chainId } = await ethers.provider.getNetwork();
    const signature = await signClaim(backendSigner, {
      contractAddress: await contract.getAddress(),
      chainId,
      projectId,
      reportHash: hash,
      hunterAddress,
      amount,
      expiresAt: expiry,
    });
    return { projectId, reportHash: hash, hunterAddress, amount, expiresAt: expiry, signature };
  }

  it("keeps balances isolated per project when paying a reward", async function () {
    await contract.depositBounty(projectA, { value: ethers.parseEther("1") });
    await contract.depositBounty(projectB, { value: ethers.parseEther("2") });
    const claim = await signedClaim({ amount: ethers.parseEther("0.75") });

    await expect(contract.connect(relayer).claimReward(
      claim.projectId,
      claim.reportHash,
      claim.hunterAddress,
      claim.amount,
      claim.expiresAt,
      claim.signature,
    )).to.emit(contract, "RewardClaimed").withArgs(
      projectA,
      claim.reportHash,
      claim.hunterAddress,
      claim.amount,
    );

    expect(await contract.projectBalances(projectA)).to.equal(ethers.parseEther("0.25"));
    expect(await contract.projectBalances(projectB)).to.equal(ethers.parseEther("2"));
    expect(await contract.projectDeposits(projectA)).to.equal(ethers.parseEther("1"));
    expect(await contract.totalRewardsPaid()).to.equal(ethers.parseEther("0.75"));
  });

  it("rejects rewards above the immutable maximum", async function () {
    await contract.depositBounty(projectA, { value: ethers.parseEther("2") });
    const claim = await signedClaim({ amount: maximumReward + 1n });

    await expect(contract.claimReward(
      claim.projectId,
      claim.reportHash,
      claim.hunterAddress,
      claim.amount,
      claim.expiresAt,
      claim.signature,
    )).to.be.revertedWithCustomError(contract, "RewardExceedsMaximum");
  });

  it("cannot spend a different project's escrow", async function () {
    await contract.depositBounty(projectA, { value: ethers.parseEther("2") });
    const claim = await signedClaim({ projectId: projectB, amount: ethers.parseEther("0.1") });

    await expect(contract.claimReward(
      claim.projectId,
      claim.reportHash,
      claim.hunterAddress,
      claim.amount,
      claim.expiresAt,
      claim.signature,
    )).to.be.revertedWithCustomError(contract, "InsufficientProjectFunds");
  });

  it("binds authorizations to their project", async function () {
    await contract.depositBounty(projectA, { value: ethers.parseEther("1") });
    await contract.depositBounty(projectB, { value: ethers.parseEther("1") });
    const claim = await signedClaim({ amount: ethers.parseEther("0.1") });

    await expect(contract.claimReward(
      projectB,
      claim.reportHash,
      claim.hunterAddress,
      claim.amount,
      claim.expiresAt,
      claim.signature,
    )).to.be.revertedWithCustomError(contract, "InvalidSignature");
  });

  it("rejects expired authorizations and report replays", async function () {
    await contract.depositBounty(projectA, { value: ethers.parseEther("1") });
    const block = await ethers.provider.getBlock("latest");
    const expired = await signedClaim({
      amount: ethers.parseEther("0.1"),
      expiresAt: block.timestamp - 1,
    });
    await expect(contract.claimReward(
      expired.projectId,
      expired.reportHash,
      expired.hunterAddress,
      expired.amount,
      expired.expiresAt,
      expired.signature,
    )).to.be.revertedWithCustomError(contract, "SignatureExpired");

    const claim = await signedClaim({ amount: ethers.parseEther("0.1") });
    const args = [
      claim.projectId,
      claim.reportHash,
      claim.hunterAddress,
      claim.amount,
      claim.expiresAt,
      claim.signature,
    ];
    await contract.claimReward(...args);
    await expect(contract.claimReward(...args)).to.be.revertedWithCustomError(contract, "AlreadyClaimed");
  });

  it("blocks reentrant reward claims", async function () {
    await contract.depositBounty(projectA, { value: ethers.parseEther("1") });
    const receiverFactory = await ethers.getContractFactory("ReentrantHunter");
    const receiver = await receiverFactory.deploy(await contract.getAddress());
    const claim = await signedClaim({
      amount: ethers.parseEther("0.1"),
      hunterAddress: await receiver.getAddress(),
    });

    await receiver.claim(
      claim.projectId,
      claim.reportHash,
      claim.amount,
      claim.expiresAt,
      claim.signature,
    );

    expect(await ethers.provider.getBalance(await receiver.getAddress())).to.equal(claim.amount);
    expect(await contract.claimedReports(claim.reportHash)).to.equal(true);
  });
});
