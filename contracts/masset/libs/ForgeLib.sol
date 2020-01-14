pragma solidity ^0.5.12;
pragma experimental ABIEncoderV2;

import { IForgeLib, MassetStructs } from "./IForgeLib.sol";
import { StableMath } from "../../shared/math/StableMath.sol";

/**
  * @title ForgeLib
  * @dev Library that validates forge arguments. V2 employs a net difference algorithm, meaning
  * that the forge is valid if it pushes the net weightings of the basket towards its target.
  * We use a unit based Grace variable, which tells us by how many Masset units we may deviate
  * from the optimal weightings.
  */
contract ForgeLib is IForgeLib {

    using StableMath for uint256;

    /**
      * @dev Checks whether a given mint is valid
      * @param _basket          MassetBasket object containing all the relevant data11
      * @param _bassetQuantity  Array of basset quantities to use in the mint
      */
    function validateMint(Basket memory _basket, uint256[] memory _bassetQuantity)
    public
    pure {
        uint256 bassetCount = _basket.bassets.length;
        require(_bassetQuantity.length == bassetCount, "Must provide values for all Bassets in system");
        require(!_basket.failed, "Basket must be alive");

        uint256 isolatedBassets = 0;
        uint256 totalIsolatedWeightings = 0;

        // Reformat basket to exclude affected Bassets and allow for relative calculations
        for(uint i = 0; i < bassetCount; i++){
            BassetStatus status = _basket.bassets[i].status;
            bool isIsolated = status == BassetStatus.BrokenBelowPeg || status == BassetStatus.Liquidating;
            if(isIsolated){
                // If the Basset is supposed to be isolated from mint, ignore it from the basket
                require(_bassetQuantity[i] == 0, "Cannot mint isolated Bassets");
                // Total the Isolated weightings and redistribute to non-affected assets
                isolatedBassets += 1;
                totalIsolatedWeightings = totalIsolatedWeightings.add(_basket.bassets[i].targetWeight);
                // Isolate this Basset by marking it as absent
                _basket.bassets[i].targetWeight = 0;
                _basket.bassets[i].vaultBalance = 0;
            } else if(_basket.bassets[i].targetWeight == 0) {
                isolatedBassets += 1;
                // if target weight is 0.. we shouldn't be allowed to mint
                require(_bassetQuantity[i] == 0, "Cannot mint target 0 Bassets");
            }
        }

        // Theoretically add the mint quantities to the vault
        for(uint j = 0; j < bassetCount; j++){
            _basket.bassets[j].vaultBalance = _basket.bassets[j].vaultBalance.add(_bassetQuantity[j]);
        }

        //
        uint256[] memory postBassets = _getBassetWeightings(_basket);

        // Check that the forge is valid, given the relative target weightings and vault balances
        // If totalIsolatedWeightings = 80e16, and there are 2 bassets un-isolated - given them 40 each
        uint256 redistributedWeighting = isolatedBassets > 0 ? totalIsolatedWeightings.div(bassetCount.sub(isolatedBassets)) : 0;
        for (uint k = 0; k < bassetCount; k++) {
            uint maxWeight = _basket.bassets[k].targetWeight.add(redistributedWeighting);
            if(_bassetQuantity[k] > 0) {
                require(postBassets[k] <= maxWeight, "Must be below max weighting");
            }
        }
    }

    /**
      * @dev Checks whether a given redemption is valid
      * @param _basket          MassetBasket object containing all the relevant data
      * @param _bassetQuantity  Array of basset quantities to use in the redemption
      */
    function validateRedemption(Basket memory _basket, uint256[] memory _bassetQuantity)
    public
    pure {
        uint256 bassetCount = _basket.bassets.length;
        require(_bassetQuantity.length == bassetCount, "Must provide values for all Bassets in system");
  
        uint256 bassetsToRedeem = 0;
        uint256 isolatedBassets = 0;
        uint256 totalIsolatedWeightings = 0;

        // Reformat basket to exclude affected Bassets and allow for relative calculations
        for(uint i = 0; i < bassetCount; i++){
            BassetStatus status = _basket.bassets[i].status;
            require(status != BassetStatus.Liquidating, "Basket cannot be undergoing liquidation");
            bool isIsolated = _basket.failed ? false : status == BassetStatus.BrokenAbovePeg;
            if(isIsolated){
                // If the Basset is supposed to be isolated from redemtion, ignore it from the basket
                require(_bassetQuantity[i] == 0, "Cannot redeem isolated Bassets");

                // Total the Isolated weightings and redistribute to non-affected assets
                isolatedBassets += 1;
                totalIsolatedWeightings = totalIsolatedWeightings.add(_basket.bassets[i].targetWeight);

                _basket.bassets[i].targetWeight = 0;
                _basket.bassets[i].vaultBalance = 0;
            } else if (_bassetQuantity[i] > 0) {
                bassetsToRedeem += 1;
                require(_basket.bassets[i].vaultBalance >= _bassetQuantity[i], "Vault must have sufficient balance to redeem");
            }
        }

        require(bassetsToRedeem > 0, "Must choose some Bassets to redeem");

        uint256[] memory preBassets = _getBassetWeightings(_basket);

        bool isInAdjustment = false;

        // If totalIsolatedWeightings = 80e16, and there are 2 bassets un-isolated - given them 40 each
        uint256 redistributedWeighting = isolatedBassets > 0 ? totalIsolatedWeightings.div(bassetCount.sub(isolatedBassets)) : 0;
        for (uint k = 0; k < bassetCount; k++) {
            uint maxWeight = _basket.bassets[k].targetWeight.add(redistributedWeighting);
            isInAdjustment = isInAdjustment || preBassets[k] > maxWeight;
        }

        // Theoretically redeem the bassets from the vault
        for (uint j = 0; j < bassetCount; j++) {
            _basket.bassets[j].vaultBalance = _basket.bassets[j].vaultBalance.sub(_bassetQuantity[j]);
        }

        uint256[] memory postBassets = _getBassetWeightings(_basket);

        // Check that the forge is valid, given the relative target weightings and vault balances
        // isInAdjustment?
        //     Bassets redeemed must be overweight
        //     Note, there is an edge case where redeeming these Bassets may push others above weightings, however
        //     it is a side effect of simplicity
        // no
        //     all unredeemed bassets must remain underweight
        for (uint m = 0; m < bassetCount; m++){
            uint maxWeight = _basket.bassets[m].targetWeight.add(redistributedWeighting);
            if(isInAdjustment){
                if(_bassetQuantity[m] > 0) {
                    require(preBassets[m] > maxWeight, "Redeemed Bassets must be overweight during adjustments");
                }
            } else {
                if(_bassetQuantity[m] == 0) {
                    require(postBassets[m] <= maxWeight, "Unredeemed bassets must stay below max weighting");
                }
            }
        }
    }


    /***************************************
                    HELPERS
    ****************************************/

    /**
      * @dev Gets the proportionate weightings of all the Bassets, relative to Total Collateral levels
      * @param _basket MassetBasket object containing all the relevant data
      * @return uint256[] Relative weightings of all Bassets where 100% == 1e18
      */
    function _getBassetWeightings(Basket memory _basket)
    private
    pure
    returns (uint256[] memory relativeWeights) {
        uint256[] memory ratioedBassets = _getRatioedBassets(_basket);

        uint256 sumOfRatioedBassets = 0;
        for(uint i = 0; i < ratioedBassets.length; i++) {
            sumOfRatioedBassets = sumOfRatioedBassets.add(ratioedBassets[i]);
        }

        uint256 len = ratioedBassets.length;
        relativeWeights = new uint256[](len);

        for(uint256 i = 0; i < len; i++) {
            if(sumOfRatioedBassets == 0){
                relativeWeights[i] = _basket.bassets[i].targetWeight;
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
      * @param _basket    MassetBasket object containing all the relevant data
      * @return uint256[] Of Ratioed Assets
      */
    function _getRatioedBassets(Basket memory _basket)
    private
    pure
    returns (uint256[] memory ratioedAssets) {
        uint256 len = _basket.bassets.length;

        ratioedAssets = new uint256[](len);
        for(uint256 i = 0; i < len; i++) {
            // If the Basset is isolated, it will have already been excluded from this calc
            ratioedAssets[i] = _basket.bassets[i].vaultBalance.mulRatioTruncate(_basket.bassets[i].ratio);
        }
    }
}
