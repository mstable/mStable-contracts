pragma solidity 0.5.16;
pragma experimental ABIEncoderV2;

import { IForgeValidator, MassetStructs } from "./IForgeValidator.sol";
import { StableMath } from "../../shared/StableMath.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";

/**
 * @title   ForgeValidator
 * @author  Stability Labs Pty. Ltd.
 * @notice  Calculates whether or not minting or redemption is valid, based
 *          on how it affects the underlying basket collateral weightings
 * @dev     VERSION: 1.1
 *          DATE:    2020-06-22
 */
contract ForgeValidator is IForgeValidator {

    using SafeMath for uint256;
    using StableMath for uint256;

    /***************************************
                    MINT
    ****************************************/

    /**
     * @notice Checks whether a given mint is valid and returns the result
     * @dev Is the resulting weighting of the max bAsset beyond it's implicit max weight?
     * Max weight is determined as max weight (in units)
     * @param _totalVault       Current sum of basket collateral
     * @param _bAsset           Struct containing relevant data on the bAsset
     * @param _bAssetQuantity   Number of bAsset units that will be used to mint
     * @return isValid          Bool to signify that the mint does not move our weightings the wrong way
     * @return reason           If the mint is invalid, this is the reason
     */
    function validateMint(
        uint256 _totalVault,
        Basset calldata _bAsset,
        uint256 _bAssetQuantity
    )
        external
        pure
        returns (bool isValid, string memory reason)
    {
        if(
            _bAsset.status == BassetStatus.BrokenBelowPeg ||
            _bAsset.status == BassetStatus.Liquidating ||
            _bAsset.status == BassetStatus.Blacklisted
        ) {
            return (false, "bAsset not allowed in mint");
        }

        // How much mAsset is this _bAssetQuantity worth?
        uint256 mintAmountInMasset = _bAssetQuantity.mulRatioTruncate(_bAsset.ratio);
        // How much of this bAsset do we have in the vault, in terms of mAsset?
        uint256 newBalanceInMasset = _bAsset.vaultBalance.mulRatioTruncate(_bAsset.ratio).add(mintAmountInMasset);
        // What is the max weight of this bAsset in the basket?
        uint256 maxWeightInUnits = (_totalVault.add(mintAmountInMasset)).mulTruncate(_bAsset.maxWeight);

        if(newBalanceInMasset > maxWeightInUnits) {
            return (false, "bAssets used in mint cannot exceed their max weight");
        }

        return (true, "");
    }

    /**
     * @notice Checks whether a given mint using more than one asset is valid and returns the result
     * @dev Is the resulting weighting of the max bAssets beyond their implicit max weight?
     * Max weight is determined as max weight (in units)
     * @param _totalVault       Current sum of basket collateral
     * @param _bAssets          Array of Struct containing relevant data on the bAssets
     * @param _bAssetQuantities Number of bAsset units that will be used to mint (aligned with above)
     * @return isValid          Bool to signify that the mint does not move our weightings the wrong way
     * @return reason           If the mint is invalid, this is the reason
     */
    function validateMintMulti(
        uint256 _totalVault,
        Basset[] calldata _bAssets,
        uint256[] calldata _bAssetQuantities
    )
        external
        pure
        returns (bool isValid, string memory reason)
    {
        uint256 bAssetCount = _bAssets.length;
        if(bAssetCount != _bAssetQuantities.length) return (false, "Input length should be equal");

        uint256[] memory newBalances = new uint256[](bAssetCount);
        uint256 newTotalVault = _totalVault;

        // Theoretically add the mint quantities to the vault
        for(uint256 j = 0; j < bAssetCount; j++){
            Basset memory b = _bAssets[j];
            BassetStatus bAssetStatus = b.status;

            if(
                bAssetStatus == BassetStatus.BrokenBelowPeg ||
                bAssetStatus == BassetStatus.Liquidating ||
                bAssetStatus == BassetStatus.Blacklisted
            ) {
                return (false, "bAsset not allowed in mint");
            }

            // How much mAsset is this bassetquantity worth?
            uint256 mintAmountInMasset = _bAssetQuantities[j].mulRatioTruncate(b.ratio);
            // How much of this bAsset do we have in the vault, in terms of mAsset?
            newBalances[j] = b.vaultBalance.mulRatioTruncate(b.ratio).add(mintAmountInMasset);

            newTotalVault = newTotalVault.add(mintAmountInMasset);
        }

        for(uint256 k = 0; k < bAssetCount; k++){
            // What is the max weight of this bAsset in the basket?
            uint256 maxWeightInUnits = newTotalVault.mulTruncate(_bAssets[k].maxWeight);

            if(newBalances[k] > maxWeightInUnits) {
                return (false, "bAssets used in mint cannot exceed their max weight");
            }
        }

        return (true, "");
    }

    /***************************************
                    SWAP
    ****************************************/

    /**
     * @notice Checks whether a given swap is valid and calculates the output
     * @dev Input bAsset must not exceed max weight, output bAsset must have sufficient liquidity
     * @param _totalVault       Current sum of basket collateral
     * @param _inputBasset      Input bAsset details
     * @param _outputBasset     Output bAsset details
     * @param _quantity         Number of bAsset units on the input side
     * @return isValid          Bool to signify that the mint does not move our weightings the wrong way
     * @return reason           If the swap is invalid, this is the reason
     * @return output           Units of output bAsset, before fee is applied
     * @return applySwapFee     Bool to signify that the swap fee is applied
     */
    function validateSwap(
        uint256 _totalVault,
        Basset calldata _inputBasset,
        Basset calldata _outputBasset,
        uint256 _quantity
    )
        external
        pure
        returns (bool isValid, string memory reason, uint256 output, bool applySwapFee)
    {
        if(_inputBasset.status != BassetStatus.Normal || _outputBasset.status != BassetStatus.Normal) {
            return (false, "bAsset not allowed in swap", 0, false);
        }

        // How much mAsset is this _bAssetQuantity worth?
        uint256 inputAmountInMasset = _quantity.mulRatioTruncate(_inputBasset.ratio);

        // 1. Determine output bAsset valid
        //  - Enough units in the bank
        uint256 outputAmount = inputAmountInMasset.divRatioPrecisely(_outputBasset.ratio);
        if(outputAmount > _outputBasset.vaultBalance) {
            return (false, "Not enough liquidity", 0, false);
        }

        // 1.1. If it is currently overweight, then no fee
        applySwapFee = true;
        uint256 outputBalanceMasset = _outputBasset.vaultBalance.mulRatioTruncate(_outputBasset.ratio);
        uint256 outputMaxWeightUnits = _totalVault.mulTruncate(_outputBasset.maxWeight);
        if(outputBalanceMasset > outputMaxWeightUnits) {
            applySwapFee = false;
        }

        // 2. Calculate input bAsset valid - If incoming basket goes above weight, then fail
        // How much of this bAsset do we have in the vault, in terms of mAsset?
        uint256 newInputBalanceInMasset = _inputBasset.vaultBalance.mulRatioTruncate(_inputBasset.ratio).add(inputAmountInMasset);
        // What is the max weight of this bAsset in the basket?
        uint256 inputMaxWeightInUnits = _totalVault.mulTruncate(_inputBasset.maxWeight);
        if(newInputBalanceInMasset > inputMaxWeightInUnits) {
            return (false, "Input must remain below max weighting", 0, false);
        }

        // 3. Return swap output
        return (true, "", outputAmount, applySwapFee);
    }


    /***************************************
                    REDEEM
    ****************************************/

    /**
     * @notice Checks whether a given redemption is valid and returns the result
     * @dev A redemption is valid if it does not push any untouched bAssets above their
     * max weightings. In addition, if bAssets are currently above their max weight
     * (i.e. during basket composition changes) they must be redeemed
     * @param _basketIsFailed   Bool to suggest that the basket has failed a recollateralisation attempt
     * @param _totalVault       Sum of collateral units in the basket
     * @param _allBassets       Array of all bAsset information
     * @param _indices          Indexes of the bAssets to redeem
     * @param _bAssetQuantities Quantity of bAsset to redeem
     * @return isValid          Bool to signify that the redemption is allowed
     * @return reason           If the redemption is invalid, this is the reason
     * @return feeRequired      Does this redemption require the swap fee to be applied
     */
    function validateRedemption(
        bool _basketIsFailed,
        uint256 _totalVault,
        Basset[] calldata _allBassets,
        uint8[] calldata _indices,
        uint256[] calldata _bAssetQuantities
    )
        external
        pure
        returns (bool, string memory, bool)
    {
        uint256 idxCount = _indices.length;
        if(idxCount != _bAssetQuantities.length) return (false, "Input arrays must have equal length", false);

        // Get current weightings, and cache some outputs from the loop to avoid unecessary recursion
        BasketStateResponse memory data = _getBasketState(_totalVault, _allBassets);
        if(!data.isValid) return (false, data.reason, false);

        // If the basket is in an affected state, enforce proportional redemption
        if(
            _basketIsFailed ||
            data.atLeastOneBroken
        ) {
            return (false, "Must redeem proportionately", false);
        } else if (data.overWeightCount > idxCount) {
            return (false, "Redemption must contain all overweight bAssets", false);
        }

        uint256 newTotalVault = _totalVault;

        // Simulate the redemption on the ratioedBassetVaults and totalSupply
        for(uint256 i = 0; i < idxCount; i++){
            uint8 idx = _indices[i];
            if(idx >= _allBassets.length) return (false, "Basset does not exist", false);

            Basset memory bAsset = _allBassets[idx];
            uint256 quantity = _bAssetQuantities[i];
            if(quantity > bAsset.vaultBalance) return (false, "Cannot redeem more bAssets than are in the vault", false);

            // Calculate ratioed redemption amount in mAsset terms
            uint256 ratioedRedemptionAmount = quantity.mulRatioTruncate(bAsset.ratio);
            // Subtract ratioed redemption amount from both vault and total supply
            data.ratioedBassetVaults[idx] = data.ratioedBassetVaults[idx].sub(ratioedRedemptionAmount);

            newTotalVault = newTotalVault.sub(ratioedRedemptionAmount);
        }

        // Get overweight after
        bool atLeastOneBecameOverweight =
            _getOverweightBassetsAfter(newTotalVault, _allBassets, data.ratioedBassetVaults, data.isOverWeight);

        bool applySwapFee = true;
        // If there are any bAssets overweight, we must redeem them all
        if(data.overWeightCount > 0) {
            for(uint256 j = 0; j < idxCount; j++) {
                if(!data.isOverWeight[_indices[j]]) return (false, "Must redeem overweight bAssets", false);
            }
            applySwapFee = false;
        }
        // Since no bAssets were overweight before, if one becomes overweight, throw
        if(atLeastOneBecameOverweight) return (false, "bAssets must remain below max weight", false);

        return (true, "", applySwapFee);
    }

    /**
     * @notice Calculates the relative quantities of bAssets to redeem, with current basket state
     * @dev Sum the value of the bAssets, and then find the proportions relative to the desired
     * mAsset quantity.
     * @param _mAssetQuantity   Quantity of mAsset to redeem
     * @param _allBassets       Array of all bAsset information
     * @return isValid          Bool to signify that the redemption is allowed
     * @return reason           If the redemption is invalid, this is the reason
     * @return quantities       Array of bAsset quantities to redeem
     */
    function calculateRedemptionMulti(
        uint256 _mAssetQuantity,
        Basset[] calldata _allBassets
    )
        external
        pure
        returns (bool, string memory, uint256[] memory)
    {
        // e.g. mAsset = 1e20 (100)
        // e.g. bAsset: [   A,   B,    C,    D]
        // e.g. vaults: [  80,  60,   60,    0]
        // e.g. ratio:  [1e12, 1e8, 1e20, 1e18]
        // expectedM:    4e19 3e19  3e19     0
        // expectedB:    4e15 3e19   3e7     0
        uint256 len = _allBassets.length;
        uint256[] memory redeemQuantities = new uint256[](len);
        uint256[] memory ratioedBassetVaults = new uint256[](len);
        uint256 totalBassetVault = 0;
        // 1. Add up total vault & ratioedBassets, fail if blacklisted
        for(uint256 i = 0; i < len; i++) {
            if(_allBassets[i].status == BassetStatus.Blacklisted) {
                return (false, "Basket contains blacklisted bAsset", redeemQuantities);
            } else if(_allBassets[i].status == BassetStatus.Liquidating) {
                return (false, "Basket contains liquidating bAsset", redeemQuantities);
            }
            // e.g. (80e14 * 1e12) / 1e8 = 80e18
            // e.g. (60e18 * 1e8) / 1e8 = 60e18
            uint256 ratioedBasset = _allBassets[i].vaultBalance.mulRatioTruncate(_allBassets[i].ratio);
            ratioedBassetVaults[i] = ratioedBasset;
            totalBassetVault = totalBassetVault.add(ratioedBasset);
        }
        if(totalBassetVault == 0) return (false, "Nothing in the basket to redeem", redeemQuantities);
        if(_mAssetQuantity > totalBassetVault) return (false, "Not enough liquidity", redeemQuantities);
        // 2. Calculate proportional weighting & non-ratioed amount
        for(uint256 i = 0; i < len; i++) {
            // proportional weighting
            // e.g. (8e19 * 1e18) / 2e20 = 8e37 / 2e20 = 4e17 (40%)
            uint256 percentageOfVault = ratioedBassetVaults[i].divPrecisely(totalBassetVault);
            // e.g. (1e20 * 4e17) / 1e18 = 4e37 / 1e18 = 4e19 (40)
            uint256 ratioedProportionalBasset = _mAssetQuantity.mulTruncate(percentageOfVault);
            // convert back to bAsset amount
             // e.g. (4e19 * 1e8) / 1e12 = 4e27 / 1e12 = 4e15
            redeemQuantities[i] = ratioedProportionalBasset.divRatioPrecisely(_allBassets[i].ratio);
        }
        // 3. Return
        return (true, "", redeemQuantities);
    }

    /***************************************
                    HELPERS
    ****************************************/

    struct BasketStateResponse {
        bool isValid;
        string reason;
        bool atLeastOneBroken;
        uint256 overWeightCount;
        bool[] isOverWeight;
        uint256[] ratioedBassetVaults;
    }

    /**
     * @dev Gets the currently overweight bAssets, and capitalises on the for loop to
     * produce some other useful data. Loops through, validating the bAsset, and determining
     * if it is overweight, returning the ratioed bAsset.
     * @param _total         Sum of collateral units in the basket
     * @param _bAssets       Array of all bAsset information
     * @return response      Struct containing calculated data
     */
    function _getBasketState(uint256 _total, Basset[] memory _bAssets)
        private
        pure
        returns (BasketStateResponse memory response)
    {
        uint256 len = _bAssets.length;
        response = BasketStateResponse({
            isValid: true,
            reason: "",
            atLeastOneBroken: false,
            overWeightCount: 0,
            isOverWeight: new bool[](len),
            ratioedBassetVaults: new uint256[](len)
        });

        for(uint256 i = 0; i < len; i++) {
            BassetStatus status = _bAssets[i].status;
            if(status == BassetStatus.Blacklisted) {
                response.isValid = false;
                response.reason = "Basket contains blacklisted bAsset";
                return response;
            } else if(
                status == BassetStatus.Liquidating ||
                status == BassetStatus.BrokenBelowPeg ||
                status == BassetStatus.BrokenAbovePeg
            ) {
                response.atLeastOneBroken = true;
            }

            uint256 ratioedBasset = _bAssets[i].vaultBalance.mulRatioTruncate(_bAssets[i].ratio);
            response.ratioedBassetVaults[i] = ratioedBasset;
            uint256 maxWeightInUnits = _total.mulTruncate(_bAssets[i].maxWeight);

            bool bAssetOverWeight = ratioedBasset > maxWeightInUnits;
            if(bAssetOverWeight){
                response.isOverWeight[i] = true;
                response.overWeightCount += 1;
            }
        }
    }

    /**
     * @dev After the redeemed bAssets have been removed from the basket, determine
     * if there are any resulting overweight, or underweight
     * @param _newTotal                 Sum of collateral units in the basket
     * @param _bAssets                  Array of all bAsset information
     * @param _ratioedBassetVaultsAfter Array of all new bAsset vaults
     * @param _previouslyOverWeight     Array of bools - was this bAsset already overweight
     * @return underWeight              Array of bools - is this bAsset now under min weight
     */
    function _getOverweightBassetsAfter(
        uint256 _newTotal,
        Basset[] memory _bAssets,
        uint256[] memory _ratioedBassetVaultsAfter,
        bool[] memory _previouslyOverWeight
    )
        private
        pure
        returns (bool atLeastOneBecameOverweight)
    {
        uint256 len = _ratioedBassetVaultsAfter.length;

        for(uint256 i = 0; i < len; i++) {
            uint256 maxWeightInUnits = _newTotal.mulTruncate(_bAssets[i].maxWeight);

            bool isOverweight = _ratioedBassetVaultsAfter[i] > maxWeightInUnits;
            // If it was not previously overweight, and now it, then it became overweight
            bool becameOverweight = !_previouslyOverWeight[i] && isOverweight;
            atLeastOneBecameOverweight = atLeastOneBecameOverweight || becameOverweight;
        }
    }
}
