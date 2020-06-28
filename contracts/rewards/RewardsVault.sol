pragma solidity 0.5.16;

import { Module } from "../shared/Module.sol";

import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";


interface IRewardsVault {
    function airdropRewards(address[] calldata rewardees, uint256[] calldata amounts) external;
    function lockupRewards(address rewardee, uint256 amount) external;
    function vestRewards(uint256[] calldata periods) external returns (uint256);
}

/**
 * @title  RewardsVault
 * @author Stability Labs Pty. Ltd.
 * @notice Locks up tokens sent to it for X periods before they can be claimed
 */
contract RewardsVault is ReentrancyGuard, Module {

    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    event Deposited(address indexed rewardee, uint256 amount, uint256 period);
    event Vested(address indexed user, uint256 cumulative, uint256[] period);
    event AllRewardsUnlocked();

    uint256 public constant LOCKUP_PERIODS = 26;
    uint256 public constant PERIOD = 1 weeks;
    uint256 public vaultStartTime;
    bool private allRewardsUnlocked = false;

    IERC20 public vestingToken;

    /** @dev All data for keeping track of rewards. Tranche ID starts at 0 (see _currentTrancheNumber) */
    mapping(uint256 => mapping(address => uint256)) internal vestingBalances;


    /** @dev RewardsVault is a module, governed by mStable governance */
    constructor(address _nexus, IERC20 _vestingToken)
        public
        Module(_nexus)
    {
        vestingToken = _vestingToken;
        vaultStartTime = now;
    }

    /***************************************
                    DEPOSIT
    ****************************************/

    /**
     * @dev Adds an amount of vestingTokens to the lockup
     * @param _rewardee      To whom should these tokens be credited?
     * @param _amount        Amount of token to transfer
     */
    function lockupRewards(
        address _rewardee,
        uint256 _amount
    )
        external
        nonReentrant
    {
        require(_rewardee != address(0), "Rewardee cannot be null");
        uint256 currentPeriod = _getCurrentPeriod();

        if(allRewardsUnlocked) {
            vestingToken.safeTransferFrom(msg.sender, _rewardee, _amount);

            uint256[] memory periods = new uint256[](1);
            periods[0] = currentPeriod;

            emit Vested(_rewardee, _amount, periods);
        } else {
            vestingToken.safeTransferFrom(msg.sender, address(this), _amount);

            vestingBalances[currentPeriod][_rewardee] = vestingBalances[currentPeriod][_rewardee].add(_amount);

            emit Deposited(_rewardee, _amount, currentPeriod);
        }
    }

    /**
     * @dev Airdrops an amount of vestingTokens to the lockup
     * @param _rewardees    To whom should these tokens be credited?
     * @param _amounts      Amount of token to transfer
     */
    function airdropRewards(
        address[] calldata _rewardees,
        uint256[] calldata _amounts
    )
        external
        nonReentrant
    {
        uint256 len = _rewardees.length;
        require(len > 0 && len == _amounts.length, "Invalid input data");

        uint256 sumOfAmounts = 0;
        for(uint256 i = 0; i < len; i++){
            sumOfAmounts = sumOfAmounts.add(_amounts[i]);
        }

        vestingToken.safeTransferFrom(msg.sender, address(this), sumOfAmounts);

        uint256 currentPeriod = _getCurrentPeriod();

        for(uint256 i = 0; i < len; i++){
            address rewardee = _rewardees[i];
            uint256 amount = _amounts[i];
            vestingBalances[currentPeriod][rewardee] = vestingBalances[currentPeriod][rewardee].add(amount);
            emit Deposited(rewardee, amount, currentPeriod);
        }
    }


    /***************************************
                    VESTING
    ****************************************/

    /**
     * @dev Vests specified periods rewards and resets data. Transfers
     * vestingToken to the sender.
     * @param _periods        Array of Period IDs to vest
     * @return vestedAmount   Cumulative vest amount from all periods
     */
    function vestRewards(uint256[] calldata _periods)
        external
        nonReentrant
        returns (uint256)
    {
        uint256 len = _periods.length;
        require(len > 0, "Must vest some periods");

        uint256 currentPeriod = _getCurrentPeriod();

        uint256 cumulativeVested = 0;
        for(uint256 i = 0; i < len; i++){
            uint256 periodToVest = _periods[i];
            require(_periodIsUnlocked(currentPeriod, periodToVest), "Period must be unlocked to vest");

            uint256 periodBal = vestingBalances[periodToVest][msg.sender];
            if(periodBal > 0){
                vestingBalances[periodToVest][msg.sender] = 0;
                cumulativeVested = cumulativeVested.add(periodBal);
            }
        }

        require(cumulativeVested > 0, "Nothing in these periods to vest");

        vestingToken.safeTransfer(msg.sender, cumulativeVested);

        emit Vested(msg.sender, cumulativeVested, _periods);

        return cumulativeVested;
    }

    /***************************************
                    ADMIN
    ****************************************/

    /**
     * @dev Sets the flag to unlock all rewards
     */
    function unlockAllRewards()
        external
        onlyGovernor
    {
        require(!allRewardsUnlocked, "Flag already set");
        allRewardsUnlocked = true;
        emit AllRewardsUnlocked();
    }

    /***************************************
                    GETTERS
    ****************************************/

    /**
     * @dev Gets a rewardee balance at particular period
     * @param _rewardee  Rewardee
     * @param _period    Period ID
     * @return balance   uint256 bal
     */
    function getBalance(
        address _rewardee,
        uint256 _period
    )
        external
        view
        returns (uint256)
    {
        return vestingBalances[_period][_rewardee];
    }

    /**
     * @dev Checks if a specified period has unlocked yet
     * @param _currentPeriod  Current active period
     * @param _period         Period to check for unlock
     * @return bool           Unlocked?
     */
    function _periodIsUnlocked(
        uint256 _currentPeriod,
        uint256 _period
    )
        internal
        view
        returns (bool)
    {
        return _currentPeriod > _period.add(LOCKUP_PERIODS) || allRewardsUnlocked;
    }

    /**
     * @dev Gets the current period ID of the Vault (starts at 0)
     * @return currentPeriod  Uint with period ID
     */
    function getCurrentPeriod()
        external
        view
        returns (uint256 currentPeriod)
    {
        return _getCurrentPeriod();
    }

    /**
     * @dev Gets the current period ID of the Vault (starts at 0)
     * @return currentPeriod  Uint with period ID
     */
    function _getCurrentPeriod()
        internal
        view
        returns (uint256 currentPeriod)
    {
        // e.g. now (1000), startTime (600), tranchePeriod (150)
        // (1000-600)/150 = 2
        // e.g. now == 650 => 50/150 = 0
        uint256 totalTimeElapsed = now.sub(vaultStartTime);
        currentPeriod = totalTimeElapsed.div(PERIOD);
    }
}
