// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import { ILockedERC20 } from "./ILockedERC20.sol";
import { ContextUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/**
 * @dev Forked from https://github.com/OpenZeppelin/openzeppelin-contracts-upgradeable/blob/master/contracts/token/ERC20/ERC20Upgradeable.sol
 * Changes:
 *   - Removed the transfer, transferFrom, approve fns
 *   - Removed `_allowances` storage
 */
contract LockedGamifiedERC20Upgradeable is Initializable, ContextUpgradeable, ILockedERC20 {
    // TODO - store:
    //  - boost & balance data
    //  - historical quest completion data to avoid double
    //  - multipliers for quests

    struct Balance {
        uint128 rawBalance;
        uint16 multiplier;
    }
    mapping(address => Balance) private _balances;

    mapping(address => mapping(uint256 => bool)) private _questCompletion;
    // 10 = 1.1x multiplier, 20 = 1.20x multiplier
    uint8[] private _quests;

    uint256 private _totalSupply;

    string private _name;
    string private _symbol;

    /**
     * @dev Sets the values for {name} and {symbol}.
     *
     * The default value of {decimals} is 18. To select a different value for
     * {decimals} you should overload it.
     *
     * All two of these values are immutable: they can only be set once during
     * construction.
     */
    function __LockedGamifiedERC20_init(string memory name_, string memory symbol_)
        internal
        initializer
    {
        __Context_init_unchained();
        __LockedGamifiedERC20_init_unchained(name_, symbol_);
    }

    function __LockedGamifiedERC20_init_unchained(string memory name_, string memory symbol_)
        internal
        initializer
    {
        _name = name_;
        _symbol = symbol_;
    }

    /**
     * @dev Returns the name of the token.
     */
    function name() public view virtual override returns (string memory) {
        return _name;
    }

    /**
     * @dev Returns the symbol of the token, usually a shorter version of the
     * name.
     */
    function symbol() public view virtual override returns (string memory) {
        return _symbol;
    }

    /**
     * @dev Returns the number of decimals used to get its user representation.
     * For example, if `decimals` equals `2`, a balance of `505` tokens should
     * be displayed to a user as `5,05` (`505 / 10 ** 2`).
     *
     * Tokens usually opt for a value of 18, imitating the relationship between
     * Ether and Wei. This is the value {ERC20} uses, unless this function is
     * overridden;
     *
     * NOTE: This information is only used for _display_ purposes: it in
     * no way affects any of the arithmetic of the contract, including
     * {IERC20-balanceOf} and {IERC20-transfer}.
     */
    function decimals() public view virtual override returns (uint8) {
        return 18;
    }

    /**
     * @dev See {IERC20-totalSupply}.
     */
    function totalSupply() public view virtual override returns (uint256) {
        return _totalSupply;
    }

    /**
     * @dev See {IERC20-balanceOf}.
     */
    function balanceOf(address account) public view virtual override returns (uint256) {
        Balance memory balance = _balances[account];
        return (balance.rawBalance * (100 + balance.multiplier)) / 100;
    }

    function _completeQuest(address account, uint256 id) internal {
        if (!_questCompletion[account][id]) {
            _questCompletion[account][id] = true;
            _balances[account].multiplier += _quests[id];
        }
    }

    function _applyBoost(address account, uint256 rawAmount)
        internal
        view
        returns (uint256 amount)
    {
        Balance memory balance = _balances[account];
        amount = (rawAmount * (100 + balance.multiplier)) / 100;
    }

    /** @dev Creates `amount` tokens and assigns them to `account`, increasing
     * the total supply.
     *
     * Emits a {Transfer} event with `from` set to the zero address.
     *
     * Requirements:
     *
     * - `account` cannot be the zero address.
     */
    function _mint(address account, uint256 rawAmount) internal virtual {
        require(account != address(0), "ERC20: mint to the zero address");

        _beforeTokenTransfer(address(0), account, rawAmount);

        // TODO - consider that mint will be called after quests are completed
        // TODO - rule: _beforeTokenTransfer = raw, then apply boost, afterTokenTransfer scaled
        uint256 amount = _applyBoost(account, rawAmount);

        _totalSupply += amount;
        _balances[account].rawBalance += SafeCast.toUint128(rawAmount);
        emit Transfer(address(0), account, amount);

        _afterTokenTransfer(address(0), account, amount);
    }

    /**
     * @dev Destroys `amount` tokens from `account`, reducing the
     * total supply.
     *
     * Emits a {Transfer} event with `to` set to the zero address.
     *
     * Requirements:
     *
     * - `account` cannot be the zero address.
     * - `account` must have at least `amount` tokens.
     */
    function _burn(address account, uint256 rawAmount) internal virtual {
        require(account != address(0), "ERC20: burn from the zero address");

        _beforeTokenTransfer(account, address(0), rawAmount);

        // TODO - clean this up?
        uint256 amount = _applyBoost(account, rawAmount);

        Balance memory accountBalance = _balances[account];
        require(accountBalance.rawBalance >= rawAmount, "ERC20: burn amount exceeds balance");
        unchecked {
            _balances[account].rawBalance =
                accountBalance.rawBalance -
                SafeCast.toUint128(rawAmount);
        }
        _totalSupply -= amount;

        emit Transfer(account, address(0), amount);

        _afterTokenTransfer(account, address(0), amount);
    }

    /**
     * @dev Hook that is called before any transfer of tokens. This includes
     * minting and burning.
     *
     * Calling conditions:
     *
     * - when `from` and `to` are both non-zero, `amount` of ``from``'s tokens
     * will be transferred to `to`.
     * - when `from` is zero, `amount` tokens will be minted for `to`.
     * - when `to` is zero, `amount` of ``from``'s tokens will be burned.
     * - `from` and `to` are never both zero.
     *
     * To learn more about hooks, head to xref:ROOT:extending-contracts.adoc#using-hooks[Using Hooks].
     */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual {}

    /**
     * @dev Hook that is called after any transfer of tokens. This includes
     * minting and burning.
     *
     * Calling conditions:
     *
     * - when `from` and `to` are both non-zero, `amount` of ``from``'s tokens
     * has been transferred to `to`.
     * - when `from` is zero, `amount` tokens have been minted for `to`.
     * - when `to` is zero, `amount` of ``from``'s tokens have been burned.
     * - `from` and `to` are never both zero.
     *
     * To learn more about hooks, head to xref:ROOT:extending-contracts.adoc#using-hooks[Using Hooks].
     */
    function _afterTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual {}

    // TODO - ensure this represents storage space
    uint256[45] private __gap;
}
