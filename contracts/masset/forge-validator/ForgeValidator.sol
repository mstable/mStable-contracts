pragma solidity 0.5.16;
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
    function validateMint(uint256 _totalVault, uint256 _grace, Basset calldata _basset, uint256 _bassetQuantity)
        external
        pure
        returns (bool isValid, string memory reason)
    {
        if(_basset.status == BassetStatus.BrokenBelowPeg || _basset.status == BassetStatus.Liquidating
            || _basset.status == BassetStatus.Blacklisted)
            return (false, "bASset not allowed in mint");

        // How much mAsset is this _bassetQuantity worth?
        uint256 mintAmountInMasset = _bassetQuantity.mulRatioTruncate(_basset.ratio);
        // How much of this bAsset do we have in the vault, in terms of mAsset?
        uint256 newBalanceInMasset = _basset.vaultBalance.mulRatioTruncate(_basset.ratio).add(mintAmountInMasset);
        // What is the target weight of this bAsset in the basket?
        uint256 targetWeightInUnits = (_totalVault.add(mintAmountInMasset)).mulTruncate(_basset.targetWeight);

        if(newBalanceInMasset > targetWeightInUnits.add(_grace)) return (false, "Must be below implicit max weighting");

        return (true, "");
    }

    /**
     * @dev Checks whether a given mint is valid
     */
    function validateMint(
        uint256 _totalVault,
        uint256 _grace,
        Basset[] calldata _bassets,
        uint256[] calldata _bassetQuantity
    )
        external
        pure
        returns (bool isValid, string memory reason)
    {
        uint256 bassetCount = _bassets.length;
        if(bassetCount != _bassetQuantity.length) return (false, "Input length should be equal");

        uint256[] memory newBalances = new uint256[](bassetCount);
        uint256 newTotalVault = _totalVault;

        // Theoretically add the mint quantities to the vault
        for(uint256 j = 0; j < bassetCount; j++){
            Basset memory b = _bassets[j];
            BassetStatus bAssetStatus = b.status;

            if(bAssetStatus == BassetStatus.BrokenBelowPeg || bAssetStatus == BassetStatus.Liquidating
                || bAssetStatus == BassetStatus.Blacklisted)
                return (false, "bASset not allowed in mint");

            // How much mAsset is this _bassetQuantity worth?
            uint256 mintAmountInMasset = _bassetQuantity[j].mulRatioTruncate(b.ratio);
            // How much of this bAsset do we have in the vault, in terms of mAsset?
            newBalances[j] = b.vaultBalance.mulRatioTruncate(b.ratio).add(mintAmountInMasset);

            newTotalVault = newTotalVault.add(mintAmountInMasset);
        }

        for(uint256 k = 0; k < bassetCount; k++){
            // What is the target weight of this bAsset in the basket?
            uint256 targetWeightInUnits = newTotalVault.mulTruncate(_bassets[k].targetWeight);

            if(newBalances[k] > targetWeightInUnits.add(_grace)) return (false, "Must be below max weighting");
        }

        return (true, "");
    }


    /**
     * @dev Checks whether a given mint is valid
     */
    function validateRedemption(
        bool basketIsFailed,
        uint256 _totalVault,
        Basset[] calldata _allBassets,
        uint256 _grace,
        uint256 _indexToRedeem,
        uint256 _bassetQuantity
    )
        external
        pure
        returns (bool, string memory)
    {
        Basset memory bAsset = _allBassets[_indexToRedeem];
        if(bAsset.status == BassetStatus.BrokenAbovePeg && !basketIsFailed) return (false, "Cannot redeem selected bAsset");

        // Get current weightings, and cache some outputs from the loop to avoid unecessary recursion
        OverWeightBassetsResponse memory data = _getOverweightBassets(_totalVault, _grace, _allBassets);
        if(!data.isValid) return (false, data.reason);

        // Calculate ratioed redemption amount in mAsset terms
        uint256 ratioedRedemptionAmount = _bassetQuantity.mulRatioTruncate(bAsset.ratio);
        // Subtract ratioed redemption amount from both vault and total supply
        data.ratioedBassetVaults[_indexToRedeem] = data.ratioedBassetVaults[_indexToRedeem].sub(ratioedRedemptionAmount);

        (bool atLeastOneOverweightAfter, bool atLeastOneUnderweightAfter) =
            _getOverweightBassetsAfter(_totalVault.sub(ratioedRedemptionAmount), _grace, _allBassets, data.ratioedBassetVaults);

        // If there is at least one overweight bAsset before, we must redeem it
        if(data.atLeastOneOverweight){
            if(!data.isOverWeight[_indexToRedeem]) return (false, "Must redeem overweight bAssets");
        }
        // Else, redemption is valid so long as no bAssets end up overweight
        else {
            if(atLeastOneOverweightAfter) return(false, "bAssets must remain under max weight");
        }
        // No bAssets must go under their implicit minimum
        if(atLeastOneUnderweightAfter) return(false, "bAssets must remain above implicit min weight");

        return (true, "");
    }

    /**
     * @dev Checks whether a given redemption is valid
     */
    function validateRedemption(
        bool basketIsFailed,
        uint256 _totalVault,
        Basset[] calldata _allBassets,
        uint256 _grace,
        uint8[] calldata _idxs,
        uint256[] calldata _bassetQuantities
    )
        external
        pure
        returns (bool, string memory)
    {
        // uint256 idxCount = _idxs.length;
        // require(idxCount == _bassetQuantities.length, "Input arrays should be equal");

        // OverWeightBassetsResponse memory data = _getOverweightBassets(_totalVault, _grace, _allBassets);
        // if(!data.isValid) return (false, data.reason);

        // uint256 newTotalVault = _totalVault;

        // for(uint256 i = 0; i < idxCount; i++){
        //     if(_allBassets[_idxs[i]].status == BassetStatus.BrokenAbovePeg && !basketIsFailed)
        //         return (false, "Cannot redeem depegged bAsset");

        //     uint256 ratioedRedemptionAmount = _bassetQuantities[i].mulRatioTruncate(_allBassets[_idxs[i]].ratio);
        //     data.ratioedBassetVaults[_idxs[i]] = data.ratioedBassetVaults[_idxs[i]].sub(ratioedRedemptionAmount);
        //     newTotalVault = newTotalVault.sub(ratioedRedemptionAmount);
        // }

        // (bool atLeastOneOverweightAfter, bool atLeastOneUnderweightAfter) =
        //     _getOverweightBassetsAfter(newTotalVault, _grace, _allBassets, data.ratioedBassetVaults);

        // // If any bAssets are overweight before, all bAssets we redeem must be overweight
        // if(data.atLeastOneOverweight){
        //     //  Note, there is an edge case where redeeming these Bassets may push others above weightings, however
        //     //  it is a side effect of simplicity
        //     for(uint256 j = 0; j < idxCount; j++){
        //         if(!data.isOverWeight[_idxs[j]]) return (false, "Must redeem overweight bAssets");
        //     }
        // }
        // // Else, redemption is valid so long as no bAssets end up overweight
        // else {
        //     if(atLeastOneOverweightAfter) return (false, "bAssets must remain underweight");
        // }

        // // No bAssets must go under their implicit minimum
        // if(atLeastOneUnderweightAfter) return(false, "bAssets must remain above implicit min weight");

        return (true, "");
    }

    /***************************************
                    HELPERS
    ****************************************/

    struct OverWeightBassetsResponse {
        bool isValid;
        string reason;
        bool[] isOverWeight;
        bool atLeastOneOverweight;
        uint256[] ratioedBassetVaults;
    }

    /**
     * @dev Something
     */
    function _getOverweightBassets(uint256 _total, uint256 _grace, Basset[] memory _bassets)
        private
        pure
        returns (OverWeightBassetsResponse memory response)
    {
        uint256 len = _bassets.length;
        response = OverWeightBassetsResponse({
            isValid: true,
            reason: "",
            isOverWeight: new bool[](len),
            ratioedBassetVaults: new uint256[](len),
            atLeastOneOverweight: false
        });

        for(uint256 i = 0; i < len; i++) {
            BassetStatus status = _bassets[i].status;
            if(status == BassetStatus.Liquidating || status == BassetStatus.Blacklisted || status == BassetStatus.BrokenBelowPeg) {
                response.isValid = false;
                response.reason = "bAssets undergoing liquidation";
                return response;
            }

            response.ratioedBassetVaults[i] = _bassets[i].vaultBalance.mulRatioTruncate(_bassets[i].ratio);
            uint256 targetWeightInUnits = _total.mulTruncate(_bassets[i].targetWeight);

            // If the bAsset is de-pegged on the up-side, it doesn't matter if it goes above max
            bool bassetOverWeight = response.ratioedBassetVaults[i] > targetWeightInUnits.add(_grace) && status != BassetStatus.BrokenAbovePeg;
            response.isOverWeight[i] = bassetOverWeight;

            response.atLeastOneOverweight = response.atLeastOneOverweight || bassetOverWeight;
        }
    }

    /**
     * @dev Something
     */
    function _getOverweightBassetsAfter(
        uint256 _newTotal,
        uint256 _grace,
        Basset[] memory _bAssets,
        uint256[] memory _ratioedBassetVaultsAfter
    )
        private
        pure
        returns (bool atLeastOneOverweight, bool atLeastOneUnderweight)
    {
        uint256 len = _ratioedBassetVaultsAfter.length;
        atLeastOneOverweight = false;
        atLeastOneUnderweight = false;

        for(uint256 i = 0; i < len; i++) {
            uint256 targetWeightInUnits = _newTotal.mulTruncate(_bAssets[i].targetWeight);
            // If the bAsset is de-pegged on the up-side, it doesn't matter if it goes above max
            bool bassetOverWeight = _ratioedBassetVaultsAfter[i] > targetWeightInUnits.add(_grace) &&
                _bAssets[i].status != BassetStatus.BrokenAbovePeg;
            bool bassetUnderWeight = _grace > targetWeightInUnits ? false : _ratioedBassetVaultsAfter[i] < targetWeightInUnits.sub(_grace);

            atLeastOneOverweight = atLeastOneOverweight || bassetOverWeight;
            atLeastOneUnderweight = atLeastOneUnderweight || bassetUnderWeight;
        }
    }
}
