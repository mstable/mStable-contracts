// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { ILockedERC20 } from "./interfaces/ILockedERC20.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { HeadlessStakingRewards } from "../../rewards/staking/HeadlessStakingRewards.sol";
import { ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import { SignatureVerifier } from "./deps/SignatureVerifier.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
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
    SignatureVerifier,
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
    /// @notice Tracks the completion of each quest (user => questId => completion)
    mapping(address => mapping(uint256 => bool)) private _questCompletion;
    /// @notice List of quests, whose ID corresponds to their position in the array (from 0)
    Quest[] private _quests;
    /// @notice Timestamp at which the current season started
    uint32 public seasonEpoch;

    /// @notice A whitelisted questMaster who can add quests
    address internal _questMaster;

    event QuestAdded(
        address questMaster,
        uint256 id,
        QuestType model,
        uint16 multiplier,
        QuestStatus status,
        uint32 expiry
    );
    event QuestComplete(address indexed user, uint256 indexed id);
    event QuestExpired(uint16 indexed id);
    event QuestSeasonEnded();

    /***************************************
                    INIT
    ****************************************/

    /**
     * @param _signer Signer address is used to verify completion of quests off chain
     * @param _nexus System nexus
     * @param _rewardsToken Token that is being distributed as a reward. eg MTA
     */
    constructor(
        address _signer,
        address _nexus,
        address _rewardsToken
    ) SignatureVerifier(_signer) HeadlessStakingRewards(_nexus, _rewardsToken) {}

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
        seasonEpoch = SafeCast.toUint32(block.timestamp);
        HeadlessStakingRewards._initialize(_rewardsDistributorArg);
    }

    /**
     * @dev Checks that _msgSender is either governor or the quest master
     */
    modifier questMasterOrGovernor() {
        require(_msgSender() == _questMaster || _msgSender() == _governor(), "Not verified");
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
    function rawBalanceOf(address _account) public view returns (uint256) {
        return _balances[_account].raw;
    }

    /**
     * @dev Scales the balance of a given user by applying multipliers
     */
    function _getBalance(Balance memory _balance) internal pure returns (uint256 balance) {
        // e.g. raw = 1000, questMultiplier = 40, timeMultiplier = 30. Cooldown of 60%
        // e.g. 1000 * (100 + 40) / 100 = 1400
        balance =
            (_balance.raw * (100 + _balance.permMultiplier + _balance.seasonMultiplier)) /
            100;
        // e.g. 1400 * (100 + 30) / 100 = 1820
        balance = (balance * (100 + _balance.timeMultiplier)) / 100;
        // If the user is in cooldown, their balance is temporarily slashed depending on % of withdrawal
        if (_balance.cooldownMultiplier > 0) {
            // e.g. 1820 * (100 - 60) / 100 = 728
            balance = (balance * (100 - _balance.cooldownMultiplier)) / 100;
        }
    }

    /**
     * @dev Raw balance data
     */
    function balanceData(address _account) external view returns (Balance memory) {
        return _balances[_account];
    }

    /**
     * @dev Gets raw quest data
     */
    function getQuest(uint256 _id) external view returns (Quest memory) {
        return _quests[_id];
    }

    /**
     * @dev Gets a users quest completion status
     */
    function getQuestCompletion(address _account, uint256 _id) external view returns (bool) {
        return _questCompletion[_account][_id];
    }

    /***************************************
                    QUESTS
    ****************************************/

    /**
     * @dev Called by questMasters to add a new quest to the system with default 'ACTIVE' status
     * @param _model Type of quest rewards multiplier (does it last forever or just for the season).
     * @param _multiplier Multiplier, from 1 == 1.01x to 100 == 2.00x
     * @param _expiry Timestamp at which quest expires. Note that permanent quests should still be given a timestamp.
     */
    function addQuest(
        QuestType _model,
        uint16 _multiplier,
        uint32 _expiry
    ) external questMasterOrGovernor {
        require(_expiry > block.timestamp + 1 days, "Quest window too small");
        require(_multiplier > 0 && _multiplier <= 50, "Quest multiplier too large > 1.5x");

        _quests.push(
            Quest({
                model: _model,
                multiplier: _multiplier,
                status: QuestStatus.ACTIVE,
                expiry: _expiry
            })
        );

        emit QuestAdded(
            _msgSender(),
            _quests.length - 1,
            _model,
            _multiplier,
            QuestStatus.ACTIVE,
            _expiry
        );
    }

    /**
     * @dev Called by questMasters to expire a quest, setting it's status as EXPIRED. After which it can
     * no longer be completed.
     * @param _id Quest ID (its position in the array)
     */
    function expireQuest(uint16 _id) external questMasterOrGovernor {
        require(_quests.length >= _id, "Quest does not exist");
        require(_quests[_id].status == QuestStatus.ACTIVE, "Quest already expired");

        _quests[_id].status = QuestStatus.EXPIRED;
        if (block.timestamp < _quests[_id].expiry) {
            _quests[_id].expiry = SafeCast.toUint32(block.timestamp);
        }

        emit QuestExpired(_id);
    }

    /**
     * @dev Called by questMasters to start a new quest season. After this, all current
     * seasonMultipliers will be reduced at the next user action (or triggered manually).
     * In order to reduce cost for any keepers, it is suggested to add quests at the start
     * of a new season to incentivise user actions.
     * A new season can only begin after 9 months has passed.
     */
    function startNewQuestSeason() external questMasterOrGovernor {
        require(block.timestamp > (seasonEpoch + 39 weeks), "Season has not elapsed");

        uint256 len = _quests.length;
        for (uint256 i = 0; i < len; i++) {
            Quest memory quest = _quests[i];
            if (quest.model == QuestType.SEASONAL) {
                require(
                    quest.status == QuestStatus.EXPIRED || block.timestamp > quest.expiry,
                    "All seasonal quests must have expired"
                );
            }
        }

        seasonEpoch = SafeCast.toUint32(block.timestamp);

        emit QuestSeasonEnded();
    }

    /**
     * @dev Called by anyone to complete one or more quests for a staker. The user must first collect a signed message
     * from the whitelisted _signer.
     * @param _account Account that has completed the quest
     * @param _ids Quest IDs (its position in the array)
     * @param _signatures Signature from the verified _signer, containing keccak hash of account & id
     */
    function completeQuests(
        address _account,
        uint256[] memory _ids,
        bytes[] calldata _signatures
    ) external {
        uint256 len = _ids.length;
        require(len > 0 && len == _signatures.length, "Invalid args");

        Quest[] memory quests = new Quest[](len);
        for (uint256 i = 0; i < len; i++) {
            require(_validQuest(_ids[i]), "Err: Invalid Quest");
            require(!hasCompleted(_account, _ids[i]), "Err: Already Completed");
            require(verify(_account, _ids[i], _signatures[i]), "Err: Invalid Signature");

            // store user quest has completed
            _questCompletion[_account][_ids[i]] = true;
            quests[i] = _quests[_ids[i]];

            emit QuestComplete(_account, _ids[i]);
        }

        _applyQuestMultiplier(_account, quests);
    }

    /**
     * @dev Called by anyone to poke the timestamp of a given account. This allows users to
     * effectively 'claim' any new timeMultiplier, but will revert if there is no change there.
     */
    function reviewTimestamp(address _account) external {
        _reviewWeightedTimestamp(_account);
    }

    /**
     * @dev Simply checks if a quest is valid. Quests are valid if their id exists,
     * they have an ACTIVE status and they have not yet reached their expiry timestamp.
     * @param _id Position of quest in array
     * @return bool with validity status
     */
    function _validQuest(uint256 _id) internal view returns (bool) {
        return
            _quests.length >= _id &&
            _quests[_id].status == QuestStatus.ACTIVE &&
            block.timestamp < _quests[_id].expiry;
    }

    /**
     * @dev Simply checks if a given user has already completed a given quest
     * @param _account User address
     * @param _id Position of quest in array
     * @return bool with completion status
     */
    function hasCompleted(address _account, uint256 _id) public view returns (bool) {
        return _questCompletion[_account][_id];
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
     * @param _percentage Percentage of total stake to cooldown for, where 100% = 1e18
     */
    function _enterCooldownPeriod(address _account, uint256 _percentage)
        internal
        updateReward(_account)
    {
        require(_account != address(0), "Invalid address");
        require(_percentage > 0 && _percentage <= 1e18, "Must choose between 0 and 100%");

        // 1. Get current balance
        (Balance memory oldBalance, uint256 oldScaledBalance) = _prepareOldBalance(_account);

        // 2. Set weighted timestamp and enter cooldown
        _balances[_account].timeMultiplier = _timeMultiplier(oldBalance.weightedTimestamp);
        // e.g. 1e18 / 1e16 = 100, 2e16 / 1e16 = 2, 1e15/1e16 = 0
        _balances[_account].cooldownMultiplier = SafeCast.toUint16(_percentage / 1e16);

        // 3. Update scaled balance
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
        _balances[_account].cooldownMultiplier = 0;

        // 3. Update scaled balance
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
     * @dev Adds the multiplier awarded from quest completion to a users data, taking the opportunity
     * to check time multipliers etc.
     * @param _account Address of user that should be updated
     * @param _questsCompleted Quest that has just been completed
     */
    function _applyQuestMultiplier(address _account, Quest[] memory _questsCompleted)
        internal
        virtual
        updateReward(_account)
    {
        require(_account != address(0), "Invalid address");

        // 1. Get current balance & update questMultiplier
        (Balance memory oldBalance, uint256 oldScaledBalance) = _prepareOldBalance(_account);
        uint256 len = _questsCompleted.length;
        for (uint256 i = 0; i < len; i++) {
            Quest memory quest = _questsCompleted[i];
            if (quest.model == QuestType.PERMANENT) {
                _balances[_account].permMultiplier += quest.multiplier;
            } else {
                _balances[_account].seasonMultiplier += quest.multiplier;
            }
        }

        // 2. Take the opportunity to set weighted timestamp, if it changes
        _balances[_account].timeMultiplier = _timeMultiplier(oldBalance.weightedTimestamp);

        // 3. Update scaled balance
        _settleScaledBalance(_account, oldScaledBalance);
    }

    /**
     * @dev Called to mint from raw tokens. Adds raw to a users balance, and then propagates the scaledBalance.
     * Importantly, when a user stakes more, their weightedTimestamp is reduced proportionate to their stake.
     * @param _account Address of user to credit
     * @param _rawAmount Raw amount of tokens staked
     * @param _exitCooldown Reset the users cooldown slash
     */
    function _mintRaw(
        address _account,
        uint256 _rawAmount,
        bool _exitCooldown
    ) internal virtual updateReward(_account) {
        require(_account != address(0), "ERC20: mint to the zero address");

        // 1. Get and update current balance
        (Balance memory oldBalance, uint256 oldScaledBalance) = _prepareOldBalance(_account);
        _balances[_account].raw = oldBalance.raw + SafeCast.toUint128(_rawAmount);

        // 2. Exit cooldown if necessary
        if (_exitCooldown) _balances[_account].cooldownMultiplier = 0;

        // 3. Set weighted timestamp
        //  i) For new _account, set up weighted timestamp
        if (oldBalance.weightedTimestamp == 0) {
            _balances[_account].weightedTimestamp = SafeCast.toUint32(block.timestamp);
            _mintScaled(_account, _getBalance(_balances[_account]));
            return;
        }
        //  ii) For previous minters, recalculate time held
        //      Calc new weighted timestamp
        uint256 secondsHeld = (block.timestamp - oldBalance.weightedTimestamp) * oldBalance.raw;
        uint256 newWeightedTs = secondsHeld / (oldBalance.raw + (_rawAmount / 2));
        _balances[_account].weightedTimestamp = SafeCast.toUint32(block.timestamp - newWeightedTs);

        uint16 timeMultiplier = _timeMultiplier(SafeCast.toUint32(newWeightedTs));
        _balances[_account].timeMultiplier = timeMultiplier;

        // 3. Update scaled balance
        _settleScaledBalance(_account, oldScaledBalance);
    }

    /**
     * @dev Called to burn a given amount of raw tokens.
     * @param _account Address of user
     * @param _rawAmount Raw amount of tokens to remove
     * @param _cooldownPercentage Set new cooldown percentage
     */
    function _burnRaw(
        address _account,
        uint256 _rawAmount,
        uint128 _cooldownPercentage
    ) internal virtual updateReward(_account) {
        require(_account != address(0), "ERC20: burn from the zero address");

        // 1. Get and update current balance
        (Balance memory oldBalance, uint256 oldScaledBalance) = _prepareOldBalance(_account);
        require(oldBalance.raw >= _rawAmount, "ERC20: burn amount exceeds balance");
        unchecked {
            _balances[_account].raw = oldBalance.raw - SafeCast.toUint128(_rawAmount);
        }

        // 2. Change the cooldown percentage based on size of recent withdrawal
        _balances[_account].cooldownMultiplier = SafeCast.toUint16(_cooldownPercentage / 1e16);

        // 3. Set back scaled time
        // e.g. stake 10 for 100 seconds, withdraw 5.
        //      secondsHeld = (100 - 0) * (10 - 1.25) = 875
        uint256 secondsHeld = (block.timestamp - oldBalance.weightedTimestamp) *
            (oldBalance.raw - (_rawAmount / 4));
        //      newWeightedTs = 875 / 100 = 87.5
        uint256 newWeightedTs = secondsHeld / oldBalance.raw;
        _balances[_account].weightedTimestamp = SafeCast.toUint32(block.timestamp - newWeightedTs);

        uint16 timeMultiplier = _timeMultiplier(SafeCast.toUint32(newWeightedTs));
        _balances[_account].timeMultiplier = timeMultiplier;

        // 4. Update scaled balance
        _burnScaled(_account, oldScaledBalance - _getBalance(_balances[_account]));
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
        _checkForSeasonFinish(oldBalance, _account);
    }

    /**
     * @dev Checks if the season has just finished between now and the users last action.
     * If it has, we reset the seasonMultiplier. Either way, we update the lastAction for the user.
     * NOTE - it is important that this is called as a hook before each state change operation
     * @param _balance Struct containing all users balance information
     * @param _account Address of user that should be updated
     */
    function _checkForSeasonFinish(Balance memory _balance, address _account) private {
        // If the last action was before current season, then reset the season timing
        if (_hasFinishedSeason(_balance)) {
            // Remove 85% of the multiplier gained in this season
            _balances[_account].seasonMultiplier = (_balance.seasonMultiplier * 15) / 100;
        }
        _balances[_account].lastAction = SafeCast.toUint32(block.timestamp);
    }

    /**
     * @dev Simple view fn to check if the users last action was before the starting of the current season
     */
    function _hasFinishedSeason(Balance memory _balance) internal view returns (bool) {
        return _balance.lastAction < seasonEpoch;
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
        if (_hasFinishedSeason(_balances[_account])) {
            // 1. Get current balance & trigger season finish
            (, uint256 oldScaledBalance) = _prepareOldBalance(_account);

            // 3. Update scaled balance
            _settleScaledBalance(_account, oldScaledBalance);
        }
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
