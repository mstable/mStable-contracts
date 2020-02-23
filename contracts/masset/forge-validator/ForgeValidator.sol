pragma solidity ^0.5.12;
pragma experimental ABIEncoderV2;

import { IForgeValidator, MassetStructs } from "./IForgeValidator.sol";
import { StableMath } from "../../shared/StableMath.sol";
import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";

/**
 * @title ForgeValidator
 * @dev Contract responsible for validating that the Forging of a particular bAsset set is allowed
 */
contract ForgeValidator is IForgeValidator {

    using SafeMath for uint256;
    using StableMath for uint256;

    /**
     * @dev Checks whether a given mint is valid
     */
    function validateMint(uint256 _totalVault, Basset calldata _basset, uint256 _bassetQuantity)
        external
        pure
    {
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
    function validateMint(
        uint256 _totalVault,
        Basset[] calldata _bassets,
        uint256[] calldata _bassetQuantity
    )
        external
        pure
    {
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
        Basset[] calldata _allBassets,
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
        // require(bAsset.vaultBalance >= _bassetQuantity, "Insufficient vault balance"); // This gets checked implicity through sub, xfer

        // Get current weightings, and cache some outputs from the loop to avoid unecessary recursion
        (
            bool[] memory overweightBassetsBefore,
            bool atLeastOneOverweightBefore,
            uint256[] memory ratioedBassetVaults
        ) = _getOverweightBassets(_totalVault, _allBassets);

        // Calculate ratioed redemption amount in mAsset terms
        uint256 ratioedRedemptionAmount = _bassetQuantity.mulRatioTruncate(bAsset.ratio);
        // Subtract ratioed redemption amount from both vault and total supply
        ratioedBassetVaults[_indexToRedeem] = ratioedBassetVaults[_indexToRedeem].sub(ratioedRedemptionAmount);
        uint256 newTotalVault = _totalVault.sub(ratioedRedemptionAmount);

        // If there is at least one overweight bAsset before, we must redeem it
        if(atLeastOneOverweightBefore){
            require(overweightBassetsBefore[_indexToRedeem], "Must redeem overweight bAssets");
        }
        // Else, redemption is valid so long as no bAssets end up overweight
        else {
            (bool atLeastOneOverweightAfter) = _getOverweightBassetsAfter(newTotalVault, _allBassets, ratioedBassetVaults);
            require(!atLeastOneOverweightAfter, "Redemption cannot push bAssets overweight");
        }
    }

    /**
     * @dev Checks whether a given redemption is valid
     */
    function validateRedemption(
        Basset[] calldata _allBassets,
        bool basketIsFailed,
        uint256 _totalVault,
        uint8[] calldata _idxs,
        uint256[] calldata _bassetQuantities
    )
        external
        pure
    {
        uint idxCount = _idxs.length;
        require(idxCount == _bassetQuantities.length, "Must provide values for all Bassets in system");

        (
            bool[] memory overweightBassetsBefore,
            bool atLeastOneOverweightBefore,
            uint256[] memory ratioedBassetVaults
        ) = _getOverweightBassets(_totalVault, _allBassets);

        uint256 newTotalVault = _totalVault;

        for(uint i = 0; i < idxCount; i++){
            require(_allBassets[_idxs[i]].status != BassetStatus.BrokenAbovePeg || basketIsFailed,
                "Cannot redeem depegged bAsset unless Basket is failed");

            uint256 ratioedRedemptionAmount = _bassetQuantities[i].mulRatioTruncate(_allBassets[_idxs[i]].ratio);
            ratioedBassetVaults[_idxs[i]] = ratioedBassetVaults[_idxs[i]].sub(ratioedRedemptionAmount);
            newTotalVault = newTotalVault.sub(ratioedRedemptionAmount);
        }

        // If any bAssets are overweight before, all bAssets we redeem must be overweight
        if(atLeastOneOverweightBefore){
            //  Note, there is an edge case where redeeming these Bassets may push others above weightings, however
            //  it is a side effect of simplicity
            for(uint j = 0; j < idxCount; j++){
                require(overweightBassetsBefore[_idxs[j]], "Must redeem overweight bAssets");
            }
        }
        // Else, redemption is valid so long as no bAssets end up overweight
        else {
            (bool atLeastOneOverweightAfter) = _getOverweightBassetsAfter(newTotalVault, _allBassets, ratioedBassetVaults);
            require(!atLeastOneOverweightAfter, "Redemption cannot push bAssets overweight");
        }
    }

    /***************************************
                    HELPERS
    ****************************************/

    /**
     * @dev Something
     */
    function _getOverweightBassets(uint256 _total, Basset[] memory _bassets)
        private
        pure
        returns (
            bool[] memory isOverWeight,
            bool atLeastOneOverweight,
            uint256[] memory ratioedBassets
        )
    {
        uint256 len = _bassets.length;
        isOverWeight = new bool[](len);
        ratioedBassets = new uint256[](len);
        atLeastOneOverweight = false;

        for(uint256 i = 0; i < len; i++) {
            BassetStatus status = _bassets[i].status;
            require(status != BassetStatus.Liquidating, "bAssets undergoing liquidation");

            ratioedBassets[i] = _bassets[i].vaultBalance.mulRatioTruncate(_bassets[i].ratio);
            uint256 maxWeightInUnits = _bassets[i].maxWeight.mulTruncate(_total);

            // If the bAsset is de-pegged on the up-side, it doesn't matter if it goes above max
            bool bassetOverWeight = ratioedBassets[i] > maxWeightInUnits && status != BassetStatus.BrokenAbovePeg;
            isOverWeight[i] = bassetOverWeight;

            atLeastOneOverweight = atLeastOneOverweight || bassetOverWeight;
        }
    }

    /**
     * @dev Something
     */
    function _getOverweightBassetsAfter(
        uint256 _newTotal,
        Basset[] memory _bAssets,
        uint256[] memory _ratioedBassetVaultsAfter
    )
        private
        pure
        returns (bool atLeastOneOverweight)
    {
        uint256 len = _ratioedBassetVaultsAfter.length;
        atLeastOneOverweight = false;

        for(uint256 i = 0; i < len; i++) {
            uint256 maxWeightInUnits = _bAssets[i].maxWeight.mulTruncate(_newTotal);
            // If the bAsset is de-pegged on the up-side, it doesn't matter if it goes above max
            bool bassetOverWeight = _ratioedBassetVaultsAfter[i] > maxWeightInUnits&& _bAssets[i].status != BassetStatus.BrokenAbovePeg;

            atLeastOneOverweight = atLeastOneOverweight || bassetOverWeight;
        }
    }
}
