/**
 *Submitted for verification at polygonscan.com on 2021-07-02
*/

pragma solidity 0.8.2;
pragma abicoder v2;


contract Initializable {

  /**
   * @dev Indicates that the contract has been initialized.
   */
  bool private initialized;

  /**
   * @dev Indicates that the contract is in the process of being initialized.
   */
  bool private initializing;

  /**
   * @dev Modifier to use in the initializer function of a contract.
   */
  modifier initializer() {
    require(initializing || isConstructor() || !initialized, "Contract instance has already been initialized");

    bool isTopLevelCall = !initializing;
    if (isTopLevelCall) {
      initializing = true;
      initialized = true;
    }

    _;

    if (isTopLevelCall) {
      initializing = false;
    }
  }

  /// @dev Returns true if and only if the function is running in the constructor
  function isConstructor() private view returns (bool) {
    // extcodesize checks the size of the code stored in an address, and
    // address returns the current address. Since the code is still not
    // deployed when running a constructor, any checks on its code size will
    // yield zero, making it an effective way to detect if a contract is
    // under construction or not.
    address self = address(this);
    uint256 cs;
    assembly { cs := extcodesize(self) }
    return cs == 0;
  }

  // Reserved storage space to allow for layout changes in the future.
  uint256[50] private ______gap;
}

/*
 * @dev Provides information about the current execution context, including the
 * sender of the transaction and its data. While these are generally available
 * via msg.sender and msg.data, they should not be accessed in such a direct
 * manner, since when dealing with GSN meta-transactions the account sending and
 * paying for execution may not be the actual sender (as far as an application
 * is concerned).
 *
 * This contract is only required for intermediate, library-like contracts.
 */
abstract contract Context {
    // Empty internal constructor, to prevent people from mistakenly deploying
    // an instance of this contract, which should be used via inheritance.
    // constructor () internal { }
    // solhint-disable-previous-line no-empty-blocks

    function _msgSender() internal view returns (address payable) {
        return payable(msg.sender);
    }

    function _msgData() internal view returns (bytes memory) {
        this; // silence state mutability warning without generating bytecode - see https://github.com/ethereum/solidity/issues/2691
        return msg.data;
    }
}

interface IERC20 {
    /**
     * @dev Returns the amount of tokens in existence.
     */
    function totalSupply() external view returns (uint256);

    /**
     * @dev Returns the amount of tokens owned by `account`.
     */
    function balanceOf(address account) external view returns (uint256);

    /**
     * @dev Moves `amount` tokens from the caller's account to `recipient`.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * Emits a {Transfer} event.
     */
    function transfer(address recipient, uint256 amount) external returns (bool);

    /**
     * @dev Returns the remaining number of tokens that `spender` will be
     * allowed to spend on behalf of `owner` through {transferFrom}. This is
     * zero by default.
     *
     * This value changes when {approve} or {transferFrom} are called.
     */
    function allowance(address owner, address spender) external view returns (uint256);

    /**
     * @dev Sets `amount` as the allowance of `spender` over the caller's tokens.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * IMPORTANT: Beware that changing an allowance with this method brings the risk
     * that someone may use both the old and the new allowance by unfortunate
     * transaction ordering. One possible solution to mitigate this race
     * condition is to first reduce the spender's allowance to 0 and set the
     * desired value afterwards:
     * https://github.com/ethereum/EIPs/issues/20#issuecomment-263524729
     *
     * Emits an {Approval} event.
     */
    function approve(address spender, uint256 amount) external returns (bool);

    /**
     * @dev Moves `amount` tokens from `sender` to `recipient` using the
     * allowance mechanism. `amount` is then deducted from the caller's
     * allowance.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * Emits a {Transfer} event.
     */
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);

    /**
     * @dev Emitted when `value` tokens are moved from one account (`from`) to
     * another (`to`).
     *
     * Note that `value` may be zero.
     */
    event Transfer(address indexed from, address indexed to, uint256 value);

    /**
     * @dev Emitted when the allowance of a `spender` for an `owner` is set by
     * a call to {approve}. `value` is the new allowance.
     */
    event Approval(address indexed owner, address indexed spender, uint256 value);
}

