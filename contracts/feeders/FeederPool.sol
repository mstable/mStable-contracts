// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

// External
import { IMasset } from "../interfaces/IMasset.sol";

// Internal
import "../masset/MassetStructs.sol";
import { IFeederPool } from "../interfaces/IFeederPool.sol";
import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import { InitializableToken } from "../shared/InitializableToken.sol";
import { PausableModule } from "../shared/PausableModule.sol";
import { InitializableReentrancyGuard } from "../shared/InitializableReentrancyGuard.sol";
import { IBasicToken } from "../shared/IBasicToken.sol";

// Libs
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { StableMath } from "../shared/StableMath.sol";
import { FeederManager } from "./FeederManager.sol";
import { FeederLogic } from "./FeederLogic.sol";

/**
 * @title   FeederPool
 * @author  mStable
 * @notice  Base contract for Feeder Pools (fPools). Feeder Pools are combined of 50/50 fAsset and mAsset. This supports
 *          efficient swaps into and out of mAssets and the bAssets in the mAsset basket (a.k.a mpAssets). There is 0
 *          fee to trade from fAsset into mAsset, providing low cost on-ramps into mAssets.
 * @dev     VERSION: 1.0
 *          DATE:    2021-03-01
 */
contract FeederPool is
    IFeederPool,
    Initializable,
    InitializableToken,
    PausableModule,
    InitializableReentrancyGuard
{
    using SafeERC20 for IERC20;
    using StableMath for uint256;

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
    event FeesChanged(uint256 swapFee, uint256 redemptionFee, uint256 govFee);
    event WeightLimitsChanged(uint128 min, uint128 max);

    // FeederManager Events
    event BassetsMigrated(address[] bAssets, address newIntegrator);
    event StartRampA(uint256 currentA, uint256 targetA, uint256 startTime, uint256 rampEndTime);
    event StopRampA(uint256 currentA, uint256 time);

    // Constants
    uint256 private constant MAX_FEE = 1e16;
    uint256 private constant A_PRECISION = 100;
    address public immutable override mAsset;

    // Core data storage
    FeederData public data;

    /**
     * @dev Constructor to set immutable bytecode
     * @param _nexus   Nexus address
     * @param _mAsset  Immutable mAsset address
     */
    constructor(address _nexus, address _mAsset) PausableModule(_nexus) {
        mAsset = _mAsset;
    }

    /**
     * @dev Basic initializer. Sets up core state and importantly provides infinite approvals to the mAsset pool
     * to support the cross pool swaps. bAssetData and bAssetPersonal are always ordered [mAsset, fAsset].
     * @param _nameArg     Name of the fPool token (a.k.a. fpToken)
     * @param _symbolArg   Symbol of the fPool token
     * @param _mAsset      Details on the base mAsset
     * @param _fAsset      Details on the attached fAsset
     * @param _mpAssets    Array of bAssets from the mAsset (to approve)
     * @param _config      Starting invariant config
     */
    function initialize(
        string calldata _nameArg,
        string calldata _symbolArg,
        BassetPersonal calldata _mAsset,
        BassetPersonal calldata _fAsset,
        address[] calldata _mpAssets,
        BasicConfig memory _config
    ) public initializer {
        InitializableToken._initialize(_nameArg, _symbolArg);

        _initializeReentrancyGuard();

        require(_mAsset.addr == mAsset, "mAsset incorrect");
        data.bAssetPersonal.push(
            BassetPersonal(_mAsset.addr, _mAsset.integrator, false, BassetStatus.Normal)
        );
        data.bAssetData.push(BassetData(1e8, 0));
        data.bAssetPersonal.push(
            BassetPersonal(_fAsset.addr, _fAsset.integrator, _fAsset.hasTxFee, BassetStatus.Normal)
        );
        data.bAssetData.push(
            BassetData(SafeCast.toUint128(10**(26 - IBasicToken(_fAsset.addr).decimals())), 0)
        );
        for (uint256 i = 0; i < _mpAssets.length; i++) {
            // Call will fail if bAsset does not exist
            IMasset(_mAsset.addr).getBasset(_mpAssets[i]);
            IERC20(_mpAssets[i]).safeApprove(_mAsset.addr, 2**255);
        }

        uint64 startA = SafeCast.toUint64(_config.a * A_PRECISION);
        data.ampData = AmpData(startA, startA, 0, 0);
        data.weightLimits = _config.limits;

        data.swapFee = 4e14;
        data.redemptionFee = 4e14;
        data.cacheSize = 1e17;
        data.govFee = 1e17;
    }

    /**
     * @dev System will be halted during a recollateralisation event
     */
    modifier whenInOperation() {
        _isOperational();
        _;
    }

    // Internal fn for modifier to reduce deployment size
    function _isOperational() internal view {
        require(!_paused || msg.sender == _recollateraliser(), "Unhealthy");
    }

    /**
     * @dev Verifies that the caller is the Interest Validator contract
     */
    modifier onlyInterestValidator() {
        require(nexus.getModule(KEY_INTEREST_VALIDATOR) == msg.sender, "Only validator");
        _;
    }

    /***************************************
                    MINTING
    ****************************************/

    /**
     * @notice Mint fpTokens with a single bAsset. This contract must have approval to spend the senders bAsset.
     * Supports either fAsset, mAsset or mpAsset as input - with mpAssets used to mint mAsset before depositing.
     * @param _input                Address of the bAsset to deposit.
     * @param _inputQuantity        Quantity in input token units.
     * @param _minOutputQuantity    Minimum fpToken quantity to be minted. This protects against slippage.
     * @param _recipient            Receipient of the newly minted fpTokens
     * @return mintOutput           Quantity of fpToken minted from the deposited bAsset.
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

        mintOutput = FeederLogic.mint(
            data,
            _getConfig(),
            input,
            _inputQuantity,
            _minOutputQuantity
        );

        // Mint the fpToken
        _mint(_recipient, mintOutput);
        emit Minted(msg.sender, _recipient, mintOutput, _input, _inputQuantity);
    }

    /**
     * @notice Mint fpTokens with multiple bAssets. This contract must have approval to spend the senders bAssets.
     * Supports only fAsset or mAsset as inputs.
     * @param _inputs               Address of the bAssets to deposit.
     * @param _inputQuantities      Quantity in input token units.
     * @param _minOutputQuantity    Minimum fpToken quantity to be minted. This protects against slippage.
     * @param _recipient            Receipient of the newly minted fpTokens
     * @return mintOutput           Quantity of fpToken minted from the deposited bAssets.
     */
    function mintMulti(
        address[] calldata _inputs,
        uint256[] calldata _inputQuantities,
        uint256 _minOutputQuantity,
        address _recipient
    ) external override nonReentrant whenInOperation returns (uint256 mintOutput) {
        require(_recipient != address(0), "Invalid recipient");
        uint256 len = _inputQuantities.length;
        require(len > 0 && len == _inputs.length, "Input array mismatch");

        uint8[] memory indexes = _getAssets(_inputs);
        mintOutput = FeederLogic.mintMulti(
            data,
            _getConfig(),
            indexes,
            _inputQuantities,
            _minOutputQuantity
        );
        // Mint the fpToken
        _mint(_recipient, mintOutput);
        emit MintedMulti(msg.sender, _recipient, mintOutput, _inputs, _inputQuantities);
    }

    /**
     * @notice Get the projected output of a given mint.
     * @param _input             Address of the bAsset to deposit
     * @param _inputQuantity     Quantity in bAsset units
     * @return mintOutput        Estimated mint output in fpToken terms
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
            mintOutput = FeederLogic.computeMint(
                data.bAssetData,
                input.idx,
                _inputQuantity,
                _getConfig()
            );
        } else {
            uint256 estimatedMasset = IMasset(mAsset).getMintOutput(_input, _inputQuantity);
            mintOutput = FeederLogic.computeMint(data.bAssetData, 0, estimatedMasset, _getConfig());
        }
    }

    /**
     * @notice Get the projected output of a given mint
     * @param _inputs            Non-duplicate address array of addresses to bAssets to deposit for the minted mAsset tokens.
     * @param _inputQuantities   Quantity of each bAsset to deposit for the minted fpToken.
     * @return mintOutput        Estimated mint output in fpToken terms
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
            FeederLogic.computeMintMulti(data.bAssetData, indexes, _inputQuantities, _getConfig());
    }

    /***************************************
                    SWAPPING
    ****************************************/

    /**
     * @notice Swaps two assets - either internally between fAsset<>mAsset, or between fAsset<>mpAsset by
     * first routing through the mAsset pool.
     * @param _input             Address of bAsset to deposit
     * @param _output            Address of bAsset to withdraw
     * @param _inputQuantity     Units of input bAsset to swap in
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
    ) external override nonReentrant whenInOperation returns (uint256 swapOutput) {
        require(_recipient != address(0), "Invalid recipient");
        require(_input != _output, "Invalid pair");
        require(_inputQuantity > 0, "Qty==0");

        Asset memory input = _getAsset(_input);
        Asset memory output = _getAsset(_output);
        require(_pathIsValid(input, output), "Invalid pair");

        uint256 localFee;
        (swapOutput, localFee) = FeederLogic.swap(
            data,
            _getConfig(),
            input,
            output,
            _inputQuantity,
            _minOutputQuantity,
            _recipient
        );

        uint256 govFee = data.govFee;
        if (govFee > 0) {
            data.pendingFees += ((localFee * govFee) / 1e18);
        }

        emit Swapped(msg.sender, input.addr, output.addr, swapOutput, localFee, _recipient);
    }

    /**
     * @notice Determines both if a trade is valid, and the expected fee or output.
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
        require(_inputQuantity > 0, "Qty==0");

        Asset memory input = _getAsset(_input);
        Asset memory output = _getAsset(_output);
        require(_pathIsValid(input, output), "Invalid pair");

        // Internal swap between fAsset and mAsset
        if (input.exists && output.exists) {
            (swapOutput, ) = FeederLogic.computeSwap(
                data.bAssetData,
                input.idx,
                output.idx,
                _inputQuantity,
                output.idx == 0 ? 0 : data.swapFee,
                _getConfig()
            );
            return swapOutput;
        }

        // Swapping out of fAsset
        if (input.exists) {
            // Swap into mAsset > Redeem into mpAsset
            (swapOutput, ) = FeederLogic.computeSwap(
                data.bAssetData,
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
            (swapOutput, ) = FeederLogic.computeSwap(
                data.bAssetData,
                0,
                1,
                swapOutput,
                data.swapFee,
                _getConfig()
            );
        }
    }

    /**
     * @dev Checks if a given swap path is valid. Only fAsset<>mAsset & fAsset<>mpAsset swaps are supported.
     */
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

    /***************************************
                    REDEMPTION
    ****************************************/

    /**
     * @notice Burns a specified quantity of the senders fpToken in return for a bAsset. The output amount is derived
     * from the invariant. Supports redemption into either the fAsset, mAsset or assets in the mAsset basket.
     * @param _output            Address of the bAsset to withdraw
     * @param _fpTokenQuantity   Quantity of LP Token to burn
     * @param _minOutputQuantity Minimum bAsset quantity to receive for the burnt fpToken. This protects against slippage.
     * @param _recipient         Address to transfer the withdrawn bAssets to.
     * @return outputQuantity    Quanity of bAsset units received for the burnt fpToken
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

        // Get config before burning. Config > Burn > CacheSize
        FeederConfig memory config = _getConfig();
        _burn(msg.sender, _fpTokenQuantity);

        uint256 localFee;
        (outputQuantity, localFee) = FeederLogic.redeem(
            data,
            config,
            output,
            _fpTokenQuantity,
            _minOutputQuantity,
            _recipient
        );

        uint256 govFee = data.govFee;
        if (govFee > 0) {
            data.pendingFees += ((localFee * govFee) / 1e18);
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
     * balance levels and desired fpToken quantity. Burns the fpToken as payment. Only fAsset & mAsset are supported in this path.
     * @param _inputQuantity        Quantity of fpToken to redeem
     * @param _minOutputQuantities  Min units of output to receive
     * @param _recipient            Address to credit the withdrawn bAssets
     * @return outputQuantities     Array of output asset quantities
     */
    function redeemProportionately(
        uint256 _inputQuantity,
        uint256[] calldata _minOutputQuantities,
        address _recipient
    ) external override nonReentrant whenInOperation returns (uint256[] memory outputQuantities) {
        require(_recipient != address(0), "Invalid recipient");
        require(_inputQuantity > 0, "Qty==0");

        // Get config before burning. Burn > CacheSize
        FeederConfig memory config = _getConfig();
        _burn(msg.sender, _inputQuantity);

        address[] memory outputs;
        uint256 scaledFee;
        (scaledFee, outputs, outputQuantities) = FeederLogic.redeemProportionately(
            data,
            config,
            _inputQuantity,
            _minOutputQuantities,
            _recipient
        );

        uint256 govFee = data.govFee;
        if (govFee > 0) {
            data.pendingFees += ((scaledFee * govFee) / 1e18);
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
     *      relative fpToken quantity from the sender. Only fAsset & mAsset (0,1) are supported in this path.
     * @param _outputs              Addresses of the bAssets to receive
     * @param _outputQuantities     Units of the bAssets to receive
     * @param _maxInputQuantity     Maximum fpToken quantity to burn for the received bAssets. This protects against slippage.
     * @param _recipient            Address to receive the withdrawn bAssets
     * @return fpTokenQuantity      Quantity of fpToken units burned as payment
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

        uint256 localFee;
        (fpTokenQuantity, localFee) = FeederLogic.redeemExactBassets(
            data,
            _getConfig(),
            indexes,
            _outputQuantities,
            _maxInputQuantity,
            _recipient
        );

        _burn(msg.sender, fpTokenQuantity);
        uint256 govFee = data.govFee;
        if (govFee > 0) {
            data.pendingFees += ((localFee * govFee) / 1e18);
        }

        emit RedeemedMulti(
            msg.sender,
            _recipient,
            fpTokenQuantity,
            _outputs,
            _outputQuantities,
            localFee
        );
    }

    /**
     * @notice Gets the estimated output from a given redeem
     * @param _output            Address of the bAsset to receive
     * @param _fpTokenQuantity   Quantity of fpToken to redeem
     * @return bAssetOutput      Estimated quantity of bAsset units received for the burnt fpTokens
     */
    function getRedeemOutput(address _output, uint256 _fpTokenQuantity)
        external
        view
        override
        returns (uint256 bAssetOutput)
    {
        require(_fpTokenQuantity > 0, "Qty==0");

        Asset memory output = _getAsset(_output);
        uint256 scaledFee = _fpTokenQuantity.mulTruncate(data.redemptionFee);

        bAssetOutput = FeederLogic.computeRedeem(
            data.bAssetData,
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
     * @return fpTokenQuantity   Estimated quantity of fpToken units needed to burn to receive output
     */
    function getRedeemExactBassetsOutput(
        address[] calldata _outputs,
        uint256[] calldata _outputQuantities
    ) external view override returns (uint256 fpTokenQuantity) {
        uint256 len = _outputQuantities.length;
        require(len > 0 && len == _outputs.length, "Invalid array input");

        uint8[] memory indexes = _getAssets(_outputs);

        uint256 mAssetRedeemed = FeederLogic.computeRedeemExact(
            data.bAssetData,
            indexes,
            _outputQuantities,
            _getConfig()
        );
        fpTokenQuantity = mAssetRedeemed.divPrecisely(1e18 - data.redemptionFee);
        if (fpTokenQuantity > 0) fpTokenQuantity += 1;
    }

    /***************************************
                    GETTERS
    ****************************************/

    /**
     * @notice Gets the price of the fpToken, and invariant value k
     * @return price    Price of an fpToken
     * @return k        Total value of basket, k
     */
    function getPrice() public view override returns (uint256 price, uint256 k) {
        return FeederLogic.computePrice(data.bAssetData, _getConfig());
    }

    /**
     * @notice Gets all config needed for general InvariantValidator calls
     */
    function getConfig() external view override returns (FeederConfig memory config) {
        return _getConfig();
    }

    /**
     * @notice Get data for a specific bAsset, if it exists
     * @param _bAsset     Address of bAsset
     * @return personal   Struct with personal data
     * @return vaultData  Struct with full bAsset data
     */
    function getBasset(address _bAsset)
        external
        view
        override
        returns (BassetPersonal memory personal, BassetData memory vaultData)
    {
        Asset memory asset = _getAsset(_bAsset);
        require(asset.exists, "Invalid asset");
        personal = data.bAssetPersonal[asset.idx];
        vaultData = data.bAssetData[asset.idx];
    }

    /**
     * @notice Get data for a all bAssets in basket
     * @return personal    Struct[] with full bAsset data
     * @return vaultData   Number of bAssets in the Basket
     */
    function getBassets()
        external
        view
        override
        returns (BassetPersonal[] memory, BassetData[] memory vaultData)
    {
        return (data.bAssetPersonal, data.bAssetData);
    }

    /***************************************
                GETTERS - INTERNAL
    ****************************************/

    /**
     * @dev Checks if a given asset exists in basket and return the index.
     * @return status    Data containing address, index and whether it exists in basket
     */
    function _getAsset(address _asset) internal view returns (Asset memory status) {
        // if input is mAsset then we know the position
        if (_asset == mAsset) return Asset(0, _asset, true);

        // else it exists if the position 1 is _asset
        return Asset(1, _asset, data.bAssetPersonal[1].addr == _asset);
    }

    /**
     * @dev Validates an array of input assets and returns their indexes. Assets must exist
     * in order to be valid, as mintMulti and redeemMulti do not support external bAssets.
     */
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
        return FeederConfig(totalSupply() + data.pendingFees, _getA(), data.weightLimits);
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
     * @dev Collects the interest generated from the lending markets, performing a theoretical mint, which
     * is then validated by the interest validator to protect against accidental hyper inflation.
     * @return mintAmount   fpToken units generated from interest collected from lending markets
     * @return newSupply    fpToken total supply after mint
     */
    function collectPlatformInterest()
        external
        override
        onlyInterestValidator
        whenInOperation
        nonReentrant
        returns (uint256 mintAmount, uint256 newSupply)
    {
        (uint8[] memory idxs, uint256[] memory gains) = FeederManager.calculatePlatformInterest(
            data.bAssetPersonal,
            data.bAssetData
        );
        // Calculate potential mint amount. This will be validated by the interest validator
        mintAmount = FeederLogic.computeMintMulti(data.bAssetData, idxs, gains, _getConfig());
        newSupply = totalSupply() + data.pendingFees + mintAmount;

        uint256 govFee = data.govFee;
        if (govFee > 0) {
            data.pendingFees += ((mintAmount * govFee) / 1e18);
        }

        // Dummy mint event to catch the collections here
        emit MintedMulti(address(this), msg.sender, 0, new address[](0), gains);
    }

    /**
     * @dev Collects the pending gov fees extracted from swap, redeem and platform interest.
     */
    function collectPendingFees() external override onlyInterestValidator {
        uint256 fees = data.pendingFees;
        if (fees > 1) {
            uint256 mintAmount = fees - 1;
            data.pendingFees = 1;

            _mint(msg.sender, mintAmount);
            emit MintedMulti(
                address(this),
                msg.sender,
                mintAmount,
                new address[](0),
                new uint256[](0)
            );
        }
    }

    /***************************************
                    STATE
    ****************************************/

    /**
     * @dev Sets the MAX cache size for each bAsset. The cache will actually revolve around
     *      _cacheSize * totalSupply / 2 under normal circumstances.
     * @param _cacheSize Maximum percent of total fpToken supply to hold for each bAsset
     */
    function setCacheSize(uint256 _cacheSize) external onlyGovernor {
        require(_cacheSize <= 2e17, "Must be <= 20%");

        data.cacheSize = _cacheSize;

        emit CacheSizeChanged(_cacheSize);
    }

    /**
     * @dev Set the ecosystem fee for sewapping bAssets or redeeming specific bAssets
     * @param _swapFee       Fee calculated in (%/100 * 1e18)
     * @param _redemptionFee Fee calculated in (%/100 * 1e18)
     * @param _govFee        Fee calculated in (%/100 * 1e18)
     */
    function setFees(
        uint256 _swapFee,
        uint256 _redemptionFee,
        uint256 _govFee
    ) external onlyGovernor {
        require(_swapFee <= MAX_FEE, "Swap rate oob");
        require(_redemptionFee <= MAX_FEE, "Redemption rate oob");
        require(_govFee <= 5e17, "Gov fee rate oob");

        data.swapFee = _swapFee;
        data.redemptionFee = _redemptionFee;
        data.govFee = _govFee;

        emit FeesChanged(_swapFee, _redemptionFee, _govFee);
    }

    /**
     * @dev Set the maximum weight across all bAssets
     * @param _min Weight where 100% = 1e18
     * @param _max Weight where 100% = 1e18
     */
    function setWeightLimits(uint128 _min, uint128 _max) external onlyGovernor {
        require(_min <= 3e17 && _max >= 7e17, "Weights oob");

        data.weightLimits = WeightLimits(_min, _max);

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
        onlyGovernor
    {
        FeederManager.migrateBassets(data.bAssetPersonal, _bAssets, _newIntegration);
    }

    /**
     * @dev Starts changing of the amplification var A
     * @param _targetA      Target A value
     * @param _rampEndTime  Time at which A will arrive at _targetA
     */
    function startRampA(uint256 _targetA, uint256 _rampEndTime) external onlyGovernor {
        FeederManager.startRampA(data.ampData, _targetA, _rampEndTime, _getA(), A_PRECISION);
    }

    /**
     * @dev Stops the changing of the amplification var A, setting
     * it to whatever the current value is.
     */
    function stopRampA() external onlyGovernor {
        FeederManager.stopRampA(data.ampData, _getA());
    }
}
