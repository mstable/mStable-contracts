// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;
pragma abicoder v2;

import { StakedToken } from "./StakedToken.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IBVault } from "./interfaces/IBVault.sol";

/**
 * @title StakedTokenBPT
 * @dev Derives from StakedToken, and simply adds the ability to withdraw any unclaimed $BAL tokens
 * that are at this address
 **/
contract StakedTokenBPT is StakedToken {
    using SafeERC20 for IERC20;

    /// @notice Balancer token
    IERC20 public immutable BAL;

    /// @notice Balancer token
    IBVault public immutable balancerVault;

    /// @notice Balancer poolId
    bytes32 public immutable poolId;

    /// @notice Core token that is staked and tracked (e.g. MTA)
    address public balRecipient;

    /// @notice Pending fees in BPT terms
    uint256 public pendingBPTFees;

    event BalClaimed();
    event BalRecipientChanged(address newRecipient);

    /**
     * @param _nexus System nexus
     * @param _rewardsToken Token that is being distributed as a reward. eg MTA
     * @param _stakedToken Core token that is staked and tracked (e.g. MTA)
     * @param _cooldownSeconds Seconds a user must wait after she initiates her cooldown before withdrawal is possible
     * @param _unstakeWindow Window in which it is possible to withdraw, following the cooldown period
     * @param _bal Balancer addresses, [0] = $BAL addr, [1] = designated recipient
     */
    constructor(
        address _nexus,
        address _rewardsToken,
        address _stakedToken,
        uint256 _cooldownSeconds,
        uint256 _unstakeWindow,
        address[3] memory _bal,
        bytes32 _poolId
    ) StakedToken(_nexus, _rewardsToken, _stakedToken, _cooldownSeconds, _unstakeWindow) {
        BAL = IERC20(_bal[0]);
        balRecipient = _bal[1];
        balancerVault = IBVault(_bal[2]);
        poolId = _poolId;
    }

    /**
     * @dev Claims any $BAL tokens present on this address as part of any potential liquidity mining program
     */
    function claimBal() external {
        uint256 balance = BAL.balanceOf(address(this));
        BAL.safeTransfer(balRecipient, balance);

        emit BalClaimed();
    }

    /**
     * @dev Sets the recipient for any potential $BAL earnings
     */
    function setBalRecipient(address _newRecipient) external onlyGovernor {
        balRecipient = _newRecipient;

        emit BalRecipientChanged(_newRecipient);
    }

    /**
     * @dev
     */
    function convertFees() external {
        require(pendingBPTFees > 1, "Must have something to convert");

        // balancerVault.exitPool(poolId, address(this), address(this), ExitPoolRequest([REWARDS_TOKEN], [], 0, false));
        uint256 balAfter = REWARDS_TOKEN.balanceOf(address(this));
        pendingAdditionalReward = balAfter;
    }

    /**
     * @dev Called by the child contract to notify of any additional rewards that have accrued.
     *      Trusts that this is called honestly.
     * @param _additionalReward Units of additional RewardToken to add at the next notification
     */
    function _notifyAdditionalReward(uint256 _additionalReward) internal override {
        require(_additionalReward < 1e24, "Cannot notify with more than a million units");

        pendingBPTFees += _additionalReward;
    }
}
