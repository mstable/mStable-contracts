// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;
pragma abicoder v2;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IStakedToken } from "./IStakedToken.sol";

import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { GamifiedVotingToken } from "./deps/GamifiedVotingToken.sol";
import { HeadlessStakingRewards } from "../../rewards/staking/HeadlessStakingRewards.sol";

/**
 * @title StakedToken
 * @notice Contract to stake Aave token, tokenize the position and get rewards, inheriting from a distribution manager contract
 * @author Aave
 **/
contract StakedToken is IStakedToken, GamifiedVotingToken, HeadlessStakingRewards {
    using SafeERC20 for IERC20;

    IERC20 public immutable STAKED_TOKEN;
    uint256 public immutable COOLDOWN_SECONDS;
    uint256 public immutable UNSTAKE_WINDOW;
    uint256 public immutable MIGRATION_WINDOW;
    uint256 private constant ONE_WEEK = 7 days;

    mapping(address => uint256) public stakersCooldowns;

    event Staked(address indexed user, address indexed onBehalfOf, uint256 amount);
    event Redeem(address indexed user, address indexed to, uint256 amount);
    event Cooldown(address indexed user);

    /***************************************
                    INIT
    ****************************************/

    constructor(
        address _signer,
        address _nexus,
        address _rewardsToken,
        uint256 _duration,
        address _stakedToken,
        uint256 _cooldownSeconds,
        uint256 _unstakeWindow,
        uint256 _migrationWindow
    ) GamifiedVotingToken(_signer) HeadlessStakingRewards(_nexus, _rewardsToken, _duration) {
        STAKED_TOKEN = IERC20(_stakedToken);
        COOLDOWN_SECONDS = _cooldownSeconds;
        UNSTAKE_WINDOW = _unstakeWindow;
        MIGRATION_WINDOW = _migrationWindow;
    }

    /**
     * @dev Called by the proxy contract
     **/
    function initialize(
        string memory _nameArg,
        string memory _symbolArg,
        address _rewardsDistributorArg
    ) external initializer {
        __GamifiedToken_init(_nameArg, _symbolArg);
        HeadlessStakingRewards._initialize(_rewardsDistributorArg);
    }

    /***************************************
                    ACTIONS
    ****************************************/

    /**
     * @dev
     */
    function stake(uint256 _amount, address _beneficiary) external override {
        _stake(_amount, _beneficiary, address(0));
    }

    /**
     * @dev
     */
    function stake(
        uint256 _amount,
        address _beneficiary,
        address _delegatee
    ) external {
        _stake(_amount, _beneficiary, _delegatee);
    }

    /**
     * @dev
     */
    function _stake(
        uint256 _amount,
        address _beneficiary,
        address _delegatee
    ) internal {
        require(_amount != 0, "INVALID_ZERO_AMOUNT");

        // TODO - investigate if gas savings by moving after _mint
        if (_delegatee != address(0)) {
            _delegate(_msgSender(), _delegatee);
        }

        // TODO - move this to 'beforeTokenTransfer'?
        stakersCooldowns[_beneficiary] = getNextCooldownTimestamp(
            _amount,
            _beneficiary,
            balanceOf(_beneficiary)
        );

        IERC20(STAKED_TOKEN).safeTransferFrom(_msgSender(), address(this), _amount);
        _mintRaw(_beneficiary, _amount);

        emit Staked(_msgSender(), _beneficiary, _amount);
    }

    /**
     * @dev Redeems staked tokens, and stop earning rewards
     * @param _amount Amount to redeem
     * @param _recipient Address to redeem to
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
        uint256 weeksStaked = ((block.timestamp - balance.weightedTimestamp) * 1e18) / ONE_WEEK;
        // e.g. (55e18 / 5e18) - 2e18 = 9e18 / 100 = 9e16
        uint256 feeRate = _calcRedemptionFeeRate(weeksStaked);
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

    function _calcRedemptionFeeRate(uint256 _weeksStaked) internal pure returns (uint256 _feeRate) {
        if (_weeksStaked > 4e18) {
            _feeRate = 55e18 / _weeksStaked;
            _feeRate = _feeRate < 2e18 ? 0 : _feeRate - 2e18;
        } else {
            _feeRate = 1e17;
        }
    }

    /**
     * @dev Activates the cooldown period to unstake
     * - It can't be called if the user is not staking
     **/
    function startCooldown() external override {
        require(balanceOf(_msgSender()) != 0, "INVALID_BALANCE_ON_COOLDOWN");
        //solium-disable-next-line
        stakersCooldowns[_msgSender()] = block.timestamp;

        // TODO - apply penalty here

        emit Cooldown(_msgSender());
    }

    /***************************************
                    HOOKS
    ****************************************/

    /**
     * @dev Responsible for updating rewards
     **/
    function _beforeBalanceChange(address _account) internal override updateReward(_account) {}

    /***************************************
                    GETTERS
    ****************************************/

    /**
     * @dev
     */
    function _balanceOf(address account) internal view override returns (uint256) {
        return balanceOf(account);
    }

    /**
     * @dev
     */
    function _totalSupply() internal view override returns (uint256) {
        return totalSupply();
    }

    /**
     * @dev
     */
    function _questMasterOrGovernor(address account) internal view override returns (bool) {
        return account == questMaster || account == _governor();
    }

    // TODO - update natspec
    /**
     * @dev Calculates the new cooldown timestamp depending on the balance
     *  - If the receiver's cooldown timestamp expired (too old), the next is 0
     *  - Weighted average if
     * @param _amountToReceive Amount
     * @param _toAddress Address of the recipient
     * @param _toBalance Current balance of the receiver
     * @return The new cooldown timestamp
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
