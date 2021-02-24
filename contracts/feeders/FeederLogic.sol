// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.0;

import "hardhat/console.sol";

import { IPlatformIntegration } from "../interfaces/IPlatformIntegration.sol";
import "../masset/MassetStructs.sol";
import { Root } from "../shared/Root.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IMasset } from "../interfaces/IMasset.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { MassetHelpers } from "../shared/MassetHelpers.sol";
import { StableMath } from "../shared/StableMath.sol";


library FeederLogic {

    using StableMath for uint256;
    using SafeERC20 for IERC20;

    uint256 internal constant A_PRECISION = 100;


    /***************************************
                    MINT
    ****************************************/

    function mint(
        FeederData storage _data,
        FeederConfig memory _config,
        Asset calldata _input,
        uint256 _inputQuantity,
        uint256 _minOutputQuantity
    ) external returns (uint256 mintOutput) {
        BassetData[] memory cachedBassetData = _data.bAssetData;
        AssetData memory inputData = _transferIn(_data, _config, cachedBassetData, _input, _inputQuantity);
        // Validation should be after token transfer, as bAssetQty is unknown before
        mintOutput = computeMint(
            cachedBassetData,
            inputData.idx,
            inputData.amt,
            _config
        );
        require(mintOutput >= _minOutputQuantity, "Mint quantity < min qty");
    }

    function mintMulti(
        FeederData storage _data,
        FeederConfig memory _config,
        uint8[] calldata _indices,
        uint256[] calldata _inputQuantities,
        uint256 _minOutputQuantity
    ) external returns (uint256 mintOutput) {
        uint256 len = _indices.length;
        uint256[] memory quantitiesDeposited = new uint256[](len);
        // Load bAssets from storage into memory
        BassetData[] memory allBassets = _data.bAssetData;
        uint256 maxCache = _getCacheDetails(_data, _config.supply);
        // Transfer the Bassets to the integrator, update storage and calc MassetQ
        for (uint256 i = 0; i < len; i++) {
            if (_inputQuantities[i] > 0) {
                uint8 idx = _indices[i];
                BassetData memory bData = allBassets[idx];
                quantitiesDeposited[i] =
                    _depositTokens(
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
        mintOutput = computeMintMulti(
            allBassets,
            _indices,
            quantitiesDeposited,
            _config
        );
        require(mintOutput >= _minOutputQuantity, "Mint quantity < min qty");
        require(mintOutput > 0, "Zero mAsset quantity");
    }


    /***************************************
                    SWAP
    ****************************************/

    function swap(
        FeederData storage _data,
        FeederConfig memory _config,
        Asset calldata _input,
        Asset calldata _output,
        uint256 _inputQuantity,
        uint256 _minOutputQuantity,
        address _recipient
    ) external returns (uint256 swapOutput, uint256 localFee) {
        BassetData[] memory cachedBassetData = _data.bAssetData;

        AssetData memory inputData = _transferIn(_data, _config, cachedBassetData, _input, _inputQuantity);
        // 1. [f/mAsset ->][ f/mAsset]               : Y - normal in, SWAP, normal out
        // 3. [mpAsset -> mAsset][ -> fAsset]        : Y - mint in  , SWAP, normal out
        if (_output.exists) {
            (swapOutput, localFee) = _swapLocal(
                _data,
                _config,
                cachedBassetData,
                inputData,
                _output,
                _minOutputQuantity,
                _recipient
            );
        }
        // 2. [fAsset ->][ mAsset][ -> mpAsset]      : Y - normal in, SWAP, mpOut
        else {
            address mAsset = _data.bAssetPersonal[0].addr;
            (swapOutput, localFee) = _swapLocal(
                _data,
                _config,
                cachedBassetData,
                inputData,
                Asset(0, mAsset, true),
                0,
                address(this)
            );
            swapOutput = IMasset(mAsset).redeem(
                _output.addr,
                swapOutput,
                _minOutputQuantity,
                _recipient
            );
        }
    }

    /***************************************
                    REDEEM
    ****************************************/

    function redeem(
        FeederData storage _data,
        FeederConfig memory _config,
        Asset calldata _output,
        uint256 _fpTokenQuantity,
        uint256 _minOutputQuantity,
        address _recipient
    ) external returns (uint256 outputQuantity, uint256 localFee) {
        if (_output.exists) {
            (outputQuantity, localFee) = _redeemLocal(
                _data,
                _config,
                _output,
                _fpTokenQuantity,
                _minOutputQuantity,
                _recipient
            );
        } else {
            address mAsset = _data.bAssetPersonal[0].addr;
            (outputQuantity, localFee) = _redeemLocal(
                _data,
                _config,
                Asset(0, mAsset, true),
                _fpTokenQuantity,
                0,
                address(this)
            );
            outputQuantity = IMasset(mAsset).redeem(
                _output.addr,
                outputQuantity,
                _minOutputQuantity,
                _recipient
            );
        }
    }

    function redeemExactBassets(
        FeederData storage _data,
        FeederConfig memory _config,
        uint8[] calldata _indices,
        uint256[] calldata _outputQuantities,
        uint256 _maxInputQuantity,
        address _recipient
    ) external returns (uint256 fpTokenQuantity, uint256 localFee) {
        // Load bAsset data from storage to memory
        BassetData[] memory allBassets = _data.bAssetData;

        // Validate redemption
        uint256 fpTokenRequired =
            computeRedeemExact(
                allBassets,
                _indices,
                _outputQuantities,
                _config
            );
        fpTokenQuantity = fpTokenRequired.divPrecisely(1e18 - _data.redemptionFee);
        localFee = fpTokenQuantity - fpTokenRequired;
        require(fpTokenQuantity > 0, "Must redeem some mAssets");
        fpTokenQuantity += 1;
        require(fpTokenQuantity <= _maxInputQuantity, "Redeem mAsset qty > max quantity");

        // Burn the full amount of Masset
        // _burn(msg.sender, fpTokenQuantity);
        uint256 maxCache = _getCacheDetails(_data, _config.supply - fpTokenQuantity);
        // Transfer the Bassets to the recipient
        for (uint256 i = 0; i < _outputQuantities.length; i++) {
            withdrawTokens(
                _outputQuantities[i],
                _data.bAssetPersonal[_indices[i]],
                allBassets[_indices[i]],
                _recipient,
                maxCache
            );
            _data.bAssetData[_indices[i]].vaultBalance =
                allBassets[_indices[i]].vaultBalance -
                SafeCast.toUint128(_outputQuantities[i]);
        }
    }

    /***************************************
                FORGING - INTERNAL
    ****************************************/

    function _transferIn(
        FeederData storage _data,
        FeederConfig memory _config,
        BassetData[] memory _cachedBassetData,
        Asset memory _input,
        uint256 _inputQuantity
    ) internal returns (AssetData memory inputData) {
        if (_input.exists) {
            BassetPersonal memory personal = _data.bAssetPersonal[_input.idx];
            uint256 amt =
                _depositTokens(
                    personal,
                    _cachedBassetData[_input.idx].ratio,
                    _inputQuantity,
                    _getCacheDetails(_data, _config.supply)
                );
            inputData = AssetData(_input.idx, amt, personal);
        } else {
            inputData = _mpMint(_data, _input, _inputQuantity);
            require(inputData.amt > 0, "Must mint something from mp");
        }
        _data.bAssetData[inputData.idx].vaultBalance =
            _cachedBassetData[inputData.idx].vaultBalance +
            SafeCast.toUint128(inputData.amt);
    }


    // mint in main pool and log balance
    function _mpMint(FeederData storage _data, Asset memory _input, uint256 _inputQuantity)
        internal
        returns (AssetData memory mAssetData)
    {
        // TODO - handle tx fees with new massethelpers fns
        // TODO - consider poking cache here?
        mAssetData = AssetData(0, 0, _data.bAssetPersonal[0]);
        IERC20(_input.addr).safeTransferFrom(msg.sender, address(this), _inputQuantity);
        uint256 balBefore = IERC20(mAssetData.personal.addr).balanceOf(address(this));
        IMasset(mAssetData.personal.addr).mint(_input.addr, _inputQuantity, 0, address(this));
        uint256 balAfter = IERC20(mAssetData.personal.addr).balanceOf(address(this));
        mAssetData.amt = balAfter - balBefore;
    }

    function _swapLocal(
        FeederData storage _data,
        FeederConfig memory _config,
        BassetData[] memory _cachedBassetData,
        AssetData memory _inputData,
        Asset memory _output,
        uint256 _minOutputQuantity,
        address _recipient
    ) internal returns (uint256 swapOutput, uint256 scaledFee) {
        // Validate the swap
        (swapOutput, scaledFee) = computeSwap(
            _cachedBassetData,
            _inputData.idx,
            _output.idx,
            _inputData.amt,
            _output.idx == 0 ? 0 : _data.swapFee,
            _config
        );
        require(swapOutput >= _minOutputQuantity, "Output qty < minimum qty");
        require(swapOutput > 0, "Zero output quantity");
        // Settle the swap
        // Decrease output bal
        BassetPersonal memory outputPersonal = _data.bAssetPersonal[_output.idx];
        withdrawTokens(
            swapOutput,
            outputPersonal,
            _cachedBassetData[_output.idx],
            _recipient,
            _getCacheDetails(_data, _config.supply)
        );
        _data.bAssetData[_output.idx].vaultBalance =
            _cachedBassetData[_output.idx].vaultBalance -
            SafeCast.toUint128(swapOutput);
    }


    function _redeemLocal(
        FeederData storage _data,
        FeederConfig memory _config,
        Asset memory _output,
        uint256 _fpTokenQuantity,
        uint256 _minOutputQuantity,
        address _recipient
    ) internal returns (uint256 outputQuantity, uint256 scaledFee) {
        BassetData[] memory allBassets = _data.bAssetData;
        // Calculate redemption quantities
        scaledFee = _fpTokenQuantity.mulTruncate(_data.redemptionFee);
        outputQuantity = computeRedeem(
            allBassets,
            _output.idx,
            _fpTokenQuantity - scaledFee,
            _config
        );
        require(outputQuantity >= _minOutputQuantity, "bAsset qty < min qty");
        require(outputQuantity > 0, "Output == 0");

        // Transfer the Bassets to the recipient
        withdrawTokens(
            outputQuantity,
            _data.bAssetPersonal[_output.idx],
            allBassets[_output.idx],
            _recipient,
            _getCacheDetails(_data, _config.supply - _fpTokenQuantity)
        );
        // Set vault balance
        _data.bAssetData[_output.idx].vaultBalance =
            allBassets[_output.idx].vaultBalance -
            SafeCast.toUint128(outputQuantity);
    }


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
    function withdrawTokens(
        uint256 _quantity,
        BassetPersonal memory _personal,
        BassetData memory _data,
        address _recipient,
        uint256 _maxCache
    ) internal {
        if (_quantity == 0) return;

        // 1.0 If there is no integrator, send from here
        if (_personal.integrator == address(0)) {
            if (_recipient == address(this)) return;
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



    /***************************************
                GETTERS - INTERNAL
    ****************************************/

    function _getCacheDetails(FeederData storage _data, uint256 _supply) internal view returns (uint256 maxCache) {
        maxCache = _supply * _data.cacheSize / 1e18;
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
     * @param _config       Generalised FeederConfig stored internally
     * @return mintAmount   Quantity of mAssets minted
     */
    function computeMint(
        BassetData[] memory _bAssets,
        uint8 _i,
        uint256 _rawInput,
        FeederConfig memory _config
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
     * @param _config       Generalised FeederConfig stored internally
     * @return mintAmount   Quantity of mAssets minted
     */
    function computeMintMulti(
        BassetData[] memory _bAssets,
        uint8[] memory _indices,
        uint256[] memory _rawInputs,
        FeederConfig memory _config
    ) public view returns (uint256 mintAmount) {
        console.log("Validator: mintMulti");
        // 1. Get raw reserves
        (uint256[] memory x, uint256 sum) = _getReserves(_bAssets);
        console.log("Validator: mintMulti 1");
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
        console.log("Validator: mintMulti 2");
        // 4. Finalise mint
        require(_inBounds(x, sum, _config.limits), "Exceeds weight limits");
        console.log("Validator: mintMulti 3");
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
     * @param _config       Generalised FeederConfig stored internally
     * @return bAssetOutputQuantity   Raw bAsset output quantity
     * @return scaledSwapFee          Swap fee collected, in mAsset terms
     */
    function computeSwap(
        BassetData[] memory _bAssets,
        uint8 _i,
        uint8 _o,
        uint256 _rawInput,
        uint256 _feeRate,
        FeederConfig memory _config
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
        uint256 k1 = _invariant(x, sum, _config.a);
        scaledSwapFee = ((k1 - k0) * _feeRate) / 1e18;
        // 5. Calc output bAsset
        uint256 newOutputReserve = _solveInvariant(x, _config.a, _o, k0 + scaledSwapFee);
        uint256 output = x[_o] - newOutputReserve - 1;
        bAssetOutputQuantity = (output * 1e8) / _bAssets[_o].ratio;
        // 6. Check for bounds
        x[_o] -= output;
        sum -= output;
        require(_inBounds(x, sum, _config.limits), "Exceeds weight limits");
    }

    /**
     * @notice Compute the amount of bAsset index `i` received for
     * redeeming `quantity` amount of mAsset.
     * @param _bAssets              Array of all bAsset Data
     * @param _o                    Index of output bAsset
     * @param _netMassetQuantity    Net amount of mAsset to redeem
     * @param _config               Generalised FeederConfig stored internally
     * @return rawOutputUnits       Raw bAsset output returned
     */
    function computeRedeem(
        BassetData[] memory _bAssets,
        uint8 _o,
        uint256 _netMassetQuantity,
        FeederConfig memory _config
    ) public view returns (uint256 rawOutputUnits) {
        // 1. Get raw reserves
        (uint256[] memory x, uint256 sum) = _getReserves(_bAssets);
        // 2. Get value of reserves according to invariant
        uint256 k0 = _invariant(x, sum, _config.a);
        uint256 kFinal = (k0 * (_config.supply - _netMassetQuantity)) / _config.supply;
        // 3. Compute bAsset output
        uint256 newOutputReserve = _solveInvariant(x, _config.a, _o, kFinal);
        uint256 output = x[_o] - newOutputReserve - 1;
        rawOutputUnits = (output * 1e8) / _bAssets[_o].ratio;
        // 4. Check for max weight
        x[_o] -= output;
        sum -= output;
        require(_inBounds(x, sum, _config.limits), "Exceeds weight limits");
    }

    /**
     * @notice Compute the amount of mAsset required to redeem
     * a given selection of bAssets.
     * @param _bAssets          Array of all bAsset Data
     * @param _indices          Indexes of output bAssets
     * @param _rawOutputs       Desired raw bAsset outputs
     * @param _config           Generalised FeederConfig stored internally
     * @return totalmAssets     Amount of mAsset required to redeem bAssets
     */
    function computeRedeemExact(
        BassetData[] memory _bAssets,
        uint8[] memory _indices,
        uint256[] memory _rawOutputs,
        FeederConfig memory _config
    ) public view returns (uint256 totalmAssets) {
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
        totalmAssets = (_config.supply * (k0 - k1)) / k0;
    }

    /***************************************
                    INTERNAL
    ****************************************/

    /**
     * @dev Computes the actual mint output after adding mint inputs
     * to the vault balances
     * @param _x            Scaled vaultBalances
     * @param _sum          Sum of vaultBalances, to avoid another loop
     * @param _k            Previous value of invariant, k, before addition
     * @param _config       Generalised FeederConfig stored internally
     * @return mintAmount   Amount of value added to invariant, in mAsset terms
     */
    function _computeMintOutput(
        uint256[] memory _x,
        uint256 _sum,
        uint256 _k,
        FeederConfig memory _config
    ) internal view returns (uint256 mintAmount) {
        // 1. Get value of reserves according to invariant
        uint256 kFinal = _invariant(_x, _sum, _config.a);
        // 2. Total minted is the difference between values, with respect to total supply
        if (_config.supply == 0) {
            mintAmount = kFinal - _k;
        } else {
            mintAmount = (_config.supply * (kFinal - _k)) / _k;
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
    ) internal view returns (bool inBounds) {
        uint256 len = _x.length;
        inBounds = true;
        uint256 w;
        console.log("min: ", _limits.min, " max :", _limits.max);
        for (uint256 i = 0; i < len; i++) {
            w = (_x[i] * 1e18) / _sum;
            console.log("weight", i, w);
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
