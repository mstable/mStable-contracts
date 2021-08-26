// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;
pragma abicoder v2;

import { StakedToken } from "./StakedToken.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IBVault, ExitPoolRequest } from "./interfaces/IBVault.sol";

/**
 * @title StakedTokenBPT
 * @dev Derives from StakedToken, and simply adds the ability to withdraw any unclaimed $BAL tokens
 * that are at this address
 **/
contract StakedTokenBPT is StakedToken {
    using SafeERC20 for IERC20;

    /// @notice Balancer token
    IERC20 public immutable BAL;

    /// @notice Balancer vault
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
     * @param _bal Balancer addresses, [0] = $BAL addr, [1] = designated recipient, [2] = BAL vault
     * @param _poolId Balancer Pool identifier
     */
    constructor(
        address _nexus,
        address _rewardsToken,
        address _questManager,
        address _stakedToken,
        uint256 _cooldownSeconds,
        uint256 _unstakeWindow,
        address[3] memory _bal,
        bytes32 _poolId
    )
        StakedToken(
            _nexus,
            _rewardsToken,
            _questManager,
            _stakedToken,
            _cooldownSeconds,
            _unstakeWindow
        )
    {
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
     * @dev Converts fees accrued in BPT into MTA, before depositing to the rewards contract
     */
    function convertFees() external {
        uint256 pendingBPT = pendingBPTFees;
        require(pendingBPT > 1, "Must have something to convert");
        pendingBPTFees = 1;

        // 1. Sell the BPT
        uint256 stakingBalBefore = STAKED_TOKEN.balanceOf(address(this));
        uint256 mtaBalBefore = REWARDS_TOKEN.balanceOf(address(this));
        (address[] memory tokens, uint256[] memory balances, ) = balancerVault.getPoolTokens(
            poolId
        );
        require(tokens[0] == address(REWARDS_TOKEN), "MTA in wrong place");

        // 1.1. Calculate minimum output amount, assuming bpt 80/20 gives ~4% max slippage
        uint256[] memory minOut = new uint256[](1);
        address[] memory exitToken = new address[](1);
        {
            uint256 unitsPerToken = (balances[0] * 12e17) / STAKED_TOKEN.totalSupply();
            minOut[0] = (pendingBPT * unitsPerToken) / 1e18;
            exitToken[0] = address(REWARDS_TOKEN);
        }

        // 1.2. Exits to here, from here. Assumes token is in position 0
        balancerVault.exitPool(
            poolId,
            address(this),
            payable(address(this)),
            ExitPoolRequest(exitToken, minOut, bytes(abi.encode(0, pendingBPT - 1, 0)), false)
        );

        // 2. Verify and update state
        uint256 stakingBalAfter = STAKED_TOKEN.balanceOf(address(this));
        require(
            stakingBalAfter == (stakingBalBefore - pendingBPT + 1),
            "Must sell correct amount of BPT"
        );

        // 3. Inform HeadlessRewards about the new rewards
        uint256 mtaBalAfter = REWARDS_TOKEN.balanceOf(address(this));
        pendingAdditionalReward += (mtaBalAfter - mtaBalBefore);
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
