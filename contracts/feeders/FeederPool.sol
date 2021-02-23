// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.0;

// Internal
import { IFeederPool } from "../interfaces/IFeederPool.sol";
import { Initializable } from "@openzeppelin/contracts/utils/Initializable.sol";
import { InitializableToken } from "../shared/InitializableToken.sol";
import { ImmutableModule } from "../shared/ImmutableModule.sol";
import { InitializableReentrancyGuard } from "../shared/InitializableReentrancyGuard.sol";
import { IBasicToken } from "../shared/IBasicToken.sol";
import { IMasset } from "../interfaces/IMasset.sol";

// Libs
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { StableMath } from "../shared/StableMath.sol";
import { FeederManager } from "./FeederManager.sol";
import { FeederValidator } from "./FeederValidator.sol";

// TODO - get back under EIP170 limit
// TODO - deploy
// TODO - resolve internal todos
// TODO - check that `mAsset` is always converted and uses storage addr
// TODO - remove unused dependencies (Here, Manager, Validator)
// TODO - remove all instances of bAsset or mAsset where used incorrectly
// TODO - reconsider moving FeederValidator to internal lib (consider upgrade strategy)
// TODO - seriously reconsider storage layout and how to tidy this file up
// - Add comprehensive natspec comments
contract FeederPool is
    IFeederPool,
    Initializable,
    InitializableToken,
    ImmutableModule,
    InitializableReentrancyGuard
{
    using StableMath for uint256;
    using SafeERC20 for IERC20;

    // Forging Events
    event Minted(
        address indexed minter,
        address recipient,
        uint256 output,
        address input,
        uint256 inputQuantity
    );
    event MintedMulti(
        address indexed minter,
        address recipient,
        uint256 output,
        address[] inputs,
        uint256[] inputQuantities
    );
    event Swapped(
        address indexed swapper,
        address input,
        address output,
        uint256 outputAmount,
        uint256 fee,
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

    // FeederValidator public validator;

    uint256 private constant MAX_FEE = 1e16;
    uint256 public swapFee;
    uint256 public redemptionFee;

    uint256 public cacheSize;

    // TODO - consider if array & storage necessary
    // Possibly save fAsset and mAsset addr's to mem and lookup at:
    // [0] = mAsset
    // [1] = fAsset
    BassetPersonal[] public bAssetPersonal;
    BassetData[] public bAssetData;
    // TODO - also store fAsset addr here?
    address public immutable mAsset;

    uint256 private constant A_PRECISION = 100;
    AmpData public ampData;
    WeightLimits public weightLimits;

    /**
     * @dev Constructor to set immutable bytecode
     * @param _nexus   Nexus address
     */
    constructor(address _nexus, address _mAsset) ImmutableModule(_nexus) {
        // TODO - need to be extremely careful when upgrading contracts with immutable storage
        // Check what would happen if this was updated incorrectly
        mAsset = _mAsset;
    }

    function initialize(
        string calldata _nameArg,
        string calldata _symbolArg,
        BassetPersonal calldata _mAsset,
        BassetPersonal calldata _fAsset,
        address[] calldata _mpAssets,
        InvariantConfig memory _config
    ) public initializer {
        InitializableToken._initialize(_nameArg, _symbolArg);

        _initializeReentrancyGuard();

        // validator = IFeederValidator(_validator);
        // TODO - consider how to store fAsset vs mAsset. Atm we do 3 extra SLOADs per asset
        // ----- prop ---- fAsset ---- mAsset
        //       addr   immutable   immutable
        //      ratio   immutable   immutable
        // integrator     mutable     mutable
        //   hasTxFee     mutable   immutable
        //   vBalance     mutable     mutable
        //     status    outdated    outdated
        require(_mAsset.addr == mAsset, "mAsset incorrect");
        bAssetPersonal.push(
            BassetPersonal(_mAsset.addr, _mAsset.integrator, false, BassetStatus.Normal)
        );
        bAssetData.push(BassetData(1e8, 0));
        bAssetPersonal.push(
            BassetPersonal(_fAsset.addr, _fAsset.integrator, _fAsset.hasTxFee, BassetStatus.Normal)
        );
        bAssetData.push(
            BassetData(SafeCast.toUint128(10**(26 - IBasicToken(_fAsset.addr).decimals())), 0)
        );
        for (uint256 i = 0; i < _mpAssets.length; i++) {
            IERC20(_mpAssets[i]).approve(_mAsset.addr, 2**255);
        }

        uint64 startA = SafeCast.toUint64(_config.a * A_PRECISION);
        ampData = AmpData(startA, startA, 0, 0);
        weightLimits = _config.limits;

        swapFee = 20e14;
        redemptionFee = 10e14;
        cacheSize = 1e17;
    }

    /**
     * @dev Requires the overall basket composition to be healthy
     */
    modifier whenInOperation() {
        _isOperational();
        _;
    }

    // Internal fn for modifier to reduce deployment size
    function _isOperational() internal view {
        // BasketState memory basket_ = basket;
        // require(!paused || msg.sender == 'recollateraliser', "Unhealthy");
    }

    /**
     * @dev Verifies that the caller is the Savings Manager contract
     */
    modifier onlyInterestValidator() {
        // keccak256("InterestValidator") = c10a28f028c7f7282a03c90608e38a4a646e136e614e4b07d119280c5f7f839f
        require(
            nexus.getModule(0xc10a28f028c7f7282a03c90608e38a4a646e136e614e4b07d119280c5f7f839f) ==
                msg.sender,
            "Only validator"
        );
        _;
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
    ) external override nonReentrant whenInOperation returns (uint256 mintOutput) {
        require(_recipient != address(0), "Invalid recipient");
        require(_inputQuantity > 0, "Qty==0");

        Asset memory input = _getAsset(_input);

        BassetData[] memory cachedBassetData = bAssetData;
        AssetData memory inputData = _transferIn(cachedBassetData, input, _inputQuantity);
        // Validation should be after token transfer, as bAssetQty is unknown before
        mintOutput = FeederValidator.computeMint(
            cachedBassetData,
            inputData.idx,
            inputData.amt,
            _getConfig()
        );
        require(mintOutput >= _minOutputQuantity, "Mint quantity < min qty");

        // Mint the LP Token
        _mint(_recipient, mintOutput);
        emit Minted(msg.sender, _recipient, mintOutput, _input, inputData.amt);
    }

    function mintMulti(
        address[] calldata _inputs,
        uint256[] calldata _inputQuantities,
        uint256 _minOutputQuantity,
        address _recipient
    ) external override nonReentrant whenInOperation returns (uint256 mintOutput) {
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

        Asset memory input = _getAsset(_input);

        if (input.exists) {
            mintOutput = FeederValidator.computeMint(
                bAssetData,
                input.idx,
                _inputQuantity,
                _getConfig()
            );
        } else {
            uint256 esimatedMasset = IMasset(mAsset).getMintOutput(_input, _inputQuantity);
            mintOutput = FeederValidator.computeMint(bAssetData, 0, esimatedMasset, _getConfig());
        }
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
            FeederValidator.computeMintMulti(bAssetData, indexes, _inputQuantities, _getConfig());
    }

    /***************************************
              MINTING (INTERNAL)
    ****************************************/

    // Results in a deposited fAsset or mAsset, whether that is directly, or through mpAsset -> mAsset minting
    // from the main pool.
    function _transferIn(
        BassetData[] memory _cachedBassetData,
        Asset memory _input,
        uint256 _inputQuantity
    ) internal returns (AssetData memory inputData) {
        if (_input.exists) {
            BassetPersonal memory personal = bAssetPersonal[_input.idx];
            uint256 amt =
                FeederManager.depositTokens(
                    personal,
                    _cachedBassetData[_input.idx].ratio,
                    _inputQuantity,
                    _getCacheDetails().maxCache
                );
            inputData = AssetData(_input.idx, amt, personal);
        } else {
            inputData = _mpMint(_input, _inputQuantity);
            require(inputData.amt > 0, "Must mint something from mp");
        }
        bAssetData[inputData.idx].vaultBalance =
            _cachedBassetData[inputData.idx].vaultBalance +
            SafeCast.toUint128(inputData.amt);
    }

    // mint in main pool and log balance
    function _mpMint(Asset memory _input, uint256 _inputQuantity)
        internal
        returns (AssetData memory mAssetData)
    {
        // TODO - handle tx fees with new massethelpers fns
        // TODO - consider poking cache here?
        mAssetData = AssetData(0, 0, bAssetPersonal[0]);
        IERC20(_input.addr).safeTransferFrom(msg.sender, address(this), _inputQuantity);
        uint256 balBefore = IERC20(mAssetData.personal.addr).balanceOf(address(this));
        IMasset(mAssetData.personal.addr).mint(_input.addr, _inputQuantity, 0, address(this));
        uint256 balAfter = IERC20(mAssetData.personal.addr).balanceOf(address(this));
        mAssetData.amt = balAfter - balBefore;
    }

    function _mintMulti(
        address[] memory _inputs,
        uint256[] memory _inputQuantities,
        uint256 _minOutputQuantity,
        address _recipient
    ) internal returns (uint256 tokensMinted) {
        require(_recipient != address(0), "Invalid recipient");
        uint256 len = _inputQuantities.length;
        require(len > 0 && len == _inputs.length, "Input array mismatch");

        uint8[] memory indexes = _getAssets(_inputs);
        // Load bAssets from storage into memory
        BassetData[] memory allBassets = bAssetData;
        Cache memory cache = _getCacheDetails();
        uint256[] memory quantitiesDeposited = new uint256[](len);
        // Transfer the Bassets to the integrator, update storage and calc MassetQ
        for (uint256 i = 0; i < len; i++) {
            uint256 bAssetQuantity = _inputQuantities[i];
            if (bAssetQuantity > 0) {
                uint8 idx = indexes[i];
                BassetData memory data = allBassets[idx];
                BassetPersonal memory personal = bAssetPersonal[idx];
                uint256 quantityDeposited =
                    FeederManager.depositTokens(
                        personal,
                        data.ratio,
                        bAssetQuantity,
                        cache.maxCache
                    );

                quantitiesDeposited[i] = quantityDeposited;
                bAssetData[idx].vaultBalance =
                    data.vaultBalance +
                    SafeCast.toUint128(quantityDeposited);
            }
        }
        // Validate the proposed mint, after token transfer
        tokensMinted = FeederValidator.computeMintMulti(
            allBassets,
            indexes,
            quantitiesDeposited,
            _getConfig()
        );
        require(tokensMinted >= _minOutputQuantity, "Mint quantity < min qty");
        require(tokensMinted > 0, "Zero mAsset quantity");
        // Mint the LP Token
        _mint(_recipient, tokensMinted);
        emit MintedMulti(msg.sender, _recipient, tokensMinted, _inputs, _inputQuantities);
    }

    /***************************************
                SWAP (PUBLIC)
    ****************************************/

    function swap(
        address _input,
        address _output,
        uint256 _inputQuantity,
        uint256 _minOutputQuantity,
        address _recipient
    ) external override returns (uint256 swapOutput) {
        require(_recipient != address(0), "Invalid recipient");
        require(_input != _output, "Invalid pair");
        require(_inputQuantity > 0, "Qty==0");

        Asset memory input = _getAsset(_input);
        Asset memory output = _getAsset(_output);
        require(_pathIsValid(input, output), "Invalid pair");

        BassetData[] memory cachedBassetData = bAssetData;

        AssetData memory inputData = _transferIn(cachedBassetData, input, _inputQuantity);
        // 1. [f/mAsset ->][ f/mAsset]               : Y - normal in, SWAP, normal out
        // 3. [mpAsset -> mAsset][ -> fAsset]        : Y - mint in  , SWAP, normal out
        uint256 localFee;
        if (output.exists) {
            (swapOutput, localFee) = _swapLocal(
                cachedBassetData,
                inputData,
                output,
                _minOutputQuantity,
                _recipient
            );
        }
        // 2. [fAsset ->][ mAsset][ -> mpAsset]      : Y - normal in, SWAP, mpOut
        else {
            (swapOutput, localFee) = _swapLocal(
                cachedBassetData,
                inputData,
                Asset(0, mAsset, true),
                0,
                address(this)
            );
            swapOutput = IMasset(mAsset).redeem(
                output.addr,
                swapOutput,
                _minOutputQuantity,
                _recipient
            );
        }

        emit Swapped(msg.sender, input.addr, output.addr, swapOutput, localFee, _recipient);
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

        Asset memory input = _getAsset(_input);
        Asset memory output = _getAsset(_output);
        require(_pathIsValid(input, output), "Invalid pair");

        // Internal swap between fAsset and mAsset
        if (input.exists && output.exists) {
            (swapOutput, ) = FeederValidator.computeSwap(
                bAssetData,
                input.idx,
                output.idx,
                _inputQuantity,
                output.idx == 0 ? 0 : swapFee,
                _getConfig()
            );
            return swapOutput;
        }

        // Swapping out of fAsset
        if (input.exists) {
            // Swap into mAsset > Redeem into mpAsset
            (swapOutput, ) = FeederValidator.computeSwap(
                bAssetData,
                1,
                0,
                _inputQuantity,
                0,
                _getConfig()
            );
            swapOutput = IMasset(mAsset).getRedeemOutput(_output, swapOutput);
        }
        // Else we are swapping into fAsset
        else {
            // Mint mAsset from mp > Swap into fAsset here
            swapOutput = IMasset(mAsset).getMintOutput(_input, _inputQuantity);
            (swapOutput, ) = FeederValidator.computeSwap(
                bAssetData,
                0,
                1,
                swapOutput,
                swapFee,
                _getConfig()
            );
        }
    }

    /***************************************
              SWAP (INTERNAL)
    ****************************************/

    function _pathIsValid(Asset memory _in, Asset memory _out)
        internal
        pure
        returns (bool isValid)
    {
        // mpAsset -> mpAsset
        if (!_in.exists && !_out.exists) return false;
        // f/mAsset -> f/mAsset
        if (_in.exists && _out.exists) return true;
        // fAsset -> mpAsset
        if (_in.exists && _in.idx == 1) return true;
        // mpAsset -> fAsset
        if (_out.exists && _out.idx == 1) return true;
        // Path is into or out of mAsset - just use main pool for this
        return false;
    }

    function _swapLocal(
        BassetData[] memory _cachedBassetData,
        AssetData memory _in,
        Asset memory _output,
        uint256 _minOutputQuantity,
        address _recipient
    ) internal returns (uint256 swapOutput, uint256 scaledFee) {
        Cache memory cache = _getCacheDetails();
        // 3. Validate the swap
        // todo - remove fee?
        (swapOutput, scaledFee) = FeederValidator.computeSwap(
            _cachedBassetData,
            _in.idx,
            _output.idx,
            _in.amt,
            _output.idx == 0 ? 0 : swapFee,
            _getConfig()
        );
        require(swapOutput >= _minOutputQuantity, "Output qty < minimum qty");
        require(swapOutput > 0, "Zero output quantity");
        //4. Settle the swap
        //4.1. Decrease output bal
        BassetPersonal memory outputPersonal = bAssetPersonal[_output.idx];
        if (_recipient != address(this) || outputPersonal.integrator != address(0)) {
            FeederManager.withdrawTokens(
                swapOutput,
                outputPersonal,
                _cachedBassetData[_output.idx],
                _recipient,
                cache.maxCache
            );
        }
        bAssetData[_output.idx].vaultBalance =
            _cachedBassetData[_output.idx].vaultBalance -
            SafeCast.toUint128(swapOutput);
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
     * @param _fpTokenQuantity   Quantity of fp LP Token to redeem
     * @param _minOutputQuantity Minimum bAsset quantity to receive for the burnt fpTokens. This protects against slippage.
     * @param _recipient         Address to transfer the withdrawn bAssets to.
     * @return outputQuantity    Quanity of bAsset units received for the burnt fpTokens
     */
    function redeem(
        address _output,
        uint256 _fpTokenQuantity,
        uint256 _minOutputQuantity,
        address _recipient
    ) external override nonReentrant whenInOperation returns (uint256 outputQuantity) {
        require(_recipient != address(0), "Invalid recipient");
        require(_fpTokenQuantity > 0, "Qty==0");

        Asset memory output = _getAsset(_output);

        uint256 localFee;
        if (output.exists) {
            (outputQuantity, localFee) = _redeemLocal(
                output,
                _fpTokenQuantity,
                _minOutputQuantity,
                _recipient
            );
        } else {
            (outputQuantity, localFee) = _redeemLocal(
                Asset(0, mAsset, true),
                _fpTokenQuantity,
                0,
                address(this)
            );
            outputQuantity = IMasset(mAsset).redeem(
                output.addr,
                outputQuantity,
                _minOutputQuantity,
                _recipient
            );
        }

        emit Redeemed(
            msg.sender,
            _recipient,
            _fpTokenQuantity,
            output.addr,
            outputQuantity,
            localFee
        );
    }

    /**
     * @dev Credits a recipient with a proportionate amount of bAssets, relative to current vault
     * balance levels and desired mAsset quantity. Burns the mAsset as payment.
     * @param _inputQuantity        Quantity of fpToken to redeem
     * @param _minOutputQuantities  Min units of output to receive
     * @param _recipient            Address to credit the withdrawn bAssets
     */
    function redeemProportionately(
        uint256 _inputQuantity,
        uint256[] calldata _minOutputQuantities,
        address _recipient
    ) external override nonReentrant whenInOperation returns (uint256[] memory outputQuantities) {
        require(_recipient != address(0), "Invalid recipient");
        require(_inputQuantity > 0, "Qty==0");

        // Calculate mAsset redemption quantities
        uint256 scaledFee = _inputQuantity.mulTruncate(redemptionFee);
        uint256 redemptionAmount = _inputQuantity - scaledFee;

        // Burn mAsset quantity
        _burn(msg.sender, _inputQuantity);

        // Calc cache and total mAsset circulating
        Cache memory cache = _getCacheDetails();
        uint256 totalMasset = cache.supply + _inputQuantity;

        // Load the bAsset data from storage into memory
        BassetData[] memory allBassets = bAssetData;

        uint256 len = allBassets.length;
        address[] memory outputs = new address[](len);
        outputQuantities = new uint256[](len);
        for (uint256 i = 0; i < len; i++) {
            // Get amount out, proportionate to redemption quantity
            uint256 amountOut = (allBassets[i].vaultBalance * redemptionAmount) / totalMasset;
            require(amountOut > 1, "Output == 0");
            amountOut -= 1;
            require(amountOut >= _minOutputQuantities[i], "bAsset qty < min qty");
            // Set output in array
            (outputQuantities[i], outputs[i]) = (amountOut, bAssetPersonal[i].addr);
            // Transfer the bAsset to the recipient
            FeederManager.withdrawTokens(
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

    /**
     * @dev Credits a recipient with a certain quantity of selected bAssets, in exchange for burning the
     *      relative Masset quantity from the sender. Sender also incurs a small fee on the outgoing asset.
     * @param _outputs           Addresses of the bAssets to receive
     * @param _outputQuantities  Units of the bAssets to redeem
     * @param _maxInputQuantity  Maximum mAsset quantity to burn for the received bAssets. This protects against slippage.
     * @param _recipient         Address to receive the withdrawn bAssets
     * @return fpTokenQuantity    Quantity of mAsset units burned plus the swap fee to pay for the redeemed bAssets
     */
    function redeemExactBassets(
        address[] calldata _outputs,
        uint256[] calldata _outputQuantities,
        uint256 _maxInputQuantity,
        address _recipient
    ) external override nonReentrant whenInOperation returns (uint256 fpTokenQuantity) {
        require(_recipient != address(0), "Invalid recipient");
        uint256 len = _outputQuantities.length;
        require(len > 0 && len == _outputs.length, "Invalid array input");
        require(_maxInputQuantity > 0, "Qty==0");

        uint8[] memory indexes = _getAssets(_outputs);

        // Load bAsset data from storage to memory
        BassetData[] memory allBassets = bAssetData;

        // Validate redemption
        uint256 fpTokenRequired =
            FeederValidator.computeRedeemExact(
                allBassets,
                indexes,
                _outputQuantities,
                _getConfig()
            );
        fpTokenQuantity = fpTokenRequired.divPrecisely(1e18 - redemptionFee);
        uint256 fee = fpTokenQuantity - fpTokenRequired;
        require(fpTokenQuantity > 0, "Must redeem some mAssets");
        fpTokenQuantity += 1;
        require(fpTokenQuantity <= _maxInputQuantity, "Redeem mAsset qty > max quantity");

        // Apply fees, burn mAsset and return bAsset to recipient
        // Avoids stack depth error by using local context
        {
            // Burn the full amount of Masset
            _burn(msg.sender, fpTokenQuantity);
            Cache memory cache = _getCacheDetails();
            // Transfer the Bassets to the recipient
            for (uint256 i = 0; i < len; i++) {
                uint8 idx = indexes[i];
                FeederManager.withdrawTokens(
                    _outputQuantities[i],
                    bAssetPersonal[idx],
                    allBassets[idx],
                    _recipient,
                    cache.maxCache
                );
                bAssetData[idx].vaultBalance =
                    allBassets[idx].vaultBalance -
                    SafeCast.toUint128(_outputQuantities[i]);
            }
        }
        emit RedeemedMulti(
            msg.sender,
            _recipient,
            fpTokenQuantity,
            _outputs,
            _outputQuantities,
            fee
        );
    }

    /**
     * @notice Gets the estimated output from a given redeem
     * @param _output            Address of the bAsset to receive
     * @param _fpTokenQuantity   Quantity of fpToken to redeem
     * @return bAssetOutput      Estimated quantity of bAsset units received for the burnt mAssets
     */
    function getRedeemOutput(address _output, uint256 _fpTokenQuantity)
        external
        view
        override
        returns (uint256 bAssetOutput)
    {
        require(_fpTokenQuantity > 0, "Qty==0");

        Asset memory output = _getAsset(_output);
        uint256 scaledFee = _fpTokenQuantity.mulTruncate(redemptionFee);

        bAssetOutput = FeederValidator.computeRedeem(
            bAssetData,
            output.exists ? output.idx : 0,
            _fpTokenQuantity - scaledFee,
            _getConfig()
        );
        // Extra step for mpAsset redemption
        if (!output.exists) {
            bAssetOutput = IMasset(mAsset).getRedeemOutput(output.addr, bAssetOutput);
        }
    }

    /**
     * @notice Gets the estimated output from a given redeem
     * @param _outputs           Addresses of the bAsset to receive
     * @param _outputQuantities  Quantities of bAsset to redeem
     * @return fpTokenQuantity    Estimated quantity of mAsset units needed to burn to receive output
     */
    function getRedeemExactBassetsOutput(
        address[] calldata _outputs,
        uint256[] calldata _outputQuantities
    ) external view override returns (uint256 fpTokenQuantity) {
        uint256 len = _outputQuantities.length;
        require(len > 0 && len == _outputs.length, "Invalid array input");

        uint8[] memory indexes = _getAssets(_outputs);

        uint256 mAssetRedeemed =
            FeederValidator.computeRedeemExact(
                bAssetData,
                indexes,
                _outputQuantities,
                _getConfig()
            );
        fpTokenQuantity = mAssetRedeemed.divPrecisely(1e18 - redemptionFee) + 1;
    }

    /***************************************
                REDEMPTION (INTERNAL)
    ****************************************/

    function _redeemLocal(
        Asset memory _output,
        uint256 _fpTokenQuantity,
        uint256 _minOutputQuantity,
        address _recipient
    ) internal returns (uint256 outputQuantity, uint256 scaledFee) {
        BassetData[] memory allBassets = bAssetData;
        // Calculate redemption quantities
        scaledFee = _fpTokenQuantity.mulTruncate(redemptionFee);
        outputQuantity = FeederValidator.computeRedeem(
            allBassets,
            _output.idx,
            _fpTokenQuantity - scaledFee,
            _getConfig()
        );
        require(outputQuantity >= _minOutputQuantity, "bAsset qty < min qty");
        require(outputQuantity > 0, "Output == 0");
        // Apply fees, burn mAsset and return bAsset to recipient
        // 1.0. Burn the full amount of Masset
        _burn(msg.sender, _fpTokenQuantity);
        // 2.0. Transfer the Bassets to the recipient
        BassetPersonal memory outputPersonal = bAssetPersonal[_output.idx];
        if (_recipient != address(this) || outputPersonal.integrator != address(0)) {
            FeederManager.withdrawTokens(
                outputQuantity,
                outputPersonal,
                allBassets[_output.idx],
                _recipient,
                _getCacheDetails().maxCache
            );
        }
        // 3.0. Set vault balance
        bAssetData[_output.idx].vaultBalance =
            allBassets[_output.idx].vaultBalance -
            SafeCast.toUint128(outputQuantity);
    }

    /***************************************
                    GETTERS
    ****************************************/

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
        Asset memory asset = _getAsset(_bAsset);
        require(asset.exists, "Invalid asset");
        personal = bAssetPersonal[asset.idx];
        data = bAssetData[asset.idx];
    }

    /**
     * @dev Gets all config needed for general InvariantValidator calls
     */
    function getConfig() external view returns (FeederConfig memory config) {
        return _getConfig();
    }

    /***************************************
                GETTERS - INTERNAL
    ****************************************/

    struct Cache {
        uint256 supply;
        uint256 maxCache;
    }

    function _getCacheDetails() internal view returns (Cache memory) {
        uint256 supply = totalSupply();
        return Cache(supply, supply.mulTruncate(cacheSize));
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

    function _getAsset(address _asset) internal view returns (Asset memory status) {
        // if input is mAsset then we know the position
        if (_asset == mAsset) return Asset(0, _asset, true);

        // else it exists if the position 1 is _asset
        return Asset(1, _asset, bAssetPersonal[1].addr == _asset);
    }

    function _getAssets(address[] memory _assets) internal view returns (uint8[] memory indexes) {
        uint256 len = _assets.length;

        indexes = new uint8[](len);

        Asset memory input_;
        for (uint256 i = 0; i < len; i++) {
            input_ = _getAsset(_assets[i]);
            indexes[i] = input_.idx;
            require(input_.exists, "Invalid asset");

            for (uint256 j = i + 1; j < len; j++) {
                require(_assets[i] != _assets[j], "Duplicate asset");
            }
        }
    }

    /**
     * @dev Gets all config needed for general InvariantValidator calls
     */
    function _getConfig() internal view returns (FeederConfig memory) {
        return FeederConfig(totalSupply(), _getA(), weightLimits);
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
     * @dev Collects the interest generated from the Basket, minting a relative
     *      amount of mAsset and sends it over to the SavingsManager.
     * @return mintAmount   mAsset units generated from interest collected from lending markets
     * @return newSupply    mAsset total supply after mint
     */
    function collectPlatformInterest()
        external
        override
        onlyInterestValidator
        whenInOperation
        nonReentrant
        returns (uint256 mintAmount, uint256 newSupply)
    {
        (uint8[] memory idxs, uint256[] memory gains) =
            FeederManager.calculatePlatformInterest(bAssetPersonal, bAssetData);
        // Calculate potential mint amount. This will be validated by the interest validator
        mintAmount = FeederValidator.computeMintMulti(bAssetData, idxs, gains, _getConfig());
        newSupply = totalSupply() + mintAmount;
        require(mintAmount > 0, "Must collect something");
        emit MintedMulti(address(this), msg.sender, 0, new address[](0), gains);
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
        require(_min <= 3e17 && _max >= 7e17, "Weights oob");

        weightLimits = WeightLimits(_min, _max);

        emit WeightLimitsChanged(_min, _max);
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
        FeederManager.migrateBassets(bAssetPersonal, _bAssets, _newIntegration);
    }

    /**
     * @dev Starts changing of the amplification var A
     * @param _targetA      Target A value
     * @param _rampEndTime  Time at which A will arrive at _targetA
     */
    function startRampA(uint256 _targetA, uint256 _rampEndTime) external onlyGovernor {
        FeederManager.startRampA(ampData, _targetA, _rampEndTime, _getA(), A_PRECISION);
    }

    /**
     * @dev Stops the changing of the amplification var A, setting
     * it to whatever the current value is.
     */
    function stopRampA() external onlyGovernor {
        FeederManager.stopRampA(ampData, _getA());
    }
}
