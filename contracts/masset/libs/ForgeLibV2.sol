pragma solidity ^0.5.12;
pragma experimental ABIEncoderV2;

import { IForgeLib, MassetStructs } from "./IForgeLib.sol";
import { StableMath } from "../../shared/math/StableMath.sol";

/**
  * @title ForgeLibV2
  * @dev Library that validates forge arguments. V2 employs a net difference algorithm, meaning
  * that the forge is valid if it pushes the net weightings of the basket towards its target.
  * We use a unit based Grace variable, which tells us by how many Masset units we may deviate
  * from the optimal weightings.
  */
contract ForgeLibV2 is IForgeLib {

    using StableMath for uint256;

    /**
      * @dev Checks whether a given mint is valid
      * @param _basket          MassetBasket object containing all the relevant data11
      * @param _bassetQuantity  Array of basset quantities to use in the mint
      */
    function validateMint(Basket memory _basket, uint256[] memory _bassetQuantity)
    public
    pure {
        require(_bassetQuantity.length == _basket.bassets.length, "Must provide values for all Bassets in system");
        require(!_basket.failed, "Basket must be alive");

        // Reformat basket to exclude affected Bassets and allow for relative calculations
        for(uint i = 0; i < _bassetQuantity.length; i++){
            BassetStatus status = _basket.bassets[i].status;
            bool isIsolated = status == BassetStatus.BrokenBelowPeg || status == BassetStatus.Liquidating;
            if(isIsolated){
                // If the Basset is supposed to be isolated from mint, ignore it from the basket
                require(_bassetQuantity[i] == 0, "Cannot mint isolated Bassets");
                _basket.bassets[i].targetWeight = 0;
                _basket.bassets[i].vaultBalance = 0;
            } else if(_basket.bassets[i].targetWeight == 0) {
                // if target weight is 0.. we shouldn't be allowed to mint
                require(_bassetQuantity[i] == 0, "Cannot mint target 0 Bassets");
            }
        }

        // Get current (ratioed) basset vault balances and total
        (uint256[] memory preBassets, uint256 preTotal) = _getRatioedBassets(_basket);

        // Add the mint quantities to the vault
        for(uint i = 0; i < _bassetQuantity.length; i++){
            _basket.bassets[i].vaultBalance = _basket.bassets[i].vaultBalance.add(_bassetQuantity[i]);
        }

        // Calculate the new (ratioed) vault balances and total
        (uint256[] memory postBassets, uint256 postTotal) = _getRatioedBassets(_basket);

        // Check that the forge is valid, given the relative target weightings and vault balances
        _isValidForge(_basket, preBassets, preTotal, postBassets, postTotal);
    }

    /**
      * @dev Checks whether a given redemption is valid
      * @param _basket          MassetBasket object containing all the relevant data
      * @param _bassetQuantity  Array of basset quantities to use in the redemption
      */
    function validateRedemption(Basket memory _basket, uint256[] memory _bassetQuantity)
    public
    pure {
        require(_bassetQuantity.length == _basket.bassets.length, "Must provide values for all Bassets in system");

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
            } else {
                require(_basket.bassets[i].vaultBalance >= _bassetQuantity[i], "Vault must have sufficient balance to redeem");
            }
        }

        (uint256[] memory preBassets, uint256 preTotal) = _getRatioedBassets(_basket);

        for (uint i = 0; i < _bassetQuantity.length; i++) {
            _basket.bassets[i].vaultBalance = _basket.bassets[i].vaultBalance.sub(_bassetQuantity[i]);
        }

        (uint256[] memory postBassets, uint256 postTotal) = _getRatioedBassets(_basket);

        _isValidForge(_basket, preBassets, preTotal, postBassets, postTotal);
    }

    /**
      * @dev Internal forge validation function - ensures that the forge pushes weightings in the correct direction
      * @param _basket                  MassetBasket object containing all the relevant data
      * @param _preForgeBassetBalances  (Ratioed) Basset vault balances pre forge
      * @param _preForgeTotalBalance    Total (Ratioed) vault balance pre forge
      * @param _postForgeBassetBalances (Ratioed) Basset vault balance post forge
      * @param _postForgeTotalBalance   Totla (Ratioed) vault balance post forge
      */
    function _isValidForge(
        Basket memory _basket,
        uint256[] memory _preForgeBassetBalances,
        uint256 _preForgeTotalBalance,
        uint256[] memory _postForgeBassetBalances,
        uint256 _postForgeTotalBalance
    )
        private
        pure
    {
        uint basketLen = _preForgeBassetBalances.length;
        require(basketLen == _postForgeBassetBalances.length, "PreWeight length != PostWeight length");
        require(basketLen == _basket.bassets.length, "PreWeight length != TargetWeight length");

        // Total delta between relative target T and collateral level C, pre and post forge
        uint preNet = 0;
        uint postNet = 0;

        // Sum of all target weights T (isolated bassets removed)
        uint totalUnisolatedTargetWeights = 0;
        for (uint i = 0; i < basketLen; i++) {
            totalUnisolatedTargetWeights += _basket.bassets[i].targetWeight;
        }

        // Calc delta between relative T and relative C for both pre and post mint
        for (uint i = 0; i < basketLen; i++) {
            uint relativeTargetWeight = _basket.bassets[i].targetWeight.divPrecisely(totalUnisolatedTargetWeights);
            preNet = preNet.add(_calcRelativeDistance(relativeTargetWeight, _preForgeTotalBalance, _preForgeBassetBalances[i]));
            postNet = postNet.add(_calcRelativeDistance(relativeTargetWeight, _postForgeTotalBalance, _postForgeBassetBalances[i]));
        }

        // It's valid if we move in the right direction or land within the grace threshold
        require(postNet <= preNet || postNet <= _basket.grace, "Forge must move Basket weightings towards the target");
    }


    /***************************************
                    HELPERS
    ****************************************/


    /**
      * @dev Gets the value of all Bassets in Masset terms, using the given ratio
      * @param _basket    MassetBasket object containing all the relevant data
      * @return uint256[] Of Ratioed Assets
      */
    function _getRatioedBassets(Basket memory _basket)
    private
    pure
    returns (uint256[] memory ratioedAssets, uint256 totalRatioedBassets) {
        uint256 len = _basket.bassets.length;

        ratioedAssets = new uint256[](len);
        totalRatioedBassets = 0;
        for(uint256 i = 0; i < len; i++) {
            // If the Basset is isolated, it will have already been excluded from this calc
            ratioedAssets[i] = _basket.bassets[i].vaultBalance.mulRatioTruncate(_basket.bassets[i].ratio);
            totalRatioedBassets = totalRatioedBassets.add(ratioedAssets[i]);
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
