// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;
pragma abicoder v2;

import { IStakedToken } from "./interfaces/IStakedToken.sol";
import { GamifiedVotingToken } from "./GamifiedVotingToken.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./GamifiedTokenStructs.sol";

/**
 * @title StakedToken
 * @notice StakedToken is a non-transferrable ERC20 token that allows users to stake and withdraw, earning voting rights.
 * Scaled balance is determined by quests a user completes, and the length of time they keep the raw balance wrapped.
 * @author mStable
 * @dev TOWRITE
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

    struct SafetyData {
        /// Percentage of collateralisation where 100% = 1e18
        uint128 collateralisationRatio;
        /// Slash % where 100% = 1e18
        uint128 slashingPercentage;
    }
    /// @notice Data relating to the re-collateralisation safety module
    SafetyData public safetyData;
    /// @notice Tracks the cooldowns for all users
    mapping(address => uint256) public stakersCooldowns;
    /// @notice Whitelisted smart contract integrations
    mapping(address => bool) public whitelistedWrappers;

    event Staked(address indexed user, uint256 amount, address delegatee);
    event Withdraw(address indexed user, address indexed to, uint256 amount);
    event Cooldown(address indexed user);
    event CooldownExited(address indexed user);
    event SlashRateChanged(uint256 newRate);
    event Recollateralised();
    event WrapperWhitelisted(address wallet);
    event WrapperBlacklisted(address wallet);

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
        safetyData = SafetyData({ collateralisationRatio: 1e18, slashingPercentage: 0 });
    }

    /**
     * @dev TOWRITE
     */
    modifier onlyRecollateralisationModule() {
        require(
            _msgSender() == _recollateraliser(),
            "Only the Recollateralisation Module can call"
        );
        _;
    }

    /**
     * @dev TOWRITE
     */
    modifier onlyBeforeRecollateralisation() {
        require(
            safetyData.collateralisationRatio == 1e18,
            "Function can only be called while fully collateralised"
        );
        _;
    }

    /**
     * @dev TOWRITE
     */
    modifier assertNotContract() {
        if (_msgSender() != tx.origin) {
            require(
                whitelistedWrappers[_msgSender()],
                "Transactions from non-whitelisted smart contracts not allowed"
            );
        }
        _;
    }

    /***************************************
                    ACTIONS
    ****************************************/

    /**
     * @dev TOWRITE
     */
    function stake(uint256 _amount) external override {
        _stake(_amount, address(0), false);
    }

    /**
     * @dev TOWRITE
     */
    function stake(uint256 _amount, bool _exitCooldown) external {
        _stake(_amount, address(0), _exitCooldown);
    }

    /**
     * @dev TOWRITE
     */
    function stake(uint256 _amount, address _delegatee) external override {
        _stake(_amount, _delegatee, false);
    }

    /**
     * @dev TOWRITE
     */
    function _stake(
        uint256 _amount,
        address _delegatee,
        bool _exitCooldown
    ) internal onlyBeforeRecollateralisation assertNotContract {
        require(_amount != 0, "INVALID_ZERO_AMOUNT");

        // TODO - investigate if gas savings by moving after _mint
        if (_delegatee != address(0)) {
            _delegate(_msgSender(), _delegatee);
        }

        uint256 nextCooldown = getNextCooldownTimestamp(
            _amount,
            _msgSender(),
            balanceOf(_msgSender())
        );
        // If we have missed the unstake window, the cooldown is over anyway
        bool exitCooldown = _exitCooldown ||
            block.timestamp > (nextCooldown + COOLDOWN_SECONDS + UNSTAKE_WINDOW);

        stakersCooldowns[_msgSender()] = exitCooldown ? 0 : nextCooldown;

        IERC20(STAKED_TOKEN).safeTransferFrom(_msgSender(), address(this), _amount);
        _mintRaw(_msgSender(), _amount, exitCooldown);

        emit Staked(_msgSender(), _amount, _delegatee);
    }

    /**
     * @dev TOWRITE
     **/
    function withdraw(
        uint256 _amount,
        address _recipient,
        bool _amountIncludesFee,
        bool _exitCooldown
    ) external override {
        _withdraw(_amount, _recipient, _amountIncludesFee, _exitCooldown);
    }

    /**
     * @dev TOWRITE
     **/
    function _withdraw(
        uint256 _amount,
        address _recipient,
        bool _amountIncludesFee,
        bool _exitCooldown
    ) internal assertNotContract {
        require(_amount != 0, "INVALID_ZERO_AMOUNT");

        // If recollateralisation has occured, the contract is finished
        // Just return the remaining amount
        if (safetyData.collateralisationRatio != 1e18) {
            _burnRaw(_msgSender(), _amount, false);
            IERC20(STAKED_TOKEN).safeTransfer(
                _recipient,
                (_amount * safetyData.collateralisationRatio) / 1e18
            );
            emit Withdraw(_msgSender(), _recipient, _amount);
        } else {
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
            bool exitCooldown = _exitCooldown || (balance.raw - _amount) == 0;
            if (exitCooldown) {
                stakersCooldowns[_msgSender()] = 0;
            }

            // Apply redemption fee
            // e.g. (55e18 / 5e18) - 2e18 = 9e18 / 100 = 9e16
            uint256 feeRate = _calcRedemptionFeeRate(balance.weightedTimestamp);
            // fee = amount * 1e18 / feeRate
            // totalAmount = amount + fee
            // fee = amount * (1e18 - feeRate) / 1e18
            uint256 totalWithdraw = _amountIncludesFee
                ? _amount
                : (_amount * (1e18 + feeRate)) / 1e18;
            uint256 userWithdrawal = (totalWithdraw * 1e18) / (1e18 + feeRate);

            _burnRaw(_msgSender(), totalWithdraw, exitCooldown);
            IERC20(STAKED_TOKEN).safeTransfer(_recipient, userWithdrawal);
            _notifyAdditionalReward(totalWithdraw - userWithdrawal);

            emit Withdraw(_msgSender(), _recipient, _amount);
        }
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
     * @dev TOWRITE
     **/
    function startCooldown() external override {
        _startCooldown();
    }

    /**
     * @dev TOWRITE
     **/
    function endCooldown() external {
        require(stakersCooldowns[_msgSender()] != 0, "No cooldown");

        stakersCooldowns[_msgSender()] = 0;
        _exitCooldown(_msgSender());

        emit CooldownExited(_msgSender());
    }

    /**
     * @dev TOWRITE
     **/
    function _startCooldown() internal {
        require(balanceOf(_msgSender()) != 0, "INVALID_BALANCE_ON_COOLDOWN");

        stakersCooldowns[_msgSender()] = block.timestamp;
        _enterCooldownPeriod(_msgSender());

        emit Cooldown(_msgSender());
    }

    /***************************************
                    ADMIN
    ****************************************/

    /**
     * @dev TOWRITE
     * Trusting that the recollateralisation module has sufficient protections in place
     **/
    function emergencyRecollateralisation()
        external
        onlyRecollateralisationModule
        onlyBeforeRecollateralisation
    {
        // 1. Change collateralisation rate
        safetyData.collateralisationRatio = 1e18 - safetyData.slashingPercentage;
        // 2. Take slashing percentage
        uint256 balance = IERC20(STAKED_TOKEN).balanceOf(address(this));
        IERC20(STAKED_TOKEN).transfer(
            _recollateraliser(),
            (balance * safetyData.slashingPercentage) / 1e18
        );
        // 3. No functions should work anymore because the colRatio has changed
        emit Recollateralised();
    }

    /**
     * @dev TOWRITE
     **/
    function changeSlashingPercentage(uint256 _newRate)
        external
        onlyGovernor
        onlyBeforeRecollateralisation
    {
        require(safetyData.collateralisationRatio == 1e18, "Process already begun");
        require(_newRate <= 5e18, "Cannot exceed 50%");

        safetyData.slashingPercentage = SafeCast.toUint128(_newRate);

        emit SlashRateChanged(_newRate);
    }

    /**
     * @dev TOWRITE
     **/
    function whitelistWrapper(address _wrapper) external onlyGovernor {
        whitelistedWrappers[_wrapper] = true;

        emit WrapperWhitelisted(_wrapper);
    }

    /**
     * @dev TOWRITE
     **/
    function blackListWrapper(address _wrapper) external onlyGovernor {
        whitelistedWrappers[_wrapper] = false;

        emit WrapperBlacklisted(_wrapper);
    }

    /***************************************
            BACKWARDS COMPATIBILITY
    ****************************************/

    /**
     * @dev TOWRITE
     **/
    function createLock(
        uint256 _value,
        uint256 /* _unlockTime */
    ) external {
        _stake(_value, address(0), false);
    }

    /**
     * @dev TOWRITE
     **/
    function increaseLockAmount(uint256 _value) external {
        _stake(_value, address(0), false);
    }

    /**
     * @dev TOWRITE
     **/
    function increaseLockLength(
        uint256 /* _unlockTime */
    ) external virtual {
        return;
    }

    /**
     * @dev TOWRITE
     **/
    function exit() external virtual {
        // Since there is no immediate exit here, this can be called twice
        if (stakersCooldowns[_msgSender()] == 0) {
            _startCooldown();
        } else {
            _withdraw(_balances[_msgSender()].raw, _msgSender(), true, false);
        }
    }

    /***************************************
                    GETTERS
    ****************************************/

    /**
     * @notice Resets the cooldown start date taking into account what has already cooled.
     *      If cooldown has nearly finished and the new staked amount is relatively small,
     *      then the cooldown start date only moves forward a small amount of time.
     *
     *      If cooldown has only just started and the new staked amount is relatively large,
     *      then the cooldown start date moves forward nearly a week.
     *
     *      If staker is not in a cooldown period, return 0.
     *
     * @param _stakedAmountToReceive amount of new rewards being staked.
     * @param _staker Address of the staker depositing rewards.
     * @param _stakedAmountOld balance of staked amount before new amount is added.
     * @return nextCooldownTimestamp new cooldown start timestamp or 0.
     **/
    function getNextCooldownTimestamp(
        uint256 _stakedAmountToReceive,
        address _staker,
        uint256 _stakedAmountOld
    ) public view returns (uint256 nextCooldownTimestamp) {
        uint256 oldCooldownTimestamp = stakersCooldowns[_staker];
        uint256 minimalValidCooldownTimestamp = block.timestamp - COOLDOWN_SECONDS - UNSTAKE_WINDOW;

        // If user has started cooldown and it has not already expired
        if (oldCooldownTimestamp >= minimalValidCooldownTimestamp) {
            // next cooldown = current time - (time already cooled * old staked amount / (old staked amount + new amount being staked))
            uint256 secondsAlreadyCooled = block.timestamp - oldCooldownTimestamp;
            uint256 weightedSecondsAlreadyCooled = (secondsAlreadyCooled * _stakedAmountOld) /
                (_stakedAmountOld + _stakedAmountToReceive);
            nextCooldownTimestamp = block.timestamp - weightedSecondsAlreadyCooled;
        }
    }
}
