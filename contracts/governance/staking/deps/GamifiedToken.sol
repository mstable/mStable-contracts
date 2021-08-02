// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import { ILockedERC20 } from "./ILockedERC20.sol";
import { ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { SignatureVerifier } from "./SignatureVerifier.sol";

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
    SignatureVerifier
{
    struct Balance {
        uint128 raw;
        uint16 questMultiplier;
        uint16 timeMultiplier;
        uint32 weightedTimestamp;
        // TODO - same lastAction timestamp? Can use this to slash quest multipliers at each season (before any action)
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
        uint32 expiryDate;
    }
    enum CompletionStatus {
        NOT_COMPLETE,
        COMPLETE,
        SLASHED
    }

    uint256 private _totalSupply;

    string private _name;
    string private _symbol;

    // TODO - store:
    //  - boost & balance data
    //  - historical quest completion data to avoid double
    //  - multipliers for quests
    // TODO - bitmap for quest completion

    mapping(address => Balance) internal _balances;
    mapping(address => CompletionStatus[]) private _questCompletion;
    // 10 = 1.1x multiplier, 20 = 1.20x multiplier
    // There are some variables in quests.
    // 1. Is the effect permanent or temporary (subject to seasonal slashing)
    // 2. Is the completion of the quest time bound or open ended?
    // 3. Has the quest been slashed?
    Quest[] private _quests;

    address internal questMaster;

    event QuestComplete(address indexed user, uint256 id);

    /***************************************
                    INIT
    ****************************************/

    constructor(address _signer) SignatureVerifier(_signer) {}

    /**
     * @dev
     */
    function __GamifiedToken_init(string memory name_, string memory symbol_) internal initializer {
        __Context_init_unchained();
        _name = name_;
        _symbol = symbol_;
    }

    modifier questMasterOrGovernor() {
        _questMasterOrGovernor(msg.sender);
        _;
    }

    function _questMasterOrGovernor(address account) internal virtual returns (bool);

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
    function totalSupply() public view virtual override returns (uint256) {
        return _totalSupply;
    }

    /**
     * @dev See {IERC20-balanceOf}.
     */
    function balanceOf(address account) public view virtual override returns (uint256) {
        return _getBalance(_balances[account]);
    }

    /**
     * @dev
     */
    function _getBalance(Balance memory _balance) internal pure returns (uint256 balance) {
        balance = (_balance.raw * (100 + _balance.questMultiplier + _balance.timeMultiplier)) / 100;
    }

    /***************************************
                    QUESTS
    ****************************************/

    /**
     * @dev
     */
    function addQuest(
        QuestType model,
        uint16 multiplier,
        uint32 expiry
    ) external questMasterOrGovernor {
        // TODO - add quest
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

        _applyQuestMultiplier(_account, _quests[_id].multiplier);

        emit QuestComplete(_account, _id);
    }

    /**
     * @dev
     */
    function _validQuest(uint256 _id) internal view returns (bool) {
        // Checks if a quest exists, is active, and not expired
        return
            _quests.length >= _id &&
            _quests[_id].status == QuestStatus.ACTIVE &&
            block.timestamp < _quests[_id].expiryDate;
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
    function _applyQuestMultiplier(address account, uint16 multiplier) internal virtual {
        require(account != address(0), "ERC20: mint to the zero address");
        _beforeBalanceChange(account);

        // 1. Get current balance & update questMultiplier
        Balance memory oldBalance = _balances[account];
        uint256 oldScaledBalance = _getBalance(oldBalance);
        _balances[account].questMultiplier += multiplier;

        // 2. Take the opportunity to set weighted timestamp, if it changes
        _balances[account].timeMultiplier = _timeMultiplier(oldBalance.weightedTimestamp);

        // 3. Update scaled balance
        _mintScaled(account, _getBalance(_balances[account]) - oldScaledBalance);
    }

    /**
     * @dev
     */
    function _mintRaw(address account, uint256 rawAmount) internal virtual {
        require(account != address(0), "ERC20: mint to the zero address");
        _beforeBalanceChange(account);

        // 1. Get and update current balance
        Balance memory oldBalance = _balances[account];
        uint256 oldScaledBalance = _getBalance(oldBalance);

        _balances[account].raw = oldBalance.raw + SafeCast.toUint128(rawAmount);

        // 2. Set weighted timestamp
        //  i) For new account, set up weighted timestamp
        if (oldBalance.weightedTimestamp == 0) {
            _balances[account].weightedTimestamp = SafeCast.toUint32(block.timestamp);
            _mintScaled(account, _getBalance(_balances[account]));
            return;
        }
        //  ii) For previous minters, recalculate time held
        //      Calc new weighted timestamp
        uint256 secondsHeld = (block.timestamp - oldBalance.weightedTimestamp) * oldBalance.raw;
        uint256 newWeightedTs = secondsHeld / (oldBalance.raw + (rawAmount / 2));
        _balances[account].weightedTimestamp = SafeCast.toUint32(block.timestamp - newWeightedTs);

        uint16 timeMultiplier = _timeMultiplier(SafeCast.toUint32(newWeightedTs));
        _balances[account].timeMultiplier = timeMultiplier;

        // 3. Update scaled balance
        // TODO - more efficient way of getting this data
        uint256 newScaledBalance = _getBalance(_balances[account]);
        if (newScaledBalance > oldScaledBalance) {
            _mintScaled(account, newScaledBalance - oldScaledBalance);
        }
        // This can happen if the user moves back a time class, but is unlikely to result in a negative mint
        else {
            _burnScaled(account, oldScaledBalance - newScaledBalance);
        }
    }

    /**
     * @dev
     */
    function _burnRaw(address account, uint256 rawAmount) internal virtual {
        require(account != address(0), "ERC20: burn from the zero address");
        _beforeBalanceChange(account);

        // 1. Get and update current balance
        Balance memory oldBalance = _balances[account];
        uint256 oldScaledBalance = _getBalance(oldBalance);
        require(oldBalance.raw >= rawAmount, "ERC20: burn amount exceeds balance");
        unchecked {
            _balances[account].raw = oldBalance.raw - SafeCast.toUint128(rawAmount);
        }

        // 2. Set back scaled time
        // e.g. stake 10 for 100 seconds, withdraw 5.
        //      secondsHeld = (100 - 0) * (10 - 1.25) = 875
        uint256 secondsHeld = (block.timestamp - oldBalance.weightedTimestamp) *
            (oldBalance.raw - (rawAmount / 4));
        //      newWeightedTs = 875 / 100 = 87.5
        uint256 newWeightedTs = secondsHeld / oldBalance.raw;
        _balances[account].weightedTimestamp = SafeCast.toUint32(block.timestamp - newWeightedTs);

        uint16 timeMultiplier = _timeMultiplier(SafeCast.toUint32(newWeightedTs));
        _balances[account].timeMultiplier = timeMultiplier;

        // 3. Update scaled balance
        _burnScaled(account, oldScaledBalance - _getBalance(_balances[account]));
    }

    /**
     * @dev
     */
    function _mintScaled(address account, uint256 amount) internal virtual {
        _totalSupply += amount;
        emit Transfer(address(0), account, amount);

        // AfterTokenTransfer has scaled voting power
        _afterTokenTransfer(address(0), account, amount);
    }

    /**
     * @dev
     */
    function _burnScaled(address account, uint256 amount) internal virtual {
        _totalSupply -= amount;

        emit Transfer(account, address(0), amount);

        _afterTokenTransfer(account, address(0), amount);
    }

    /***************************************
                    HOOKS
    ****************************************/

    /**
     * @dev
     */
    function _beforeBalanceChange(address account) internal virtual {}

    /**
     * @dev
     */
    function _afterTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual {}

    // TODO - ensure this represents storage space
    uint256[45] private __gap;
}
