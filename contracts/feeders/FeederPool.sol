// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.0;
pragma abicoder v2;

import "hardhat/console.sol";

// External
import { IFeederValidator } from "./IFeederValidator.sol";

// Internal
import { IFeederPool } from "../interfaces/IFeederPool.sol";
import { Initializable } from "@openzeppelin/contracts-sol8/contracts/proxy/Initializable.sol";
import { InitializableToken } from "../shared/InitializableToken.sol";
import { ImmutableModule } from "../shared/ImmutableModule.sol";
import { InitializableReentrancyGuard } from "../shared/InitializableReentrancyGuard.sol";
import { IBasicToken } from "../shared/IBasicToken.sol";
import { IMasset } from "../interfaces/IMasset.sol";

// Libs
import { SafeCast } from "@openzeppelin/contracts-sol8/contracts/utils/SafeCast.sol";
import { IERC20 } from "@openzeppelin/contracts-sol8/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-sol8/contracts/token/ERC20/SafeERC20.sol";
import { StableMath } from "../shared/StableMath.sol";
import { Manager } from "../masset/Manager.sol";

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
    // event Redeemed(
    //     address indexed redeemer,
    //     address recipient,
    //     uint256 mAssetQuantity,
    //     address output,
    //     uint256 outputQuantity,
    //     uint256 scaledFee
    // );
    // event RedeemedMulti(
    //     address indexed redeemer,
    //     address recipient,
    //     uint256 mAssetQuantity,
    //     address[] outputs,
    //     uint256[] outputQuantity,
    //     uint256 scaledFee
    // );

    // State Events
    // event CacheSizeChanged(uint256 cacheSize);
    // event FeesChanged(uint256 swapFee, uint256 redemptionFee);
    // event WeightLimitsChanged(uint128 min, uint128 max);
    // event validatorChanged(address validator);

    IFeederValidator public validator;

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
        address _validator,
        BassetPersonal calldata _mAsset,
        BassetPersonal calldata _fAsset,
        address[] calldata _mpAssets,
        InvariantConfig memory _config
    ) public initializer {
        InitializableToken._initialize(_nameArg, _symbolArg);

        _initializeReentrancyGuard();

        validator = IFeederValidator(_validator);
        console.log("a");
        // TODO - consider how to store fAsset vs mAsset. Atm we do 3 extra SLOADs per asset
        // ----- prop ---- fAsset ---- mAsset
        //       addr   immutable   immutable
        //      ratio   immutable   immutable
        // integrator     mutable     mutable
        //   hasTxFee     mutable   immutable
        //   vBalance     mutable     mutable
        //     status    outdated    outdated
        require(_mAsset.addr == mAsset, "mAsset incorrect");
        console.log("b");
        bAssetPersonal.push(
            BassetPersonal(_mAsset.addr, _mAsset.integrator, false, BassetStatus.Normal)
        );
        console.log("c");
        bAssetData.push(BassetData(1e8, 0));
        console.log("d");
        bAssetPersonal.push(
            BassetPersonal(_fAsset.addr, _fAsset.integrator, _fAsset.hasTxFee, BassetStatus.Normal)
        );
        console.log("e");
        bAssetData.push(
            BassetData(SafeCast.toUint128(10**(26 - IBasicToken(_fAsset.addr).decimals())), 0)
        );
        for (uint256 i = 0; i < _mpAssets.length; i++) {
            IERC20(_mpAssets[i]).approve(_mAsset.addr, 2**255);
        }
        console.log("f");

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
    ) external nonReentrant whenInOperation returns (uint256 mintOutput) {
        require(_recipient != address(0), "Invalid recipient");
        require(_inputQuantity > 0, "Qty==0");

        Asset memory input = _getAsset(_input);

        BassetData[] memory cachedBassetData = bAssetData;
        AssetData memory inputData = _transferIn(cachedBassetData, input, _inputQuantity);
        // Validation should be after token transfer, as bAssetQty is unknown before
        mintOutput = validator.computeMint(cachedBassetData, inputData.idx, inputData.amt, _getConfig());
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
    ) external nonReentrant whenInOperation returns (uint256 mintOutput) {
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
        returns (uint256 mintOutput)
    {
        require(_inputQuantity > 0, "Qty==0");

        Asset memory input = _getAsset(_input);

        if (input.exists) {
            mintOutput = validator.computeMint(bAssetData, input.idx, _inputQuantity, _getConfig());
        } else {
            uint256 esimatedMasset = IMasset(mAsset).getMintOutput(_input, _inputQuantity);
            mintOutput = validator.computeMint(bAssetData, 0, esimatedMasset, _getConfig());
        }
    }

    // /**
    //  * @dev Get the projected output of a given mint
    //  * @param _inputs            Non-duplicate address array of addresses to bAssets to deposit for the minted mAsset tokens.
    //  * @param _inputQuantities  Quantity of each bAsset to deposit for the minted mAsset.
    //  * @return mintOutput        Estimated mint output in mAsset terms
    //  */
    // function getMintMultiOutput(address[] calldata _inputs, uint256[] calldata _inputQuantities)
    //     external
    //     view
    //
    //     returns (uint256 mintOutput)
    // {
    //     uint256 len = _inputQuantities.length;
    //     require(len > 0 && len == _inputs.length, "Input array mismatch");
    //     (uint8[] memory indexes, ) = _getBassets(_inputs);
    //     return validator.computeMintMulti(bAssetData, indexes, _inputQuantities, _getConfig());
    // }

    /***************************************
              MINTING (INTERNAL)
    ****************************************/

    // Results in a deposited fAsset or mAsset, whether that is directly, or through mpAsset -> mAsset minting
    // from the main pool.
    function _transferIn(
        BassetData[] memory _cachedBassetData,
        Asset memory _input,
        uint256 _inputQuantity
    )
        internal
        returns (AssetData memory inputData)
    {
        if (_input.exists) {
            BassetPersonal memory personal = bAssetPersonal[_input.idx];
            uint256 amt =
                Manager.depositTokens(
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
    function _mpMint(
        Asset memory _input,
        uint256 _inputQuantity
    ) internal returns (AssetData memory mAssetData) {
        // TODO - handle tx fees?
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

        Asset memory input_;
        uint8[] memory indexes = new uint8[](len);
        for (uint256 i = 0; i < len; i++) {
            input_ = _getAsset(_inputs[i]);
            indexes[i] = input_.idx;
            console.log("asset: ", _inputs[i], input_.exists, indexes[i]);
            require(input_.exists, "Invalid asset");
        }
        console.log("two");
        // Load bAssets from storage into memory
        BassetData[] memory allBassets = bAssetData;
        Cache memory cache = _getCacheDetails();
        uint256[] memory quantitiesDeposited = new uint256[](len);
        // Transfer the Bassets to the integrator, update storage and calc MassetQ
        for (uint256 i = 0; i < len; i++) {
            console.log("three");
            uint256 bAssetQuantity = _inputQuantities[i];
            if (bAssetQuantity > 0) {
                uint8 idx = indexes[i];
                BassetData memory data = allBassets[idx];
                console.log("three.1", address(Manager));
                BassetPersonal memory personal = bAssetPersonal[idx];
                console.log("three.2", bAssetPersonal[idx].addr);
                uint256 quantityDeposited =
                    Manager.depositTokens(personal, data.ratio, bAssetQuantity, cache.maxCache);

                console.log("three.3", quantityDeposited);
                quantitiesDeposited[i] = quantityDeposited;
                bAssetData[idx].vaultBalance =
                    data.vaultBalance +
                    SafeCast.toUint128(quantityDeposited);
            }
        }
        console.log("four", address(validator), quantitiesDeposited[0], quantitiesDeposited[1]);
        console.log("four", address(validator), indexes[0], indexes[1]);
        console.log("four", address(validator), allBassets[0].ratio, allBassets[1].ratio);
        // Validate the proposed mint, after token transfer
        tokensMinted = validator.computeMintMulti(
            allBassets,
            indexes,
            quantitiesDeposited,
            _getConfig()
        );
        console.log("four.1");
        require(tokensMinted >= _minOutputQuantity, "Mint quantity < min qty");
        require(tokensMinted > 0, "Zero mAsset quantity");
        console.log("five");
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
    ) external returns (uint256 swapOutput) {
        // require(_recipient != address(0), "Invalid recipient");
        // require(_input != _output, "Invalid pair");
        // require(_inputQuantity > 0, "Qty==0");

        Asset memory input = _getAsset(_input);
        Asset memory output = _getAsset(_output);
        require(_pathIsValid(input, output), "Invalid pair");

        BassetData[] memory cachedBassetData = bAssetData;

        AssetData memory inputData = _transferIn(cachedBassetData, input, _inputQuantity);
        // 1. [f/mAsset ->][ f/mAsset]               : Y - normal in, SWAP, normal out
        // 3. [mpAsset -> mAsset][ -> fAsset]        : Y - mint in  , SWAP, normal out
        uint256 localFee;
        if (output.exists) {
            (swapOutput, localFee) = _swapLocal(cachedBassetData, inputData, output, _minOutputQuantity, _recipient);
        }
        // 2. [fAsset ->][ mAsset][ -> mpAsset]      : Y - normal in, SWAP, mpOut
        else {
            (swapOutput, localFee) = _swapLocal(cachedBassetData, inputData, Asset(0, mAsset, true), 0, address(this));
            swapOutput = IMasset(mAsset).redeem(output.addr, swapOutput, _minOutputQuantity, _recipient);
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
    ) external view returns (uint256 swapOutput) {
        require(_input != _output, "Invalid pair");
        require(_inputQuantity > 0, "Invalid swap quantity");

        Asset memory input = _getAsset(_input);
        Asset memory output = _getAsset(_output);
        require(_pathIsValid(input, output), "Invalid pair");

        // Internal swap between fAsset and mAsset
        if (input.exists && output.exists) {
            (swapOutput, ) = validator.computeSwap(
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
            (swapOutput, ) = validator.computeSwap(
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
            (swapOutput, ) = validator.computeSwap(
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


    function _pathIsValid(Asset memory _in, Asset memory _out) internal pure returns (bool isValid) {
        // mpAsset -> mpAsset
        if(!_in.exists && !_out.exists) return false;
        // f/mAsset -> f/mAsset
        if(_in.exists && _out.exists) return true;
        // fAsset -> mpAsset
        if(_in.exists && _in.idx == 1) return true;
        // mpAsset -> fAsset
        if(_out.exists && _out.idx == 1) return true;
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
        uint256 scaledFee;
        (swapOutput, scaledFee) = validator.computeSwap(
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
        // TODO - if recipient == address(this) then no need to transfer anything
        BassetPersonal memory outputPersonal = bAssetPersonal[_output.idx];
        Manager.withdrawTokens(
            swapOutput,
            outputPersonal,
            _cachedBassetData[_output.idx],
            _recipient,
            cache.maxCache
        );
        bAssetData[_output.idx].vaultBalance =
            _cachedBassetData[_output.idx].vaultBalance -
            SafeCast.toUint128(swapOutput);
        // Save new surplus to storage
        // TODO - re-jig the fees and increase LP token value
        // surplus = cache.surplus + scaledFee;
    }

    // /***************************************
    //             REDEMPTION (PUBLIC)
    // ****************************************/

    // /**
    //  * @notice Redeems a specified quantity of mAsset in return for a bAsset specified by bAsset address.
    //  * The bAsset is sent to the specified recipient.
    //  * The bAsset quantity is relative to current vault balance levels and desired mAsset quantity.
    //  * The quantity of mAsset is burnt as payment.
    //  * A minimum quantity of bAsset is specified to protect against price slippage between the mAsset and bAsset.
    //  * @param _output            Address of the bAsset to receive
    //  * @param _mAssetQuantity    Quantity of mAsset to redeem
    //  * @param _minOutputQuantity Minimum bAsset quantity to receive for the burnt mAssets. This protects against slippage.
    //  * @param _recipient         Address to transfer the withdrawn bAssets to.
    //  * @return outputQuantity    Quanity of bAsset units received for the burnt mAssets
    //  */
    // function redeem(
    //     address _output,
    //     uint256 _mAssetQuantity,
    //     uint256 _minOutputQuantity,
    //     address _recipient
    // ) external  nonReentrant whenInOperation returns (uint256 outputQuantity) {
    //     outputQuantity = _redeem(_output, _mAssetQuantity, _minOutputQuantity, _recipient);
    // }

    // /**
    //  * @dev Credits a recipient with a proportionate amount of bAssets, relative to current vault
    //  * balance levels and desired mAsset quantity. Burns the mAsset as payment.
    //  * @param _mAssetQuantity       Quantity of mAsset to redeem
    //  * @param _minOutputQuantities  Min units of output to receive
    //  * @param _recipient            Address to credit the withdrawn bAssets
    //  */
    // function redeemMasset(
    //     uint256 _mAssetQuantity,
    //     uint256[] calldata _minOutputQuantities,
    //     address _recipient
    // ) external  nonReentrant whenInOperation returns (uint256[] memory outputQuantities) {
    //     outputQuantities = _redeemMasset(_mAssetQuantity, _minOutputQuantities, _recipient);
    // }

    // /**
    //  * @dev Credits a recipient with a certain quantity of selected bAssets, in exchange for burning the
    //  *      relative Masset quantity from the sender. Sender also incurs a small fee on the outgoing asset.
    //  * @param _outputs           Addresses of the bAssets to receive
    //  * @param _outputQuantities  Units of the bAssets to redeem
    //  * @param _maxMassetQuantity Maximum mAsset quantity to burn for the received bAssets. This protects against slippage.
    //  * @param _recipient         Address to receive the withdrawn bAssets
    //  * @return mAssetQuantity    Quantity of mAsset units burned plus the swap fee to pay for the redeemed bAssets
    //  */
    // function redeemExactBassets(
    //     address[] calldata _outputs,
    //     uint256[] calldata _outputQuantities,
    //     uint256 _maxMassetQuantity,
    //     address _recipient
    // ) external  nonReentrant whenInOperation returns (uint256 mAssetQuantity) {
    //     mAssetQuantity = _redeemExactBassets(
    //         _outputs,
    //         _outputQuantities,
    //         _maxMassetQuantity,
    //         _recipient
    //     );
    // }

    // /**
    //  * @notice Gets the estimated output from a given redeem
    //  * @param _output            Address of the bAsset to receive
    //  * @param _mAssetQuantity    Quantity of mAsset to redeem
    //  * @return bAssetOutput      Estimated quantity of bAsset units received for the burnt mAssets
    //  */
    // function getRedeemOutput(address _output, uint256 _mAssetQuantity)
    //     external
    //     view
    //
    //     returns (uint256 bAssetOutput)
    // {
    //     require(_mAssetQuantity > 0, "Qty==0");

    //     (uint8 idx, ) = _getAsset(_output);

    //     uint256 scaledFee = _mAssetQuantity.mulTruncate(swapFee);
    //     bAssetOutput = validator.computeRedeem(
    //         bAssetData,
    //         idx,
    //         _mAssetQuantity - scaledFee,
    //         _getConfig()
    //     );
    // }

    // /**
    //  * @notice Gets the estimated output from a given redeem
    //  * @param _outputs           Addresses of the bAsset to receive
    //  * @param _outputQuantities  Quantities of bAsset to redeem
    //  * @return mAssetQuantity    Estimated quantity of mAsset units needed to burn to receive output
    //  */
    // function getRedeemExactBassetsOutput(
    //     address[] calldata _outputs,
    //     uint256[] calldata _outputQuantities
    // ) external view  returns (uint256 mAssetQuantity) {
    //     uint256 len = _outputQuantities.length;
    //     require(len > 0 && len == _outputs.length, "Invalid array input");

    //     (uint8[] memory indexes, ) = _getBassets(_outputs);

    //     // calculate the value of mAssets need to cover the value of bAssets being redeemed
    //     uint256 mAssetRedeemed =
    //         validator.computeRedeemExact(bAssetData, indexes, _outputQuantities, _getConfig());
    //     mAssetQuantity = mAssetRedeemed.divPrecisely(1e18 - swapFee) + 1;
    // }

    // /***************************************
    //             REDEMPTION (INTERNAL)
    // ****************************************/

    // /**
    //  * @dev Redeem mAsset for a single bAsset
    //  */
    // function _redeem(
    //     address _output,
    //     uint256 _inputQuantity,
    //     uint256 _minOutputQuantity,
    //     address _recipient
    // ) internal returns (uint256 bAssetQuantity) {
    //     require(_recipient != address(0), "Invalid recipient");
    //     require(_inputQuantity > 0, "Qty==0");

    //     // Load the bAsset data from storage into memory
    //     BassetData[] memory allBassets = bAssetData;
    //     (uint8 bAssetIndex, BassetPersonal memory personal) = _getAsset(_output);
    //     // Calculate redemption quantities
    //     uint256 scaledFee = _inputQuantity.mulTruncate(swapFee);
    //     bAssetQuantity = validator.computeRedeem(
    //         allBassets,
    //         bAssetIndex,
    //         _inputQuantity - scaledFee,
    //         _getConfig()
    //     );
    //     require(bAssetQuantity >= _minOutputQuantity, "bAsset qty < min qty");
    //     require(bAssetQuantity > 0, "Output == 0");
    //     // Apply fees, burn mAsset and return bAsset to recipient
    //     // 1.0. Burn the full amount of Masset
    //     _burn(msg.sender, _inputQuantity);
    //     surplus += scaledFee;
    //     Cache memory cache = _getCacheDetails();
    //     // 2.0. Transfer the Bassets to the recipient
    //     Manager.withdrawTokens(
    //         bAssetQuantity,
    //         personal,
    //         allBassets[bAssetIndex],
    //         _recipient,
    //         cache.maxCache
    //     );
    //     // 3.0. Set vault balance
    //     bAssetData[bAssetIndex].vaultBalance =
    //         allBassets[bAssetIndex].vaultBalance -
    //         SafeCast.toUint128(bAssetQuantity);

    //     emit Redeemed(
    //         msg.sender,
    //         _recipient,
    //         _inputQuantity,
    //         personal.addr,
    //         bAssetQuantity,
    //         scaledFee
    //     );
    // }

    // /**
    //  * @dev Redeem mAsset for proportional amount of bAssets
    //  */
    // function _redeemMasset(
    //     uint256 _inputQuantity,
    //     uint256[] calldata _minOutputQuantities,
    //     address _recipient
    // ) internal returns (uint256[] memory outputQuantities) {
    //     require(_recipient != address(0), "Invalid recipient");
    //     require(_inputQuantity > 0, "Qty==0");

    //     // Calculate mAsset redemption quantities
    //     uint256 scaledFee = _inputQuantity.mulTruncate(redemptionFee);
    //     uint256 mAssetRedemptionAmount = _inputQuantity - scaledFee;

    //     // Burn mAsset quantity
    //     _burn(msg.sender, _inputQuantity);
    //     surplus += scaledFee;

    //     // Calc cache and total mAsset circulating
    //     Cache memory cache = _getCacheDetails();
    //     // Total mAsset = (totalSupply + _inputQuantity - scaledFee) + surplus
    //     uint256 totalMasset = cache.vaultBalanceSum + mAssetRedemptionAmount;

    //     // Load the bAsset data from storage into memory
    //     BassetData[] memory allBassets = bAssetData;

    //     uint256 len = allBassets.length;
    //     address[] memory outputs = new address[](len);
    //     outputQuantities = new uint256[](len);
    //     for (uint256 i = 0; i < len; i++) {
    //         // Get amount out, proportionate to redemption quantity
    //         // Use `cache.sum` here as the total mAsset supply is actually totalSupply + surplus
    //         uint256 amountOut = (allBassets[i].vaultBalance * mAssetRedemptionAmount) / totalMasset;
    //         require(amountOut > 1, "Output == 0");
    //         amountOut -= 1;
    //         require(amountOut >= _minOutputQuantities[i], "bAsset qty < min qty");
    //         // Set output in array
    //         (outputQuantities[i], outputs[i]) = (amountOut, bAssetPersonal[i].addr);
    //         // Transfer the bAsset to the recipient
    //         Manager.withdrawTokens(
    //             amountOut,
    //             bAssetPersonal[i],
    //             allBassets[i],
    //             _recipient,
    //             cache.maxCache
    //         );
    //         // reduce vaultBalance
    //         bAssetData[i].vaultBalance = allBassets[i].vaultBalance - SafeCast.toUint128(amountOut);
    //     }

    //     emit RedeemedMulti(
    //         msg.sender,
    //         _recipient,
    //         _inputQuantity,
    //         outputs,
    //         outputQuantities,
    //         scaledFee
    //     );
    // }

    // /** @dev Redeem mAsset for one or more bAssets */
    // function _redeemExactBassets(
    //     address[] memory _outputs,
    //     uint256[] memory _outputQuantities,
    //     uint256 _maxMassetQuantity,
    //     address _recipient
    // ) internal returns (uint256 mAssetQuantity) {
    //     require(_recipient != address(0), "Invalid recipient");
    //     uint256 len = _outputQuantities.length;
    //     require(len > 0 && len == _outputs.length, "Invalid array input");
    //     require(_maxMassetQuantity > 0, "Qty==0");

    //     (uint8[] memory indexes, BassetPersonal[] memory personal) = _getBassets(_outputs);
    //     // Load bAsset data from storage to memory
    //     BassetData[] memory allBassets = bAssetData;
    //     // Validate redemption
    //     uint256 mAssetRequired =
    //         validator.computeRedeemExact(allBassets, indexes, _outputQuantities, _getConfig());
    //     mAssetQuantity = mAssetRequired.divPrecisely(1e18 - swapFee);
    //     uint256 fee = mAssetQuantity - mAssetRequired;
    //     require(mAssetQuantity > 0, "Must redeem some mAssets");
    //     mAssetQuantity += 1;
    //     require(mAssetQuantity <= _maxMassetQuantity, "Redeem mAsset qty > max quantity");
    //     // Apply fees, burn mAsset and return bAsset to recipient
    //     // 1.0. Burn the full amount of Masset
    //     _burn(msg.sender, mAssetQuantity);
    //     surplus += fee;
    //     Cache memory cache = _getCacheDetails();
    //     // 2.0. Transfer the Bassets to the recipient and count fees
    //     for (uint256 i = 0; i < len; i++) {
    //         uint8 idx = indexes[i];
    //         Manager.withdrawTokens(
    //             _outputQuantities[i],
    //             personal[i],
    //             allBassets[idx],
    //             _recipient,
    //             cache.maxCache
    //         );
    //         bAssetData[idx].vaultBalance =
    //             allBassets[idx].vaultBalance -
    //             SafeCast.toUint128(_outputQuantities[i]);
    //     }
    //     emit RedeemedMulti(
    //         msg.sender,
    //         _recipient,
    //         mAssetQuantity,
    //         _outputs,
    //         _outputQuantities,
    //         fee
    //     );
    // }

    /***************************************
                    GETTERS
    ****************************************/

    // /**
    //  * @dev Get basket details for `Masset_MassetStructs.Basket`
    //  * @return b   Basket struct
    //  */
    // function getBasket() external view  returns (bool, bool) {
    //     return (basket.undergoingRecol, basket.failed);
    // }

    // /**
    //  * @dev Get data for a all bAssets in basket
    //  * @return personal  Struct[] with full bAsset data
    //  * @return data      Number of bAssets in the Basket
    //  */
    // function getBassets()
    //     external
    //     view
    //
    //     returns (BassetPersonal[] memory personal, BassetData[] memory data)
    // {
    //     return (bAssetPersonal, bAssetData);
    // }

    // /**
    //  * @dev Get data for a specific bAsset, if it exists
    //  * @param _bAsset   Address of bAsset
    //  * @return personal  Struct with full bAsset data
    //  * @return data  Struct with full bAsset data
    //  */
    // function getBasset(address _bAsset)
    //     external
    //     view
    //
    //     returns (BassetPersonal memory personal, BassetData memory data)
    // {
    //     uint8 idx = bAssetIndexes[_bAsset];
    //     personal = bAssetPersonal[idx];
    //     require(personal.addr == _bAsset, "Invalid asset");
    //     data = bAssetData[idx];
    // }

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

    // function _getAssets(address[] memory _assets)
    //     internal
    //     view
    //     returns (uint8[] memory indexes, BassetPersonal[] memory personal)
    // {
    //     uint256 len = _bAssets.length;

    //     indexes = new uint8[](len);
    //     personal = new BassetPersonal[](len);

    //     for (uint256 i = 0; i < len; i++) {
    //         (, indexes[i], personal[i]) = _getAsset(_bAssets[i], true);

    //         for (uint256 j = i + 1; j < len; j++) {
    //             require(_bAssets[i] != _bAssets[j], "Duplicate asset");
    //         }
    //     }
    // }

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

    // /**
    //  * @dev Collects the interest generated from the Basket, minting a relative
    //  *      amount of mAsset and sends it over to the SavingsManager.
    //  * @return mintAmount   mAsset units generated from interest collected from lending markets
    //  * @return newSupply    mAsset total supply after mint
    //  */
    // function collectPlatformInterest()
    //     external
    //
    //     onlySavingsManager
    //     whenInOperation
    //     nonReentrant
    //     returns (uint256 mintAmount, uint256 newSupply)
    // {
    //     uint256[] memory gains;
    //     (mintAmount, gains) = Manager.collectPlatformInterest(
    //         bAssetPersonal,
    //         bAssetData,
    //         validator,
    //         _getConfig()
    //     );

    //     require(mintAmount > 0, "Must collect something");

    //     _mint(msg.sender, mintAmount);
    //     emit MintedMulti(address(this), msg.sender, mintAmount, new address[](0), gains);

    //     newSupply = totalSupply();
    // }

    /***************************************
                    STATE
    ****************************************/

    // /**
    //  * @dev Sets the MAX cache size for each bAsset. The cache will actually revolve around
    //  *      _cacheSize * totalSupply / 2 under normal circumstances.
    //  * @param _cacheSize Maximum percent of total mAsset supply to hold for each bAsset
    //  */
    // function setCacheSize(uint256 _cacheSize) external  onlyGovernor {
    //     require(_cacheSize <= 2e17, "Must be <= 20%");

    //     cacheSize = _cacheSize;

    //     emit CacheSizeChanged(_cacheSize);
    // }

    // /**
    //  * @dev Upgrades the version of validator protocol. Governor can do this
    //  *      only while validator is unlocked.
    //  * @param _newvalidator Address of the new validator
    //  */
    // function upgradevalidator(address _newvalidator) external  onlyGovernor {
    //     require(!validatorLocked, "ForgeVal locked");
    //     require(_newvalidator != address(0), "Null address");

    //     validator = IInvariantValidator(_newvalidator);

    //     emit validatorChanged(_newvalidator);
    // }

    // /**
    //  * @dev Set the ecosystem fee for sewapping bAssets or redeeming specific bAssets
    //  * @param _swapFee Fee calculated in (%/100 * 1e18)
    //  */
    // function setFees(uint256 _swapFee, uint256 _redemptionFee) external  onlyGovernor {
    //     require(_swapFee <= MAX_FEE, "Swap rate oob");
    //     require(_redemptionFee <= MAX_FEE, "Redemption rate oob");

    //     swapFee = _swapFee;
    //     redemptionFee = _redemptionFee;

    //     emit FeesChanged(_swapFee, _redemptionFee);
    // }

    // /**
    //  * @dev Set the maximum weight for a given bAsset
    //  * @param _min Weight where 100% = 1e18
    //  * @param _max Weight where 100% = 1e18
    //  */
    // function setWeightLimits(uint128 _min, uint128 _max) external onlyGovernor {
    //     require(_min <= 1e18 / (bAssetData.length * 2), "Min weight oob");
    //     require(_max >= 1e18 / (bAssetData.length - 1), "Max weight oob");

    //     weightLimits = WeightLimits(_min, _max);

    //     emit WeightLimitsChanged(_min, _max);
    // }

    // /**
    //  * @dev Update transfer fee flag for a given bAsset, should it change its fee practice
    //  * @param _bAsset   bAsset address
    //  * @param _flag         Charge transfer fee when its set to 'true', otherwise 'false'
    //  */
    // function setTransferFeesFlag(address _bAsset, bool _flag) external  onlyGovernor {
    //     Manager.setTransferFeesFlag(bAssetPersonal, bAssetIndexes, _bAsset, _flag);
    // }

    // /**
    //  * @dev Transfers all collateral from one lending market to another - used initially
    //  *      to handle the migration between Aave V1 and Aave V2. Note - only supports non
    //  *      tx fee enabled assets. Supports going from no integration to integration, but
    //  *      not the other way around.
    //  * @param _bAssets Array of basket assets to migrate
    //  * @param _newIntegration Address of the new platform integration
    //  */
    // function migrateBassets(address[] calldata _bAssets, address _newIntegration)
    //     external
    //
    //     onlyGovernor
    // {
    //     Manager.migrateBassets(bAssetPersonal, bAssetIndexes, _bAssets, _newIntegration);
    // }

    // /**
    //  * @dev Starts changing of the amplification var A
    //  * @param _targetA      Target A value
    //  * @param _rampEndTime  Time at which A will arrive at _targetA
    //  */
    // function startRampA(uint256 _targetA, uint256 _rampEndTime) external onlyGovernor {
    //     Manager.startRampA(ampData, _targetA, _rampEndTime, _getA(), A_PRECISION);
    // }

    // /**
    //  * @dev Stops the changing of the amplification var A, setting
    //  * it to whatever the current value is.
    //  */
    // function stopRampA() external onlyGovernor {
    //     Manager.stopRampA(ampData, _getA());
    // }
}
