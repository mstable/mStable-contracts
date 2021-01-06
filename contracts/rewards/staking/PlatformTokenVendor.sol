// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.7.6;

import { IERC20 } from "@openzeppelin/contracts-solc7/token/ERC20/SafeERC20.sol";
import { MassetHelpers } from "../../masset/shared/MassetHelpers.sol";

/**
 * @title  PlatformTokenVendor
 * @author Stability Labs Pty. Ltd.
 * @notice Stores platform tokens for distributing to StakingReward participants
 * @dev    Only deploy this during the constructor of a given StakingReward contract
 */
contract PlatformTokenVendor {

    IERC20 public platformToken;
    address public parentStakingContract;

    /** @dev Simple constructor that stores the parent address */
    constructor(IERC20 _platformToken) public {
        parentStakingContract = msg.sender;
        platformToken = _platformToken;
        MassetHelpers.safeInfiniteApprove(address(_platformToken), parentStakingContract);
    }

    /**
     * @dev Re-approves the StakingReward contract to spend the platform token.
     * Just incase for some reason approval has been reset.
     */
    function reApproveOwner() external {
        MassetHelpers.safeInfiniteApprove(address(platformToken), parentStakingContract);
    }
}
