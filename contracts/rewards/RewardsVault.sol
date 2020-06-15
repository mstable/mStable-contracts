pragma solidity 0.5.16;

import { StableMath } from "../shared/StableMath.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";


interface IRewardsVault {
    function lockupRewards(address rewardee, uint256 amount) external;
    function vestReward(uint256 period) external returns (uint256);
    function vestRewards(uint256[] calldata periods) external returns (uint256);
}

/**
 * @title  RewardsVault
 * @author Stability Labs Pty. Ltd.
 * @notice Locks up tokens sent to it for X periods before they can be claimed
 */
contract RewardsVault is ReentrancyGuard {

    using SafeMath for uint256;
    using StableMath for uint256;
    using SafeERC20 for IERC20;

    event Deposited(address indexed rewardee, uint256 amount, uint256 period);
    event Vested(address indexed user, uint256 cumulative, uint256 period);
    event VestedMulti(address indexed user, uint256 cumulative, uint256[] periods);

    uint256 private constant LOCKUP_PERIODS = 26;
    uint256 private constant PERIOD = 1 weeks;
    uint256 public vaultStartTime;

    IERC20 private vestingToken;

    /** @dev All data for keeping track of rewards. Tranche ID starts at 0 (see _currentTrancheNumber) */
    mapping(uint256 => mapping(address => uint256)) internal vestingBalances;


    /** @dev RewardsVault is a module, governed by mStable governance */
    constructor(IERC20 _vestingToken)
        public
    {
        vestingToken = _vestingToken;
        vaultStartTime = now;
    }

    /***************************************
                    DEPOSIT
    ****************************************/

    /**
     * @dev Adds an amount of vestingTokens to the lockup
     * @param _amount        Amount of token to transfer
     */
    function lockupRewards(
        uint256 _amount
    )
        external
    {
        _lockupRewards(msg.sender, _amount);
    }

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
    {
        _lockupRewards(_rewardee, _amount);
    }

    /**
     * @dev Adds an amount of vestingTokens to the lockup
     * @param _rewardee      To whom should these tokens be credited?
     * @param _amount        Amount of token to transfer
     */
    function _lockupRewards(
        address _rewardee,
        uint256 _amount
    )
        internal
        nonReentrant
    {
        vestingToken.safeTransferFrom(msg.sender, address(this), _amount);

        uint256 currentPeriod = _getCurrentPeriod();
        vestingBalances[currentPeriod][_rewardee] = vestingBalances[currentPeriod][_rewardee].add(_amount);

        emit Deposited(_rewardee, _amount, currentPeriod);
    }

    /***************************************
                    VESTING
    ****************************************/

    /**
     * @dev Vests specified periods rewards and resets data. Transfers
     * vestingToken to the sender.
     * @param _period        Period ID to vest
     * @return vestedAmount  Vest amount from this period
     */
    function vestReward(uint256 _period)
        external
        nonReentrant
        returns (uint256)
    {
        uint256 currentPeriod = _getCurrentPeriod();

        uint256 vested = _vestReward(currentPeriod, _period);
        require(vested > 0, "Nothing in this period to vest");

        vestingToken.safeTransfer(msg.sender, vested);

        emit Vested(msg.sender, vested, _period);

        return vested;
    }

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
        uint256 currentPeriod = _getCurrentPeriod();

        uint256 cumulativeVested = 0;
        for(uint256 i = 0; i < len; i++){
            uint256 vestedInPeriod = _vestReward(currentPeriod, _periods[i]);
            cumulativeVested = cumulativeVested.add(vestedInPeriod);
        }

        require(cumulativeVested > 0, "Nothing in these periods to vest");

        vestingToken.safeTransfer(msg.sender, cumulativeVested);

        emit VestedMulti(msg.sender, cumulativeVested, _periods);

        return cumulativeVested;
    }

    /**
     * @dev Internally vests an unlocked periods rewards and resets data
     * @param _currentPeriod  Current active period (save gas by reading here)
     * @param _period         Period to vest
     * @return periodAmount   Uint signalling newly unlocked balance from period
     */
    function _vestReward(
        uint256 _currentPeriod,
        uint256 _period
    )
        internal
        returns (uint256 periodAmount)
    {
        require(_periodIsUnlocked(_currentPeriod, _period), "Period must be unlocked to vest");

        uint256 bal = vestingBalances[_period][msg.sender];
        if(bal > 0){
            vestingBalances[_period][msg.sender] = 0;
        }
        return bal;
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
        public
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
        pure
        returns (bool)
    {
        return _currentPeriod > _period.add(LOCKUP_PERIODS);
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
