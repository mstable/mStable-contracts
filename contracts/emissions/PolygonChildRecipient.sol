// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

// Libs
import { IERC20, SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title  PolygonChildRecipient
 * @author mStable
 * @notice sends reward tokens across the Polygon PoS Bridge to a specified recipient contract on the Polygon chain.
 * @dev     VERSION: 1.0
 *          DATE:    2021-10-28
 */
contract PolygonChildRecipient {
    using SafeERC20 for IERC20;

    /// @notice bridged rewards token on the Polygon chain.
    IERC20 public immutable childRewardsToken;
    /// @notice Polygon contract that will distribute bridged rewards on the Polygon chain.
    address public immutable childEmissionsController;

    /**
     * @param _childRewardsToken bridged rewards token on the Polygon chain.
     * @param _childEmissionsController Polygon contract that will distribute bridged rewards on the Polygon chain.
     */
    constructor(address _childRewardsToken, address _childEmissionsController) {
        childRewardsToken = IERC20(_childRewardsToken);
        childEmissionsController = _childEmissionsController;

        // Approve the Polygon PoS Bridge to transfer reward tokens from this contract
        IERC20(_childRewardsToken).safeApprove(_childEmissionsController, type(uint256).max);
    }
}
