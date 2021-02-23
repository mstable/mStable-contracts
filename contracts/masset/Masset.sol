// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.0;
pragma abicoder v2;

// External
import { IInvariantValidator } from "./IInvariantValidator.sol";

// Internal
import { Initializable } from "../shared/@openzeppelin-2.5/Initializable.sol";
import { InitializableToken } from "../shared/InitializableToken.sol";
import { ImmutableModule } from "../shared/ImmutableModule.sol";
import { InitializableReentrancyGuard } from "../shared/InitializableReentrancyGuard.sol";
import { IMasset, Deprecated_BasketManager } from "../interfaces/IMasset.sol";

// Libs
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { StableMath } from "../shared/StableMath.sol";
import { Manager } from "./Manager.sol";

/**
 * @title   Masset
 * @author  mStable
 * @notice  An incentivised constant sum market maker with hard limits at max region. This supports
 *          low slippage swaps and applies penalties towards min and max regions. AMM produces a
 *          stablecoin (mAsset) and redirects lending market interest and swap fees to the savings
 *          contract, producing a second yield bearing asset.
 * @dev     VERSION: 3.0
 *          DATE:    2021-01-22
 */
contract Masset is
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

    // Release 1.0 VARS
    IInvariantValidator public forgeValidator;
    bool private forgeValidatorLocked;
    // Deprecated - maintain for storage layout in mUSD
    Deprecated_BasketManager private deprecated_basketManager;

    // Basic redemption fee information
    uint256 public swapFee;
    uint256 private MAX_FEE;

    // Release 1.1 VARS
    uint256 public redemptionFee;

    // Release 2.0 VARS
    uint256 public cacheSize;
    uint256 public surplus;

    // Release 3.0 VARS
    // Struct holding Basket details
    BassetPersonal[] public bAssetPersonal;
    BassetData[] public bAssetData;
    mapping(address => uint8) public override bAssetIndexes;
    uint8 public maxBassets;
    BasketState public basket;
    // Amplification Data
    uint256 private constant A_PRECISION = 100;
    AmpData public ampData;
    WeightLimits public weightLimits;

    /**
     * @dev Constructor to set immutable bytecode
     * @param _nexus   Nexus address
     */
    constructor(address _nexus) ImmutableModule(_nexus) {}

    /**
     * @dev Initialization function for upgradable proxy contract.
     *      This function should be called via Proxy just after contract deployment.
     *      To avoid variable shadowing appended `Arg` after arguments name.
     * @param _nameArg          Name of the mAsset
     * @param _symbolArg        Symbol of the mAsset
     * @param _forgeValidator   Address of the AMM implementation
     * @param _bAssets          Array of Basset data
     */
    function initialize(
        string calldata _nameArg,
        string calldata _symbolArg,
        address _forgeValidator,
        BassetPersonal[] calldata _bAssets,
        InvariantConfig memory _config
    ) public initializer {
        InitializableToken._initialize(_nameArg, _symbolArg);

        _initializeReentrancyGuard();

        forgeValidator = IInvariantValidator(_forgeValidator);

        maxBassets = 10;

        uint256 len = _bAssets.length;
        require(len > 0, "No bAssets");
        for (uint256 i = 0; i < len; i++) {
            Manager.addBasset(
                bAssetPersonal,
                bAssetData,
                bAssetIndexes,
                maxBassets,
                _bAssets[i].addr,
                _bAssets[i].integrator,
                1e8,
                _bAssets[i].hasTxFee
            );
        }

        uint64 startA = SafeCast.toUint64(_config.a * A_PRECISION);
        ampData = AmpData(startA, startA, 0, 0);
        weightLimits = _config.limits;

        MAX_FEE = 2e16;
        swapFee = 6e14;
        redemptionFee = 3e14;
        cacheSize = 1e17;
    }

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
        BasketState memory basket_ = basket;
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
        BasketState memory basket_ = basket;
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
        mintOutput = _mintTo(_input, _inputQuantity, _minOutputQuantity, _recipient);
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
        mintOutput = _mintMulti(_inputs, _inputQuantities, _minOutputQuantity, _recipient);
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

        (uint8 idx, ) = _getAsset(_input);

        mintOutput = forgeValidator.computeMint(bAssetData, idx, _inputQuantity, _getConfig());
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
        (uint8[] memory indexes, ) = _getBassets(_inputs);
        return forgeValidator.computeMintMulti(bAssetData, indexes, _inputQuantities, _getConfig());
    }

    /***************************************
              MINTING (INTERNAL)
    ****************************************/

    /** @dev Mint Single */
    function _mintTo(
        address _input,
        uint256 _inputQuantity,
        uint256 _minMassetQuantity,
        address _recipient
    ) internal returns (uint256 mAssetMinted) {
        require(_recipient != address(0), "Invalid recipient");
        require(_inputQuantity > 0, "Qty==0");
        BassetData[] memory allBassets = bAssetData;
        (uint8 bAssetIndex, BassetPersonal memory personal) = _getAsset(_input);
        Cache memory cache = _getCacheDetails();
        // Transfer collateral to the platform integration address and call deposit
        uint256 quantityDeposited =
            Manager.depositTokens(
                personal,
                allBassets[bAssetIndex].ratio,
                _inputQuantity,
                cache.maxCache
            );
        // Validation should be after token transfer, as bAssetQty is unknown before
        mAssetMinted = forgeValidator.computeMint(
            allBassets,
            bAssetIndex,
            quantityDeposited,
            _getConfig()
        );
        require(mAssetMinted >= _minMassetQuantity, "Mint quantity < min qty");
        // Log the Vault increase - can only be done when basket is healthy
        bAssetData[bAssetIndex].vaultBalance =
            allBassets[bAssetIndex].vaultBalance +
            SafeCast.toUint128(quantityDeposited);
        // Mint the Masset
        _mint(_recipient, mAssetMinted);
        emit Minted(msg.sender, _recipient, mAssetMinted, _input, quantityDeposited);
    }

    /** @dev Mint Multi */
    function _mintMulti(
        address[] memory _inputs,
        uint256[] memory _inputQuantities,
        uint256 _minMassetQuantity,
        address _recipient
    ) internal returns (uint256 mAssetMinted) {
        require(_recipient != address(0), "Invalid recipient");
        uint256 len = _inputQuantities.length;
        require(len > 0 && len == _inputs.length, "Input array mismatch");
        // Load bAssets from storage into memory
        (uint8[] memory indexes, BassetPersonal[] memory personals) = _getBassets(_inputs);
        BassetData[] memory allBassets = bAssetData;
        Cache memory cache = _getCacheDetails();
        uint256[] memory quantitiesDeposited = new uint256[](len);
        // Transfer the Bassets to the integrator, update storage and calc MassetQ
        for (uint256 i = 0; i < len; i++) {
            uint256 bAssetQuantity = _inputQuantities[i];
            if (bAssetQuantity > 0) {
                uint8 idx = indexes[i];
                BassetData memory data = allBassets[idx];
                BassetPersonal memory personal = personals[i];
                uint256 quantityDeposited =
                    Manager.depositTokens(personal, data.ratio, bAssetQuantity, cache.maxCache);
                quantitiesDeposited[i] = quantityDeposited;
                bAssetData[idx].vaultBalance =
                    data.vaultBalance +
                    SafeCast.toUint128(quantityDeposited);
            }
        }
        // Validate the proposed mint, after token transfer
        mAssetMinted = forgeValidator.computeMintMulti(
            allBassets,
            indexes,
            quantitiesDeposited,
            _getConfig()
        );
        require(mAssetMinted >= _minMassetQuantity, "Mint quantity < min qty");
        require(mAssetMinted > 0, "Zero mAsset quantity");

        // Mint the Masset
        _mint(_recipient, mAssetMinted);
        emit MintedMulti(msg.sender, _recipient, mAssetMinted, _inputs, _inputQuantities);
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
        swapOutput = _swap(_input, _output, _inputQuantity, _minOutputQuantity, _recipient);
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

        // 1. Load the bAssets from storage into memory
        BassetData[] memory allBassets = bAssetData;
        (uint8 inputIdx, ) = _getAsset(_input);
        (uint8 outputIdx, ) = _getAsset(_output);

        // 2. If a bAsset swap, calculate the validity, output and fee
        (swapOutput, ) = forgeValidator.computeSwap(
            allBassets,
            inputIdx,
            outputIdx,
            _inputQuantity,
            swapFee,
            _getConfig()
        );
    }

    /***************************************
              SWAP (INTERNAL)
    ****************************************/

    /** @dev Swap single */
    function _swap(
        address _input,
        address _output,
        uint256 _inputQuantity,
        uint256 _minOutputQuantity,
        address _recipient
    ) internal returns (uint256 swapOutput) {
        require(_recipient != address(0), "Invalid recipient");
        require(_input != _output, "Invalid pair");
        require(_inputQuantity > 0, "Invalid swap quantity");

        // 1. Load the bAssets from storage into memory
        BassetData[] memory allBassets = bAssetData;
        (uint8 inputIdx, BassetPersonal memory inputPersonal) = _getAsset(_input);
        (uint8 outputIdx, BassetPersonal memory outputPersonal) = _getAsset(_output);
        // 2. Load cache
        Cache memory cache = _getCacheDetails();
        // 3. Deposit the input tokens
        uint256 quantityDeposited =
            Manager.depositTokens(
                inputPersonal,
                allBassets[inputIdx].ratio,
                _inputQuantity,
                cache.maxCache
            );
        // 3.1. Update the input balance
        bAssetData[inputIdx].vaultBalance =
            allBassets[inputIdx].vaultBalance +
            SafeCast.toUint128(quantityDeposited);

        // 3. Validate the swap
        uint256 scaledFee;
        (swapOutput, scaledFee) = forgeValidator.computeSwap(
            allBassets,
            inputIdx,
            outputIdx,
            quantityDeposited,
            swapFee,
            _getConfig()
        );
        require(swapOutput >= _minOutputQuantity, "Output qty < minimum qty");
        require(swapOutput > 0, "Zero output quantity");
        //4. Settle the swap
        //4.1. Decrease output bal
        Manager.withdrawTokens(
            swapOutput,
            outputPersonal,
            allBassets[outputIdx],
            _recipient,
            cache.maxCache
        );
        bAssetData[outputIdx].vaultBalance =
            allBassets[outputIdx].vaultBalance -
            SafeCast.toUint128(swapOutput);
        // Save new surplus to storage
        surplus = cache.surplus + scaledFee;
        emit Swapped(
            msg.sender,
            inputPersonal.addr,
            outputPersonal.addr,
            swapOutput,
            scaledFee,
            _recipient
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
        outputQuantity = _redeem(_output, _mAssetQuantity, _minOutputQuantity, _recipient);
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
        outputQuantities = _redeemMasset(_mAssetQuantity, _minOutputQuantities, _recipient);
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
        mAssetQuantity = _redeemExactBassets(
            _outputs,
            _outputQuantities,
            _maxMassetQuantity,
            _recipient
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

        (uint8 idx, ) = _getAsset(_output);

        uint256 scaledFee = _mAssetQuantity.mulTruncate(swapFee);
        bAssetOutput = forgeValidator.computeRedeem(
            bAssetData,
            idx,
            _mAssetQuantity - scaledFee,
            _getConfig()
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

        (uint8[] memory indexes, ) = _getBassets(_outputs);

        // calculate the value of mAssets need to cover the value of bAssets being redeemed
        uint256 mAssetRedeemed =
            forgeValidator.computeRedeemExact(bAssetData, indexes, _outputQuantities, _getConfig());
        mAssetQuantity = mAssetRedeemed.divPrecisely(1e18 - swapFee) + 1;
    }

    /***************************************
                REDEMPTION (INTERNAL)
    ****************************************/

    /**
     * @dev Redeem mAsset for a single bAsset
     */
    function _redeem(
        address _output,
        uint256 _inputQuantity,
        uint256 _minOutputQuantity,
        address _recipient
    ) internal returns (uint256 bAssetQuantity) {
        require(_recipient != address(0), "Invalid recipient");
        require(_inputQuantity > 0, "Qty==0");

        // Load the bAsset data from storage into memory
        BassetData[] memory allBassets = bAssetData;
        (uint8 bAssetIndex, BassetPersonal memory personal) = _getAsset(_output);
        // Calculate redemption quantities
        uint256 scaledFee = _inputQuantity.mulTruncate(swapFee);
        bAssetQuantity = forgeValidator.computeRedeem(
            allBassets,
            bAssetIndex,
            _inputQuantity - scaledFee,
            _getConfig()
        );
        require(bAssetQuantity >= _minOutputQuantity, "bAsset qty < min qty");
        require(bAssetQuantity > 0, "Output == 0");
        // Apply fees, burn mAsset and return bAsset to recipient
        // 1.0. Burn the full amount of Masset
        _burn(msg.sender, _inputQuantity);
        surplus += scaledFee;
        Cache memory cache = _getCacheDetails();
        // 2.0. Transfer the Bassets to the recipient
        Manager.withdrawTokens(
            bAssetQuantity,
            personal,
            allBassets[bAssetIndex],
            _recipient,
            cache.maxCache
        );
        // 3.0. Set vault balance
        bAssetData[bAssetIndex].vaultBalance =
            allBassets[bAssetIndex].vaultBalance -
            SafeCast.toUint128(bAssetQuantity);

        emit Redeemed(
            msg.sender,
            _recipient,
            _inputQuantity,
            personal.addr,
            bAssetQuantity,
            scaledFee
        );
    }

    /**
     * @dev Redeem mAsset for proportional amount of bAssets
     */
    function _redeemMasset(
        uint256 _inputQuantity,
        uint256[] calldata _minOutputQuantities,
        address _recipient
    ) internal returns (uint256[] memory outputQuantities) {
        require(_recipient != address(0), "Invalid recipient");
        require(_inputQuantity > 0, "Qty==0");

        // Calculate mAsset redemption quantities
        uint256 scaledFee = _inputQuantity.mulTruncate(redemptionFee);
        uint256 mAssetRedemptionAmount = _inputQuantity - scaledFee;

        // Burn mAsset quantity
        _burn(msg.sender, _inputQuantity);
        surplus += scaledFee;

        // Calc cache and total mAsset circulating
        Cache memory cache = _getCacheDetails();
        // Total mAsset = (totalSupply + _inputQuantity - scaledFee) + surplus
        uint256 totalMasset = cache.vaultBalanceSum + mAssetRedemptionAmount;

        // Load the bAsset data from storage into memory
        BassetData[] memory allBassets = bAssetData;

        uint256 len = allBassets.length;
        address[] memory outputs = new address[](len);
        outputQuantities = new uint256[](len);
        for (uint256 i = 0; i < len; i++) {
            // Get amount out, proportionate to redemption quantity
            // Use `cache.sum` here as the total mAsset supply is actually totalSupply + surplus
            uint256 amountOut = (allBassets[i].vaultBalance * mAssetRedemptionAmount) / totalMasset;
            require(amountOut > 1, "Output == 0");
            amountOut -= 1;
            require(amountOut >= _minOutputQuantities[i], "bAsset qty < min qty");
            // Set output in array
            (outputQuantities[i], outputs[i]) = (amountOut, bAssetPersonal[i].addr);
            // Transfer the bAsset to the recipient
            Manager.withdrawTokens(
                amountOut,
                bAssetPersonal[i],
                allBassets[i],
                _recipient,
                cache.maxCache
            );
            // reduce vaultBalance
            bAssetData[i].vaultBalance = allBassets[i].vaultBalance - SafeCast.toUint128(amountOut);
        }

        emit RedeemedMulti(
            msg.sender,
            _recipient,
            _inputQuantity,
            outputs,
            outputQuantities,
            scaledFee
        );
    }

    /** @dev Redeem mAsset for one or more bAssets */
    function _redeemExactBassets(
        address[] memory _outputs,
        uint256[] memory _outputQuantities,
        uint256 _maxMassetQuantity,
        address _recipient
    ) internal returns (uint256 mAssetQuantity) {
        require(_recipient != address(0), "Invalid recipient");
        uint256 len = _outputQuantities.length;
        require(len > 0 && len == _outputs.length, "Invalid array input");
        require(_maxMassetQuantity > 0, "Qty==0");

        (uint8[] memory indexes, BassetPersonal[] memory personal) = _getBassets(_outputs);
        // Load bAsset data from storage to memory
        BassetData[] memory allBassets = bAssetData;
        // Validate redemption
        uint256 mAssetRequired =
            forgeValidator.computeRedeemExact(allBassets, indexes, _outputQuantities, _getConfig());
        mAssetQuantity = mAssetRequired.divPrecisely(1e18 - swapFee);
        uint256 fee = mAssetQuantity - mAssetRequired;
        require(mAssetQuantity > 0, "Must redeem some mAssets");
        mAssetQuantity += 1;
        require(mAssetQuantity <= _maxMassetQuantity, "Redeem mAsset qty > max quantity");
        // Apply fees, burn mAsset and return bAsset to recipient
        // 1.0. Burn the full amount of Masset
        _burn(msg.sender, mAssetQuantity);
        surplus += fee;
        Cache memory cache = _getCacheDetails();
        // 2.0. Transfer the Bassets to the recipient and count fees
        for (uint256 i = 0; i < len; i++) {
            uint8 idx = indexes[i];
            Manager.withdrawTokens(
                _outputQuantities[i],
                personal[i],
                allBassets[idx],
                _recipient,
                cache.maxCache
            );
            bAssetData[idx].vaultBalance =
                allBassets[idx].vaultBalance -
                SafeCast.toUint128(_outputQuantities[i]);
        }
        emit RedeemedMulti(
            msg.sender,
            _recipient,
            mAssetQuantity,
            _outputs,
            _outputQuantities,
            fee
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
        return (basket.undergoingRecol, basket.failed);
    }

    /**
     * @dev Get data for a all bAssets in basket
     * @return personal  Struct[] with full bAsset data
     * @return data      Number of bAssets in the Basket
     */
    function getBassets()
        external
        view
        override
        returns (BassetPersonal[] memory personal, BassetData[] memory data)
    {
        return (bAssetPersonal, bAssetData);
    }

    /**
     * @dev Get data for a specific bAsset, if it exists
     * @param _bAsset   Address of bAsset
     * @return personal  Struct with full bAsset data
     * @return data  Struct with full bAsset data
     */
    function getBasset(address _bAsset)
        external
        view
        override
        returns (BassetPersonal memory personal, BassetData memory data)
    {
        uint8 idx = bAssetIndexes[_bAsset];
        personal = bAssetPersonal[idx];
        require(personal.addr == _bAsset, "Invalid asset");
        data = bAssetData[idx];
    }

    /**
     * @dev Gets all config needed for general InvariantValidator calls
     */
    function getConfig() external view returns (InvariantConfig memory config) {
        return _getConfig();
    }

    /***************************************
                GETTERS - INTERNAL
    ****************************************/

    /**
     * vaultBalanceSum = totalSupply + 'surplus'
     * maxCache = vaultBalanceSum * (cacheSize / 1e18)
     * surplus is simply surplus, to reduce SLOADs
     */
    struct Cache {
        uint256 vaultBalanceSum;
        uint256 maxCache;
        uint256 surplus;
    }

    /**
     * @dev Gets the supply and cache details for the mAsset, taking into account the surplus
     * @return Cache containing (tracked) sum of vault balances, ideal cache size and surplus
     */
    function _getCacheDetails() internal view returns (Cache memory) {
        // read surplus from storage into memory
        uint256 _surplus = surplus;
        uint256 sum = totalSupply() + _surplus;
        return Cache(sum, sum.mulTruncate(cacheSize), _surplus);
    }

    /**
     * @dev Gets a bAsset from storage
     * @param _asset        Address of the asset
     * @return idx        Index of the asset
     * @return personal   Personal details for the asset
     */
    function _getAsset(address _asset)
        internal
        view
        returns (uint8 idx, BassetPersonal memory personal)
    {
        idx = bAssetIndexes[_asset];
        personal = bAssetPersonal[idx];
        require(personal.addr == _asset, "Invalid asset");
    }

    /**
     * @dev Gets a an array of bAssets from storage and protects against duplicates
     * @param _bAssets    Addresses of the assets
     * @return indexes    Indexes of the assets
     * @return personal   Personal details for the assets
     */
    function _getBassets(address[] memory _bAssets)
        internal
        view
        returns (uint8[] memory indexes, BassetPersonal[] memory personal)
    {
        uint256 len = _bAssets.length;

        indexes = new uint8[](len);
        personal = new BassetPersonal[](len);

        for (uint256 i = 0; i < len; i++) {
            (indexes[i], personal[i]) = _getAsset(_bAssets[i]);

            for (uint256 j = i + 1; j < len; j++) {
                require(_bAssets[i] != _bAssets[j], "Duplicate asset");
            }
        }
    }

    /**
     * @dev Gets all config needed for general InvariantValidator calls
     */
    function _getConfig() internal view returns (InvariantConfig memory) {
        return InvariantConfig(_getA(), weightLimits);
    }

    /**
     * @dev Gets current amplification var A
     */
    function _getA() internal view returns (uint256) {
        AmpData memory ampData_ = ampData;

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
        uint256 surplusFees = surplus;
        if (surplusFees > 1) {
            mintAmount = surplusFees - 1;
            surplus = 1;

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
     *      amount of mAsset and sends it over to the SavingsManager.
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
        uint256[] memory gains;
        (mintAmount, gains) = Manager.collectPlatformInterest(
            bAssetPersonal,
            bAssetData,
            forgeValidator,
            _getConfig()
        );

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

        cacheSize = _cacheSize;

        emit CacheSizeChanged(_cacheSize);
    }

    /**
     * @dev Upgrades the version of ForgeValidator protocol. Governor can do this
     *      only while ForgeValidator is unlocked.
     * @param _newForgeValidator Address of the new ForgeValidator
     */
    function upgradeForgeValidator(address _newForgeValidator) external override onlyGovernor {
        require(!forgeValidatorLocked, "ForgeVal locked");
        require(_newForgeValidator != address(0), "Null address");

        forgeValidator = IInvariantValidator(_newForgeValidator);

        emit ForgeValidatorChanged(_newForgeValidator);
    }

    /**
     * @dev Set the ecosystem fee for sewapping bAssets or redeeming specific bAssets
     * @param _swapFee Fee calculated in (%/100 * 1e18)
     */
    function setFees(uint256 _swapFee, uint256 _redemptionFee) external override onlyGovernor {
        require(_swapFee <= MAX_FEE, "Swap rate oob");
        require(_redemptionFee <= MAX_FEE, "Redemption rate oob");

        swapFee = _swapFee;
        redemptionFee = _redemptionFee;

        emit FeesChanged(_swapFee, _redemptionFee);
    }

    /**
     * @dev Set the maximum weight for a given bAsset
     * @param _min Weight where 100% = 1e18
     * @param _max Weight where 100% = 1e18
     */
    function setWeightLimits(uint128 _min, uint128 _max) external onlyGovernor {
        require(_min <= 1e18 / (bAssetData.length * 2), "Min weight oob");
        require(_max >= 1e18 / (bAssetData.length - 1), "Max weight oob");

        weightLimits = WeightLimits(_min, _max);

        emit WeightLimitsChanged(_min, _max);
    }

    /**
     * @dev Update transfer fee flag for a given bAsset, should it change its fee practice
     * @param _bAsset   bAsset address
     * @param _flag         Charge transfer fee when its set to 'true', otherwise 'false'
     */
    function setTransferFeesFlag(address _bAsset, bool _flag) external override onlyGovernor {
        Manager.setTransferFeesFlag(bAssetPersonal, bAssetIndexes, _bAsset, _flag);
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
        Manager.migrateBassets(bAssetPersonal, bAssetIndexes, _bAssets, _newIntegration);
    }

    /**
     * @dev Executes the Auto Redistribution event by isolating the bAsset from the Basket
     * @param _bAsset          Address of the ERC20 token to isolate
     * @param _belowPeg        Bool to describe whether the bAsset deviated below peg (t)
     *                         or above (f)
     */
    function handlePegLoss(address _bAsset, bool _belowPeg) external onlyGovernor {
        Manager.handlePegLoss(basket, bAssetPersonal, bAssetIndexes, _bAsset, _belowPeg);
    }

    /**
     * @dev Negates the isolation of a given bAsset
     * @param _bAsset Address of the bAsset
     */
    function negateIsolation(address _bAsset) external onlyGovernor {
        Manager.negateIsolation(basket, bAssetPersonal, bAssetIndexes, _bAsset);
    }

    /**
     * @dev Starts changing of the amplification var A
     * @param _targetA      Target A value
     * @param _rampEndTime  Time at which A will arrive at _targetA
     */
    function startRampA(uint256 _targetA, uint256 _rampEndTime) external onlyGovernor {
        Manager.startRampA(ampData, _targetA, _rampEndTime, _getA(), A_PRECISION);
    }

    /**
     * @dev Stops the changing of the amplification var A, setting
     * it to whatever the current value is.
     */
    function stopRampA() external onlyGovernor {
        Manager.stopRampA(ampData, _getA());
    }
}
