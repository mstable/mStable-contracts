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
        uint16 multiplier;
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

    mapping(address => Balance) private _balances;
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
        Balance memory balance = _balances[account];
        return (balance.raw * (100 + balance.multiplier)) / 100;
    }

    /***************************************
                    QUESTS
    ****************************************/

    function addQuest(
        QuestType model,
        uint16 multiplier,
        uint32 expiry
    ) external questMasterOrGovernor {
        // TODO - add quest
    }

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

        Quest memory quest = _quests[_id];
        _changeMultiplier(_account, _balances[_account].multiplier += quest.multiplier);

        emit QuestComplete(_account, _id);
    }

    function _validQuest(uint256 _id) internal view returns (bool) {
        // Checks if a quest exists, is active, and not expired
        return
            _quests.length >= _id &&
            _quests[_id].status == QuestStatus.ACTIVE &&
            block.timestamp < _quests[_id].expiryDate;
    }

    function _hasCompleted(address _account, uint256 _id) internal view returns (bool) {
        return _questCompletion[_account][_id] != CompletionStatus.NOT_COMPLETE;
    }

    function _applyMultiplier(uint256 rawAmount, uint16 multiplier)
        internal
        pure
        returns (uint256 amount)
    {
        amount = (rawAmount * (100 + multiplier)) / 100;
    }

    /***************************************
                STATE CHANGES
    ****************************************/

    function _changeMultiplier(address account, uint16 newMultiplier) internal virtual {
        require(account != address(0), "ERC20: mint to the zero address");
        _beforeBalanceChange(account);

        Balance memory balance = _balances[account];
        uint256 oldBalance = _applyMultiplier(balance.raw, balance.multiplier);

        _balances[account].multiplier = newMultiplier;
        uint256 newBalance = _applyMultiplier(balance.raw, newMultiplier);

        if (newBalance > oldBalance) {
            _mint(account, newBalance - oldBalance);
        } else if (oldBalance > newBalance) {
            _burn(account, oldBalance - newBalance);
        }
    }

    /**
     * @dev
     */
    function _mintRaw(address account, uint256 rawAmount) internal virtual {
        require(account != address(0), "ERC20: mint to the zero address");
        _beforeBalanceChange(account);

        _balances[account].raw += SafeCast.toUint128(rawAmount);

        _mint(account, _applyMultiplier(rawAmount, _balances[account].multiplier));
    }

    function _mint(address account, uint256 amount) internal virtual {
        _totalSupply += amount;
        emit Transfer(address(0), account, amount);

        // AfterTokenTransfer has scaled voting power
        _afterTokenTransfer(address(0), account, amount);
    }

    /**
     * @dev
     */
    function _burnRaw(address account, uint256 rawAmount) internal virtual {
        require(account != address(0), "ERC20: burn from the zero address");
        _beforeBalanceChange(account);

        // TODO - clean this up?

        Balance memory accountBalance = _balances[account];
        require(accountBalance.raw >= rawAmount, "ERC20: burn amount exceeds balance");
        unchecked {
            _balances[account].raw = accountBalance.raw - SafeCast.toUint128(rawAmount);
        }

        _burn(account, _applyMultiplier(rawAmount, accountBalance.multiplier));
    }

    function _burn(address account, uint256 amount) internal virtual {
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
