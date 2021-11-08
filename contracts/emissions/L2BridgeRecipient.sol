// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { IERC20, SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title  L2BridgeRecipient
 * @author mStable
 * @notice Deployed on Polygon (or other L2's), this contract receives bridged tokens and gives the root emissions
 *         controller permission to forward them.
 * @dev    VERSION: 1.0
 *         DATE:    2021-10-28
 */
contract L2BridgeRecipient {
    using SafeERC20 for IERC20;

    /// @notice Bridged rewards token on the Polygon chain.
    IERC20 public immutable REWARDS_TOKEN;
    /// @notice Polygon contract that will distribute bridged rewards on the Polygon chain.
    address public immutable L2_EMISSIONS_CONTROLLER;

    /**
     * @param _childRewardsToken Bridged rewards token on the Polygon chain.
     * @param _childEmissionsController Polygon contract that will distribute bridged rewards on the Polygon chain.
     */
    constructor(address _childRewardsToken, address _childEmissionsController) {
        REWARDS_TOKEN = IERC20(_childRewardsToken);
        L2_EMISSIONS_CONTROLLER = _childEmissionsController;

        // Approve the Polygon PoS Bridge to transfer reward tokens from this contract
        IERC20(_childRewardsToken).safeApprove(_childEmissionsController, type(uint256).max);
    }
}
