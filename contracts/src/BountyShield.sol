// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract BountyShield {
    address public immutable backendSigner;
    uint256 public immutable maxReward;
    uint256 public constant MAX_SIGNATURE_LIFETIME = 7 days;
    uint256 public totalDeposited;
    uint256 public totalRewardsPaid;

    mapping(bytes32 => uint256) public projectDeposits;
    mapping(bytes32 => uint256) public projectBalances;
    mapping(bytes32 => bool) public claimedReports;

    uint256 private locked = 1;

    event BountyDeposited(bytes32 indexed projectId, address indexed owner, uint256 amount);
    event RewardClaimed(
        bytes32 indexed projectId,
        bytes32 indexed reportHash,
        address indexed hunter,
        uint256 amount
    );

    error InvalidSigner();
    error InvalidSignature();
    error InvalidAmount();
    error AlreadyClaimed();
    error InsufficientProjectFunds();
    error RewardExceedsMaximum();
    error SignatureExpired();
    error TransferFailed();
    error ReentrantCall();

    constructor(address signer, uint256 maximumReward) {
        if (signer == address(0)) revert InvalidSigner();
        if (maximumReward == 0) revert InvalidAmount();
        backendSigner = signer;
        maxReward = maximumReward;
    }

    function depositBounty(bytes32 projectId) external payable {
        if (msg.value == 0) revert InvalidAmount();

        projectDeposits[projectId] += msg.value;
        projectBalances[projectId] += msg.value;
        totalDeposited += msg.value;
        emit BountyDeposited(projectId, msg.sender, msg.value);
    }

    function claimReward(
        bytes32 projectId,
        bytes32 reportHash,
        address payable hunter,
        uint256 amount,
        uint256 expiresAt,
        bytes memory signature
    ) external {
        if (locked != 1) revert ReentrantCall();
        locked = 2;

        if (hunter == address(0) || amount == 0) revert InvalidAmount();
        if (amount > maxReward) revert RewardExceedsMaximum();
        if (expiresAt < block.timestamp || expiresAt > block.timestamp + MAX_SIGNATURE_LIFETIME) {
            revert SignatureExpired();
        }
        if (claimedReports[reportHash]) revert AlreadyClaimed();

        bytes32 payloadHash = keccak256(
            abi.encodePacked(address(this), block.chainid, projectId, reportHash, hunter, amount, expiresAt)
        );
        bytes32 signedHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", payloadHash)
        );

        if (_recoverSigner(signedHash, signature) != backendSigner) {
            revert InvalidSignature();
        }
        if (projectBalances[projectId] < amount) revert InsufficientProjectFunds();

        claimedReports[reportHash] = true;
        projectBalances[projectId] -= amount;
        totalRewardsPaid += amount;

        (bool success, ) = hunter.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit RewardClaimed(projectId, reportHash, hunter, amount);
        locked = 1;
    }

    function _recoverSigner(bytes32 digest, bytes memory signature) private pure returns (address) {
        if (signature.length != 65) return address(0);

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }

        if (
            uint256(s) >
            0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0 ||
            (v != 27 && v != 28)
        ) return address(0);

        return ecrecover(digest, v, r, s);
    }
}
