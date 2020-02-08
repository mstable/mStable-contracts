pragma solidity ^0.5.12;
pragma experimental ABIEncoderV2;

import { IForgeValidator, MassetStructs } from "./IForgeValidator.sol";
import { StableMath } from "../../shared/math/StableMath.sol";

/**
  * @title ForgeValidator
  * @dev Contract responsible for validating that the Forging of a particular bAsset set is allowed
  */
contract ForgeValidator is IForgeValidator {

    using StableMath for uint256;

    /**
      * @dev Checks whether a given mint is valid
      */
    function validateMint(uint256 _totalVault, Basset memory _basset, uint256 _bassetQuantity)
    public
    pure {
        require(_basset.status != BassetStatus.BrokenBelowPeg &&
            _basset.status != BassetStatus.Liquidating, "Basset not allowed in mint");

        // How much mAsset is this _bassetQuantity worth?
        uint256 mintAmountInMasset = _bassetQuantity.mulRatioTruncate(_basset.ratio);
        // How much of this bAsset do we have in the vault, in terms of mAsset?
        uint256 newBalanceInMasset = _basset.vaultBalance.mulRatioTruncate(_basset.ratio).add(mintAmountInMasset);
        // What is the percentage of this bAsset in the basket?
        uint256 weighting = newBalanceInMasset.divPrecisely(_totalVault.add(mintAmountInMasset));

        require(weighting <= _basset.maxWeight, "Must be below max weighting");
    }

    /**
      * @dev Checks whether a given mint is valid
      */
    function validateMint(uint256 _totalVault, Basset[] memory _bassets, uint256[] memory _bassetQuantity)
    public
    pure {
        uint256 bassetCount = _bassets.length;
        require(bassetCount == _bassetQuantity.length, "indexes & _bAssetQty length should be equal");

        uint256[] memory newBalances = new uint256[](bassetCount);
        uint256 newTotalVault = _totalVault;

        // Theoretically add the mint quantities to the vault
        for(uint j = 0; j < bassetCount; j++){
            Basset memory b = _bassets[j];
            BassetStatus bAssetStatus = b.status;

            require(bAssetStatus != BassetStatus.BrokenBelowPeg && bAssetStatus != BassetStatus.Liquidating, "Basset not allowed in mint");

            // How much mAsset is this _bassetQuantity worth?
            uint256 mintAmountInMasset = _bassetQuantity[j].mulRatioTruncate(b.ratio);
            // How much of this bAsset do we have in the vault, in terms of mAsset?
            newBalances[j] = b.vaultBalance.mulRatioTruncate(b.ratio).add(mintAmountInMasset);

            newTotalVault = newTotalVault.add(mintAmountInMasset);
        }

        for(uint k = 0; k < bassetCount; k++){
            // What is the percentage of this bAsset in the basket?
            uint256 weighting = newBalances[k].divPrecisely(newTotalVault);

            require(weighting <= _bassets[k].maxWeight, "Must be below max weighting");
        }
    }

    /**
      * @dev Checks whether a given redemption is valid
      * @param _bassets          Array of bassets
      * @param _bassetQuantity  Array of basset quantities to use in the redemption
      */
    function validateRedemption(bool isBasketFailed, Basset[] memory _bassets, uint256[] memory _bassetQuantity)
    public
    pure {
        uint256 bassetCount = _bassets.length;
        require(_bassetQuantity.length == bassetCount, "Must provide values for all Bassets in system");

        uint256 bassetsToRedeem = 0;
        uint256 isolatedBassets = 0;
        uint256 totalIsolatedWeightings = 0;

        // Reformat basket to exclude affected Bassets and allow for relative calculations
        for(uint i = 0; i < bassetCount; i++){
            BassetStatus status = _bassets[i].status;
            require(status != BassetStatus.Liquidating, "Basket cannot be undergoing liquidation");
            bool isIsolated = isBasketFailed ? false : status == BassetStatus.BrokenAbovePeg;
            if(isIsolated){
                // If the Basset is supposed to be isolated from redemtion, ignore it from the basket
                require(_bassetQuantity[i] == 0, "Cannot redeem isolated Bassets");

                // Total the Isolated weightings and redistribute to non-affected assets
                isolatedBassets += 1;
                totalIsolatedWeightings = totalIsolatedWeightings.add(_bassets[i].maxWeight);

                _bassets[i].maxWeight = 0;
                _bassets[i].vaultBalance = 0;
            } else if (_bassetQuantity[i] > 0) {
                bassetsToRedeem += 1;
                require(_bassets[i].vaultBalance >= _bassetQuantity[i], "Vault must have sufficient balance to redeem");
            }
        }

        require(bassetsToRedeem > 0, "Must choose some Bassets to redeem");

        uint256[] memory preBassets = _getBassetWeightings(_bassets);

        bool isInAdjustment = false;

        // If totalIsolatedWeightings = 80e16, and there are 2 bassets un-isolated - given them 40 each
        uint256 redistributedWeighting = isolatedBassets > 0 ? totalIsolatedWeightings.div(bassetCount.sub(isolatedBassets)) : 0;
        for (uint k = 0; k < bassetCount; k++) {
            uint maxWeight = _bassets[k].maxWeight.add(redistributedWeighting);
            isInAdjustment = isInAdjustment || preBassets[k] > maxWeight;
        }

        // Theoretically redeem the bassets from the vault
        for (uint j = 0; j < bassetCount; j++) {
            _bassets[j].vaultBalance = _bassets[j].vaultBalance.sub(_bassetQuantity[j]);
        }

        uint256[] memory postBassets = _getBassetWeightings(_bassets);

        // Check that the forge is valid, given the relative target weightings and vault balances
        // isInAdjustment?
        //     Bassets redeemed must be overweight
        //     Note, there is an edge case where redeeming these Bassets may push others above weightings, however
        //     it is a side effect of simplicity
        // no
        //     all unredeemed bassets must remain underweight
        for (uint m = 0; m < bassetCount; m++){
            uint maxWeight = _bassets[m].maxWeight.add(redistributedWeighting);
            if(isInAdjustment){
                if(_bassetQuantity[m] > 0) {
                    require(preBassets[m] > maxWeight, "Redeemed Bassets must be overweight during adjustments");
                }
            } else {
                require(postBassets[m] <= maxWeight, "Unredeemed bassets must stay below max weighting");
            }
        }
    }


    /***************************************
                    HELPERS
    ****************************************/

    /**
      * @dev Gets the proportionate weightings of all the Bassets, relative to Total Collateral levels
      * @param _bassets Array of bassets
      * @return uint256[] Relative weightings of all Bassets where 100% == 1e18
      */
    function _getBassetWeightings(Basset[] memory _bassets)
    private
    pure
    returns (uint256[] memory relativeWeights) {
        uint256[] memory ratioedBassets = _getRatioedBassets(_bassets);

        uint256 sumOfRatioedBassets = 0;
        for(uint i = 0; i < ratioedBassets.length; i++) {
            sumOfRatioedBassets = sumOfRatioedBassets.add(ratioedBassets[i]);
        }

        uint256 len = ratioedBassets.length;
        relativeWeights = new uint256[](len);

        for(uint256 i = 0; i < len; i++) {
            if(sumOfRatioedBassets == 0){
                relativeWeights[i] = _bassets[i].maxWeight;
                continue;
            }
            if(ratioedBassets[i] == 0) {
                relativeWeights[i] = 0;
                continue;
            }

            relativeWeights[i] = ratioedBassets[i].divPrecisely(sumOfRatioedBassets);
        }

        return relativeWeights;
    }

    /**
      * @dev Gets the value of all Bassets in Masset terms, using the given ratio
      * @param _bassets    Array of bassets
      * @return uint256[] Of Ratioed Assets
      */
    function _getRatioedBassets(Basset[] memory _bassets)
    private
    pure
    returns (uint256[] memory ratioedAssets) {
        uint256 len = _bassets.length;

        ratioedAssets = new uint256[](len);
        for(uint256 i = 0; i < len; i++) {
            // If the Basset is isolated, it will have already been excluded from this calc
            ratioedAssets[i] = _bassets[i].vaultBalance.mulRatioTruncate(_bassets[i].ratio);
        }
    }
}
