pragma solidity 0.5.16;

import { Module } from "../shared/Module.sol";
import { StableMath } from "../shared/StableMath.sol";

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";


interface IRewardsVault {
  function lockupRewards(address _rewardee, address _rewardToken, uint256 _amount) external;
  function vestRewards() external;
}

/**
 * @title  RewardsVault
 * @notice RewardsVault stores Meta token deposits that vest after LOCKUP_PERIOD
 * @author Stability Labs Pty. Ltd.
 */
contract RewardsVault is Module {

    using SafeMath for uint256;
    using StableMath for uint256;
    using SafeERC20 for IERC20;

    uint256 private constant LOCKUP_PERIODS = 13;
    uint256 private constant PERIOD = 2 weeks;
    uint256 private vaultStartTime;

    IERC20 private vestingToken;

    // 2 options for vesting
    // ONE - Lock up per period, then cycle through periods at the end
    //     - Pro = Less read/write?     Con = Slightly longer lockups per person
    /** @dev All data for keeping track of rewards. Tranche ID starts at 0 (see _currentTrancheNumber) */
    mapping(uint256 => mapping(address => uint256)) internal vestingBalances;
    mapping(address => uint256) internal lastPeriodClaimed;

    function getCurrentPeriod()
        public
        view
        returns (
            uint256 currentPeriod
        )
    {
        // e.g. now (1000), startTime (600), tranchePeriod (150)
        // (1000-600)/150 = 2
        // e.g. now == 650 => 50/150 = 0
        uint256 totalTimeElapsed = now.sub(vaultStartTime);
        currentPeriod = totalTimeElapsed.div(PERIOD);
    }

    // TWO - Lock up pro-rata, then cycle through array at the end, marking most recent withdrawal
    //     - Pro = More optionality/faster payotus    Con = Higher gas

    /** @dev RewardsVault is a module, governed by mStable governance */
    constructor(address _nexus)
        public
        Module(_nexus)
    {
    }


    function lockupRewards(
        address _rewardee,
        address _rewardToken,
        uint256 _amount
    ) external {
        // xfer token from sender
        // add to vesting
    }

    function vestRewards() external {
        // get rewards for [msg.sender] that have unlocked
    }
}
