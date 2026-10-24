// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract BountyShield {
    address public immutable backendSigner;
    uint256 public totalDeposited;
    uint256 public totalRewardsPaid;

    mapping(bytes32 => uint256) public projectDeposits;
    mapping(bytes32 => bool) public claimedReports;

    uint256 private locked = 1;

    event BountyDeposited(bytes32 indexed projectId, address indexed owner, uint256 amount);
    event RewardClaimed(bytes32 indexed reportHash, address indexed hunter, uint256 amount);

    error InvalidSigner();
    error InvalidSignature();
    error InvalidAmount();
    error AlreadyClaimed();
    error InsufficientFunds();
    error TransferFailed();
    error ReentrantCall();

    constructor(address signer) {
        if (signer == address(0)) revert InvalidSigner();
        backendSigner = signer;
    }

    function depositBounty(bytes32 projectId) external payable {
        if (msg.value == 0) revert InvalidAmount();

        projectDeposits[projectId] += msg.value;
        totalDeposited += msg.value;
        emit BountyDeposited(projectId, msg.sender, msg.value);
    }

    function claimReward(
        bytes32 reportHash,
        address payable hunter,
        uint256 amount,
        bytes memory signature
    ) external {
        if (locked != 1) revert ReentrantCall();
        locked = 2;

        if (hunter == address(0) || amount == 0) revert InvalidAmount();
        if (claimedReports[reportHash]) revert AlreadyClaimed();

        bytes32 payloadHash = keccak256(
            abi.encodePacked(address(this), block.chainid, reportHash, hunter, amount)
        );
        bytes32 signedHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", payloadHash)
        );

        if (_recoverSigner(signedHash, signature) != backendSigner) {
            revert InvalidSignature();
        }
        if (address(this).balance < amount) revert InsufficientFunds();

        claimedReports[reportHash] = true;
        totalRewardsPaid += amount;

        (bool success, ) = hunter.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit RewardClaimed(reportHash, hunter, amount);
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
