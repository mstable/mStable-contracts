pragma solidity ^0.5.12;
pragma experimental ABIEncoderV2;

import { IForgeLib, MassetStructs } from "./IForgeLib.sol";
import { StableMath } from "../../shared/math/StableMath.sol";

/**
  * @title ForgeLib
  * @dev Library that validates forge arguments. V1 employs a net difference algorithm, meaning
  * that the forge is valid if it pushes the net weightings of the basket towards its target.
  * The library is also responsible for calculating the quantity of Masset that the given forge
  * inputs equate to.
  */
contract ForgeLib is IForgeLib {

    using StableMath for uint256;

    // SCENARIOS / BASSET STATES
    // 1. BassetStatus.Normal
    // Minting > Normal. Redemption > Normal.
    // 2. BassetStatus.BrokenBelowPeg
    // Minting > Isolated. Redemption > Normal.
    // 3. BassetStatus.BrokenAbovePeg
    // Minting > Normal. Redemption > Isolated
    // 4. BassetStatus.Liquidating
    // Minting > Isolated. Redemption > COMPLETE BLOCK.
    // 5. BassetStatus.Liquidated
    // Liquidated Bassets have 0 T and 0 Vault by design, set when Liquidation begins
    // Plus, we immediately remove them.
    // 6. Basket is Failed
    // Minting > COMPLETELY BLOCKED. Redemption > Normal (OVERRIDES isolation from #3)
    // 7. All Bassets isolated >> 0 T[0,0...] B[0,0...]

    /**
      * @dev Checks whether a given mint is valid
      * @param _basket MassetBasket object containing all the relevant data11
      * @param _bassetQuantity array of basset quantities to use in the mint
      * @return bool, mint is valid
      */
    function validateMint(Basket memory _basket, uint256[] memory _bassetQuantity)
    public
    pure {
        require(_bassetQuantity.length == _basket.bassets.length, "Must provide values for all Bassets in system");
        require(!_basket.failed, "Basket must be alive");

        bool basketContainsAffectedBassets = false;
        // Reformat basket to exclude affected Bassets and allow for relative calculations
        for(uint i = 0; i < _bassetQuantity.length; i++){
            BassetStatus status = _basket.bassets[i].status;
            bool isIsolated = status == BassetStatus.BrokenBelowPeg || status == BassetStatus.Liquidating;
            if(isIsolated){
                // If the Basset is supposed to be isolated from mint, ignore it from the basket
                require(_bassetQuantity[i] == 0, "Cannot mint isolated Bassets");
                _basket.bassets[i].targetWeight = 0;
                _basket.bassets[i].vaultBalance = 0;
                basketContainsAffectedBassets = true;
            } else if(_basket.bassets[i].targetWeight == 0) {
                // if target weight is 0.. we shouldn't be allowed to mint
                require(_bassetQuantity[i] == 0, "Cannot mint target 0 Bassets");
            }
        }

        // TODO - optimise RatioedBassets calculation for gas usage. I.e. remove duplicate `getBWeightings`
        uint256[] memory preWeight = _getBassetWeightings(_basket);

        for(uint i = 0; i < _bassetQuantity.length; i++){
            _basket.bassets[i].vaultBalance = _basket.bassets[i].vaultBalance.add(_bassetQuantity[i]);
        }

        uint256[] memory postWeight = _getBassetWeightings(_basket);

        _isValidForge(_basket, preWeight, postWeight, basketContainsAffectedBassets);
    }

    /**
      * @dev Checks whether a given redemption is valid
      * @param _basket MassetBasket object containing all the relevant data
      * @param _bassetQuantity array of basset quantities to use in the redemption
      * @return bool, mint is valid
      */
    function validateRedemption(Basket memory _basket, uint256[] memory _bassetQuantity)
    public
    pure {
        require(_bassetQuantity.length == _basket.bassets.length, "Must provide values for all Bassets in system");

        bool basketContainsAffectedBassets = false;
        // Reformat basket to exclude affected Bassets and allow for relative calculations
        for(uint i = 0; i < _bassetQuantity.length; i++){
            BassetStatus status = _basket.bassets[i].status;
            require(status != BassetStatus.Liquidating, "Basket cannot be undergoing liquidation");
            bool isIsolated = _basket.failed ? false : status == BassetStatus.BrokenAbovePeg;
            if(isIsolated){
                // If the Basset is supposed to be isolated from redemtion, ignore it from the basket
                require(_bassetQuantity[i] == 0, "Cannot redeem isolated Bassets");
                _basket.bassets[i].targetWeight = 0;
                _basket.bassets[i].vaultBalance = 0;
                basketContainsAffectedBassets = true;
            } else {
                require(_basket.bassets[i].vaultBalance >= _bassetQuantity[i], "Vault must have sufficient balance to redeem");
            }
        }

        uint256[] memory preWeight = _getBassetWeightings(_basket);

        for (uint i = 0; i < _bassetQuantity.length; i++) {
            _basket.bassets[i].vaultBalance = _basket.bassets[i].vaultBalance.sub(_bassetQuantity[i]);
        }

        uint256[] memory postWeight = _getBassetWeightings(_basket);

        _isValidForge(_basket, preWeight, postWeight, basketContainsAffectedBassets);
    }

    /**
      * @dev Internal forge validation function - ensures that the forge pushes weightings in the correct direction
      * @param _basket MassetBasket object containing all the relevant data
      * @param _preWeight Relative weightings before the forge
      * @param _postWeight Relative weightings before the forge
      * @param _basketContainedAffectedBassets Flag to signal that we have removed some affected Bassets from the Basket
      * @return bool Forge is valid
      */
    function _isValidForge(
        Basket memory _basket,
        uint256[] memory _preWeight,
        uint256[] memory _postWeight,
        bool _basketContainedAffectedBassets
    )
        private
        pure
    {
        uint basketLen = _preWeight.length;
        require(basketLen == _postWeight.length, "PreWeight length != PostWeight length");
        require(basketLen == _basket.bassets.length, "PreWeight length != TargetWeight length");

        // Total delta between T and C
        uint preNet = 0;
        uint postNet = 0;

        // Sum of all T
        uint totalUnisolatedTargetWeights = 0;
        for (uint i = 0; i < basketLen; i++) {
            totalUnisolatedTargetWeights += _basket.bassets[i].targetWeight;
        }

        // Calc delta between relative T and relative C for both pre and post mint
        for (uint i = 0; i < basketLen; i++) {
            uint relativeTargetWeight = _basket.bassets[i].targetWeight.divPrecisely(totalUnisolatedTargetWeights);
            preNet = preNet.add(_calcDifference(relativeTargetWeight, _preWeight[i]));
            postNet = postNet.add(_calcDifference(relativeTargetWeight, _postWeight[i]));
        }

        // It's valid if we move in the right direction or land within the grace threshold
        require(postNet <= preNet || postNet <= _basket.grace, "Forge must move Basket weightings towards the target");
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

        // TODO
        // In order to turn this into a unit delta as opposed to a weighting one
        // we need to calc unit deficit of initial basket, then add the new mint/redemption
        // .. which actually allows us to calc the units a bit easier, as we don't need to do two
        // percentage calculations

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
      * @param _basket MassetBasket object containing all the relevant data
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
            ratioedAssets[i] = _basket.bassets[i].vaultBalance.mul(_basket.bassets[i].ratio);
        }

        return ratioedAssets;
    }

    /**
      * @dev Calculates the absolute (always non-negative) difference between two values
      * @param _value1 first value
      * @param _value2 second value
      * @return uint256 difference
      */
    function _calcDifference(uint256 _value1, uint256 _value2)
    private
    pure
    returns (uint256) {
        return _value1 > _value2 ? _value1.sub(_value2) : _value2.sub(_value1);
    }
}
