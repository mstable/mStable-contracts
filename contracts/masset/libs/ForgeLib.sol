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
                // if target weight is 0.. we shouldn't be allowed to mint
                require(_bassetQuantity[i] == 0, "Cannot mint target 0 Bassets");
            }
        }

        // Theoretically add the mint quantities to the vault
        for(uint j = 0; j < bassetCount; j++){
            _basket.bassets[j].vaultBalance = _basket.bassets[j].vaultBalance.add(_bassetQuantity[j]);
        }

        //p
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
            } else {
                require(_basket.bassets[i].vaultBalance >= _bassetQuantity[i], "Vault must have sufficient balance to redeem");
            }
        }

        // Theoretically redeem the bassets from the vault
        for (uint i = 0; i < bassetCount; i++) {
            _basket.bassets[i].vaultBalance = _basket.bassets[i].vaultBalance.sub(_bassetQuantity[i]);
        }

        uint256[] memory postBassets = _getBassetWeightings(_basket);

        // Check that the forge is valid, given the relative target weightings and vault balances
        // If totalIsolatedWeightings = 80e16, and there are 2 bassets un-isolated - given them 40 each
        uint256 redistributedWeighting = isolatedBassets > 0 ? totalIsolatedWeightings.div(bassetCount.sub(isolatedBassets)) : 0;
        for (uint k = 0; k < bassetCount; k++) {
            uint maxWeight = _basket.bassets[k].targetWeight.add(redistributedWeighting);
            require(postBassets[k] <= maxWeight, "Must be below max weighting");
        }
    }

    /**
      * @dev Internal forge validation function - ensures that the forge pushes weightings in the correct direction
      * @param _basket                  MassetBasket object containing all the relevant data
      * @param _postForgeBassetWeights  (Ratioed) Basset vault balance post forge
      */
    function _isValidForge(
        Basket memory _basket,
        uint256 _redistributedWeightings,
        uint256[] memory _postForgeBassetWeights
    )
        private
        pure
    {
        uint basketLen = _postForgeBassetWeights.length;
        require(basketLen == _basket.bassets.length, "PostWeight length != TargetWeight length");

        // Redistribute the 'isolated' Basket weights (i.e. Basset A: T 40 should be redistributed)
        // This pushes the other targets up, as their Collat levels also rise relative to totals
        // So basket adjustments.. move Max weight down to 0.. any mint or redeem MUST
        for (uint i = 0; i < basketLen; i++) {
            uint maxWeight = _basket.bassets[i].targetWeight.add(_redistributedWeightings);
            require(_postForgeBassetWeights[i] < maxWeight, "Must be below max weighting");
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

    /**
      * @dev Calculates the delta between the target units of a basset (relative weighting T * total collateral)
      *      and the actual units in the vault.
      * @param _targetWeight        Target weight of a given Basset where 1% == 1e16
      * @param _totalVaultBalance   Total (ratioed) collateral present in the basket vault where 100 Massets == 1e20
      * @param _bassetVaultBalance  Vault balance of the given Basset
      * @return uint256             Distance between the basset vault balance and target
      */
    function _calcRelativeDistance(uint256 _targetWeight, uint256 _totalVaultBalance, uint256 _bassetVaultBalance)
    private
    pure
    returns (uint256) {
      uint256 targetVaultBalance = _targetWeight.mulTruncate(_totalVaultBalance);

      return _calcDifference(targetVaultBalance, _bassetVaultBalance);
    }

    /**
      * @dev Calculates the absolute (always non-negative) difference between two values
      * @param _value1  First value
      * @param _value2  Second value
      * @return uint256 Difference
      */
    function _calcDifference(uint256 _value1, uint256 _value2)
    private
    pure
    returns (uint256) {
        return _value1 > _value2 ? _value1.sub(_value2) : _value2.sub(_value1);
    }
}
