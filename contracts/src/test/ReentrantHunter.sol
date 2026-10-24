// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../BountyShield.sol";

contract ReentrantHunter {
    BountyShield private immutable bounty;
    bytes32 private projectId;
    bytes32 private reportHash;
    uint256 private amount;
    uint256 private expiresAt;
    bytes private signature;

    constructor(BountyShield target) {
        bounty = target;
    }

    function claim(
        bytes32 project,
        bytes32 report,
        uint256 reward,
        uint256 expiry,
        bytes calldata authorization
    ) external {
        projectId = project;
        reportHash = report;
        amount = reward;
        expiresAt = expiry;
        signature = authorization;
        bounty.claimReward(project, report, payable(address(this)), reward, expiry, authorization);
    }

    receive() external payable {
        (bool success, ) = address(bounty).call(
            abi.encodeWithSelector(
                bounty.claimReward.selector,
                projectId,
                reportHash,
                payable(address(this)),
                amount,
                expiresAt,
                signature
            )
        );
        require(!success, "reentrant claim succeeded");
    }
}