contract ERC205 is Context, IERC20 {
    mapping (address => uint256) private _balances;

    mapping (address => mapping (address => uint256)) private _allowances;

    uint256 private _totalSupply;

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
        return _balances[account];
    }

    /**
     * @dev See {IERC20-transfer}.
     *
     * Requirements:
     *
     * - `recipient` cannot be the zero address.
     * - the caller must have a balance of at least `amount`.
     */
    function transfer(address recipient, uint256 amount) public virtual override returns (bool) {
        _transfer(_msgSender(), recipient, amount);
        return true;
    }

    /**
     * @dev See {IERC20-allowance}.
     */
    function allowance(address owner, address spender) public view virtual override returns (uint256) {
        return _allowances[owner][spender];
    }

    /**
     * @dev See {IERC20-approve}.
     *
     * Requirements:
     *
     * - `spender` cannot be the zero address.
     */
    function approve(address spender, uint256 amount) public virtual override returns (bool) {
        _approve(_msgSender(), spender, amount);
        return true;
    }

    /**
     * @dev See {IERC20-transferFrom}.
     *
     * Emits an {Approval} event indicating the updated allowance. This is not
     * required by the EIP. See the note at the beginning of {ERC20}.
     *
     * Requirements:
     *
     * - `sender` and `recipient` cannot be the zero address.
     * - `sender` must have a balance of at least `amount`.
     * - the caller must have allowance for ``sender``'s tokens of at least
     * `amount`.
     */
    function transferFrom(address sender, address recipient, uint256 amount) public virtual override returns (bool) {
        _transfer(sender, recipient, amount);

        uint256 currentAllowance = _allowances[sender][_msgSender()];
        require(currentAllowance >= amount, "ERC20: transfer amount exceeds allowance");
        _approve(sender, _msgSender(), currentAllowance - amount);

        return true;
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
    function increaseAllowance(address spender, uint256 addedValue) public virtual returns (bool) {
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
    function decreaseAllowance(address spender, uint256 subtractedValue) public virtual returns (bool) {
        uint256 currentAllowance = _allowances[_msgSender()][spender];
        require(currentAllowance >= subtractedValue, "ERC20: decreased allowance below zero");
        _approve(_msgSender(), spender, currentAllowance - subtractedValue);

        return true;
    }

    /**
     * @dev Moves tokens `amount` from `sender` to `recipient`.
     *
     * This is internal function is equivalent to {transfer}, and can be used to
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
    function _transfer(address sender, address recipient, uint256 amount) internal virtual {
        require(sender != address(0), "ERC20: transfer from the zero address");
        require(recipient != address(0), "ERC20: transfer to the zero address");

        uint256 senderBalance = _balances[sender];
        require(senderBalance >= amount, "ERC20: transfer amount exceeds balance");
        _balances[sender] = senderBalance - amount;
        _balances[recipient] += amount;

        emit Transfer(sender, recipient, amount);
    }

    /** @dev Creates `amount` tokens and assigns them to `account`, increasing
     * the total supply.
     *
     * Emits a {Transfer} event with `from` set to the zero address.
     *
     * Requirements:
     *
     * - `to` cannot be the zero address.
     */
    function _mint(address account, uint256 amount) internal virtual {
        require(account != address(0), "ERC20: mint to the zero address");

        _totalSupply += amount;
        _balances[account] += amount;
        emit Transfer(address(0), account, amount);
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
    function _burn(address account, uint256 amount) internal virtual {
        require(account != address(0), "ERC20: burn from the zero address");

        uint256 accountBalance = _balances[account];
        require(accountBalance >= amount, "ERC20: burn amount exceeds balance");
        _balances[account] = accountBalance - amount;
        _totalSupply -= amount;

        emit Transfer(account, address(0), amount);
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
    function _approve(address owner, address spender, uint256 amount) internal virtual {
        require(owner != address(0), "ERC20: approve from the zero address");
        require(spender != address(0), "ERC20: approve to the zero address");

        _allowances[owner][spender] = amount;
        emit Approval(owner, spender, amount);
    }
}

abstract contract InitializableERC20Detailed is IERC20 {
    string private _name;
    string private _symbol;
    uint8 private _decimals;

    /**
     * @dev Sets the values for `name`, `symbol`, and `decimals`. All three of
     * these values are immutable: they can only be set once during
     * construction.
     * @notice To avoid variable shadowing appended `Arg` after arguments name.
     */
    function _initialize(
        string memory nameArg,
        string memory symbolArg,
        uint8 decimalsArg
    ) internal {
        _name = nameArg;
        _symbol = symbolArg;
        _decimals = decimalsArg;
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
     * be displayed to a user as `5,05` (`505 / 10 ** 2`).
     *
     * Tokens usually opt for a value of 18, imitating the relationship between
     * Ether and Wei.
     *
     * NOTE: This information is only used for _display_ purposes: it in
     * no way affects any of the arithmetic of the contract, including
     * {IERC20-balanceOf} and {IERC20-transfer}.
     */
    function decimals() public view returns (uint8) {
        return _decimals;
    }
}

abstract contract InitializableToken is ERC205, InitializableERC20Detailed {
    /**
     * @dev Initialization function for implementing contract
     * @notice To avoid variable shadowing appended `Arg` after arguments name.
     */
    function _initialize(string memory _nameArg, string memory _symbolArg) internal {
        InitializableERC20Detailed._initialize(_nameArg, _symbolArg, 18);
    }
}

contract ModuleKeys {
    // Governance
    // ===========
    // keccak256("Governance");
    bytes32 internal constant KEY_GOVERNANCE =
        0x9409903de1e6fd852dfc61c9dacb48196c48535b60e25abf92acc92dd689078d;
    //keccak256("Staking");
    bytes32 internal constant KEY_STAKING =
        0x1df41cd916959d1163dc8f0671a666ea8a3e434c13e40faef527133b5d167034;
    //keccak256("ProxyAdmin");
    bytes32 internal constant KEY_PROXY_ADMIN =
        0x96ed0203eb7e975a4cbcaa23951943fa35c5d8288117d50c12b3d48b0fab48d1;

    // mStable
    // =======
    // keccak256("OracleHub");
    bytes32 internal constant KEY_ORACLE_HUB =
        0x8ae3a082c61a7379e2280f3356a5131507d9829d222d853bfa7c9fe1200dd040;
    // keccak256("Manager");
    bytes32 internal constant KEY_MANAGER =
        0x6d439300980e333f0256d64be2c9f67e86f4493ce25f82498d6db7f4be3d9e6f;
    //keccak256("Recollateraliser");
    bytes32 internal constant KEY_RECOLLATERALISER =
        0x39e3ed1fc335ce346a8cbe3e64dd525cf22b37f1e2104a755e761c3c1eb4734f;
    //keccak256("MetaToken");
    bytes32 internal constant KEY_META_TOKEN =
        0xea7469b14936af748ee93c53b2fe510b9928edbdccac3963321efca7eb1a57a2;
    // keccak256("SavingsManager");
    bytes32 internal constant KEY_SAVINGS_MANAGER =
        0x12fe936c77a1e196473c4314f3bed8eeac1d757b319abb85bdda70df35511bf1;
    // keccak256("Liquidator");
    bytes32 internal constant KEY_LIQUIDATOR =
        0x1e9cb14d7560734a61fa5ff9273953e971ff3cd9283c03d8346e3264617933d4;
    // keccak256("InterestValidator");
    bytes32 internal constant KEY_INTEREST_VALIDATOR =
        0xc10a28f028c7f7282a03c90608e38a4a646e136e614e4b07d119280c5f7f839f;
}

interface INexus {
    function governor() external view returns (address);

    function getModule(bytes32 key) external view returns (address);

    function proposeModule(bytes32 _key, address _addr) external;

    function cancelProposedModule(bytes32 _key) external;

    function acceptProposedModule(bytes32 _key) external;

    function acceptProposedModules(bytes32[] calldata _keys) external;

    function requestLockModule(bytes32 _key) external;

    function cancelLockModule(bytes32 _key) external;

    function lockModule(bytes32 _key) external;
}

abstract contract ImmutableModule is ModuleKeys {
    INexus public immutable nexus;

    /**
     * @dev Initialization function for upgradable proxy contracts
     * @param _nexus Nexus contract address
     */
    constructor(address _nexus) {
        require(_nexus != address(0), "Nexus address is zero");
        nexus = INexus(_nexus);
    }

    /**
     * @dev Modifier to allow function calls only from the Governor.
     */
    modifier onlyGovernor() {
        _onlyGovernor();
        _;
    }

    function _onlyGovernor() internal view {
        require(msg.sender == _governor(), "Only governor can execute");
    }

    /**
     * @dev Modifier to allow function calls only from the Governance.
     *      Governance is either Governor address or Governance address.
     */
    modifier onlyGovernance() {
        require(
            msg.sender == _governor() || msg.sender == _governance(),
            "Only governance can execute"
        );
        _;
    }

    /**
     * @dev Returns Governor address from the Nexus
     * @return Address of Governor Contract
     */
    function _governor() internal view returns (address) {
        return nexus.governor();
    }

    /**
     * @dev Returns Governance Module address from the Nexus
     * @return Address of the Governance (Phase 2)
     */
    function _governance() internal view returns (address) {
        return nexus.getModule(KEY_GOVERNANCE);
    }

    /**
     * @dev Return SavingsManager Module address from the Nexus
     * @return Address of the SavingsManager Module contract
     */
    function _savingsManager() internal view returns (address) {
        return nexus.getModule(KEY_SAVINGS_MANAGER);
    }

    /**
     * @dev Return Recollateraliser Module address from the Nexus
     * @return  Address of the Recollateraliser Module contract (Phase 2)
     */
    function _recollateraliser() internal view returns (address) {
        return nexus.getModule(KEY_RECOLLATERALISER);
    }

    /**
     * @dev Return Recollateraliser Module address from the Nexus
     * @return  Address of the Recollateraliser Module contract (Phase 2)
     */
    function _liquidator() internal view returns (address) {
        return nexus.getModule(KEY_LIQUIDATOR);
    }

    /**
     * @dev Return ProxyAdmin Module address from the Nexus
     * @return Address of the ProxyAdmin Module contract
     */
    function _proxyAdmin() internal view returns (address) {
        return nexus.getModule(KEY_PROXY_ADMIN);
    }
}

contract InitializableReentrancyGuard {
    bool private _notEntered;

    function _initializeReentrancyGuard() internal {
        // Storing an initial non-zero value makes deployment a bit more
        // expensive, but in exchange the refund on every call to nonReentrant
        // will be lower in amount. Since refunds are capped to a percetange of
        // the total transaction's gas, it is best to keep them low in cases
        // like this one, to increase the likelihood of the full refund coming
        // into effect.
        _notEntered = true;
    }

    /**
     * @dev Prevents a contract from calling itself, directly or indirectly.
     * Calling a `nonReentrant` function from another `nonReentrant`
     * function is not supported. It is possible to prevent this from happening
     * by making the `nonReentrant` function external, and make it call a
     * `private` function that does the actual work.
     */
    modifier nonReentrant() {
        // On the first call to nonReentrant, _notEntered will be true
        require(_notEntered, "ReentrancyGuard: reentrant call");

        // Any calls to nonReentrant after this point will fail
        _notEntered = false;

        _;

        // By storing the original value once again, a refund is triggered (see
        // https://eips.ethereum.org/EIPS/eip-2200)
        _notEntered = true;
    }
}

struct BassetPersonal {
    // Address of the bAsset
    address addr;
    // Address of the bAsset
    address integrator;
    // An ERC20 can charge transfer fee, for example USDT, DGX tokens.
    bool hasTxFee; // takes a byte in storage
    // Status of the bAsset
    BassetStatus status;
}

struct BassetData {
    // 1 Basset * ratio / ratioScale == x Masset (relative value)
    // If ratio == 10e8 then 1 bAsset = 10 mAssets
    // A ratio is divised as 10^(18-tokenDecimals) * measurementMultiple(relative value of 1 base unit)
    uint128 ratio;
    // Amount of the Basset that is held in Collateral
    uint128 vaultBalance;
}

abstract contract IMasset {
    // Mint
    function mint(
        address _input,
        uint256 _inputQuantity,
        uint256 _minOutputQuantity,
        address _recipient
    ) external virtual returns (uint256 mintOutput);

    function mintMulti(
        address[] calldata _inputs,
        uint256[] calldata _inputQuantities,
        uint256 _minOutputQuantity,
        address _recipient
    ) external virtual returns (uint256 mintOutput);

    function getMintOutput(address _input, uint256 _inputQuantity)
        external
        view
        virtual
        returns (uint256 mintOutput);

    function getMintMultiOutput(address[] calldata _inputs, uint256[] calldata _inputQuantities)
        external
        view
        virtual
        returns (uint256 mintOutput);

    // Swaps
    function swap(
        address _input,
        address _output,
        uint256 _inputQuantity,
        uint256 _minOutputQuantity,
        address _recipient
    ) external virtual returns (uint256 swapOutput);

    function getSwapOutput(
        address _input,
        address _output,
        uint256 _inputQuantity
    ) external view virtual returns (uint256 swapOutput);

    // Redemption
    function redeem(
        address _output,
        uint256 _mAssetQuantity,
        uint256 _minOutputQuantity,
        address _recipient
    ) external virtual returns (uint256 outputQuantity);

    function redeemMasset(
        uint256 _mAssetQuantity,
        uint256[] calldata _minOutputQuantities,
        address _recipient
    ) external virtual returns (uint256[] memory outputQuantities);

    function redeemExactBassets(
        address[] calldata _outputs,
        uint256[] calldata _outputQuantities,
        uint256 _maxMassetQuantity,
        address _recipient
    ) external virtual returns (uint256 mAssetRedeemed);

    function getRedeemOutput(address _output, uint256 _mAssetQuantity)
        external
        view
        virtual
        returns (uint256 bAssetOutput);

    function getRedeemExactBassetsOutput(
        address[] calldata _outputs,
        uint256[] calldata _outputQuantities
    ) external view virtual returns (uint256 mAssetAmount);

    // Views
    function getBasket() external view virtual returns (bool, bool);

    function getBasset(address _token)
        external
        view
        virtual
        returns (BassetPersonal memory personal, BassetData memory data);

    function getBassets()
        external
        view
        virtual
        returns (BassetPersonal[] memory personal, BassetData[] memory data);

    function bAssetIndexes(address) external view virtual returns (uint8);

    function getPrice() external view virtual returns (uint256 price, uint256 k);

    // SavingsManager
    function collectInterest() external virtual returns (uint256 swapFeesGained, uint256 newSupply);

    function collectPlatformInterest()
        external
        virtual
        returns (uint256 mintAmount, uint256 newSupply);

    // Admin
    function setCacheSize(uint256 _cacheSize) external virtual;

    function setFees(uint256 _swapFee, uint256 _redemptionFee) external virtual;

    function setTransferFeesFlag(address _bAsset, bool _flag) external virtual;

    function migrateBassets(address[] calldata _bAssets, address _newIntegration) external virtual;
}

// Status of the Basset - has it broken its peg?
enum BassetStatus {
    Default,
    Normal,
    BrokenBelowPeg,
    BrokenAbovePeg,
    Blacklisted,
    Liquidating,
    Liquidated,
    Failed
}

struct BasketState {
    bool undergoingRecol;
    bool failed;
}

struct FeederConfig {
    uint256 supply;
    uint256 a;
    WeightLimits limits;
}

struct InvariantConfig {
    uint256 supply;
    uint256 a;
    WeightLimits limits;
    uint256 recolFee;
}

struct BasicConfig {
    uint256 a;
    WeightLimits limits;
}

struct WeightLimits {
    uint128 min;
    uint128 max;
}

struct AmpData {
    uint64 initialA;
    uint64 targetA;
    uint64 rampStartTime;
    uint64 rampEndTime;
}

struct FeederData {
    uint256 swapFee;
    uint256 redemptionFee;
    uint256 govFee;
    uint256 pendingFees;
    uint256 cacheSize;
    BassetPersonal[] bAssetPersonal;
    BassetData[] bAssetData;
    AmpData ampData;
    WeightLimits weightLimits;
}

struct MassetData {
    uint256 swapFee;
    uint256 redemptionFee;
    uint256 cacheSize;
    uint256 surplus;
    BassetPersonal[] bAssetPersonal;
    BassetData[] bAssetData;
    BasketState basket;
    AmpData ampData;
    WeightLimits weightLimits;
}

struct AssetData {
    uint8 idx;
    uint256 amt;
    BassetPersonal personal;
}

struct Asset {
    uint8 idx;
    address addr;
    bool exists;
}

library SafeCast {
    /**
     * @dev Returns the downcasted uint128 from uint256, reverting on
     * overflow (when the input is greater than largest uint128).
     *
     * Counterpart to Solidity's `uint128` operator.
     *
     * Requirements:
     *
     * - input must fit into 128 bits
     */
    function toUint128(uint256 value) internal pure returns (uint128) {
        require(value < 2**128, "SafeCast: value doesn\'t fit in 128 bits");
        return uint128(value);
    }

    /**
     * @dev Returns the downcasted uint64 from uint256, reverting on
     * overflow (when the input is greater than largest uint64).
     *
     * Counterpart to Solidity's `uint64` operator.
     *
     * Requirements:
     *
     * - input must fit into 64 bits
     */
    function toUint64(uint256 value) internal pure returns (uint64) {
        require(value < 2**64, "SafeCast: value doesn\'t fit in 64 bits");
        return uint64(value);
    }

    /**
     * @dev Returns the downcasted uint32 from uint256, reverting on
     * overflow (when the input is greater than largest uint32).
     *
     * Counterpart to Solidity's `uint32` operator.
     *
     * Requirements:
     *
     * - input must fit into 32 bits
     */
    function toUint32(uint256 value) internal pure returns (uint32) {
        require(value < 2**32, "SafeCast: value doesn\'t fit in 32 bits");
        return uint32(value);
    }

    /**
     * @dev Returns the downcasted uint16 from uint256, reverting on
     * overflow (when the input is greater than largest uint16).
     *
     * Counterpart to Solidity's `uint16` operator.
     *
     * Requirements:
     *
     * - input must fit into 16 bits
     */
    function toUint16(uint256 value) internal pure returns (uint16) {
        require(value < 2**16, "SafeCast: value doesn\'t fit in 16 bits");
        return uint16(value);
    }

    /**
     * @dev Returns the downcasted uint8 from uint256, reverting on
     * overflow (when the input is greater than largest uint8).
     *
     * Counterpart to Solidity's `uint8` operator.
     *
     * Requirements:
     *
     * - input must fit into 8 bits.
     */
    function toUint8(uint256 value) internal pure returns (uint8) {
        require(value < 2**8, "SafeCast: value doesn\'t fit in 8 bits");
        return uint8(value);
    }

    /**
     * @dev Converts a signed int256 into an unsigned uint256.
     *
     * Requirements:
     *
     * - input must be greater than or equal to 0.
     */
    function toUint256(int256 value) internal pure returns (uint256) {
        require(value >= 0, "SafeCast: value must be positive");
        return uint256(value);
    }

    /**
     * @dev Returns the downcasted int128 from int256, reverting on
     * overflow (when the input is less than smallest int128 or
     * greater than largest int128).
     *
     * Counterpart to Solidity's `int128` operator.
     *
     * Requirements:
     *
     * - input must fit into 128 bits
     *
     * _Available since v3.1._
     */
    function toInt128(int256 value) internal pure returns (int128) {
        require(value >= -2**127 && value < 2**127, "SafeCast: value doesn\'t fit in 128 bits");
        return int128(value);
    }

    /**
     * @dev Returns the downcasted int64 from int256, reverting on
     * overflow (when the input is less than smallest int64 or
     * greater than largest int64).
     *
     * Counterpart to Solidity's `int64` operator.
     *
     * Requirements:
     *
     * - input must fit into 64 bits
     *
     * _Available since v3.1._
     */
    function toInt64(int256 value) internal pure returns (int64) {
        require(value >= -2**63 && value < 2**63, "SafeCast: value doesn\'t fit in 64 bits");
        return int64(value);
    }

    /**
     * @dev Returns the downcasted int32 from int256, reverting on
     * overflow (when the input is less than smallest int32 or
     * greater than largest int32).
     *
     * Counterpart to Solidity's `int32` operator.
     *
     * Requirements:
     *
     * - input must fit into 32 bits
     *
     * _Available since v3.1._
     */
    function toInt32(int256 value) internal pure returns (int32) {
        require(value >= -2**31 && value < 2**31, "SafeCast: value doesn\'t fit in 32 bits");
        return int32(value);
    }

    /**
     * @dev Returns the downcasted int16 from int256, reverting on
     * overflow (when the input is less than smallest int16 or
     * greater than largest int16).
     *
     * Counterpart to Solidity's `int16` operator.
     *
     * Requirements:
     *
     * - input must fit into 16 bits
     *
     * _Available since v3.1._
     */
    function toInt16(int256 value) internal pure returns (int16) {
        require(value >= -2**15 && value < 2**15, "SafeCast: value doesn\'t fit in 16 bits");
        return int16(value);
    }

    /**
     * @dev Returns the downcasted int8 from int256, reverting on
     * overflow (when the input is less than smallest int8 or
     * greater than largest int8).
     *
     * Counterpart to Solidity's `int8` operator.
     *
     * Requirements:
     *
     * - input must fit into 8 bits.
     *
     * _Available since v3.1._
     */
    function toInt8(int256 value) internal pure returns (int8) {
        require(value >= -2**7 && value < 2**7, "SafeCast: value doesn\'t fit in 8 bits");
        return int8(value);
    }

    /**
     * @dev Converts an unsigned uint256 into a signed int256.
     *
     * Requirements:
     *
     * - input must be less than or equal to maxInt256.
     */
    function toInt256(uint256 value) internal pure returns (int256) {
        require(value < 2**255, "SafeCast: value doesn't fit in an int256");
        return int256(value);
    }
}

library StableMath {
    /**
     * @dev Scaling unit for use in specific calculations,
     * where 1 * 10**18, or 1e18 represents a unit '1'
     */
    uint256 private constant FULL_SCALE = 1e18;

    /**
     * @dev Token Ratios are used when converting between units of bAsset, mAsset and MTA
     * Reasoning: Takes into account token decimals, and difference in base unit (i.e. grams to Troy oz for gold)
     * bAsset ratio unit for use in exact calculations,
     * where (1 bAsset unit * bAsset.ratio) / ratioScale == x mAsset unit
     */
    uint256 private constant RATIO_SCALE = 1e8;

    /**
     * @dev Provides an interface to the scaling unit
     * @return Scaling unit (1e18 or 1 * 10**18)
     */
    function getFullScale() internal pure returns (uint256) {
        return FULL_SCALE;
    }

    /**
     * @dev Provides an interface to the ratio unit
     * @return Ratio scale unit (1e8 or 1 * 10**8)
     */
    function getRatioScale() internal pure returns (uint256) {
        return RATIO_SCALE;
    }

    /**
     * @dev Scales a given integer to the power of the full scale.
     * @param x   Simple uint256 to scale
     * @return    Scaled value a to an exact number
     */
    function scaleInteger(uint256 x) internal pure returns (uint256) {
        return x * FULL_SCALE;
    }

    /***************************************
              PRECISE ARITHMETIC
    ****************************************/

    /**
     * @dev Multiplies two precise units, and then truncates by the full scale
     * @param x     Left hand input to multiplication
     * @param y     Right hand input to multiplication
     * @return      Result after multiplying the two inputs and then dividing by the shared
     *              scale unit
     */
    function mulTruncate(uint256 x, uint256 y) internal pure returns (uint256) {
        return mulTruncateScale(x, y, FULL_SCALE);
    }

    /**
     * @dev Multiplies two precise units, and then truncates by the given scale. For example,
     * when calculating 90% of 10e18, (10e18 * 9e17) / 1e18 = (9e36) / 1e18 = 9e18
     * @param x     Left hand input to multiplication
     * @param y     Right hand input to multiplication
     * @param scale Scale unit
     * @return      Result after multiplying the two inputs and then dividing by the shared
     *              scale unit
     */
    function mulTruncateScale(
        uint256 x,
        uint256 y,
        uint256 scale
    ) internal pure returns (uint256) {
        // e.g. assume scale = fullScale
        // z = 10e18 * 9e17 = 9e36
        // return 9e38 / 1e18 = 9e18
        return (x * y) / scale;
    }

    /**
     * @dev Multiplies two precise units, and then truncates by the full scale, rounding up the result
     * @param x     Left hand input to multiplication
     * @param y     Right hand input to multiplication
     * @return      Result after multiplying the two inputs and then dividing by the shared
     *              scale unit, rounded up to the closest base unit.
     */
    function mulTruncateCeil(uint256 x, uint256 y) internal pure returns (uint256) {
        // e.g. 8e17 * 17268172638 = 138145381104e17
        uint256 scaled = x * y;
        // e.g. 138145381104e17 + 9.99...e17 = 138145381113.99...e17
        uint256 ceil = scaled + FULL_SCALE - 1;
        // e.g. 13814538111.399...e18 / 1e18 = 13814538111
        return ceil / FULL_SCALE;
    }

    /**
     * @dev Precisely divides two units, by first scaling the left hand operand. Useful
     *      for finding percentage weightings, i.e. 8e18/10e18 = 80% (or 8e17)
     * @param x     Left hand input to division
     * @param y     Right hand input to division
     * @return      Result after multiplying the left operand by the scale, and
     *              executing the division on the right hand input.
     */
    function divPrecisely(uint256 x, uint256 y) internal pure returns (uint256) {
        // e.g. 8e18 * 1e18 = 8e36
        // e.g. 8e36 / 10e18 = 8e17
        return (x * FULL_SCALE) / y;
    }

    /***************************************
                  RATIO FUNCS
    ****************************************/

    /**
     * @dev Multiplies and truncates a token ratio, essentially flooring the result
     *      i.e. How much mAsset is this bAsset worth?
     * @param x     Left hand operand to multiplication (i.e Exact quantity)
     * @param ratio bAsset ratio
     * @return c    Result after multiplying the two inputs and then dividing by the ratio scale
     */
    function mulRatioTruncate(uint256 x, uint256 ratio) internal pure returns (uint256 c) {
        return mulTruncateScale(x, ratio, RATIO_SCALE);
    }

    /**
     * @dev Multiplies and truncates a token ratio, rounding up the result
     *      i.e. How much mAsset is this bAsset worth?
     * @param x     Left hand input to multiplication (i.e Exact quantity)
     * @param ratio bAsset ratio
     * @return      Result after multiplying the two inputs and then dividing by the shared
     *              ratio scale, rounded up to the closest base unit.
     */
    function mulRatioTruncateCeil(uint256 x, uint256 ratio) internal pure returns (uint256) {
        // e.g. How much mAsset should I burn for this bAsset (x)?
        // 1e18 * 1e8 = 1e26
        uint256 scaled = x * ratio;
        // 1e26 + 9.99e7 = 100..00.999e8
        uint256 ceil = scaled + RATIO_SCALE - 1;
        // return 100..00.999e8 / 1e8 = 1e18
        return ceil / RATIO_SCALE;
    }

    /**
     * @dev Precisely divides two ratioed units, by first scaling the left hand operand
     *      i.e. How much bAsset is this mAsset worth?
     * @param x     Left hand operand in division
     * @param ratio bAsset ratio
     * @return c    Result after multiplying the left operand by the scale, and
     *              executing the division on the right hand input.
     */
    function divRatioPrecisely(uint256 x, uint256 ratio) internal pure returns (uint256 c) {
        // e.g. 1e14 * 1e8 = 1e22
        // return 1e22 / 1e12 = 1e10
        return (x * RATIO_SCALE) / ratio;
    }

    /***************************************
                    HELPERS
    ****************************************/

    /**
     * @dev Calculates minimum of two numbers
     * @param x     Left hand input
     * @param y     Right hand input
     * @return      Minimum of the two inputs
     */
    function min(uint256 x, uint256 y) internal pure returns (uint256) {
        return x > y ? y : x;
    }

    /**
     * @dev Calculated maximum of two numbers
     * @param x     Left hand input
     * @param y     Right hand input
     * @return      Maximum of the two inputs
     */
    function max(uint256 x, uint256 y) internal pure returns (uint256) {
        return x > y ? x : y;
    }

    /**
     * @dev Clamps a value to an upper bound
     * @param x           Left hand input
     * @param upperBound  Maximum possible value to return
     * @return            Input x clamped to a maximum value, upperBound
     */
    function clamp(uint256 x, uint256 upperBound) internal pure returns (uint256) {
        return x > upperBound ? upperBound : x;
    }
}

interface IPlatformIntegration {
    /**
     * @dev Deposit the given bAsset to Lending platform
     * @param _bAsset bAsset address
     * @param _amount Amount to deposit
     */
    function deposit(
        address _bAsset,
        uint256 _amount,
        bool isTokenFeeCharged
    ) external returns (uint256 quantityDeposited);

    /**
     * @dev Withdraw given bAsset from Lending platform
     */
    function withdraw(
        address _receiver,
        address _bAsset,
        uint256 _amount,
        bool _hasTxFee
    ) external;

    /**
     * @dev Withdraw given bAsset from Lending platform
     */
    function withdraw(
        address _receiver,
        address _bAsset,
        uint256 _amount,
        uint256 _totalAmount,
        bool _hasTxFee
    ) external;

    /**
     * @dev Withdraw given bAsset from the cache
     */
    function withdrawRaw(
        address _receiver,
        address _bAsset,
        uint256 _amount
    ) external;

    /**
     * @dev Returns the current balance of the given bAsset
     */
    function checkBalance(address _bAsset) external returns (uint256 balance);

    /**
     * @dev Returns the pToken
     */
    function bAssetToPToken(address _bAsset) external returns (address pToken);
}

library Root {
    /**
     * @dev Returns the square root of a given number
     * @param x Input
     * @return y Square root of Input
     */
    function sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        else {
            uint256 xx = x;
            uint256 r = 1;
            if (xx >= 0x100000000000000000000000000000000) {
                xx >>= 128;
                r <<= 64;
            }
            if (xx >= 0x10000000000000000) {
                xx >>= 64;
                r <<= 32;
            }
            if (xx >= 0x100000000) {
                xx >>= 32;
                r <<= 16;
            }
            if (xx >= 0x10000) {
                xx >>= 16;
                r <<= 8;
            }
            if (xx >= 0x100) {
                xx >>= 8;
                r <<= 4;
            }
            if (xx >= 0x10) {
                xx >>= 4;
                r <<= 2;
            }
            if (xx >= 0x8) {
                r <<= 1;
            }
            r = (r + x / r) >> 1;
            r = (r + x / r) >> 1;
            r = (r + x / r) >> 1;
            r = (r + x / r) >> 1;
            r = (r + x / r) >> 1;
            r = (r + x / r) >> 1;
            r = (r + x / r) >> 1; // Seven iterations should be enough
            uint256 r1 = x / r;
            return uint256(r < r1 ? r : r1);
        }
    }
}

/**
 * @dev Collection of functions related to the address type
 */
library Address {
    /**
     * @dev Returns true if `account` is a contract.
     *
     * [IMPORTANT]
     * ====
     * It is unsafe to assume that an address for which this function returns
     * false is an externally-owned account (EOA) and not a contract.
     *
     * Among others, `isContract` will return false for the following
     * types of addresses:
     *
     *  - an externally-owned account
     *  - a contract in construction
     *  - an address where a contract will be created
     *  - an address where a contract lived, but was destroyed
     * ====
     */
    function isContract(address account) internal view returns (bool) {
        // This method relies on extcodesize, which returns 0 for contracts in
        // construction, since the code is only stored at the end of the
        // constructor execution.

        uint256 size;
        // solhint-disable-next-line no-inline-assembly
        assembly { size := extcodesize(account) }
        return size > 0;
    }

    /**
     * @dev Replacement for Solidity's `transfer`: sends `amount` wei to
     * `recipient`, forwarding all available gas and reverting on errors.
     *
     * https://eips.ethereum.org/EIPS/eip-1884[EIP1884] increases the gas cost
     * of certain opcodes, possibly making contracts go over the 2300 gas limit
     * imposed by `transfer`, making them unable to receive funds via
     * `transfer`. {sendValue} removes this limitation.
     *
     * https://diligence.consensys.net/posts/2019/09/stop-using-soliditys-transfer-now/[Learn more].
     *
     * IMPORTANT: because control is transferred to `recipient`, care must be
     * taken to not create reentrancy vulnerabilities. Consider using
     * {ReentrancyGuard} or the
     * https://solidity.readthedocs.io/en/v0.5.11/security-considerations.html#use-the-checks-effects-interactions-pattern[checks-effects-interactions pattern].
     */
    function sendValue(address payable recipient, uint256 amount) internal {
        require(address(this).balance >= amount, "Address: insufficient balance");

        // solhint-disable-next-line avoid-low-level-calls, avoid-call-value
        (bool success, ) = recipient.call{ value: amount }("");
        require(success, "Address: unable to send value, recipient may have reverted");
    }

    /**
     * @dev Performs a Solidity function call using a low level `call`. A
     * plain`call` is an unsafe replacement for a function call: use this
     * function instead.
     *
     * If `target` reverts with a revert reason, it is bubbled up by this
     * function (like regular Solidity function calls).
     *
     * Returns the raw returned data. To convert to the expected return value,
     * use https://solidity.readthedocs.io/en/latest/units-and-global-variables.html?highlight=abi.decode#abi-encoding-and-decoding-functions[`abi.decode`].
     *
     * Requirements:
     *
     * - `target` must be a contract.
     * - calling `target` with `data` must not revert.
     *
     * _Available since v3.1._
     */
    function functionCall(address target, bytes memory data) internal returns (bytes memory) {
      return functionCall(target, data, "Address: low-level call failed");
    }

    /**
     * @dev Same as {xref-Address-functionCall-address-bytes-}[`functionCall`], but with
     * `errorMessage` as a fallback revert reason when `target` reverts.
     *
     * _Available since v3.1._
     */
    function functionCall(address target, bytes memory data, string memory errorMessage) internal returns (bytes memory) {
        return functionCallWithValue(target, data, 0, errorMessage);
    }

    /**
     * @dev Same as {xref-Address-functionCall-address-bytes-}[`functionCall`],
     * but also transferring `value` wei to `target`.
     *
     * Requirements:
     *
     * - the calling contract must have an ETH balance of at least `value`.
     * - the called Solidity function must be `payable`.
     *
     * _Available since v3.1._
     */
    function functionCallWithValue(address target, bytes memory data, uint256 value) internal returns (bytes memory) {
        return functionCallWithValue(target, data, value, "Address: low-level call with value failed");
    }

    /**
     * @dev Same as {xref-Address-functionCallWithValue-address-bytes-uint256-}[`functionCallWithValue`], but
     * with `errorMessage` as a fallback revert reason when `target` reverts.
     *
     * _Available since v3.1._
     */
    function functionCallWithValue(address target, bytes memory data, uint256 value, string memory errorMessage) internal returns (bytes memory) {
        require(address(this).balance >= value, "Address: insufficient balance for call");
        require(isContract(target), "Address: call to non-contract");

        // solhint-disable-next-line avoid-low-level-calls
        (bool success, bytes memory returndata) = target.call{ value: value }(data);
        return _verifyCallResult(success, returndata, errorMessage);
    }

    /**
     * @dev Same as {xref-Address-functionCall-address-bytes-}[`functionCall`],
     * but performing a static call.
     *
     * _Available since v3.3._
     */
    function functionStaticCall(address target, bytes memory data) internal view returns (bytes memory) {
        return functionStaticCall(target, data, "Address: low-level static call failed");
    }

    /**
     * @dev Same as {xref-Address-functionCall-address-bytes-string-}[`functionCall`],
     * but performing a static call.
     *
     * _Available since v3.3._
     */
    function functionStaticCall(address target, bytes memory data, string memory errorMessage) internal view returns (bytes memory) {
        require(isContract(target), "Address: static call to non-contract");

        // solhint-disable-next-line avoid-low-level-calls
        (bool success, bytes memory returndata) = target.staticcall(data);
        return _verifyCallResult(success, returndata, errorMessage);
    }

    /**
     * @dev Same as {xref-Address-functionCall-address-bytes-}[`functionCall`],
     * but performing a delegate call.
     *
     * _Available since v3.4._
     */
    function functionDelegateCall(address target, bytes memory data) internal returns (bytes memory) {
        return functionDelegateCall(target, data, "Address: low-level delegate call failed");
    }

    /**
     * @dev Same as {xref-Address-functionCall-address-bytes-string-}[`functionCall`],
     * but performing a delegate call.
     *
     * _Available since v3.4._
     */
    function functionDelegateCall(address target, bytes memory data, string memory errorMessage) internal returns (bytes memory) {
        require(isContract(target), "Address: delegate call to non-contract");

        // solhint-disable-next-line avoid-low-level-calls
        (bool success, bytes memory returndata) = target.delegatecall(data);
        return _verifyCallResult(success, returndata, errorMessage);
    }

    function _verifyCallResult(bool success, bytes memory returndata, string memory errorMessage) private pure returns(bytes memory) {
        if (success) {
            return returndata;
        } else {
            // Look for revert reason and bubble it up if present
            if (returndata.length > 0) {
                // The easiest way to bubble the revert reason is using memory via assembly

                // solhint-disable-next-line no-inline-assembly
                assembly {
                    let returndata_size := mload(returndata)
                    revert(add(32, returndata), returndata_size)
                }
            } else {
                revert(errorMessage);
            }
        }
    }
}

library SafeERC20 {
    using Address for address;

    function safeTransfer(IERC20 token, address to, uint256 value) internal {
        _callOptionalReturn(token, abi.encodeWithSelector(token.transfer.selector, to, value));
    }

    function safeTransferFrom(IERC20 token, address from, address to, uint256 value) internal {
        _callOptionalReturn(token, abi.encodeWithSelector(token.transferFrom.selector, from, to, value));
    }

    /**
     * @dev Deprecated. This function has issues similar to the ones found in
     * {IERC20-approve}, and its usage is discouraged.
     *
     * Whenever possible, use {safeIncreaseAllowance} and
     * {safeDecreaseAllowance} instead.
     */
    function safeApprove(IERC20 token, address spender, uint256 value) internal {
        // safeApprove should only be called when setting an initial allowance,
        // or when resetting it to zero. To increase and decrease it, use
        // 'safeIncreaseAllowance' and 'safeDecreaseAllowance'
        // solhint-disable-next-line max-line-length
        require((value == 0) || (token.allowance(address(this), spender) == 0),
            "SafeERC20: approve from non-zero to non-zero allowance"
        );
        _callOptionalReturn(token, abi.encodeWithSelector(token.approve.selector, spender, value));
    }

    function safeIncreaseAllowance(IERC20 token, address spender, uint256 value) internal {
        uint256 newAllowance = token.allowance(address(this), spender) + value;
        _callOptionalReturn(token, abi.encodeWithSelector(token.approve.selector, spender, newAllowance));
    }

    function safeDecreaseAllowance(IERC20 token, address spender, uint256 value) internal {
        unchecked {
            uint256 oldAllowance = token.allowance(address(this), spender);
            require(oldAllowance >= value, "SafeERC20: decreased allowance below zero");
            uint256 newAllowance = oldAllowance - value;
            _callOptionalReturn(token, abi.encodeWithSelector(token.approve.selector, spender, newAllowance));
        }
    }

    /**
     * @dev Imitates a Solidity high-level call (i.e. a regular function call to a contract), relaxing the requirement
     * on the return value: the return value is optional (but if data is returned, it must not be false).
     * @param token The token targeted by the call.
     * @param data The call data (encoded using abi.encode or one of its variants).
     */
    function _callOptionalReturn(IERC20 token, bytes memory data) private {
        // We need to perform a low level call here, to bypass Solidity's return data size checking mechanism, since
        // we're implementing it ourselves. We use {Address.functionCall} to perform this call, which verifies that
        // the target address contains contract code and also asserts for success in the low-level call.

        bytes memory returndata = address(token).functionCall(data, "SafeERC20: low-level call failed");
        if (returndata.length > 0) { // Return data is optional
            // solhint-disable-next-line max-line-length
            require(abi.decode(returndata, (bool)), "SafeERC20: ERC20 operation did not succeed");
        }
    }
}

library MassetHelpers {
    using SafeERC20 for IERC20;

    function transferReturnBalance(
        address _sender,
        address _recipient,
        address _bAsset,
        uint256 _qty
    ) internal returns (uint256 receivedQty, uint256 recipientBalance) {
        uint256 balBefore = IERC20(_bAsset).balanceOf(_recipient);
        IERC20(_bAsset).safeTransferFrom(_sender, _recipient, _qty);
        recipientBalance = IERC20(_bAsset).balanceOf(_recipient);
        receivedQty = recipientBalance - balBefore;
    }

    function safeInfiniteApprove(address _asset, address _spender) internal {
        IERC20(_asset).safeApprove(_spender, 0);
        IERC20(_asset).safeApprove(_spender, 2**256 - 1);
    }
}

library MassetLogic {
    using StableMath for uint256;
    using SafeERC20 for IERC20;

    uint256 internal constant A_PRECISION = 100;

    /***************************************
                    MINT
    ****************************************/

    /**
     * @notice Transfers token in, updates internal balances and computes the mAsset output
     * @param _data                 Masset storage state
     * @param _config               Core config for use in the invariant validator
     * @param _input                Data on the bAsset to deposit for the minted mAsset.
     * @param _inputQuantity        Quantity in input token units.
     * @param _minOutputQuantity    Minimum mAsset quantity to be minted. This protects against slippage.
     * @return mintOutput           Quantity of mAsset minted from the deposited bAsset.
     */
    function mint(
        MassetData storage _data,
        InvariantConfig calldata _config,
        Asset calldata _input,
        uint256 _inputQuantity,
        uint256 _minOutputQuantity
    ) external returns (uint256 mintOutput) {
        BassetData[] memory cachedBassetData = _data.bAssetData;
        // Transfer collateral to the platform integration address and call deposit
        uint256 quantityDeposited =
            _depositTokens(
                _data.bAssetPersonal[_input.idx],
                cachedBassetData[_input.idx].ratio,
                _inputQuantity,
                _getCacheDetails(_data, _config.supply)
            );
        // Validation should be after token transfer, as bAssetQty is unknown before
        mintOutput = computeMint(cachedBassetData, _input.idx, quantityDeposited, _config);
        require(mintOutput >= _minOutputQuantity, "Mint quantity < min qty");
        // Log the Vault increase - can only be done when basket is healthy
        _data.bAssetData[_input.idx].vaultBalance =
            cachedBassetData[_input.idx].vaultBalance +
            SafeCast.toUint128(quantityDeposited);
    }

    /**
     * @notice Transfers tokens in, updates internal balances and computes the mAsset output.
     * Only fAsset & mAsset are supported in this path.
     * @param _data                 Masset storage state
     * @param _config               Core config for use in the invariant validator
     * @param _indices              Non-duplicate addresses of the bAssets to deposit for the minted mAsset.
     * @param _inputQuantities      Quantity of each input in input token units.
     * @param _minOutputQuantity    Minimum mAsset quantity to be minted. This protects against slippage.
     * @return mintOutput           Quantity of mAsset minted from the deposited bAsset.
     */
    function mintMulti(
        MassetData storage _data,
        InvariantConfig calldata _config,
        uint8[] calldata _indices,
        uint256[] calldata _inputQuantities,
        uint256 _minOutputQuantity
    ) external returns (uint256 mintOutput) {
        uint256 len = _indices.length;
        uint256[] memory quantitiesDeposited = new uint256[](len);
        BassetData[] memory cachedBassetData = _data.bAssetData;
        uint256 maxCache = _getCacheDetails(_data, _config.supply);
        // Transfer the Bassets to the integrator, update storage and calc MassetQ
        for (uint256 i = 0; i < len; i++) {
            if (_inputQuantities[i] > 0) {
                uint8 idx = _indices[i];
                BassetData memory bData = cachedBassetData[idx];
                quantitiesDeposited[i] = _depositTokens(
                    _data.bAssetPersonal[idx],
                    bData.ratio,
                    _inputQuantities[i],
                    maxCache
                );

                _data.bAssetData[idx].vaultBalance =
                    bData.vaultBalance +
                    SafeCast.toUint128(quantitiesDeposited[i]);
            }
        }
        // Validate the proposed mint, after token transfer
        mintOutput = computeMintMulti(cachedBassetData, _indices, quantitiesDeposited, _config);
        require(mintOutput >= _minOutputQuantity, "Mint quantity < min qty");
        require(mintOutput > 0, "Zero mAsset quantity");
    }

    /***************************************
                    SWAP
    ****************************************/

    /**
     * @notice Swaps two assets - either internally between fAsset<>mAsset, or between fAsset<>mpAsset by
     * first routing through the mAsset pool.
     * @param _data              Masset storage state
     * @param _config            Core config for use in the invariant validator
     * @param _input             Data on bAsset to deposit
     * @param _output            Data on bAsset to withdraw
     * @param _inputQuantity     Units of input bAsset to swap in
     * @param _minOutputQuantity Minimum quantity of the swap output asset. This protects against slippage
     * @param _recipient         Address to transfer output asset to
     * @return swapOutput        Quantity of output asset returned from swap
     * @return scaledFee          Fee paid, in mAsset terms
     */
    function swap(
        MassetData storage _data,
        InvariantConfig calldata _config,
        Asset calldata _input,
        Asset calldata _output,
        uint256 _inputQuantity,
        uint256 _minOutputQuantity,
        address _recipient
    ) external returns (uint256 swapOutput, uint256 scaledFee) {
        BassetData[] memory cachedBassetData = _data.bAssetData;
        // 3. Deposit the input tokens
        uint256 quantityDeposited =
            _depositTokens(
                _data.bAssetPersonal[_input.idx],
                cachedBassetData[_input.idx].ratio,
                _inputQuantity,
                _getCacheDetails(_data, _config.supply)
            );
        // 3.1. Update the input balance
        _data.bAssetData[_input.idx].vaultBalance =
            cachedBassetData[_input.idx].vaultBalance +
            SafeCast.toUint128(quantityDeposited);

        // 3. Validate the swap
        (swapOutput, scaledFee) = computeSwap(
            cachedBassetData,
            _input.idx,
            _output.idx,
            quantityDeposited,
            _data.swapFee,
            _config
        );
        require(swapOutput >= _minOutputQuantity, "Output qty < minimum qty");
        require(swapOutput > 0, "Zero output quantity");
        //4. Settle the swap
        //4.1. Decrease output bal
        uint256 maxCache = _getCacheDetails(_data, _config.supply);
        _withdrawTokens(
            swapOutput,
            _data.bAssetPersonal[_output.idx],
            cachedBassetData[_output.idx],
            _recipient,
            maxCache
        );
        _data.bAssetData[_output.idx].vaultBalance =
            cachedBassetData[_output.idx].vaultBalance -
            SafeCast.toUint128(swapOutput);
        // Save new surplus to storage
        _data.surplus += scaledFee;
    }

    /***************************************
                    REDEEM
    ****************************************/

    /**
     * @notice Burns a specified quantity of the senders mAsset in return for a bAsset. The output amount is derived
     * from the invariant. Supports redemption into either the fAsset, mAsset or assets in the mAsset basket.
     * @param _data              Masset storage state
     * @param _config            Core config for use in the invariant validator
     * @param _output            Data on bAsset to withdraw
     * @param _inputQuantity   Quantity of mAsset to burn
     * @param _minOutputQuantity Minimum bAsset quantity to receive for the burnt mAsset. This protects against slippage.
     * @param _recipient         Address to transfer the withdrawn bAssets to.
     * @return bAssetQuantity    Quanity of bAsset units received for the burnt mAsset
     * @return scaledFee          Fee paid, in mAsset terms
     */
    function redeem(
        MassetData storage _data,
        InvariantConfig calldata _config,
        Asset calldata _output,
        uint256 _inputQuantity,
        uint256 _minOutputQuantity,
        address _recipient
    ) external returns (uint256 bAssetQuantity, uint256 scaledFee) {
        // Load the bAsset data from storage into memory
        BassetData[] memory cachedBassetData = _data.bAssetData;
        // Calculate redemption quantities
        (bAssetQuantity, scaledFee) = computeRedeem(
            cachedBassetData,
            _output.idx,
            _inputQuantity,
            _config,
            _data.swapFee
        );
        require(bAssetQuantity >= _minOutputQuantity, "bAsset qty < min qty");
        require(bAssetQuantity > 0, "Output == 0");
        // Apply fees, burn mAsset and return bAsset to recipient
        _data.surplus += scaledFee;
        // 2.0. Transfer the Bassets to the recipient
        uint256 maxCache = _getCacheDetails(_data, _config.supply - _inputQuantity + scaledFee);
        _withdrawTokens(
            bAssetQuantity,
            _data.bAssetPersonal[_output.idx],
            cachedBassetData[_output.idx],
            _recipient,
            maxCache
        );
        // 3.0. Set vault balance
        _data.bAssetData[_output.idx].vaultBalance =
            cachedBassetData[_output.idx].vaultBalance -
            SafeCast.toUint128(bAssetQuantity);
    }

    /**
     * @dev Credits a recipient with a proportionate amount of bAssets, relative to current vault
     * balance levels and desired mAsset quantity. Burns the mAsset as payment. Only fAsset & mAsset are supported in this path.
     * @param _data                 Masset storage state
     * @param _config               Core config for use in the invariant validator
     * @param _inputQuantity        Quantity of mAsset to redeem
     * @param _minOutputQuantities  Min units of output to receive
     * @param _recipient            Address to credit the withdrawn bAssets
     * @return scaledFee            Fee collected in mAsset terms
     * @return outputs              Array of output asset addresses
     * @return outputQuantities     Array of output asset quantities
     */
    function redeemProportionately(
        MassetData storage _data,
        InvariantConfig calldata _config,
        uint256 _inputQuantity,
        uint256[] calldata _minOutputQuantities,
        address _recipient
    )
        external
        returns (
            uint256 scaledFee,
            address[] memory outputs,
            uint256[] memory outputQuantities
        )
    {
        // Load the bAsset data from storage into memory
        BassetData[] memory cachedBassetData = _data.bAssetData;

        // Calculate mAsset redemption quantities
        uint256 deductedInput;
        (deductedInput, scaledFee) = _getDeducted(
            cachedBassetData,
            _config,
            _inputQuantity,
            _data.redemptionFee
        );

        _data.surplus += scaledFee;

        // Calc cache and total mAsset circulating
        uint256 maxCache = _getCacheDetails(_data, _config.supply - _inputQuantity + scaledFee);

        uint256 len = cachedBassetData.length;
        outputs = new address[](len);
        outputQuantities = new uint256[](len);
        for (uint256 i = 0; i < len; i++) {
            // Get amount out, proportionate to redemption quantity
            uint256 amountOut = (cachedBassetData[i].vaultBalance * deductedInput) / _config.supply;
            require(amountOut > 1, "Output == 0");
            amountOut -= 1;
            require(amountOut >= _minOutputQuantities[i], "bAsset qty < min qty");
            // reduce vaultBalance
            _data.bAssetData[i].vaultBalance =
                cachedBassetData[i].vaultBalance -
                SafeCast.toUint128(amountOut);
            // Set output in array
            BassetPersonal memory personal = _data.bAssetPersonal[i];
            (outputQuantities[i], outputs[i]) = (amountOut, personal.addr);
            // Transfer the bAsset to the recipient
            _withdrawTokens(amountOut, personal, cachedBassetData[i], _recipient, maxCache);
        }
    }

    /** @dev Internal func to get the deducted input to avoid stack depth error */
    function _getDeducted(
        BassetData[] memory _bData,
        InvariantConfig memory _config,
        uint256 _input,
        uint256 _redemptionFee
    ) internal pure returns (uint256 deductedInput, uint256 scaledFee) {
        deductedInput = _input;
        // If supply > k, deduct recolFee
        (uint256 price, ) = computePrice(_bData, _config);
        if (price < 1e18) {
            deductedInput -= ((_input * _config.recolFee) / 1e18);
        }
        scaledFee = deductedInput.mulTruncate(_redemptionFee);
        deductedInput -= scaledFee;
    }

    /**
     * @dev Credits a recipient with a certain quantity of selected bAssets, in exchange for burning the
     *      relative mAsset quantity from the sender. Only fAsset & mAsset (0,1) are supported in this path.
     * @param _data                 Masset storage state
     * @param _config               Core config for use in the invariant validator
     * @param _indices              Indices of the bAssets to receive
     * @param _outputQuantities     Units of the bAssets to receive
     * @param _maxMassetQuantity     Maximum mAsset quantity to burn for the received bAssets. This protects against slippage.
     * @param _recipient            Address to receive the withdrawn bAssets
     * @return mAssetQuantity      Quantity of mAsset units to burn as payment
     * @return fee             Fee collected, in mAsset terms
     */
    function redeemExactBassets(
        MassetData storage _data,
        InvariantConfig memory _config,
        uint8[] calldata _indices,
        uint256[] calldata _outputQuantities,
        uint256 _maxMassetQuantity,
        address _recipient
    ) external returns (uint256 mAssetQuantity, uint256 fee) {
        // Load bAsset data from storage to memory
        BassetData[] memory cachedBassetData = _data.bAssetData;

        (mAssetQuantity, fee) = computeRedeemExact(
            cachedBassetData,
            _indices,
            _outputQuantities,
            _config,
            _data.swapFee
        );
        require(mAssetQuantity <= _maxMassetQuantity, "Redeem mAsset qty > max quantity");
        // Apply fees, burn mAsset and return bAsset to recipient
        _data.surplus += fee;
        // Transfer the Bassets to the recipient and count fees
        uint256 maxCache = _getCacheDetails(_data, _config.supply - mAssetQuantity + fee);
        for (uint256 i = 0; i < _indices.length; i++) {
            uint8 idx = _indices[i];
            _withdrawTokens(
                _outputQuantities[i],
                _data.bAssetPersonal[idx],
                cachedBassetData[idx],
                _recipient,
                maxCache
            );
            _data.bAssetData[idx].vaultBalance =
                cachedBassetData[idx].vaultBalance -
                SafeCast.toUint128(_outputQuantities[i]);
        }
    }

    /***************************************
                FORGING - INTERNAL
    ****************************************/

    /**
     * @dev Deposits a given asset to the system. If there is sufficient room for the asset
     * in the cache, then just transfer, otherwise reset the cache to the desired mid level by
     * depositing the delta in the platform
     */
    function _depositTokens(
        BassetPersonal memory _bAsset,
        uint256 _bAssetRatio,
        uint256 _quantity,
        uint256 _maxCache
    ) internal returns (uint256 quantityDeposited) {
        // 0. If integration is 0, short circuit
        if (_bAsset.integrator == address(0)) {
            (uint256 received, ) =
                MassetHelpers.transferReturnBalance(
                    msg.sender,
                    address(this),
                    _bAsset.addr,
                    _quantity
                );
            return received;
        }

        // 1 - Send all to PI, using the opportunity to get the cache balance and net amount transferred
        uint256 cacheBal;
        (quantityDeposited, cacheBal) = MassetHelpers.transferReturnBalance(
            msg.sender,
            _bAsset.integrator,
            _bAsset.addr,
            _quantity
        );

        // 2 - Deposit X if necessary
        // 2.1 - Deposit if xfer fees
        if (_bAsset.hasTxFee) {
            uint256 deposited =
                IPlatformIntegration(_bAsset.integrator).deposit(
                    _bAsset.addr,
                    quantityDeposited,
                    true
                );

            return StableMath.min(deposited, quantityDeposited);
        }
        // 2.2 - Else Deposit X if Cache > %
        // This check is in place to ensure that any token with a txFee is rejected
        require(quantityDeposited == _quantity, "Asset not fully transferred");

        uint256 relativeMaxCache = _maxCache.divRatioPrecisely(_bAssetRatio);

        if (cacheBal > relativeMaxCache) {
            uint256 delta = cacheBal - (relativeMaxCache / 2);
            IPlatformIntegration(_bAsset.integrator).deposit(_bAsset.addr, delta, false);
        }
    }

    /**
     * @dev Withdraws a given asset from its platformIntegration. If there is sufficient liquidity
     * in the cache, then withdraw from there, otherwise withdraw from the lending market and reset the
     * cache to the mid level.
     */
    function _withdrawTokens(
        uint256 _quantity,
        BassetPersonal memory _personal,
        BassetData memory _data,
        address _recipient,
        uint256 _maxCache
    ) internal {
        if (_quantity == 0) return;

        // 1.0 If there is no integrator, send from here
        if (_personal.integrator == address(0)) {
            IERC20(_personal.addr).safeTransfer(_recipient, _quantity);
        }
        // 1.1 If txFee then short circuit - there is no cache
        else if (_personal.hasTxFee) {
            IPlatformIntegration(_personal.integrator).withdraw(
                _recipient,
                _personal.addr,
                _quantity,
                _quantity,
                true
            );
        }
        // 1.2. Else, withdraw from either cache or main vault
        else {
            uint256 cacheBal = IERC20(_personal.addr).balanceOf(_personal.integrator);
            // 2.1 - If balance b in cache, simply withdraw
            if (cacheBal >= _quantity) {
                IPlatformIntegration(_personal.integrator).withdrawRaw(
                    _recipient,
                    _personal.addr,
                    _quantity
                );
            }
            // 2.2 - Else reset the cache to X, or as far as possible
            //       - Withdraw X+b from platform
            //       - Send b to user
            else {
                uint256 relativeMidCache = _maxCache.divRatioPrecisely(_data.ratio) / 2;
                uint256 totalWithdrawal =
                    StableMath.min(
                        relativeMidCache + _quantity - cacheBal,
                        _data.vaultBalance - SafeCast.toUint128(cacheBal)
                    );

                IPlatformIntegration(_personal.integrator).withdraw(
                    _recipient,
                    _personal.addr,
                    _quantity,
                    totalWithdrawal,
                    false
                );
            }
        }
    }

    /**
     * @dev Gets the max cache size, given the supply of mAsset
     * @return maxCache    Max units of any given bAsset that should be held in the cache
     */
    function _getCacheDetails(MassetData storage _data, uint256 _supply)
        internal
        view
        returns (uint256 maxCache)
    {
        maxCache = (_supply * _data.cacheSize) / 1e18;
    }

    /***************************************
                    INVARIANT
    ****************************************/

    /**
     * @notice Compute the amount of mAsset received for minting
     * with `quantity` amount of bAsset index `i`.
     * @param _bAssets      Array of all bAsset Data
     * @param _i            Index of bAsset with which to mint
     * @param _rawInput     Raw amount of bAsset to use in mint
     * @param _config       Generalised invariantConfig stored externally
     * @return mintAmount   Quantity of mAssets minted
     */
    function computeMint(
        BassetData[] memory _bAssets,
        uint8 _i,
        uint256 _rawInput,
        InvariantConfig memory _config
    ) public view returns (uint256 mintAmount) {
        // 1. Get raw reserves
        (uint256[] memory x, uint256 sum) = _getReserves(_bAssets);
        // 2. Get value of reserves according to invariant
        uint256 k0 = _invariant(x, sum, _config.a);
        uint256 scaledInput = (_rawInput * _bAssets[_i].ratio) / 1e8;

        // 3. Add deposit to x and sum
        x[_i] += scaledInput;
        sum += scaledInput;
        // 4. Finalise mint
        require(_inBounds(x, sum, _config.limits), "Exceeds weight limits");
        mintAmount = _computeMintOutput(x, sum, k0, _config);
    }

    /**
     * @notice Compute the amount of mAsset received for minting
     * with the given array of inputs.
     * @param _bAssets      Array of all bAsset Data
     * @param _indices      Indexes of bAssets with which to mint
     * @param _rawInputs    Raw amounts of bAssets to use in mint
     * @param _config       Generalised invariantConfig stored externally
     * @return mintAmount   Quantity of mAssets minted
     */
    function computeMintMulti(
        BassetData[] memory _bAssets,
        uint8[] memory _indices,
        uint256[] memory _rawInputs,
        InvariantConfig memory _config
    ) public view returns (uint256 mintAmount) {
        // 1. Get raw reserves
        (uint256[] memory x, uint256 sum) = _getReserves(_bAssets);
        // 2. Get value of reserves according to invariant
        uint256 k0 = _invariant(x, sum, _config.a);

        // 3. Add deposits to x and sum
        uint256 len = _indices.length;
        uint8 idx;
        uint256 scaledInput;
        for (uint256 i = 0; i < len; i++) {
            idx = _indices[i];
            scaledInput = (_rawInputs[i] * _bAssets[idx].ratio) / 1e8;
            x[idx] += scaledInput;
            sum += scaledInput;
        }
        // 4. Finalise mint
        require(_inBounds(x, sum, _config.limits), "Exceeds weight limits");
        mintAmount = _computeMintOutput(x, sum, k0, _config);
    }

    /**
     * @notice Compute the amount of bAsset received for swapping
     * `quantity` amount of index `input_idx` to index `output_idx`.
     * @param _bAssets      Array of all bAsset Data
     * @param _i            Index of bAsset to swap IN
     * @param _o            Index of bAsset to swap OUT
     * @param _rawInput     Raw amounts of input bAsset to input
     * @param _feeRate      Swap fee rate to apply to output
     * @param _config       Generalised invariantConfig stored externally
     * @return bAssetOutputQuantity   Raw bAsset output quantity
     * @return scaledSwapFee          Swap fee collected, in mAsset terms
     */
    function computeSwap(
        BassetData[] memory _bAssets,
        uint8 _i,
        uint8 _o,
        uint256 _rawInput,
        uint256 _feeRate,
        InvariantConfig memory _config
    ) public view returns (uint256 bAssetOutputQuantity, uint256 scaledSwapFee) {
        // 1. Get raw reserves
        (uint256[] memory x, uint256 sum) = _getReserves(_bAssets);
        // 2. Get value of reserves according to invariant
        uint256 k0 = _invariant(x, sum, _config.a);
        // 3. Add deposits to x and sum
        uint256 scaledInput = (_rawInput * _bAssets[_i].ratio) / 1e8;
        x[_i] += scaledInput;
        sum += scaledInput;
        // 4. Calc total mAsset q
        uint256 k2;
        (k2, scaledSwapFee) = _getSwapFee(k0, _invariant(x, sum, _config.a), _feeRate, _config);
        // 5. Calc output bAsset
        uint256 newOutputReserve = _solveInvariant(x, _config.a, _o, k2);
        require(newOutputReserve < x[_o], "Zero swap output");
        uint256 output = x[_o] - newOutputReserve - 1;
        bAssetOutputQuantity = (output * 1e8) / _bAssets[_o].ratio;
        // 6. Check for bounds
        x[_o] -= output;
        sum -= output;
        require(_inBounds(x, sum, _config.limits), "Exceeds weight limits");
    }

    /** @dev Gets swap fee and scales to avoid stack depth errors in computeSwap */
    function _getSwapFee(
        uint256 _k0,
        uint256 _k1,
        uint256 _feeRate,
        InvariantConfig memory _config
    ) internal pure returns (uint256 k2, uint256 scaledSwapFee) {
        uint256 minted = _k1 - _k0;
        // Under col? Deduct fee
        if (_config.supply > _k0) {
            minted -= ((minted * _config.recolFee) / 1e18);
        }
        // base swap fee
        scaledSwapFee = (minted * _feeRate) / 1e18;
        k2 = _k1 - minted + scaledSwapFee;
        // swap fee in lpToken terms
        scaledSwapFee = (scaledSwapFee * _config.supply) / _k0;
    }

    /**
     * @notice Compute the amount of bAsset index `i` received for
     * redeeming `quantity` amount of mAsset.
     * @param _bAssets              Array of all bAsset Data
     * @param _o                    Index of output bAsset
     * @param _grossMassetQuantity  Net amount of mAsset to redeem
     * @param _config               Generalised invariantConfig stored externally
     * @return rawOutputUnits       Raw bAsset output returned
     */
    function computeRedeem(
        BassetData[] memory _bAssets,
        uint8 _o,
        uint256 _grossMassetQuantity,
        InvariantConfig memory _config,
        uint256 _feeRate
    ) public view returns (uint256 rawOutputUnits, uint256 scaledFee) {
        // 1. Get raw reserves
        (uint256[] memory x, uint256 sum) = _getReserves(_bAssets);
        // 2. Get value of reserves according to invariant
        uint256 k0 = _invariant(x, sum, _config.a);
        uint256 redemption;
        (redemption, scaledFee) = _getFee(_grossMassetQuantity, _config, _feeRate, k0);
        uint256 kFinal = (k0 * (_config.supply - redemption)) / _config.supply + 1;
        // 3. Compute bAsset output
        uint256 newOutputReserve = _solveInvariant(x, _config.a, _o, kFinal);
        uint256 output = x[_o] - newOutputReserve - 1;
        rawOutputUnits = (output * 1e8) / _bAssets[_o].ratio;
        // 4. Check for max weight
        x[_o] -= output;
        sum -= output;
        require(_inBounds(x, sum, _config.limits), "Exceeds weight limits");
    }

    function _getFee(
        uint256 _grossMassetQuantity,
        InvariantConfig memory _config,
        uint256 _feeRate,
        uint256 _k0
    ) internal pure returns (uint256 redemption, uint256 scaledFee) {
        redemption = _grossMassetQuantity;
        if (_config.supply > _k0) {
            redemption -= ((redemption * _config.recolFee) / 1e18);
        }
        scaledFee = redemption.mulTruncate(_feeRate);
        redemption -= scaledFee;
    }

    /**
     * @notice Compute the amount of mAsset required to redeem
     * a given selection of bAssets.
     * @param _bAssets          Array of all bAsset Data
     * @param _indices          Indexes of output bAssets
     * @param _rawOutputs       Desired raw bAsset outputs
     * @param _config           Generalised invariantConfig stored externally
     * @return grossMasset      Amount of mAsset required to redeem bAssets
     * @return fee              Fee to subtract from gross
     */
    function computeRedeemExact(
        BassetData[] memory _bAssets,
        uint8[] memory _indices,
        uint256[] memory _rawOutputs,
        InvariantConfig memory _config,
        uint256 _feeRate
    ) public view returns (uint256 grossMasset, uint256 fee) {
        // 1. Get raw reserves
        (uint256[] memory x, uint256 sum) = _getReserves(_bAssets);
        // 2. Get value of reserves according to invariant
        uint256 k0 = _invariant(x, sum, _config.a);
        // 3. Sub deposits from x and sum
        uint256 len = _indices.length;
        uint256 ratioed;
        for (uint256 i = 0; i < len; i++) {
            ratioed = (_rawOutputs[i] * _bAssets[_indices[i]].ratio) / 1e8;
            x[_indices[i]] -= ratioed;
            sum -= ratioed;
        }
        require(_inBounds(x, sum, _config.limits), "Exceeds weight limits");
        // 4. Get new value of reserves according to invariant
        uint256 k1 = _invariant(x, sum, _config.a);
        // 5. Total mAsset is the difference between values
        uint256 redeemed = (_config.supply * (k0 - k1)) / k0;
        require(redeemed > 1e6, "Must redeem > 1e6 units");
        grossMasset = redeemed.divPrecisely(1e18 - _feeRate);
        fee = grossMasset - redeemed;
        grossMasset += 1;
        if (_config.supply > k0) {
            grossMasset = ((grossMasset * 1e18) / (1e18 - _config.recolFee));
        }
    }

    /**
     * @notice Gets the price of the mAsset, and invariant value k
     * @param _bAssets  Array of all bAsset Data
     * @param _config   Generalised InvariantConfig stored externally
     * @return price    Price of an mAsset
     * @return k        Total value of basket, k
     */
    function computePrice(BassetData[] memory _bAssets, InvariantConfig memory _config)
        public
        pure
        returns (uint256 price, uint256 k)
    {
        (uint256[] memory x, uint256 sum) = _getReserves(_bAssets);
        k = _invariant(x, sum, _config.a);
        price = (1e18 * k) / _config.supply;
    }

    /***************************************
                    INTERNAL
    ****************************************/

    /**
     * @dev Computes the actual mint output after adding mint inputs
     * to the vault balances.
     * @param _x            Scaled vaultBalances
     * @param _sum          Sum of vaultBalances, to avoid another loop
     * @param _k            Previous value of invariant, k, before addition
     * @param _config       Generalised InvariantConfig stored externally
     * @return mintAmount   Amount of value added to invariant, in mAsset terms
     */
    function _computeMintOutput(
        uint256[] memory _x,
        uint256 _sum,
        uint256 _k,
        InvariantConfig memory _config
    ) internal pure returns (uint256 mintAmount) {
        // 1. Get value of reserves according to invariant
        uint256 kFinal = _invariant(_x, _sum, _config.a);
        // 2. Total minted is the difference between values, with respect to total supply
        if (_config.supply == 0) {
            mintAmount = kFinal - _k;
        } else {
            mintAmount = (_config.supply * (kFinal - _k)) / _k;
        }
        // 3. Deviation? deduct recolFee of 0.5 bps
        if (_config.supply > _k) {
            mintAmount -= ((mintAmount * _config.recolFee) / 1e18);
        }
    }

    /**
     * @dev Simply scaled raw reserve values and returns the sum
     * @param _bAssets  All bAssets
     * @return x        Scaled vault balances
     * @return sum      Sum of scaled vault balances
     */
    function _getReserves(BassetData[] memory _bAssets)
        internal
        pure
        returns (uint256[] memory x, uint256 sum)
    {
        uint256 len = _bAssets.length;
        x = new uint256[](len);
        uint256 r;
        for (uint256 i = 0; i < len; i++) {
            BassetData memory bAsset = _bAssets[i];
            r = (bAsset.vaultBalance * bAsset.ratio) / 1e8;
            x[i] = r;
            sum += r;
        }
    }

    /**
     * @dev Checks that no bAsset reserves exceed max weight
     * @param _x            Scaled bAsset reserves
     * @param _sum          Sum of x, precomputed
     * @param _limits       Config object containing max and min weights
     * @return inBounds     Bool, true if all assets are within bounds
     */
    function _inBounds(
        uint256[] memory _x,
        uint256 _sum,
        WeightLimits memory _limits
    ) internal pure returns (bool inBounds) {
        uint256 len = _x.length;
        inBounds = true;
        uint256 w;
        for (uint256 i = 0; i < len; i++) {
            w = (_x[i] * 1e18) / _sum;
            if (w > _limits.max || w < _limits.min) return false;
        }
    }

    /***************************************
                    INVARIANT
    ****************************************/

    /**
     * @dev Compute the invariant f(x) for a given array of supplies `x`.
     * @param _x        Scaled vault balances
     * @param _sum      Sum of scaled vault balances
     * @param _a        Precise amplification coefficient
     * @return k        Cumulative value of all assets according to the invariant
     */
    function _invariant(
        uint256[] memory _x,
        uint256 _sum,
        uint256 _a
    ) internal pure returns (uint256 k) {
        uint256 len = _x.length;

        if (_sum == 0) return 0;

        uint256 nA = _a * len;
        uint256 kPrev;
        k = _sum;

        for (uint256 i = 0; i < 256; i++) {
            uint256 kP = k;
            for (uint256 j = 0; j < len; j++) {
                kP = (kP * k) / (_x[j] * len);
            }
            kPrev = k;
            k =
                (((nA * _sum) / A_PRECISION + (kP * len)) * k) /
                (((nA - A_PRECISION) * k) / A_PRECISION + ((len + 1) * kP));
            if (_hasConverged(k, kPrev)) {
                return k;
            }
        }

        revert("Invariant did not converge");
    }

    /**
     * @dev Checks if a given solution has converged within a factor of 1
     * @param _k              Current solution k
     * @param _kPrev          Previous iteration solution
     * @return hasConverged   Bool, true if diff abs(k, kPrev) <= 1
     */
    function _hasConverged(uint256 _k, uint256 _kPrev) internal pure returns (bool) {
        if (_kPrev > _k) {
            return (_kPrev - _k) <= 1;
        } else {
            return (_k - _kPrev) <= 1;
        }
    }

    /**
     * @dev Solves the invariant for _i with respect to target K, given an array of reserves.
     * @param _x        Scaled reserve balances
     * @param _a        Precise amplification coefficient
     * @param _idx      Index of asset for which to solve
     * @param _targetK  Target invariant value K
     * @return y        New reserve of _i
     */
    function _solveInvariant(
        uint256[] memory _x,
        uint256 _a,
        uint8 _idx,
        uint256 _targetK
    ) internal pure returns (uint256 y) {
        uint256 len = _x.length;
        require(_idx >= 0 && _idx < len, "Invalid index");

        (uint256 sum_, uint256 nA, uint256 kP) = (0, _a * len, _targetK);

        for (uint256 i = 0; i < len; i++) {
            if (i != _idx) {
                sum_ += _x[i];
                kP = (kP * _targetK) / (_x[i] * len);
            }
        }

        uint256 c = (((kP * _targetK) * A_PRECISION) / nA) / len;
        uint256 g = (_targetK * (nA - A_PRECISION)) / nA;
        uint256 b = 0;

        if (g > sum_) {
            b = g - sum_;
            y = (Root.sqrt((b**2) + (4 * c)) + b) / 2 + 1;
        } else {
            b = sum_ - g;
            y = (Root.sqrt((b**2) + (4 * c)) - b) / 2 + 1;
        }

        if (y < 1e8) revert("Invalid solution");
    }
}

abstract contract IInvariantValidator {
    // Mint
    function computeMint(
        BassetData[] calldata _bAssets,
        uint8 _i,
        uint256 _rawInput,
        InvariantConfig memory _config
    ) external view virtual returns (uint256);

    function computeMintMulti(
        BassetData[] calldata _bAssets,
        uint8[] calldata _indices,
        uint256[] calldata _rawInputs,
        InvariantConfig memory _config
    ) external view virtual returns (uint256);

    // Swap
    function computeSwap(
        BassetData[] calldata _bAssets,
        uint8 _i,
        uint8 _o,
        uint256 _rawInput,
        uint256 _feeRate,
        InvariantConfig memory _config
    ) external view virtual returns (uint256, uint256);

    // Redeem
    function computeRedeem(
        BassetData[] calldata _bAssets,
        uint8 _i,
        uint256 _mAssetQuantity,
        InvariantConfig memory _config
    ) external view virtual returns (uint256);

    function computeRedeemExact(
        BassetData[] calldata _bAssets,
        uint8[] calldata _indices,
        uint256[] calldata _rawOutputs,
        InvariantConfig memory _config
    ) external view virtual returns (uint256);

    function computePrice(BassetData[] memory _bAssets, InvariantConfig memory _config)
        public
        pure
        virtual
        returns (uint256 price, uint256 k);
}

interface IBasicToken {
    function decimals() external view returns (uint8);
}

library MassetManagerV2 {
    using SafeERC20 for IERC20;
    using StableMath for uint256;

    event BassetsMigrated(address[] bAssets, address newIntegrator);
    event TransferFeeEnabled(address indexed bAsset, bool enabled);
    event BassetAdded(address indexed bAsset, address integrator);
    event BassetStatusChanged(address indexed bAsset, BassetStatus status);
    event BasketStatusChanged();
    event StartRampA(uint256 currentA, uint256 targetA, uint256 startTime, uint256 rampEndTime);
    event StopRampA(uint256 currentA, uint256 time);

    uint256 private constant MIN_RAMP_TIME = 1 days;
    uint256 private constant MAX_A = 1e6;

    /**
     * @notice Adds a bAsset to the given personal, data and mapping, provided it is valid
     * @param _bAssetPersonal   Basset data storage array
     * @param _bAssetData       Basset data storage array
     * @param _bAssetIndexes    Mapping of bAsset address to their index
     * @param _bAsset           Address of the ERC20 token to add to the Basket
     * @param _integration      Address of the Platform Integration
     * @param _mm               Base 1e8 var to determine measurement ratio
     * @param _hasTxFee         Are transfer fees charged on this bAsset (e.g. USDT)
     */
    function addBasset(
        BassetPersonal[] storage _bAssetPersonal,
        BassetData[] storage _bAssetData,
        mapping(address => uint8) storage _bAssetIndexes,
        address _bAsset,
        address _integration,
        uint256 _mm,
        bool _hasTxFee
    ) external {
        require(_bAsset != address(0), "bAsset address must be valid");
        uint8 bAssetCount = uint8(_bAssetPersonal.length);

        uint8 idx = _bAssetIndexes[_bAsset];
        require(
            bAssetCount == 0 || _bAssetPersonal[idx].addr != _bAsset,
            "bAsset already exists in Basket"
        );

        // Should fail if bAsset is not added to integration
        // Programmatic enforcement of bAsset validity should service through decentralised feed
        if (_integration != address(0)) {
            IPlatformIntegration(_integration).checkBalance(_bAsset);
        }

        uint256 bAssetDecimals = IBasicToken(_bAsset).decimals();
        require(
            bAssetDecimals >= 4 && bAssetDecimals <= 18,
            "Token must have sufficient decimal places"
        );

        uint256 delta = uint256(18) - bAssetDecimals;
        uint256 ratio = _mm * (10**delta);

        _bAssetIndexes[_bAsset] = bAssetCount;

        _bAssetPersonal.push(
            BassetPersonal({
                addr: _bAsset,
                integrator: _integration,
                hasTxFee: _hasTxFee,
                status: BassetStatus.Normal
            })
        );
        _bAssetData.push(BassetData({ ratio: SafeCast.toUint128(ratio), vaultBalance: 0 }));

        emit BassetAdded(_bAsset, _integration);
    }

    /**
     * @dev Collects the interest generated from the Basket, minting a relative
     *      amount of mAsset and sending it over to the SavingsManager.
     * @param _bAssetPersonal   Basset personal storage array
     * @param _bAssetData       Basset data storage array
     * @return indices          Array of bAsset idxs [0,1...]
     * @return rawGains         Raw increases in vault Balance
     */
    function collectPlatformInterest(
        BassetPersonal[] memory _bAssetPersonal,
        BassetData[] storage _bAssetData
    ) external returns (uint8[] memory indices, uint256[] memory rawGains) {
        // Get basket details
        BassetData[] memory bAssetData_ = _bAssetData;
        uint256 count = bAssetData_.length;
        indices = new uint8[](count);
        rawGains = new uint256[](count);
        // 1. Calculate rawGains in each bAsset, in comparison to current vault balance
        for (uint256 i = 0; i < count; i++) {
            indices[i] = uint8(i);
            BassetPersonal memory bPersonal = _bAssetPersonal[i];
            BassetData memory bData = bAssetData_[i];
            // If there is no integration, then nothing can have accrued
            if (bPersonal.integrator == address(0)) continue;
            uint256 lending =
                IPlatformIntegration(bPersonal.integrator).checkBalance(bPersonal.addr);
            uint256 cache = 0;
            if (!bPersonal.hasTxFee) {
                cache = IERC20(bPersonal.addr).balanceOf(bPersonal.integrator);
            }
            uint256 balance = lending + cache;
            uint256 oldVaultBalance = bData.vaultBalance;
            if (balance > oldVaultBalance && bPersonal.status == BassetStatus.Normal) {
                _bAssetData[i].vaultBalance = SafeCast.toUint128(balance);
                uint256 interestDelta = balance - oldVaultBalance;
                rawGains[i] = interestDelta;
            } else {
                rawGains[i] = 0;
            }
        }
    }

    /**
     * @dev Update transfer fee flag for a given bAsset, should it change its fee practice
     * @param _bAssetPersonal   Basset data storage array
     * @param _bAssetIndexes    Mapping of bAsset address to their index
     * @param _bAsset   bAsset address
     * @param _flag         Charge transfer fee when its set to 'true', otherwise 'false'
     */
    function setTransferFeesFlag(
        BassetPersonal[] storage _bAssetPersonal,
        mapping(address => uint8) storage _bAssetIndexes,
        address _bAsset,
        bool _flag
    ) external {
        uint256 index = _getAssetIndex(_bAssetPersonal, _bAssetIndexes, _bAsset);
        _bAssetPersonal[index].hasTxFee = _flag;

        if (_flag) {
            // if token has tx fees, it can no longer operate with a cache
            address integration = _bAssetPersonal[index].integrator;
            if (integration != address(0)) {
                uint256 bal = IERC20(_bAsset).balanceOf(integration);
                if (bal > 0) {
                    IPlatformIntegration(integration).deposit(_bAsset, bal, true);
                }
            }
        }

        emit TransferFeeEnabled(_bAsset, _flag);
    }

    /**
     * @dev Transfers all collateral from one lending market to another - used initially
     *      to handle the migration between Aave V1 and Aave V2. Note - only supports non
     *      tx fee enabled assets. Supports going from no integration to integration, but
     *      not the other way around.
     * @param _bAssetPersonal   Basset data storage array
     * @param _bAssetIndexes    Mapping of bAsset address to their index
     * @param _bAssets          Array of basket assets to migrate
     * @param _newIntegration   Address of the new platform integration
     */
    function migrateBassets(
        BassetPersonal[] storage _bAssetPersonal,
        mapping(address => uint8) storage _bAssetIndexes,
        address[] calldata _bAssets,
        address _newIntegration
    ) external {
        uint256 len = _bAssets.length;
        require(len > 0, "Must migrate some bAssets");

        for (uint256 i = 0; i < len; i++) {
            // 1. Check that the bAsset is in the basket
            address bAsset = _bAssets[i];
            uint256 index = _getAssetIndex(_bAssetPersonal, _bAssetIndexes, bAsset);
            require(!_bAssetPersonal[index].hasTxFee, "A bAsset has a transfer fee");

            // 2. Withdraw everything from the old platform integration
            address oldAddress = _bAssetPersonal[index].integrator;
            require(oldAddress != _newIntegration, "Must transfer to new integrator");
            (uint256 cache, uint256 lendingBal) = (0, 0);
            if (oldAddress == address(0)) {
                cache = IERC20(bAsset).balanceOf(address(this));
            } else {
                IPlatformIntegration oldIntegration = IPlatformIntegration(oldAddress);
                cache = IERC20(bAsset).balanceOf(address(oldIntegration));
                // 2.1. Withdraw from the lending market
                lendingBal = oldIntegration.checkBalance(bAsset);
                if (lendingBal > 0) {
                    oldIntegration.withdraw(address(this), bAsset, lendingBal, false);
                }
                // 2.2. Withdraw from the cache, if any
                if (cache > 0) {
                    oldIntegration.withdrawRaw(address(this), bAsset, cache);
                }
            }
            uint256 sum = lendingBal + cache;

            // 3. Update the integration address for this bAsset
            _bAssetPersonal[index].integrator = _newIntegration;

            // 4. Deposit everything into the new
            //    This should fail if we did not receive the full amount from the platform withdrawal
            // 4.1. Deposit all bAsset
            if (_newIntegration != address(0)) {
                IERC20(bAsset).safeTransfer(_newIntegration, sum);
                IPlatformIntegration newIntegration = IPlatformIntegration(_newIntegration);
                if (lendingBal > 0) {
                    newIntegration.deposit(bAsset, lendingBal, false);
                }
                // 4.2. Check balances
                uint256 newLendingBal = newIntegration.checkBalance(bAsset);
                uint256 newCache = IERC20(bAsset).balanceOf(address(newIntegration));
                uint256 upperMargin = 10001e14;
                uint256 lowerMargin = 9999e14;

                require(
                    newLendingBal >= lendingBal.mulTruncate(lowerMargin) &&
                        newLendingBal <= lendingBal.mulTruncate(upperMargin),
                    "Must transfer full amount"
                );
                require(
                    newCache >= cache.mulTruncate(lowerMargin) &&
                        newCache <= cache.mulTruncate(upperMargin),
                    "Must transfer full amount"
                );
            } else {
                uint256 newCache = IERC20(bAsset).balanceOf(address(this));
                require(newCache == sum, "Must cache full amount");
            }
        }

        emit BassetsMigrated(_bAssets, _newIntegration);
    }

    /**
     * @dev Executes the Auto Redistribution event by isolating the bAsset from the Basket
     * @param _basket          Struct containing core basket info
     * @param _bAssetPersonal  Basset data storage array
     * @param _bAsset          Address of the ERC20 token to isolate
     * @param _belowPeg        Bool to describe whether the bAsset deviated below peg (t)
     *                         or above (f)
     */
    function handlePegLoss(
        BasketState storage _basket,
        BassetPersonal[] storage _bAssetPersonal,
        mapping(address => uint8) storage _bAssetIndexes,
        address _bAsset,
        bool _belowPeg
    ) external {
        require(!_basket.failed, "Basket must be alive");

        uint256 i = _getAssetIndex(_bAssetPersonal, _bAssetIndexes, _bAsset);

        BassetStatus newStatus =
            _belowPeg ? BassetStatus.BrokenBelowPeg : BassetStatus.BrokenAbovePeg;
        _bAssetPersonal[i].status = newStatus;

        _basket.undergoingRecol = true;

        emit BassetStatusChanged(_bAsset, newStatus);
    }

    /**
     * @dev Negates the isolation of a given bAsset
     * @param _basket          Struct containing core basket info
     * @param _bAssetPersonal  Basset data storage array
     * @param _bAssetIndexes    Mapping of bAsset address to their index
     * @param _bAsset Address of the bAsset
     */
    function negateIsolation(
        BasketState storage _basket,
        BassetPersonal[] storage _bAssetPersonal,
        mapping(address => uint8) storage _bAssetIndexes,
        address _bAsset
    ) external {
        uint256 i = _getAssetIndex(_bAssetPersonal, _bAssetIndexes, _bAsset);

        _bAssetPersonal[i].status = BassetStatus.Normal;

        bool undergoingRecol = false;
        for (uint256 j = 0; j < _bAssetPersonal.length; j++) {
            if (_bAssetPersonal[j].status != BassetStatus.Normal) {
                undergoingRecol = true;
                break;
            }
        }
        _basket.undergoingRecol = undergoingRecol;

        emit BassetStatusChanged(_bAsset, BassetStatus.Normal);
    }

    /**
     * @dev Starts changing of the amplification var A
     * @param _targetA      Target A value
     * @param _rampEndTime  Time at which A will arrive at _targetA
     */
    function startRampA(
        AmpData storage _ampData,
        uint256 _targetA,
        uint256 _rampEndTime,
        uint256 _currentA,
        uint256 _precision
    ) external {
        require(
            block.timestamp >= (_ampData.rampStartTime + MIN_RAMP_TIME),
            "Sufficient period of previous ramp has not elapsed"
        );
        require(_rampEndTime >= (block.timestamp + MIN_RAMP_TIME), "Ramp time too short");
        require(_targetA > 0 && _targetA < MAX_A, "A target out of bounds");

        uint256 preciseTargetA = _targetA * _precision;

        if (preciseTargetA > _currentA) {
            require(preciseTargetA <= _currentA * 10, "A target increase too big");
        } else {
            require(preciseTargetA >= _currentA / 10, "A target decrease too big");
        }

        _ampData.initialA = SafeCast.toUint64(_currentA);
        _ampData.targetA = SafeCast.toUint64(preciseTargetA);
        _ampData.rampStartTime = SafeCast.toUint64(block.timestamp);
        _ampData.rampEndTime = SafeCast.toUint64(_rampEndTime);

        emit StartRampA(_currentA, preciseTargetA, block.timestamp, _rampEndTime);
    }

    /**
     * @dev Stops the changing of the amplification var A, setting
     * it to whatever the current value is.
     */
    function stopRampA(AmpData storage _ampData, uint256 _currentA) external {
        require(block.timestamp < _ampData.rampEndTime, "Amplification not changing");

        _ampData.initialA = SafeCast.toUint64(_currentA);
        _ampData.targetA = SafeCast.toUint64(_currentA);
        _ampData.rampStartTime = SafeCast.toUint64(block.timestamp);
        _ampData.rampEndTime = SafeCast.toUint64(block.timestamp);

        emit StopRampA(_currentA, block.timestamp);
    }

    /**
     * @dev Gets a bAsset index from storage
     * @param _asset      Address of the asset
     * @return idx        Index of the asset
     */
    function _getAssetIndex(
        BassetPersonal[] storage _bAssetPersonal,
        mapping(address => uint8) storage _bAssetIndexes,
        address _asset
    ) internal view returns (uint8 idx) {
        idx = _bAssetIndexes[_asset];
        require(_bAssetPersonal[idx].addr == _asset, "Invalid asset input");
    }
}

/**
 * @title   MassetPolygon
 * @author  mStable
 * @notice  An incentivised constant sum market maker with hard limits at max region. This supports
 *          low slippage swaps and applies penalties towards min and max regions. AMM produces a
 *          stablecoin (mAsset) and redirects lending market interest and swap fees to the savings
 *          contract, producing a second yield bearing asset.
 * @dev     VERSION: 3.0
 *          DATE:    2021-04-22
 */
contract MassetPolygon is
    IMasset,
    Initializable,
    InitializableToken,
    ImmutableModule,
    InitializableReentrancyGuard
{
    using StableMath for uint256;

    // Forging Events
    event Minted(
        address indexed minter,
        address recipient,
        uint256 mAssetQuantity,
        address input,
        uint256 inputQuantity
    );
    event MintedMulti(
        address indexed minter,
        address recipient,
        uint256 mAssetQuantity,
        address[] inputs,
        uint256[] inputQuantities
    );
    event Swapped(
        address indexed swapper,
        address input,
        address output,
        uint256 outputAmount,
        uint256 scaledFee,
        address recipient
    );
    event Redeemed(
        address indexed redeemer,
        address recipient,
        uint256 mAssetQuantity,
        address output,
        uint256 outputQuantity,
        uint256 scaledFee
    );
    event RedeemedMulti(
        address indexed redeemer,
        address recipient,
        uint256 mAssetQuantity,
        address[] outputs,
        uint256[] outputQuantity,
        uint256 scaledFee
    );

    // State Events
    event CacheSizeChanged(uint256 cacheSize);
    event FeesChanged(uint256 swapFee, uint256 redemptionFee);
    event WeightLimitsChanged(uint128 min, uint128 max);
    event ForgeValidatorChanged(address forgeValidator);
    event DeficitMinted(uint256 amt);
    event SurplusBurned(address creditor, uint256 amt);

    // Amplification Data
    uint256 private constant MAX_FEE = 1e16;
    uint256 private constant A_PRECISION = 100;
    uint256 private immutable RECOL_FEE;
    // Core data storage
    mapping(address => uint8) public override bAssetIndexes;
    MassetData public data;

    /**
     * @dev Constructor to set immutable bytecode
     * @param _nexus   Nexus address
     */
    constructor(address _nexus, uint256 _recolFee) ImmutableModule(_nexus) {
        require(_recolFee <= 5e13, "RecolFee too high");
        RECOL_FEE = _recolFee;
    }

    // /**
    //  * @dev Initialization function for upgradable proxy contract.
    //  *      This function should be called via Proxy just after contract deployment.
    //  *      To avoid variable shadowing appended `Arg` after arguments name.
    //  * @param _nameArg          Name of the mAsset
    //  * @param _symbolArg        Symbol of the mAsset
    //  * @param _bAssets          Array of Basset data
    //  */
    // function initialize(
    //     string calldata _nameArg,
    //     string calldata _symbolArg,
    //     BassetPersonal[] calldata _bAssets,
    //     BasicConfig memory _config
    // ) public initializer {
    //     InitializableToken._initialize(_nameArg, _symbolArg);

    //     _initializeReentrancyGuard();

    //     uint256 len = _bAssets.length;
    //     require(len > 0, "No bAssets");
    //     for (uint256 i = 0; i < len; i++) {
    //         MassetManagerV2.addBasset(
    //             data.bAssetPersonal,
    //             data.bAssetData,
    //             bAssetIndexes,
    //             _bAssets[i].addr,
    //             _bAssets[i].integrator,
    //             1e8,
    //             _bAssets[i].hasTxFee
    //         );
    //     }

    //     uint64 startA = SafeCast.toUint64(_config.a * A_PRECISION);
    //     data.ampData = AmpData(startA, startA, 0, 0);
    //     data.weightLimits = _config.limits;

    //     data.swapFee = 6e14;    // 0.06% or 6 bps
    //     data.redemptionFee = 6e14;  // normally 3e14 0.03% or 3 bps
    //     data.cacheSize = 0; // normally 1e17 (10%)
    // }

    /**
     * @dev Verifies that the caller is the Savings Manager contract
     */
    modifier onlySavingsManager() {
        _isSavingsManager();
        _;
    }

    // Internal fn for modifier to reduce deployment size
    function _isSavingsManager() internal view {
        require(_savingsManager() == msg.sender, "Must be savings manager");
    }

    /**
     * @dev Requires the overall basket composition to be healthy
     */
    modifier whenHealthy() {
        _isHealthy();
        _;
    }

    // Internal fn for modifier to reduce deployment size
    function _isHealthy() internal view {
        BasketState memory basket_ = data.basket;
        require(!basket_.undergoingRecol && !basket_.failed, "Unhealthy");
    }

    /**
     * @dev Requires the basket not to be undergoing recollateralisation
     */
    modifier whenNoRecol() {
        _noRecol();
        _;
    }

    // Internal fn for modifier to reduce deployment size
    function _noRecol() internal view {
        BasketState memory basket_ = data.basket;
        require(!basket_.undergoingRecol, "In recol");
    }

    /***************************************
                MINTING (PUBLIC)
    ****************************************/

    /**
     * @dev Mint a single bAsset, at a 1:1 ratio with the bAsset. This contract
     *      must have approval to spend the senders bAsset
     * @param _input             Address of the bAsset to deposit for the minted mAsset.
     * @param _inputQuantity     Quantity in bAsset units
     * @param _minOutputQuantity Minimum mAsset quanity to be minted. This protects against slippage.
     * @param _recipient         Receipient of the newly minted mAsset tokens
     * @return mintOutput        Quantity of newly minted mAssets for the deposited bAsset.
     */
    function mint(
        address _input,
        uint256 _inputQuantity,
        uint256 _minOutputQuantity,
        address _recipient
    ) external override nonReentrant whenHealthy returns (uint256 mintOutput) {
        require(_recipient != address(0), "Invalid recipient");
        require(_inputQuantity > 0, "Qty==0");

        Asset memory input = _getAsset(_input);

        mintOutput = MassetLogic.mint(
            data,
            _getConfig(),
            input,
            _inputQuantity,
            _minOutputQuantity
        );

        // Mint the Masset
        _mint(_recipient, mintOutput);
        emit Minted(msg.sender, _recipient, mintOutput, _input, _inputQuantity);
    }

    /**
     * @dev Mint with multiple bAssets, at a 1:1 ratio to mAsset. This contract
     *      must have approval to spend the senders bAssets
     * @param _inputs            Non-duplicate address array of bASset addresses to deposit for the minted mAsset tokens.
     * @param _inputQuantities   Quantity of each bAsset to deposit for the minted mAsset.
     *                           Order of array should mirror the above bAsset addresses.
     * @param _minOutputQuantity Minimum mAsset quanity to be minted. This protects against slippage.
     * @param _recipient         Address to receive the newly minted mAsset tokens
     * @return mintOutput    Quantity of newly minted mAssets for the deposited bAssets.
     */
    function mintMulti(
        address[] calldata _inputs,
        uint256[] calldata _inputQuantities,
        uint256 _minOutputQuantity,
        address _recipient
    ) external override nonReentrant whenHealthy returns (uint256 mintOutput) {
        require(_recipient != address(0), "Invalid recipient");
        uint256 len = _inputQuantities.length;
        require(len > 0 && len == _inputs.length, "Input array mismatch");

        uint8[] memory indexes = _getAssets(_inputs);
        mintOutput = MassetLogic.mintMulti(
            data,
            _getConfig(),
            indexes,
            _inputQuantities,
            _minOutputQuantity
        );

        // Mint the Masset
        _mint(_recipient, mintOutput);
        emit MintedMulti(msg.sender, _recipient, mintOutput, _inputs, _inputQuantities);
    }

    /**
     * @dev Get the projected output of a given mint
     * @param _input             Address of the bAsset to deposit for the minted mAsset
     * @param _inputQuantity     Quantity in bAsset units
     * @return mintOutput        Estimated mint output in mAsset terms
     */
    function getMintOutput(address _input, uint256 _inputQuantity)
        external
        view
        override
        returns (uint256 mintOutput)
    {
        require(_inputQuantity > 0, "Qty==0");

        Asset memory input = _getAsset(_input);

        mintOutput = MassetLogic.computeMint(
            data.bAssetData,
            input.idx,
            _inputQuantity,
            _getConfig()
        );
    }

    /**
     * @dev Get the projected output of a given mint
     * @param _inputs            Non-duplicate address array of addresses to bAssets to deposit for the minted mAsset tokens.
     * @param _inputQuantities  Quantity of each bAsset to deposit for the minted mAsset.
     * @return mintOutput        Estimated mint output in mAsset terms
     */
    function getMintMultiOutput(address[] calldata _inputs, uint256[] calldata _inputQuantities)
        external
        view
        override
        returns (uint256 mintOutput)
    {
        uint256 len = _inputQuantities.length;
        require(len > 0 && len == _inputs.length, "Input array mismatch");
        uint8[] memory indexes = _getAssets(_inputs);
        return
            MassetLogic.computeMintMulti(data.bAssetData, indexes, _inputQuantities, _getConfig());
    }

    /***************************************
                SWAP (PUBLIC)
    ****************************************/

    /**
     * @dev Swaps one bAsset for another bAsset using the bAsset addresses.
     * bAsset <> bAsset swaps will incur a small fee (swapFee()).
     * @param _input             Address of bAsset to deposit
     * @param _output            Address of bAsset to receive
     * @param _inputQuantity     Units of input bAsset to swap
     * @param _minOutputQuantity Minimum quantity of the swap output asset. This protects against slippage
     * @param _recipient         Address to transfer output asset to
     * @return swapOutput        Quantity of output asset returned from swap
     */
    function swap(
        address _input,
        address _output,
        uint256 _inputQuantity,
        uint256 _minOutputQuantity,
        address _recipient
    ) external override nonReentrant whenHealthy returns (uint256 swapOutput) {
        require(_recipient != address(0), "Invalid recipient");
        require(_input != _output, "Invalid pair");
        require(_inputQuantity > 0, "Invalid swap quantity");

        Asset memory input = _getAsset(_input);
        Asset memory output = _getAsset(_output);

        uint256 scaledFee;
        (swapOutput, scaledFee) = MassetLogic.swap(
            data,
            _getConfig(),
            input,
            output,
            _inputQuantity,
            _minOutputQuantity,
            _recipient
        );

        emit Swapped(msg.sender, input.addr, output.addr, swapOutput, scaledFee, _recipient);
    }

    /**
     * @dev Determines both if a trade is valid, and the expected fee or output.
     * Swap is valid if it does not result in the input asset exceeding its maximum weight.
     * @param _input             Address of bAsset to deposit
     * @param _output            Address of bAsset to receive
     * @param _inputQuantity     Units of input bAsset to swap
     * @return swapOutput        Quantity of output asset returned from swap
     */
    function getSwapOutput(
        address _input,
        address _output,
        uint256 _inputQuantity
    ) external view override returns (uint256 swapOutput) {
        require(_input != _output, "Invalid pair");
        require(_inputQuantity > 0, "Invalid swap quantity");

        // 1. Load the bAssets from storage
        Asset memory input = _getAsset(_input);
        Asset memory output = _getAsset(_output);

        // 2. If a bAsset swap, calculate the validity, output and fee
        (swapOutput, ) = MassetLogic.computeSwap(
            data.bAssetData,
            input.idx,
            output.idx,
            _inputQuantity,
            data.swapFee,
            _getConfig()
        );
    }

    /***************************************
                REDEMPTION (PUBLIC)
    ****************************************/

    /**
     * @notice Redeems a specified quantity of mAsset in return for a bAsset specified by bAsset address.
     * The bAsset is sent to the specified recipient.
     * The bAsset quantity is relative to current vault balance levels and desired mAsset quantity.
     * The quantity of mAsset is burnt as payment.
     * A minimum quantity of bAsset is specified to protect against price slippage between the mAsset and bAsset.
     * @param _output            Address of the bAsset to receive
     * @param _mAssetQuantity    Quantity of mAsset to redeem
     * @param _minOutputQuantity Minimum bAsset quantity to receive for the burnt mAssets. This protects against slippage.
     * @param _recipient         Address to transfer the withdrawn bAssets to.
     * @return outputQuantity    Quanity of bAsset units received for the burnt mAssets
     */
    function redeem(
        address _output,
        uint256 _mAssetQuantity,
        uint256 _minOutputQuantity,
        address _recipient
    ) external override nonReentrant whenNoRecol returns (uint256 outputQuantity) {
        require(_recipient != address(0), "Invalid recipient");
        require(_mAssetQuantity > 0, "Qty==0");

        Asset memory output = _getAsset(_output);

        // Get config before burning. Config > Burn > CacheSize
        InvariantConfig memory config = _getConfig();
        _burn(msg.sender, _mAssetQuantity);

        uint256 scaledFee;
        (outputQuantity, scaledFee) = MassetLogic.redeem(
            data,
            config,
            output,
            _mAssetQuantity,
            _minOutputQuantity,
            _recipient
        );

        emit Redeemed(
            msg.sender,
            _recipient,
            _mAssetQuantity,
            output.addr,
            outputQuantity,
            scaledFee
        );
    }

    /**
     * @dev Credits a recipient with a proportionate amount of bAssets, relative to current vault
     * balance levels and desired mAsset quantity. Burns the mAsset as payment.
     * @param _mAssetQuantity       Quantity of mAsset to redeem
     * @param _minOutputQuantities  Min units of output to receive
     * @param _recipient            Address to credit the withdrawn bAssets
     */
    function redeemMasset(
        uint256 _mAssetQuantity,
        uint256[] calldata _minOutputQuantities,
        address _recipient
    ) external override nonReentrant whenNoRecol returns (uint256[] memory outputQuantities) {
        require(_recipient != address(0), "Invalid recipient");
        require(_mAssetQuantity > 0, "Qty==0");

        // Get config before burning. Burn > CacheSize
        InvariantConfig memory config = _getConfig();
        _burn(msg.sender, _mAssetQuantity);

        address[] memory outputs;
        uint256 scaledFee;
        (scaledFee, outputs, outputQuantities) = MassetLogic.redeemProportionately(
            data,
            config,
            _mAssetQuantity,
            _minOutputQuantities,
            _recipient
        );

        emit RedeemedMulti(
            msg.sender,
            _recipient,
            _mAssetQuantity,
            outputs,
            outputQuantities,
            scaledFee
        );
    }

    /**
     * @dev Credits a recipient with a certain quantity of selected bAssets, in exchange for burning the
     *      relative Masset quantity from the sender. Sender also incurs a small fee on the outgoing asset.
     * @param _outputs           Addresses of the bAssets to receive
     * @param _outputQuantities  Units of the bAssets to redeem
     * @param _maxMassetQuantity Maximum mAsset quantity to burn for the received bAssets. This protects against slippage.
     * @param _recipient         Address to receive the withdrawn bAssets
     * @return mAssetQuantity    Quantity of mAsset units burned plus the swap fee to pay for the redeemed bAssets
     */
    function redeemExactBassets(
        address[] calldata _outputs,
        uint256[] calldata _outputQuantities,
        uint256 _maxMassetQuantity,
        address _recipient
    ) external override nonReentrant whenNoRecol returns (uint256 mAssetQuantity) {
        require(_recipient != address(0), "Invalid recipient");
        uint256 len = _outputQuantities.length;
        require(len > 0 && len == _outputs.length, "Invalid array input");
        require(_maxMassetQuantity > 0, "Qty==0");

        uint8[] memory indexes = _getAssets(_outputs);

        uint256 fee;
        (mAssetQuantity, fee) = MassetLogic.redeemExactBassets(
            data,
            _getConfig(),
            indexes,
            _outputQuantities,
            _maxMassetQuantity,
            _recipient
        );

        _burn(msg.sender, mAssetQuantity);

        emit RedeemedMulti(
            msg.sender,
            _recipient,
            mAssetQuantity,
            _outputs,
            _outputQuantities,
            fee
        );
    }

    /**
     * @notice Gets the estimated output from a given redeem
     * @param _output            Address of the bAsset to receive
     * @param _mAssetQuantity    Quantity of mAsset to redeem
     * @return bAssetOutput      Estimated quantity of bAsset units received for the burnt mAssets
     */
    function getRedeemOutput(address _output, uint256 _mAssetQuantity)
        external
        view
        override
        returns (uint256 bAssetOutput)
    {
        require(_mAssetQuantity > 0, "Qty==0");

        Asset memory output = _getAsset(_output);

        (bAssetOutput, ) = MassetLogic.computeRedeem(
            data.bAssetData,
            output.idx,
            _mAssetQuantity,
            _getConfig(),
            data.swapFee
        );
    }

    /**
     * @notice Gets the estimated output from a given redeem
     * @param _outputs           Addresses of the bAsset to receive
     * @param _outputQuantities  Quantities of bAsset to redeem
     * @return mAssetQuantity    Estimated quantity of mAsset units needed to burn to receive output
     */
    function getRedeemExactBassetsOutput(
        address[] calldata _outputs,
        uint256[] calldata _outputQuantities
    ) external view override returns (uint256 mAssetQuantity) {
        uint256 len = _outputQuantities.length;
        require(len > 0 && len == _outputs.length, "Invalid array input");

        uint8[] memory indexes = _getAssets(_outputs);

        // calculate the value of mAssets need to cover the value of bAssets being redeemed
        (mAssetQuantity, ) = MassetLogic.computeRedeemExact(
            data.bAssetData,
            indexes,
            _outputQuantities,
            _getConfig(),
            data.swapFee
        );
    }

    /***************************************
                    GETTERS
    ****************************************/

    /**
     * @dev Get basket details for `Masset_MassetStructs.Basket`
     * @return b   Basket struct
     */
    function getBasket() external view override returns (bool, bool) {
        return (data.basket.undergoingRecol, data.basket.failed);
    }

    /**
     * @dev Get data for a all bAssets in basket
     * @return personal  Struct[] with full bAsset data
     * @return bData      Number of bAssets in the Basket
     */
    function getBassets()
        external
        view
        override
        returns (BassetPersonal[] memory personal, BassetData[] memory bData)
    {
        return (data.bAssetPersonal, data.bAssetData);
    }

    /**
     * @dev Get data for a specific bAsset, if it exists
     * @param _bAsset   Address of bAsset
     * @return personal  Struct with full bAsset data
     * @return bData  Struct with full bAsset data
     */
    function getBasset(address _bAsset)
        external
        view
        override
        returns (BassetPersonal memory personal, BassetData memory bData)
    {
        uint8 idx = bAssetIndexes[_bAsset];
        personal = data.bAssetPersonal[idx];
        require(personal.addr == _bAsset, "Invalid asset");
        bData = data.bAssetData[idx];
    }

    /**
     * @dev Gets all config needed for general InvariantValidator calls
     */
    function getConfig() external view returns (InvariantConfig memory config) {
        return _getConfig();
    }

    /**
     * @notice Gets the price of the fpToken, and invariant value k
     * @return price    Price of an fpToken
     * @return k        Total value of basket, k
     */
    function getPrice() external view override returns (uint256 price, uint256 k) {
        return MassetLogic.computePrice(data.bAssetData, _getConfig());
    }

    /***************************************
                GETTERS - INTERNAL
    ****************************************/

    /**
     * @dev Gets a bAsset from storage
     * @param _asset      Address of the asset
     * @return asset      Struct containing bAsset details (idx, data)
     */
    function _getAsset(address _asset) internal view returns (Asset memory asset) {
        asset.idx = bAssetIndexes[_asset];
        asset.addr = _asset;
        asset.exists = data.bAssetPersonal[asset.idx].addr == _asset;
        require(asset.exists, "Invalid asset");
    }

    /**
     * @dev Gets a an array of bAssets from storage and protects against duplicates
     * @param _bAssets    Addresses of the assets
     * @return indexes    Indexes of the assets
     */
    function _getAssets(address[] memory _bAssets) internal view returns (uint8[] memory indexes) {
        uint256 len = _bAssets.length;

        indexes = new uint8[](len);

        Asset memory input_;
        for (uint256 i = 0; i < len; i++) {
            input_ = _getAsset(_bAssets[i]);
            indexes[i] = input_.idx;

            for (uint256 j = i + 1; j < len; j++) {
                require(_bAssets[i] != _bAssets[j], "Duplicate asset");
            }
        }
    }

    /**
     * @dev Gets all config needed for general InvariantValidator calls
     */
    function _getConfig() internal view returns (InvariantConfig memory) {
        return InvariantConfig(totalSupply() + data.surplus, _getA(), data.weightLimits, RECOL_FEE);
    }

    /**
     * @dev Gets current amplification var A
     */
    function _getA() internal view returns (uint256) {
        AmpData memory ampData_ = data.ampData;

        uint64 endA = ampData_.targetA;
        uint64 endTime = ampData_.rampEndTime;

        // If still changing, work out based on current timestmap
        if (block.timestamp < endTime) {
            uint64 startA = ampData_.initialA;
            uint64 startTime = ampData_.rampStartTime;

            (uint256 elapsed, uint256 total) = (block.timestamp - startTime, endTime - startTime);

            if (endA > startA) {
                return startA + (((endA - startA) * elapsed) / total);
            } else {
                return startA - (((startA - endA) * elapsed) / total);
            }
        }
        // Else return final value
        else {
            return endA;
        }
    }

    /***************************************
                    YIELD
    ****************************************/

    /**
     * @dev Converts recently accrued swap and redeem fees into mAsset
     * @return mintAmount   mAsset units generated from swap and redeem fees
     * @return newSupply    mAsset total supply after mint
     */
    function collectInterest()
        external
        override
        onlySavingsManager
        returns (uint256 mintAmount, uint256 newSupply)
    {
        // Set the surplus variable to 1 to optimise for SSTORE costs.
        // If setting to 0 here, it would save 5k per savings deposit, but cost 20k for the
        // first surplus call (a SWAP or REDEEM).
        uint256 surplusFees = data.surplus;
        if (surplusFees > 1) {
            mintAmount = surplusFees - 1;
            data.surplus = 1;

            // mint new mAsset to savings manager
            _mint(msg.sender, mintAmount);
            emit MintedMulti(
                address(this),
                msg.sender,
                mintAmount,
                new address[](0),
                new uint256[](0)
            );
        }
        newSupply = totalSupply();
    }

    /**
     * @dev Collects the interest generated from the Basket, minting a relative
     *      amount of mAsset and sends it over to the SavingsMassetManager.
     * @return mintAmount   mAsset units generated from interest collected from lending markets
     * @return newSupply    mAsset total supply after mint
     */
    function collectPlatformInterest()
        external
        override
        onlySavingsManager
        whenHealthy
        nonReentrant
        returns (uint256 mintAmount, uint256 newSupply)
    {
        (uint8[] memory idxs, uint256[] memory gains) =
            MassetManagerV2.collectPlatformInterest(data.bAssetPersonal, data.bAssetData);

        mintAmount = MassetLogic.computeMintMulti(data.bAssetData, idxs, gains, _getConfig());

        require(mintAmount > 0, "Must collect something");

        _mint(msg.sender, mintAmount);
        emit MintedMulti(address(this), msg.sender, mintAmount, new address[](0), gains);

        newSupply = totalSupply();
    }

    /***************************************
                    STATE
    ****************************************/

    /**
     * @dev Sets the MAX cache size for each bAsset. The cache will actually revolve around
     *      _cacheSize * totalSupply / 2 under normal circumstances.
     * @param _cacheSize Maximum percent of total mAsset supply to hold for each bAsset
     */
    function setCacheSize(uint256 _cacheSize) external override onlyGovernor {
        require(_cacheSize <= 2e17, "Must be <= 20%");

        data.cacheSize = _cacheSize;

        emit CacheSizeChanged(_cacheSize);
    }

    /**
     * @dev Set the ecosystem fee for sewapping bAssets or redeeming specific bAssets
     * @param _swapFee Fee calculated in (%/100 * 1e18)
     */
    function setFees(uint256 _swapFee, uint256 _redemptionFee) external override onlyGovernor {
        require(_swapFee <= MAX_FEE, "Swap rate oob");
        require(_redemptionFee <= MAX_FEE, "Redemption rate oob");

        data.swapFee = _swapFee;
        data.redemptionFee = _redemptionFee;

        emit FeesChanged(_swapFee, _redemptionFee);
    }

    /**
     * @dev Set the maximum weight for a given bAsset
     * @param _min Weight where 100% = 1e18
     * @param _max Weight where 100% = 1e18
     */
    function setWeightLimits(uint128 _min, uint128 _max) external onlyGovernor {
        require(_min <= 1e18 / (data.bAssetData.length * 2), "Min weight oob");
        require(_max >= 1e18 / (data.bAssetData.length - 1), "Max weight oob");

        data.weightLimits = WeightLimits(_min, _max);

        emit WeightLimitsChanged(_min, _max);
    }

    /**
     * @dev Update transfer fee flag for a given bAsset, should it change its fee practice
     * @param _bAsset   bAsset address
     * @param _flag         Charge transfer fee when its set to 'true', otherwise 'false'
     */
    function setTransferFeesFlag(address _bAsset, bool _flag) external override onlyGovernor {
        MassetManagerV2.setTransferFeesFlag(data.bAssetPersonal, bAssetIndexes, _bAsset, _flag);
    }

    /**
     * @dev Transfers all collateral from one lending market to another - used initially
     *      to handle the migration between Aave V1 and Aave V2. Note - only supports non
     *      tx fee enabled assets. Supports going from no integration to integration, but
     *      not the other way around.
     * @param _bAssets Array of basket assets to migrate
     * @param _newIntegration Address of the new platform integration
     */
    function migrateBassets(address[] calldata _bAssets, address _newIntegration)
        external
        override
        onlyGovernor
    {
        MassetManagerV2.migrateBassets(data.bAssetPersonal, bAssetIndexes, _bAssets, _newIntegration);
    }

    /**
     * @dev Executes the Auto Redistribution event by isolating the bAsset from the Basket
     * @param _bAsset          Address of the ERC20 token to isolate
     * @param _belowPeg        Bool to describe whether the bAsset deviated below peg (t)
     *                         or above (f)
     */
    function handlePegLoss(address _bAsset, bool _belowPeg) external onlyGovernor {
        MassetManagerV2.handlePegLoss(
            data.basket,
            data.bAssetPersonal,
            bAssetIndexes,
            _bAsset,
            _belowPeg
        );
    }

    /**
     * @dev Negates the isolation of a given bAsset
     * @param _bAsset Address of the bAsset
     */
    function negateIsolation(address _bAsset) external onlyGovernor {
        MassetManagerV2.negateIsolation(data.basket, data.bAssetPersonal, bAssetIndexes, _bAsset);
    }

    /**
     * @dev Starts changing of the amplification var A
     * @param _targetA      Target A value
     * @param _rampEndTime  Time at which A will arrive at _targetA
     */
    function startRampA(uint256 _targetA, uint256 _rampEndTime) external onlyGovernor {
        MassetManagerV2.startRampA(data.ampData, _targetA, _rampEndTime, _getA(), A_PRECISION);
    }

    /**
     * @dev Stops the changing of the amplification var A, setting
     * it to whatever the current value is.
     */
    function stopRampA() external onlyGovernor {
        MassetManagerV2.stopRampA(data.ampData, _getA());
    }

    /**
     * @dev Mints deficit to SAVE if k > token supply
     */
    function mintDeficit() external returns (uint256 mintAmount) {
        require(msg.sender == _governor() || msg.sender == _proxyAdmin(), "Gov or ProxyAdmin");

        InvariantConfig memory config = _getConfig();
        (, uint256 k) = MassetLogic.computePrice(data.bAssetData, config);
        require(k > config.supply, "No deficit");
        mintAmount = k - config.supply;
        data.surplus += mintAmount;

        emit DeficitMinted(mintAmount);
    }

    /**
     * @dev Burns surplus if token supply > k
     */
    function burnSurplus() external returns (uint256 burnAmount) {
        InvariantConfig memory config = _getConfig();
        (, uint256 k) = MassetLogic.computePrice(data.bAssetData, config);
        require(config.supply > k, "No surplus");
        burnAmount = config.supply - k;

        _burn(msg.sender, burnAmount);

        emit SurplusBurned(msg.sender, burnAmount);
    }
}