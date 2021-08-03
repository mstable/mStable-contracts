// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;
pragma abicoder v2;

import { IStakedToken } from "./interfaces/IStakedToken.sol";
import { GamifiedVotingToken } from "./GamifiedVotingToken.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./GamifiedTokenStructs.sol";

/**
 * @title StakedToken
 * @notice StakedToken is a non-transferrable ERC20 token that allows users to stake and withdraw, earning voting rights.
 * Scaled balance is determined by quests a user completes, and the length of time they keep the raw balance wrapped.
 * @author mStable
 * @dev TODO
 **/
contract StakedToken is IStakedToken, GamifiedVotingToken {
    using SafeERC20 for IERC20;

    /// @notice Core token that is staked and tracked (e.g. MTA)
    IERC20 public immutable STAKED_TOKEN;
    /// @notice Seconds a user must wait after she initiates her cooldown before withdrawal is possible
    uint256 public immutable COOLDOWN_SECONDS;
    /// @notice Window in which it is possible to withdraw, following the cooldown period
    uint256 public immutable UNSTAKE_WINDOW;
    /// @notice A week
    uint256 private constant ONE_WEEK = 7 days;

    /// @notice Tracks the cooldowns for all users
    mapping(address => uint256) public stakersCooldowns;

    event Staked(address indexed user, uint256 amount, address delegatee);
    event Redeem(address indexed user, address indexed to, uint256 amount);
    event Cooldown(address indexed user);

    /***************************************
                    INIT
    ****************************************/

    /**
     * @param _signer Signer address is used to verify completion of quests off chain
     * @param _nexus System nexus
     * @param _rewardsToken Token that is being distributed as a reward. eg MTA
     * @param _stakedToken Core token that is staked and tracked (e.g. MTA)
     * @param _cooldownSeconds Seconds a user must wait after she initiates her cooldown before withdrawal is possible
     * @param _unstakeWindow Window in which it is possible to withdraw, following the cooldown period
     */
    constructor(
        address _signer,
        address _nexus,
        address _rewardsToken,
        address _stakedToken,
        uint256 _cooldownSeconds,
        uint256 _unstakeWindow
    ) GamifiedVotingToken(_signer, _nexus, _rewardsToken) {
        STAKED_TOKEN = IERC20(_stakedToken);
        COOLDOWN_SECONDS = _cooldownSeconds;
        UNSTAKE_WINDOW = _unstakeWindow;
    }

    /**
     * @param _nameArg Token name
     * @param _symbolArg Token symbol
     * @param _rewardsDistributorArg mStable Rewards Distributor
     */
    function initialize(
        string memory _nameArg,
        string memory _symbolArg,
        address _rewardsDistributorArg
    ) external initializer {
        __GamifiedToken_init(_nameArg, _symbolArg, _rewardsDistributorArg);
    }

    /***************************************
                    ACTIONS
    ****************************************/

    /**
     * @dev TODO
     */
    function stake(uint256 _amount) external override {
        _stake(_amount, address(0));
    }

    /**
     * @dev TODO
     */
    function stake(uint256 _amount, address _delegatee) external override {
        _stake(_amount, _delegatee);
    }

    /**
     * @dev TODO
     */
    function _stake(uint256 _amount, address _delegatee) internal {
        require(_amount != 0, "INVALID_ZERO_AMOUNT");

        // TODO - investigate if gas savings by moving after _mint
        if (_delegatee != address(0)) {
            _delegate(_msgSender(), _delegatee);
        }

        stakersCooldowns[_msgSender()] = getNextCooldownTimestamp(
            _amount,
            _msgSender(),
            balanceOf(_msgSender())
        );

        IERC20(STAKED_TOKEN).safeTransferFrom(_msgSender(), address(this), _amount);
        _mintRaw(_msgSender(), _amount);

        emit Staked(_msgSender(), _amount, _delegatee);
    }

    /**
     * @dev TODO
     **/
    function withdraw(
        uint256 _amount,
        address _recipient,
        bool _amountIncludesFee
    ) external override {
        require(_amount != 0, "INVALID_ZERO_AMOUNT");

        uint256 cooldownStartTimestamp = stakersCooldowns[_msgSender()];
        require(
            block.timestamp > cooldownStartTimestamp + COOLDOWN_SECONDS,
            "INSUFFICIENT_COOLDOWN"
        );
        require(
            block.timestamp - (cooldownStartTimestamp + COOLDOWN_SECONDS) <= UNSTAKE_WINDOW,
            "UNSTAKE_WINDOW_FINISHED"
        );

        Balance memory balance = _balances[_msgSender()];
        if ((balance.raw - _amount) == 0) {
            stakersCooldowns[_msgSender()] = 0;
        }

        // Apply redemption fee
        // e.g. (55e18 / 5e18) - 2e18 = 9e18 / 100 = 9e16
        uint256 feeRate = _calcRedemptionFeeRate(balance.weightedTimestamp);
        // fee = amount * 1e18 / feeRate
        // totalAmount = amount + fee
        // fee = amount * (1e18 - feeRate) / 1e18
        uint256 totalWithdraw = _amountIncludesFee ? _amount : (_amount * (1e18 + feeRate)) / 1e18;
        uint256 userWithdrawal = (totalWithdraw * 1e18) / (1e18 + feeRate);

        _burnRaw(_msgSender(), totalWithdraw);
        IERC20(STAKED_TOKEN).safeTransfer(_recipient, userWithdrawal);
        _notifyAdditionalReward(totalWithdraw - userWithdrawal);

        emit Redeem(_msgSender(), _recipient, _amount);
    }

    /**
     * @dev fee = x/k - 2, where x = weeks since a user has staked, and k = 55
     * @param _weightedTimestamp The users weightedTimestamp
     * @return _feeRate where 1% == 1e16
     */
    function _calcRedemptionFeeRate(uint32 _weightedTimestamp)
        internal
        view
        returns (uint256 _feeRate)
    {
        uint256 weeksStaked = ((block.timestamp - _weightedTimestamp) * 1e18) / ONE_WEEK;
        if (weeksStaked > 4e18) {
            _feeRate = 55e18 / weeksStaked;
            _feeRate = _feeRate < 2e18 ? 0 : _feeRate - 2e18;
        } else {
            _feeRate = 1e17;
        }
    }

    /**
     * @dev TODO
     **/
    function startCooldown() external override {
        require(balanceOf(_msgSender()) != 0, "INVALID_BALANCE_ON_COOLDOWN");
        //solium-disable-next-line
        stakersCooldowns[_msgSender()] = block.timestamp;

        // TODO - apply penalty here..
        // Is there a need for the unstake window if we are slashing? Can just leave it open ended
        // TODO - poke _checkForSeasonFinish here

        emit Cooldown(_msgSender());
    }

    /***************************************
                    GETTERS
    ****************************************/

    /**
     * @dev TODO
     **/
    function getNextCooldownTimestamp(
        uint256 _amountToReceive,
        address _toAddress,
        uint256 _toBalance
    ) public view returns (uint256) {
        uint256 toCooldownTimestamp = stakersCooldowns[_toAddress];
        if (toCooldownTimestamp == 0) {
            return 0;
        }

        uint256 minimalValidCooldownTimestamp = block.timestamp - COOLDOWN_SECONDS - UNSTAKE_WINDOW;

        // If user has missed their unstake window, reset
        if (minimalValidCooldownTimestamp > toCooldownTimestamp) {
            toCooldownTimestamp = 0;
        } else {
            toCooldownTimestamp =
                ((_amountToReceive * block.timestamp) + (_toBalance * toCooldownTimestamp)) /
                (_amountToReceive + _toBalance);
        }
        return toCooldownTimestamp;
    }
}
