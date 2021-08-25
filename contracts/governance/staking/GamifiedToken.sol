// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { ILockedERC20 } from "./interfaces/ILockedERC20.sol";
import { HeadlessStakingRewards } from "../../rewards/staking/HeadlessStakingRewards.sol";
import { QuestManager } from "./QuestManager.sol";
import "./GamifiedTokenStructs.sol";

/**
 * @title GamifiedToken
 * @notice GamifiedToken is a non-transferrable ERC20 token that has both a raw balance and a scaled balance.
 * Scaled balance is determined by quests a user completes, and the length of time they keep the raw balance wrapped.
 * QuestMasters can add new quests for stakers to complete, for which they are rewarded with permanent or seasonal multipliers.
 * @author mStable
 * @dev Originally forked from openzeppelin-contracts-upgradeable/contracts/token/ERC20/ERC20Upgradeable.sol
 * Changes:
 *   - Removed the transfer, transferFrom, approve fns to make non-transferrable
 *   - Removed `_allowances` storage
 *   - Removed `_beforeTokenTransfer` hook
 *   - Replaced standard uint256 balance with a single struct containing all data from which the scaledBalance can be derived
 *   - Quest system implemented that tracks a users quest status and applies multipliers for them
 **/
abstract contract GamifiedToken is
    ILockedERC20,
    Initializable,
    ContextUpgradeable,
    HeadlessStakingRewards
{
    /// @notice name of this token (ERC20)
    string public override name;
    /// @notice symbol of this token (ERC20)
    string public override symbol;
    /// @notice number of decimals of this token (ERC20)
    uint8 public constant override decimals = 18;

    /// @notice User balance structs containing all data needed to scale balance
    mapping(address => Balance) internal _balances;
    /// @notice Tracks the cooldowns for all users
    mapping(address => CooldownData) public stakersCooldowns;
    /// @notice Quest Manager
    QuestManager public immutable questManager;

    /***************************************
                    INIT
    ****************************************/

    /**
     * @param _nexus System nexus
     * @param _rewardsToken Token that is being distributed as a reward. eg MTA
     */
    constructor(
        address _nexus,
        address _rewardsToken,
        address _questManager
    ) HeadlessStakingRewards(_nexus, _rewardsToken) {
        questManager = QuestManager(_questManager);
    }

    /**
     * @param _nameArg Token name
     * @param _symbolArg Token symbol
     * @param _rewardsDistributorArg mStable Rewards Distributor
     */
    function __GamifiedToken_init(
        string memory _nameArg,
        string memory _symbolArg,
        address _rewardsDistributorArg
    ) internal initializer {
        __Context_init_unchained();
        name = _nameArg;
        symbol = _symbolArg;
        HeadlessStakingRewards._initialize(_rewardsDistributorArg);
    }

    /**
     * @dev Checks that _msgSender is the quest Manager
     */
    modifier onlyQuestManager() {
        require(_msgSender() == address(questManager), "Not verified");
        _;
    }

    /***************************************
                    VIEWS
    ****************************************/

    /**
     * @dev Total sum of all scaled balances
     * In this instance, leave to the child token.
     */
    function totalSupply()
        public
        view
        virtual
        override(HeadlessStakingRewards, ILockedERC20)
        returns (uint256);

    /**
     * @dev Simply gets scaled balance
     * @return scaled balance for user
     */
    function balanceOf(address _account)
        public
        view
        virtual
        override(HeadlessStakingRewards, ILockedERC20)
        returns (uint256)
    {
        return _getBalance(_balances[_account]);
    }

    /**
     * @dev Simply gets raw balance
     * @return raw balance for user
     */
    function rawBalanceOf(address _account) public view returns (uint256, uint256) {
        return (_balances[_account].raw, stakersCooldowns[_account].units);
    }

    /**
     * @dev Scales the balance of a given user by applying multipliers
     */
    function _getBalance(Balance memory _balance) internal pure returns (uint256 balance) {
        // e.g. raw = 1000, questMultiplier = 40, timeMultiplier = 30. Cooldown of 60%
        // e.g. 1000 * (100 + 40) / 100 = 1400
        balance = (_balance.raw * (100 + _balance.questMultiplier)) / 100;
        // e.g. 1400 * (100 + 30) / 100 = 1820
        balance = (balance * (100 + _balance.timeMultiplier)) / 100;
    }

    /**
     * @notice Raw staked balance without any multipliers
     */
    function balanceData(address _account) external view returns (Balance memory) {
        return _balances[_account];
    }

    /***************************************
                    QUESTS
    ****************************************/

    /**
     * @dev Called by anyone to poke the timestamp of a given account. This allows users to
     * effectively 'claim' any new timeMultiplier, but will revert if there is no change there.
     */
    function reviewTimestamp(address _account) external {
        _reviewWeightedTimestamp(_account);
    }

    /**
     * @dev Adds the multiplier awarded from quest completion to a users data, taking the opportunity
     * to check time multipliers etc.
     * @param _account Address of user that should be updated
     * @param _newMultiplier New Quest Multiplier
     */
    function applyQuestMultiplier(address _account, uint16 _newMultiplier)
        external
        onlyQuestManager
    {
        require(_account != address(0), "Invalid address");

        // 1. Get current balance & update questMultiplier, only if user has a balance
        Balance memory oldBalance = _balances[_account];
        uint256 oldScaledBalance = _getBalance(oldBalance);
        if (oldScaledBalance > 0) {
            _applyQuestMultiplier(_account, oldBalance, oldScaledBalance, _newMultiplier);
        }
    }

    function _applyQuestMultiplier(
        address _account,
        Balance memory _oldBalance,
        uint256 _oldScaledBalance,
        uint16 _newMultiplier
    ) internal updateReward(_account) {
        _balances[_account].questMultiplier = _newMultiplier;

        // 2. Take the opportunity to set weighted timestamp, if it changes
        _balances[_account].timeMultiplier = _timeMultiplier(_oldBalance.weightedTimestamp);

        // 3. Update scaled balance
        _settleScaledBalance(_account, _oldScaledBalance);
    }

    /**
     * @dev Gets the multiplier awarded for a given weightedTimestamp
     * @param _ts WeightedTimestamp of a user
     * @return timeMultiplier Ranging from 20 (0.2x) to 60 (0.6x)
     */
    function _timeMultiplier(uint32 _ts) internal view returns (uint16 timeMultiplier) {
        // If the user has no ts yet, they are not in the system
        if (_ts == 0) return 0;

        uint256 hodlLength = block.timestamp - _ts;
        if (hodlLength < 13 weeks) {
            // 0-3 months = 1x
            return 0;
        } else if (hodlLength < 26 weeks) {
            // 3 months = 1.2x
            return 20;
        } else if (hodlLength < 52 weeks) {
            // 6 months = 1.3x
            return 30;
        } else if (hodlLength < 78 weeks) {
            // 12 months = 1.4x
            return 40;
        } else if (hodlLength < 104 weeks) {
            // 18 months = 1.5x
            return 50;
        } else {
            // > 24 months = 1.6x
            return 60;
        }
    }

    /***************************************
                BALANCE CHANGES
    ****************************************/

    /**
     * @dev Entering a cooldown period means a user wishes to withdraw. With this in mind, their balance
     * should be reduced until they have shown more commitment to the system
     * @param _account Address of user that should be cooled
     * @param _units Units to cooldown for
     */
    function _enterCooldownPeriod(address _account, uint256 _units)
        internal
        updateReward(_account)
    {
        require(_account != address(0), "Invalid address");

        // 1. Get current balance
        (Balance memory oldBalance, uint256 oldScaledBalance) = _prepareOldBalance(_account);
        CooldownData memory cooldownData = stakersCooldowns[_account];
        uint128 totalUnits = _balances[_account].raw + cooldownData.units;
        require(_units > 0 && _units <= totalUnits, "Must choose between 0 and 100%");

        // 2. Set weighted timestamp and enter cooldown
        _balances[_account].timeMultiplier = _timeMultiplier(oldBalance.weightedTimestamp);
        // e.g. 1e18 / 1e16 = 100, 2e16 / 1e16 = 2, 1e15/1e16 = 0
        _balances[_account].raw = totalUnits - SafeCast.toUint128(_units);

        // 3. Set cooldown data
        stakersCooldowns[_account] = CooldownData({
            timestamp: SafeCast.toUint128(block.timestamp),
            units: SafeCast.toUint128(_units)
        });

        // 4. Update scaled balance
        _settleScaledBalance(_account, oldScaledBalance);
    }

    /**
     * @dev Exiting the cooldown period explicitly resets the users cooldown window and their balance
     * @param _account Address of user that should be exited
     */
    function _exitCooldownPeriod(address _account) internal updateReward(_account) {
        require(_account != address(0), "Invalid address");

        // 1. Get current balance
        (Balance memory oldBalance, uint256 oldScaledBalance) = _prepareOldBalance(_account);

        // 2. Set weighted timestamp and enter cooldown
        _balances[_account].timeMultiplier = _timeMultiplier(oldBalance.weightedTimestamp);
        _balances[_account].raw += stakersCooldowns[_account].units;

        // 3. Set cooldown data
        stakersCooldowns[_account] = CooldownData(0, 0);

        // 4. Update scaled balance
        _settleScaledBalance(_account, oldScaledBalance);
    }

    /**
     * @dev Pokes the weightedTimestamp of a given user and checks if it entitles them
     * to a better timeMultiplier. If not, it simply reverts as there is nothing to update.
     * @param _account Address of user that should be updated
     */
    function _reviewWeightedTimestamp(address _account) internal updateReward(_account) {
        require(_account != address(0), "Invalid address");

        // 1. Get current balance
        (Balance memory oldBalance, uint256 oldScaledBalance) = _prepareOldBalance(_account);

        // 2. Set weighted timestamp, if it changes
        uint16 newTimeMultiplier = _timeMultiplier(oldBalance.weightedTimestamp);
        require(newTimeMultiplier != oldBalance.timeMultiplier, "Nothing worth poking here");
        _balances[_account].timeMultiplier = newTimeMultiplier;

        // 3. Update scaled balance
        _settleScaledBalance(_account, oldScaledBalance);
    }

    /**
     * @dev Called to mint from raw tokens. Adds raw to a users balance, and then propagates the scaledBalance.
     * Importantly, when a user stakes more, their weightedTimestamp is reduced proportionate to their stake.
     * @param _account Address of user to credit
     * @param _rawAmount Raw amount of tokens staked
     * @param _exitCooldown Should we end any cooldown?
     */
    function _mintRaw(
        address _account,
        uint256 _rawAmount,
        bool _exitCooldown
    ) internal virtual updateReward(_account) {
        require(_account != address(0), "ERC20: mint to the zero address");

        // 1. Get and update current balance
        (Balance memory oldBalance, uint256 oldScaledBalance) = _prepareOldBalance(_account);
        CooldownData memory cooldownData = stakersCooldowns[_account];
        uint256 totalRaw = oldBalance.raw + cooldownData.units;
        _balances[_account].raw = oldBalance.raw + SafeCast.toUint128(_rawAmount);

        // 2. Exit cooldown if necessary
        if (_exitCooldown) {
            _balances[_account].raw += cooldownData.units;
            stakersCooldowns[_account] = CooldownData(0, 0);
        }

        // 3. Set weighted timestamp
        //  i) For new _account, set up weighted timestamp
        if (oldBalance.weightedTimestamp == 0) {
            _balances[_account].weightedTimestamp = SafeCast.toUint32(block.timestamp);
            _mintScaled(_account, _getBalance(_balances[_account]));
            return;
        }
        //  ii) For previous minters, recalculate time held
        //      Calc new weighted timestamp
        uint256 oldWeighredSecondsHeld = (block.timestamp - oldBalance.weightedTimestamp) *
            totalRaw;
        uint256 newSecondsHeld = oldWeighredSecondsHeld / (totalRaw + (_rawAmount / 2));
        uint32 newWeightedTs = SafeCast.toUint32(block.timestamp - newSecondsHeld);
        _balances[_account].weightedTimestamp = newWeightedTs;

        uint16 timeMultiplier = _timeMultiplier(newWeightedTs);
        _balances[_account].timeMultiplier = timeMultiplier;

        // 3. Update scaled balance
        _settleScaledBalance(_account, oldScaledBalance);
    }

    /**
     * @dev Called to burn a given amount of raw tokens.
     * @param _account Address of user
     * @param _rawAmount Raw amount of tokens to remove
     * @param _exitCooldown Exit the cooldown?
     * @param _finalise Has recollateralisation happened? If so, everything is cooled down
     */
    function _burnRaw(
        address _account,
        uint256 _rawAmount,
        bool _exitCooldown,
        bool _finalise
    ) internal virtual updateReward(_account) {
        require(_account != address(0), "ERC20: burn from zero address");

        // 1. Get and update current balance
        (Balance memory oldBalance, uint256 oldScaledBalance) = _prepareOldBalance(_account);
        CooldownData memory cooldownData = stakersCooldowns[_msgSender()];
        uint256 totalRaw = oldBalance.raw + cooldownData.units;
        // 1.1. If _finalise, move everything to cooldown
        if (_finalise) {
            _balances[_account].raw = 0;
            stakersCooldowns[_account].units = SafeCast.toUint128(totalRaw);
            cooldownData.units = SafeCast.toUint128(totalRaw);
        }
        // 1.2. Update
        require(cooldownData.units >= _rawAmount, "ERC20: burn amount > balance");
        unchecked {
            stakersCooldowns[_account].units -= SafeCast.toUint128(_rawAmount);
        }

        // 2. If we are exiting cooldown, reset the balance
        if (_exitCooldown) {
            _balances[_account].raw += stakersCooldowns[_account].units;
            stakersCooldowns[_account] = CooldownData(0, 0);
        }

        // 3. Set back scaled time
        // e.g. stake 10 for 100 seconds, withdraw 5.
        //      secondsHeld = (100 - 0) * (10 - 1.25) = 875
        uint256 secondsHeld = (block.timestamp - oldBalance.weightedTimestamp) *
            (totalRaw - (_rawAmount / 4));
        //      newWeightedTs = 875 / 100 = 87.5
        uint256 newSecondsHeld = secondsHeld / totalRaw;
        uint32 newWeightedTs = SafeCast.toUint32(block.timestamp - newSecondsHeld);
        _balances[_account].weightedTimestamp = newWeightedTs;

        uint16 timeMultiplier = _timeMultiplier(newWeightedTs);
        _balances[_account].timeMultiplier = timeMultiplier;

        // 4. Update scaled balance
        _settleScaledBalance(_account, oldScaledBalance);
    }

    /***************************************
                    PRIVATE
    updateReward should already be called by now
    ****************************************/

    /**
     * @dev Fetches the balance of a given user, scales it, and also takes the opportunity
     * to check if the season has just finished between now and their last action.
     * @param _account Address of user to fetch
     * @return oldBalance struct containing all balance information
     * @return oldScaledBalance scaled balance after applying multipliers
     */
    function _prepareOldBalance(address _account)
        private
        returns (Balance memory oldBalance, uint256 oldScaledBalance)
    {
        // Get the old balance
        oldBalance = _balances[_account];
        oldScaledBalance = _getBalance(oldBalance);
        // Take the opportunity to check for season finish
        _balances[_account].questMultiplier = questManager.checkForSeasonFinish(_account);
    }

    /**
     * @dev Settles the scaled balance of a given account. The reason this is done here, is because
     * in each of the write functions above, there is the chance that a users balance can go down,
     * requiring to burn sacled tokens. This could happen at the end of a season when multipliers are slashed.
     * This is called after updating all multipliers etc.
     * @param _account Address of user that should be updated
     * @param _oldScaledBalance Previous scaled balance of the user
     */
    function _settleScaledBalance(address _account, uint256 _oldScaledBalance) private {
        uint256 newScaledBalance = _getBalance(_balances[_account]);
        if (newScaledBalance > _oldScaledBalance) {
            _mintScaled(_account, newScaledBalance - _oldScaledBalance);
        }
        // This can happen if the user moves back a time class, but is unlikely to result in a negative mint
        else {
            _burnScaled(_account, _oldScaledBalance - newScaledBalance);
        }
    }

    /**
     * @dev Propagates the minting of the tokens downwards.
     * @param _account Address of user that has minted
     * @param _amount Amount of scaled tokens minted
     */
    function _mintScaled(address _account, uint256 _amount) private {
        emit Transfer(address(0), _account, _amount);

        _afterTokenTransfer(address(0), _account, _amount);
    }

    /**
     * @dev Propagates the burning of the tokens downwards.
     * @param _account Address of user that has burned
     * @param _amount Amount of scaled tokens burned
     */
    function _burnScaled(address _account, uint256 _amount) private {
        emit Transfer(_account, address(0), _amount);

        _afterTokenTransfer(_account, address(0), _amount);
    }

    /***************************************
                    HOOKS
    ****************************************/

    /**
     * @dev Triggered after a user claims rewards from the HeadlessStakingRewards. Used
     * to check for season finish. If it has not, then do not spend gas updating the other vars.
     * @param _account Address of user that has burned
     */
    function _claimRewardHook(address _account) internal override {
        // if (_hasFinishedSeason(_balances[_account])) {
        //     // 1. Get current balance & trigger season finish
        //     (, uint256 oldScaledBalance) = _prepareOldBalance(_account);
        //     // 3. Update scaled balance
        //     _settleScaledBalance(_account, oldScaledBalance);
        // }
    }

    /**
     * @dev Unchanged from OpenZeppelin. Used in child contracts to react to any balance changes.
     */
    function _afterTokenTransfer(
        address _from,
        address _to,
        uint256 _amount
    ) internal virtual {}

    uint256[43] private __gap;
}
