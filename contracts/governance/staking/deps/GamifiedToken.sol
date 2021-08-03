// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import { ILockedERC20 } from "./ILockedERC20.sol";
import { ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { SignatureVerifier } from "./SignatureVerifier.sol";
import { HeadlessStakingRewards } from "../../../rewards/staking/HeadlessStakingRewards.sol";

/**
 * @dev Forked from https://github.com/OpenZeppelin/openzeppelin-contracts-upgradeable/blob/master/contracts/token/ERC20/ERC20Upgradeable.sol
 * Changes:
 *   - Removed the transfer, transferFrom, approve fns
 *   - Removed `_allowances` storage
 */
abstract contract GamifiedToken is
    Initializable,
    ContextUpgradeable,
    ILockedERC20,
    SignatureVerifier,
    HeadlessStakingRewards
{
    struct Balance {
        uint128 raw;
        uint32 weightedTimestamp;
        uint32 lastAction;
        uint16 permMultiplier;
        uint16 seasonMultiplier;
        uint16 timeMultiplier;
        // bool isInCooldown;
    }
    enum QuestType {
        PERMANENT,
        SEASONAL
    }
    enum QuestStatus {
        ACTIVE,
        EXPIRED
    }
    struct Quest {
        QuestType model;
        uint16 multiplier;
        QuestStatus status;
        uint32 expiry;
    }
    enum CompletionStatus {
        NOT_COMPLETE,
        COMPLETE
    }

    uint256 private _totalSupply;

    string private _name;
    string private _symbol;

    // TODO - make this more efficient?
    uint32 private _seasonEpoch;

    mapping(address => Balance) internal _balances;
    mapping(address => CompletionStatus[]) private _questCompletion;
    // 10 = 1.1x multiplier, 20 = 1.20x multiplier
    // There are some variables in quests.
    // 1. Is the effect permanent or temporary (subject to seasonal slashing)
    // 2. Is the completion of the quest time bound or open ended?
    // 3. Has the quest been slashed?
    Quest[] private _quests;

    address internal questMaster;

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

    constructor(
        address _signer,
        address _nexus,
        address _rewardsToken,
        uint256 _duration
    ) SignatureVerifier(_signer) HeadlessStakingRewards(_nexus, _rewardsToken, _duration) {}

    /**
     * @dev
     */
    function __GamifiedToken_init(
        string memory name_,
        string memory symbol_,
        address rewardsDistributorArg_
    ) internal initializer {
        __Context_init_unchained();
        _name = name_;
        _symbol = symbol_;
        _seasonEpoch = SafeCast.toUint32(block.timestamp);
        HeadlessStakingRewards._initialize(rewardsDistributorArg_);
    }

    modifier questMasterOrGovernor() {
        require(_msgSender() == questMaster || _msgSender() == _governor(), "Not verified");
        _;
    }

    /***************************************
                    VIEWS
    ****************************************/

    /**
     * @dev
     */
    function name() public view virtual override returns (string memory) {
        return _name;
    }

    /**
     * @dev
     */
    function symbol() public view virtual override returns (string memory) {
        return _symbol;
    }

    /**
     * @dev
     */
    function decimals() public view virtual override returns (uint8) {
        return 18;
    }

    /**
     * @dev
     */
    function totalSupply()
        public
        view
        virtual
        override(HeadlessStakingRewards, ILockedERC20)
        returns (uint256)
    {
        return _totalSupply;
    }

    /**
     * @dev See {IERC20-balanceOf}.
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
     * @dev
     */
    function _getBalance(Balance memory _balance) internal pure returns (uint256 balance) {
        balance =
            (_balance.raw *
                (100 +
                    _balance.permMultiplier +
                    _balance.seasonMultiplier +
                    _balance.timeMultiplier)) /
            100;
        // if(isInCooldown)
        //     return balance/0.6;
    }

    /***************************************
                    QUESTS
    ****************************************/

    /**
     * @dev
     */
    function addQuest(
        QuestType _model,
        uint16 _multiplier,
        uint32 _expiry
    ) external questMasterOrGovernor {
        // TODO - more validation needed here? i.e. adding too many quests
        require(_expiry > block.timestamp + 1 days, "Quest window too small");
        require(_multiplier <= 100, "Quest multiplier too large (> 2x)");

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
     * @dev
     */
    function expireQuest(uint16 _id) external questMasterOrGovernor {
        require(_quests.length >= _id, "Quest does not exist");
        require(
            _quests[_id].status == QuestStatus.ACTIVE || block.timestamp < _quests[_id].expiry,
            "Quest already expired"
        );
        _quests[_id].status = QuestStatus.EXPIRED;

        emit QuestExpired(_id);
    }

    /**
     * @dev
     */
    function endQuestSeason() external questMasterOrGovernor {
        require(block.timestamp > (_seasonEpoch + 39 weeks), "Not enough time elapsed in season");

        _seasonEpoch = SafeCast.toUint32(block.timestamp);

        emit QuestSeasonEnded();
    }

    /**
     * @dev
     */
    function completeQuest(
        address _account,
        uint256 _id,
        bytes calldata _signature
    ) external {
        require(_validQuest(_id), "Err: Invalid Quest");
        require(!_hasCompleted(_account, _id), "Err: Already Completed");
        require(verify(_account, _id, _signature), "Err: Invalid Signature");

        // TODO - is this valid? dont think so
        _questCompletion[_account][_id] = CompletionStatus.COMPLETE;

        _applyQuestMultiplier(_account, _quests[_id]);

        emit QuestComplete(_account, _id);
    }

    /**
     * @dev
     */
    function pokeTimestamp(address _account) external {
        _pokeWeightedTimestamp(_account);
    }

    /**
     * @dev
     */
    function _validQuest(uint256 _id) internal view returns (bool) {
        // Checks if a quest exists, is active, and not expired
        return
            _quests.length >= _id &&
            _quests[_id].status == QuestStatus.ACTIVE &&
            block.timestamp < _quests[_id].expiry;
    }

    /**
     * @dev
     */
    function _hasCompleted(address _account, uint256 _id) internal view returns (bool) {
        return _questCompletion[_account][_id] != CompletionStatus.NOT_COMPLETE;
    }

    /**
     * @dev
     */
    function _timeMultiplier(uint32 _ts) internal pure returns (uint16 timeMultiplier) {
        // weighted hodling tiers
        // 3 months = 1.2x
        // 6 months = 1.3x
        // 12 months = 1.4x
        // 18 months = 1.5x
        // 24 months = 1.6x
        // e.g. stake 100 for 1 months = 100 "weightedTimestamp"
        //      stake 100 again.. new "weightedTimestamp" = 100/200 = 0.5
        if (_ts < 13 weeks) {
            return 0;
        } else if (_ts < 26 weeks) {
            return 20;
        } else if (_ts < 52 weeks) {
            return 30;
        } else if (_ts < 78 weeks) {
            return 40;
        } else if (_ts < 104 weeks) {
            return 50;
        } else {
            return 60;
        }
    }

    /***************************************
                STATE CHANGES
    ****************************************/

    /**
     * @dev
     */
    function _pokeWeightedTimestamp(address _account) internal {
        require(_account != address(0), "ERC20: mint to the zero address");
        _beforeBalanceChange(_account);

        // 1. Get current balance
        (Balance memory oldBalance, uint256 oldScaledBalance) = _prepareOldBalance(_account);

        // 2. Set weighted timestamp, if it changes
        uint16 newTimeMultiplier = _timeMultiplier(oldBalance.weightedTimestamp);
        require(newTimeMultiplier != oldBalance.timeMultiplier, "Nothing worth poking here");
        _balances[_account].timeMultiplier = newTimeMultiplier;

        // 3. Update scaled balance
        _mintScaled(_account, _getBalance(_balances[_account]) - oldScaledBalance);
    }

    /**
     * @dev
     */
    function _applyQuestMultiplier(address _account, Quest memory _quest) internal virtual {
        require(_account != address(0), "ERC20: mint to the zero address");
        _beforeBalanceChange(_account);

        // 1. Get current balance & update questMultiplier
        (Balance memory oldBalance, uint256 oldScaledBalance) = _prepareOldBalance(_account);
        if (_quest.model == QuestType.PERMANENT) {
            _balances[_account].permMultiplier += _quest.multiplier;
        } else {
            _balances[_account].seasonMultiplier += _quest.multiplier;
        }

        // 2. Take the opportunity to set weighted timestamp, if it changes
        _balances[_account].timeMultiplier = _timeMultiplier(oldBalance.weightedTimestamp);

        // 3. Update scaled balance
        _mintScaled(_account, _getBalance(_balances[_account]) - oldScaledBalance);
    }

    /**
     * @dev
     */
    function _mintRaw(address _account, uint256 _rawAmount) internal virtual {
        require(_account != address(0), "ERC20: mint to the zero address");
        _beforeBalanceChange(_account);

        // 1. Get and update current balance
        (Balance memory oldBalance, uint256 oldScaledBalance) = _prepareOldBalance(_account);
        _balances[_account].raw = oldBalance.raw + SafeCast.toUint128(_rawAmount);

        // 2. Set weighted timestamp
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
        // TODO - more efficient way of getting this data
        uint256 newScaledBalance = _getBalance(_balances[_account]);
        if (newScaledBalance > oldScaledBalance) {
            _mintScaled(_account, newScaledBalance - oldScaledBalance);
        }
        // This can happen if the user moves back a time class, but is unlikely to result in a negative mint
        else {
            _burnScaled(_account, oldScaledBalance - newScaledBalance);
        }
    }

    /**
     * @dev
     */
    function _burnRaw(address _account, uint256 _rawAmount) internal virtual {
        require(_account != address(0), "ERC20: burn from the zero address");
        _beforeBalanceChange(_account);

        // 1. Get and update current balance
        (Balance memory oldBalance, uint256 oldScaledBalance) = _prepareOldBalance(_account);
        require(oldBalance.raw >= _rawAmount, "ERC20: burn amount exceeds balance");
        unchecked {
            _balances[_account].raw = oldBalance.raw - SafeCast.toUint128(_rawAmount);
        }

        // 2. Set back scaled time
        // e.g. stake 10 for 100 seconds, withdraw 5.
        //      secondsHeld = (100 - 0) * (10 - 1.25) = 875
        uint256 secondsHeld = (block.timestamp - oldBalance.weightedTimestamp) *
            (oldBalance.raw - (_rawAmount / 4));
        //      newWeightedTs = 875 / 100 = 87.5
        uint256 newWeightedTs = secondsHeld / oldBalance.raw;
        _balances[_account].weightedTimestamp = SafeCast.toUint32(block.timestamp - newWeightedTs);

        uint16 timeMultiplier = _timeMultiplier(SafeCast.toUint32(newWeightedTs));
        _balances[_account].timeMultiplier = timeMultiplier;

        // 3. Update scaled balance
        _burnScaled(_account, oldScaledBalance - _getBalance(_balances[_account]));
    }

    /**
     * @dev
     */
    function _mintScaled(address _account, uint256 _amount) internal virtual {
        _totalSupply += _amount;
        emit Transfer(address(0), _account, _amount);

        // AfterTokenTransfer has scaled voting power
        _afterTokenTransfer(address(0), _account, _amount);
    }

    /**
     * @dev
     */
    function _burnScaled(address _account, uint256 _amount) internal virtual {
        _totalSupply -= _amount;

        emit Transfer(_account, address(0), _amount);

        _afterTokenTransfer(_account, address(0), _amount);
    }

    /**
     * @dev Called before every state change op to fetch old balance and update the 'lastAction' timestamp
     */
    function _prepareOldBalance(address _account)
        internal
        returns (Balance memory oldBalance, uint256 oldScaledBalance)
    {
        // Get the old balance
        oldBalance = _balances[_account];
        oldScaledBalance = _getBalance(oldBalance);
        // Take the opportunity to check for season finish
        _checkForSeasonFinish(oldBalance, _account);
    }

    /**
     * @dev This must be called before each state change
     */
    function _checkForSeasonFinish(Balance memory _balance, address _account) internal {
        // Seasons happen every 9 months after contract creation
        // TODO - how to cope with some users being inactive for the whole 9 months?
        //      - Answer: give out a time based quest at the start of each new season.. then after this has finished,
        //                trigger the remaining high value quest accounts
        // If the last action was before current season, then reset the season timing
        if (_balance.lastAction < _seasonEpoch) {
            // Remove 75% of the multiplier gained in this season
            _balances[_account].seasonMultiplier = (_balance.seasonMultiplier * 25) / 100;
        }
        _balances[_account].lastAction = SafeCast.toUint32(block.timestamp);
    }

    /***************************************
                    HOOKS
    ****************************************/

    /**
     * @dev
     */
    function _beforeBalanceChange(address _account) internal virtual {}

    /**
     * @dev
     */
    function _afterTokenTransfer(
        address _from,
        address _to,
        uint256 _amount
    ) internal virtual {}

    // TODO - ensure this represents storage space
    uint256[45] private __gap;
}
