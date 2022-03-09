// SPDX-License-Identifier: MIT
pragma solidity >=0.5.0 <0.9.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "./WadRayMath.sol";

contract MockUsdPlusToken is IERC20, Context {
    using WadRayMath for uint256;
    using EnumerableSet for EnumerableSet.AddressSet;

    // --- ERC20 fields

    mapping(address => uint256) private _balances;

    mapping(address => mapping(address => uint256)) private _allowances;

    uint256 private _totalSupply;

    string private _name;
    string private _symbol;
    uint8 private _decimals;

    // ---  fields

    uint256 private _totalMint;
    uint256 private _totalBurn;

    uint256 public liquidityIndexChangeTime;
    uint256 public liquidityIndex;

    EnumerableSet.AddressSet _owners;


    function setLiquidityIndex(uint256 _liquidityIndex) external {
        require(_liquidityIndex > 0, "Zero liquidity index not allowed");
        liquidityIndex = _liquidityIndex;
        liquidityIndexChangeTime = block.timestamp;
    }


    function initialize(
        string memory name,
        string memory symbol,
        uint8 decimals,
        address _initialRecipient,
        uint256 _initialMint
    ) external {
        _name = name;
        _symbol = symbol;
        _decimals = decimals;
        liquidityIndex = 10 ** 27;
        liquidityIndexChangeTime = block.timestamp;
        _mint(_initialRecipient, _initialMint * (10 ** 27));
    }


    // ---  logic


    function mint(address _sender, uint256 _amount) external {
        // up to ray
        uint256 mintAmount = _amount.wadToRay();
        mintAmount = mintAmount.rayDiv(liquidityIndex);
        _mint(_sender, mintAmount);
        _totalMint += mintAmount;
        emit Transfer(address(0), _sender, _amount);
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
    function _mint(address account, uint256 amount) internal  {
        require(account != address(0), "ERC20: mint to the zero address");

        _beforeTokenTransfer(address(0), account, amount);

        _totalSupply += amount;
        _balances[account] += amount;

        _afterTokenTransfer(address(0), account, amount);
    }

    function burn(address _sender, uint256 _amount) external {
        // up to ray
        uint256 burnAmount = _amount.wadToRay();
        burnAmount = burnAmount.rayDiv(liquidityIndex);
        _burn(_sender, burnAmount);
        _totalBurn += burnAmount;
        emit Transfer(_sender, address(0), _amount);
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
    function _burn(address account, uint256 amount) internal  {
        require(account != address(0), "ERC20: burn from the zero address");

        _beforeTokenTransfer(account, address(0), amount);

        uint256 accountBalance = _balances[account];
        require(accountBalance >= amount, "ERC20: burn amount exceeds balance");
        unchecked {
            _balances[account] = accountBalance - amount;
        }
        _totalSupply -= amount;


        _afterTokenTransfer(account, address(0), amount);
    }



    /**
       * @dev Moves `amount` of tokens from `sender` to `recipient`.
     *
     * This internal function is equivalent to {transfer}, and can be used to
     * e.g. implement automatic token fees, slashing mechanisms, etc.
     *
     * Emits a {Transfer} event.
     *
     * Requirements:
     *
     * - `sender` cannot be the zero address.
     * - `recipient` cannot be the zero address.
     * - `sender` must have a balance of at least `amount`.
     */
    function _transfer(
        address sender,
        address recipient,
        uint256 amount
    ) internal  {
        require(sender != address(0), "ERC20: transfer from the zero address");
        require(recipient != address(0), "ERC20: transfer to the zero address");
//        console.log("sender: ", sender);
//        console.log("recipient: ", recipient);
//        console.log("amount: ", amount);
        _beforeTokenTransfer(sender, recipient, amount);

        uint256 senderBalance = _balances[sender];
//        console.log("senderBalance: ", senderBalance);
        require(senderBalance >= amount, "ERC20: transfer amount exceeds balance");
        unchecked {
            _balances[sender] = senderBalance - amount;
        }
        _balances[recipient] += amount;

        _afterTokenTransfer(sender, recipient, amount);
    }


    /**
     * @dev See {IERC20-transfer}.
     */
    function transfer(address recipient, uint256 amount) public override returns (bool) {
        // up to ray
        uint256 transferAmount = amount.wadToRay();
        transferAmount = transferAmount.rayDiv(liquidityIndex);
        _transfer(_msgSender(), recipient, transferAmount);
        emit Transfer(_msgSender(), recipient, amount);
        return true;
    }


    /**
     * @dev See {IERC20-allowance}.
     */
    function allowance(address owner, address spender) public view override returns (uint256) {
        uint256 allowanceRay = _allowance(owner, spender).rayMul(liquidityIndex);
        // ray -> wad
        return allowanceRay.rayToWad();
    }

    /**
    * @dev See {IERC20-allowance}.
     */
    function _allowance(address owner, address spender) internal view returns (uint256) {
        return _allowances[owner][spender];
    }


    /**
     * @dev See {IERC20-approve}.
     */
    function approve(address spender, uint256 amount) external override returns (bool){
        // up to ray
        uint256 scaledAmount = amount.wadToRay();
        scaledAmount = scaledAmount.rayDiv(liquidityIndex);
        _approve(_msgSender(), spender, scaledAmount);
        return true;
    }

    /**
    * @dev Sets `amount` as the allowance of `spender` over the `owner` s tokens.
     *
     * This internal function is equivalent to `approve`, and can be used to
     * e.g. set automatic allowances for certain subsystems, etc.
     *
     * Emits an {Approval} event.
     *
     * Requirements:
     *
     * - `owner` cannot be the zero address.
     * - `spender` cannot be the zero address.
     */
    function _approve(
        address owner,
        address spender,
        uint256 amount
    ) internal virtual {
        require(owner != address(0), "ERC20: approve from the zero address");
        require(spender != address(0), "ERC20: approve to the zero address");

        _allowances[owner][spender] = amount;
        emit Approval(owner, spender, amount);
    }



    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) public override returns (bool) {
        // up to ray
        uint256 scaledAmount = amount.wadToRay();
        scaledAmount = scaledAmount.rayDiv(liquidityIndex);
        _transfer(sender, recipient, scaledAmount);

        uint256 currentAllowance = _allowance(sender, _msgSender());
        require(currentAllowance >= scaledAmount, "UsdPlusToken: transfer amount exceeds allowance");
        unchecked {
            _approve(sender, _msgSender(), currentAllowance - scaledAmount);
        }
        emit Transfer(sender, recipient, amount);

        return true;
    }


    /**
     * @dev Calculates the balance of the user: principal balance + interest generated by the principal
     * @param user The user whose balance is calculated
     * @return The balance of the user
     **/
    function balanceOf(address user)
    public
    view
    override
    returns (uint256)
    {
        // stored balance is ray (27)
        uint256 balanceInMapping = _balanceOf(user);
        // ray -> ray
        uint256 balanceRay =  balanceInMapping.rayMul(liquidityIndex);
        // ray -> wad
        return balanceRay.rayToWad();
    }

    /**
    * @dev See {IERC20-balanceOf}.
     */
    function _balanceOf(address account) internal view  returns (uint256) {
        return _balances[account];
    }

    /**
     * @dev Returns the scaled balance of the user. The scaled balance is the sum of all the
     * updated stored balance divided by the reserve's liquidity index at the moment of the update
     * @param user The user whose balance is calculated
     * @return The scaled balance of the user
     **/
    function scaledBalanceOf(address user) external view returns (uint256) {
        return _balanceOf(user);
    }


    /**
     * @dev calculates the total supply of the specific aToken
     * since the balance of every single user increases over time, the total supply
     * does that too.
     * @return the current total supply
     **/
    function totalSupply() public view override returns (uint256) {
        // stored totalSupply is ray (27)
        uint256 currentSupply = _totalSupply;
        // ray -> ray
        uint256 currentSupplyRay = currentSupply.rayMul(liquidityIndex);
        // ray -> wad
        return currentSupplyRay.rayToWad();
    }

    function totalMint() external view returns (uint256) {
        uint256 totalMintRay = _totalMint.rayMul(liquidityIndex);
        return totalMintRay.rayToWad();
    }

    function totalBurn() external view returns (uint256) {
        uint256 totalBurnRay = _totalBurn.rayMul(liquidityIndex);
        return totalBurnRay.rayToWad();
    }



    /**
     * @dev Atomically increases the allowance granted to `spender` by the caller.
     *
     * This is an alternative to {approve} that can be used as a mitigation for
     * problems described in {IERC20-approve}.
     *
     * Emits an {Approval} event indicating the updated allowance.
     *
     * Requirements:
     *
     * - `spender` cannot be the zero address.
     */
    function increaseAllowance(address spender, uint256 addedValue) public  returns (bool) {
        _approve(_msgSender(), spender, _allowances[_msgSender()][spender] + addedValue);
        return true;
    }

    /**
     * @dev Atomically decreases the allowance granted to `spender` by the caller.
     *
     * This is an alternative to {approve} that can be used as a mitigation for
     * problems described in {IERC20-approve}.
     *
     * Emits an {Approval} event indicating the updated allowance.
     *
     * Requirements:
     *
     * - `spender` cannot be the zero address.
     * - `spender` must have allowance for the caller of at least
     * `subtractedValue`.
     */
    function decreaseAllowance(address spender, uint256 subtractedValue) public  returns (bool) {
        uint256 currentAllowance = _allowances[_msgSender()][spender];
        require(currentAllowance >= subtractedValue, "ERC20: decreased allowance below zero");
        unchecked {
            _approve(_msgSender(), spender, currentAllowance - subtractedValue);
        }

        return true;
    }

    /**
     * @dev Returns the scaled total supply of the variable debt token
     * @return the scaled total supply
     **/
    function scaledTotalSupply() public view returns (uint256) {
        return _totalSupply;
    }


    function ownerLength() external view returns (uint256) {
        return _owners.length();
    }

    function ownerAt(uint256 index) external view returns (address) {
        return _owners.at(index);
    }

    function ownerBalanceAt(uint256 index) external view returns (uint256) {
        return balanceOf(_owners.at(index));
    }

    /**
   * @dev Returns the name of the token.
     */
    function name() public view returns (string memory) {
        return _name;
    }

    /**
     * @dev Returns the symbol of the token, usually a shorter version of the
     * name.
     */
    function symbol() public view returns (string memory) {
        return _symbol;
    }


    /**
   * @dev Returns the number of decimals used to get its user representation.
     * For example, if `decimals` equals `2`, a balance of `505` tokens should
     * be displayed to a user as `5.05` (`505 / 10 ** 2`).
     *
     * Tokens usually opt for a value of 18, imitating the relationship between
     * Ether and Wei. This is the value {ERC20} uses, unless this function is
     * overridden;
     *
     * NOTE: This information is only used for _display_ purposes: it in
     * no way affects any of the arithmetic of the contract, including
     * {IERC20-balanceOf} and {IERC20-transfer}.
     */
    function decimals() public view returns (uint8) {
        return _decimals;
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
    ) internal  {

    }


    function _afterTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal  {

        if (from == address(0)) {
            // mint
            _owners.add(to);
        } else if (to == address(0)) {
            // burn
            if (balanceOf(from) == 0) {
                _owners.remove(from);
            }
        } else {
            // transfer
            if (balanceOf(from) == 0) {
                _owners.remove(from);
            }
            _owners.add(to);
        }
    }

}
