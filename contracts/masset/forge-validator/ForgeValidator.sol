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
    external
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
    external
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
      * @dev Checks whether a given mint is valid
      */
    function validateRedemption(
        Basset[] memory _allBassets,
        bool basketIsFailed,
        uint256 _totalVault,
        uint256 _indexToRedeem,
        uint256 _bassetQuantity
    )
        external
        pure
    {
        Basset memory bAsset = _allBassets[_indexToRedeem];
        require(bAsset.status != BassetStatus.BrokenAbovePeg || basketIsFailed, "Cannot redeem this bAsset unless Basket is failed");
        // require(bAsset.vaultBalance >= _bassetQuantity, "Insufficient vault balance"); // This gets checked implicity through sub

        (bool[] memory overweightBassetsBefore, bool atLeastOneOverweightBefore) = _getOverweightBassets(_totalVault, _allBassets);

        _allBassets[_indexToRedeem].vaultBalance = bAsset.vaultBalance.sub(_bassetQuantity);

        if(atLeastOneOverweightBefore){
            // If the bAsset is broken above peg.. it doesn't count
            require(overweightBassetsBefore[_indexToRedeem], "Must redeem overweight bAssets");
        } else {
            (, bool atLeastOneOverweightAfter) = _getOverweightBassets(_totalVault, _allBassets);
            require(!atLeastOneOverweightAfter, "Redemption cannot push bAssets overweight");
        }
    }

    /**
      * @dev Checks whether a given redemption is valid
      * @param _bassets          Array of bassets
      * @param _bassetQuantity  Array of basset quantities to use in the redemption
      */
    function validateRedemption(
        Basset[] memory _allBassets,
        bool basketIsFailed,
        uint256 _totalVault,
        uint256[] memory _idxs,
        uint256[] memory _bassetQuantity
    )
        external
        pure
    {
        uint idxCount = _idxs.length;
        require(idxCount == _bassetQuantity.length, "Must provide values for all Bassets in system");

        (bool[] memory overweightBassetsBefore, bool atLeastOneOverweightBefore) = _getOverweightBassets(_totalVault, _allBassets);

        for(uint i = 0; i < idxCount; i++){
            require(_allBassets[_idxs[i]].status != BassetStatus.BrokenAbovePeg || basketIsFailed,
                "Cannot redeem depegged bAsset unless Basket is failed");
            _allBassets[_idxs[i]].vaultBalance = _allBassets[_idxs[i]].vaultBalance.sub(_bassetQuantity[i]);
        }

        if(atLeastOneOverweightBefore){
            //  Note, there is an edge case where redeeming these Bassets may push others above weightings, however
            //  it is a side effect of simplicity
            for(uint j = 0; j < idxCount; j++){
                require(overweightBassetsBefore[_idxs[j]], "Must redeem overweight bAssets");
            }
        } else {
            (, bool atLeastOneOverweightAfter) = _getOverweightBassets(_totalVault, _allBassets);
            require(!atLeastOneOverweightAfter, "Redemption cannot push bAssets overweight");
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
    function _getOverweightBassets(uint256 _total, Basset[] memory _bassets)
    private
    pure
    returns (bool[] memory isOverWeight, bool atLeastOneOverweight) {
        uint256 len = _bassets.length;
        isOverWeight = new bool[](len);
        atLeastOneOverweight = false;

        for(uint256 i = 0; i < len; i++) {
            BassetStatus status = _bassets[i].status;
            require(status != BassetStatus.Liquidating, "bAssets undergoing liquidation");

            uint256 ratioedBasset = _bassets[i].vaultBalance.mulRatioTruncate(_bassets[i].ratio);
            uint256 maxWeightInUnits = _bassets[i].maxWeight.mulTruncate(_total);

            // If the bAsset is de-pegged on the up-side, it doesn't matter if it goes above max
            bool bassetOverWeight = ratioedBasset > maxWeightInUnits && status != BassetStatus.BrokenAbovePeg;
            isOverWeight[i] = bassetOverWeight;

            atLeastOneOverweight = atLeastOneOverweight || bassetOverWeight;
        }
    }
}
