pragma solidity 0.5.16;
pragma experimental ABIEncoderV2;

import { IForgeValidator, MassetStructs } from "./IForgeValidator.sol";
import { StableMath } from "../../shared/StableMath.sol";
import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";

/**
 * @title   ForgeValidator
 * @author  Stability Labs Pty. Lte.
 * @notice  Calculates whether or not minting or redemption is valid, based
 *          on how it affects the underlying basket collateral weightings
 * @dev     VERSION: 1.0
 *          DATE:    2020-03-28
 */
contract ForgeValidator is IForgeValidator {

    using SafeMath for uint256;
    using StableMath for uint256;

    /**
     * @notice Checks whether a given mint is valid and returns the result
     * @dev Is the resulting weighting of the target bAsset beyond it's implicit max weight?
     * Max weight is determined as target weight (in units) + grace
     * @param _totalVault       Current sum of basket collateral
     * @param _grace            Unit based deviation allowance, where 1 == 1e18
     * @param _bAsset           Struct containing relevant data on the bAsset
     * @param _bAssetQuantity   Number of bAsset units that will be used to mint
     * @return isValid          Bool to signify that the mint does not move our weightings the wrong way
     * @return reason           If the mint is invalid, this is the reason
     */
    function validateMint(uint256 _totalVault, uint256 _grace, Basset calldata _bAsset, uint256 _bAssetQuantity)
        external
        pure
        returns (bool isValid, string memory reason)
    {
        if(_bAsset.status == BassetStatus.BrokenBelowPeg || _bAsset.status == BassetStatus.Liquidating
            || _bAsset.status == BassetStatus.Blacklisted)
            return (false, "bAsset not allowed in mint");

        // How much mAsset is this _bAssetQuantity worth?
        uint256 mintAmountInMasset = _bAssetQuantity.mulRatioTruncate(_bAsset.ratio);
        // How much of this bAsset do we have in the vault, in terms of mAsset?
        uint256 newBalanceInMasset = _bAsset.vaultBalance.mulRatioTruncate(_bAsset.ratio).add(mintAmountInMasset);
        // What is the target weight of this bAsset in the basket?
        uint256 targetWeightInUnits = (_totalVault.add(mintAmountInMasset)).mulTruncate(_bAsset.targetWeight);

        if(newBalanceInMasset > targetWeightInUnits.add(_grace)) return (false, "Must be below implicit max weighting");

        return (true, "");
    }

    /**
     * @notice Checks whether a given mint using more than one asset is valid and returns the result
     * @dev Is the resulting weighting of the target bAssets beyond their implicit max weight?
     * Max weight is determined as target weight (in units) + grace
     * @param _totalVault       Current sum of basket collateral
     * @param _grace            Unit based deviation allowance, where 1 == 1e18
     * @param _bAssets          Array of Struct containing relevant data on the bAssets
     * @param _bAssetQuantity   Number of bAsset units that will be used to mint (aligned with above)
     * @return isValid          Bool to signify that the mint does not move our weightings the wrong way
     * @return reason           If the mint is invalid, this is the reason
     */
    function validateMint(
        uint256 _totalVault,
        uint256 _grace,
        Basset[] calldata _bAssets,
        uint256[] calldata _bAssetQuantity
    )
        external
        pure
        returns (bool isValid, string memory reason)
    {
        uint256 bAssetCount = _bAssets.length;
        if(bAssetCount != _bAssetQuantity.length) return (false, "Input length should be equal");

        uint256[] memory newBalances = new uint256[](bAssetCount);
        uint256 newTotalVault = _totalVault;

        // Theoretically add the mint quantities to the vault
        for(uint256 j = 0; j < bAssetCount; j++){
            Basset memory b = _bAssets[j];
            BassetStatus bAssetStatus = b.status;

            if(bAssetStatus == BassetStatus.BrokenBelowPeg || bAssetStatus == BassetStatus.Liquidating
                || bAssetStatus == BassetStatus.Blacklisted)
                return (false, "bAsset not allowed in mint");

            // How much mAsset is this _bAssetQuantity worth?
            uint256 mintAmountInMasset = _bAssetQuantity[j].mulRatioTruncate(b.ratio);
            // How much of this bAsset do we have in the vault, in terms of mAsset?
            newBalances[j] = b.vaultBalance.mulRatioTruncate(b.ratio).add(mintAmountInMasset);

            newTotalVault = newTotalVault.add(mintAmountInMasset);
        }

        for(uint256 k = 0; k < bAssetCount; k++){
            // What is the target weight of this bAsset in the basket?
            uint256 targetWeightInUnits = newTotalVault.mulTruncate(_bAssets[k].targetWeight);

            if(newBalances[k] > targetWeightInUnits.add(_grace)) return (false, "Must be below implicit max weighting");
        }

        return (true, "");
    }


    /**
     * @notice Checks whether a given redemption is valid and returns the result
     * @dev A redemption is valid if it does not push any bAssets above their max weightings, or
     * under their minimum weightings. In addition, if bAssets are currently above their max weight
     * (i.e. during basket composition changes) they must be redeemed
     * @param _basketIsFailed   Bool to suggest that the basket has failed a recollateralisation attempt
     * @param _totalVault       Sum of collateral units in the basket
     * @param _allBassets       Array of all bAsset information
     * @param _grace            Deviation allowance in units
     * @param _indexToRedeem    Index of the bAsset to redeem
     * @param _bAssetQuantity   Quantity of bAsset to redeem
     * @return isValid          Bool to signify that the redemption is allowed
     * @return reason           If the redemption is invalid, this is the reason
     */
    function validateRedemption(
        bool _basketIsFailed,
        uint256 _totalVault,
        Basset[] calldata _allBassets,
        uint256 _grace,
        uint256 _indexToRedeem,
        uint256 _bAssetQuantity
    )
        external
        pure
        returns (bool, string memory)
    {
        Basset memory bAsset = _allBassets[_indexToRedeem];
        if(bAsset.status == BassetStatus.BrokenAbovePeg && !_basketIsFailed) return (false, "Cannot redeem depegged bAsset");

        // Get current weightings, and cache some outputs from the loop to avoid unecessary recursion
        OverWeightBassetsResponse memory data = _getOverweightBassets(_totalVault, _grace, _allBassets);
        if(!data.isValid) return (false, data.reason);

        // Calculate ratioed redemption amount in mAsset terms
        uint256 ratioedRedemptionAmount = _bAssetQuantity.mulRatioTruncate(bAsset.ratio);
        // Subtract ratioed redemption amount from both vault and total supply
        data.ratioedBassetVaults[_indexToRedeem] = data.ratioedBassetVaults[_indexToRedeem].sub(ratioedRedemptionAmount);

        (bool atLeastOneOverweightAfter, bool[] memory underWeight) =
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
        if(underWeight[_indexToRedeem]) return(false, "bAssets must remain above implicit min weight");

        return (true, "");
    }

    /**
     * @notice Checks whether a given redemption is valid and returns the result
     * @dev A redemption is valid if it does not push any bAssets above their max weightings, or
     * under their minimum weightings. In addition, if bAssets are currently above their max weight
     * (i.e. during basket composition changes) they must be redeemed
     * @param _basketIsFailed   Bool to suggest that the basket has failed a recollateralisation attempt
     * @param _totalVault       Sum of collateral units in the basket
     * @param _grace            Deviation allowance in units
     * @param _idxs             Indexes of the bAssets to redeem
     * @param _bAssetQuantities Quantities of bAssets to redeem
     * @param _allBassets       Array of all bAsset information
     * @return isValid          Bool to signify that the redemption is allowed
     * @return reason           If the redemption is invalid, this is the reason
     */
    function validateRedemption(
        bool _basketIsFailed,
        uint256 _totalVault,
        uint256 _grace,
        uint8[] calldata _idxs,
        uint256[] calldata _bAssetQuantities,
        Basset[] calldata _allBassets
    )
        external
        pure
        returns (bool, string memory)
    {
        uint256 idxCount = _idxs.length;
        require(idxCount == _bAssetQuantities.length, "Input arrays should be equal");

        OverWeightBassetsResponse memory data = _getOverweightBassets(_totalVault, _grace, _allBassets);
        if(!data.isValid) return (false, data.reason);

        uint256 newTotalVault = _totalVault;

        for(uint256 i = 0; i < idxCount; i++){
            if(_allBassets[_idxs[i]].status == BassetStatus.BrokenAbovePeg && !_basketIsFailed)
                return (false, "Cannot redeem depegged bAsset");

            uint256 ratioedRedemptionAmount = _bAssetQuantities[i].mulRatioTruncate(_allBassets[_idxs[i]].ratio);
            data.ratioedBassetVaults[_idxs[i]] = data.ratioedBassetVaults[_idxs[i]].sub(ratioedRedemptionAmount);
            newTotalVault = newTotalVault.sub(ratioedRedemptionAmount);
        }

        (bool atLeastOneOverweightAfter, bool[] memory underWeight) =
            _getOverweightBassetsAfter(newTotalVault, _grace, _allBassets, data.ratioedBassetVaults);

        // If any bAssets are overweight before, all bAssets we redeem must be overweight
        if(data.atLeastOneOverweight){
            //  Note, there is an edge case where redeeming these Bassets may push others above weightings, however
            //  it is a side effect of simplicity
            for(uint256 j = 0; j < idxCount; j++){
                if(!data.isOverWeight[_idxs[j]]) return (false, "Must redeem overweight bAssets");
            }
        }
        // Else, redemption is valid so long as no bAssets end up overweight
        else {
            if(atLeastOneOverweightAfter) return (false, "bAssets must remain under max weight");
        }

        // No redeemed bAssets must go under their implicit minimum
        for(uint256 k = 0; k < idxCount; k++){
            if(underWeight[_idxs[k]]) return (false, "bAssets must remain above implicit min weight");
        }

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
     * @dev Gets the currently overweight bAssets, and capitalises on the for loop to
     * produce some other useful data. Loops through, validating the bAsset, and determining
     * if it is overweight, returning the ratioed bAsset.
     * @param _total         Sum of collateral units in the basket
     * @param _grace         Deviation allowance in units
     * @param _bAssets       Array of all bAsset information
     * @return response      Struct containing calculated data
     */
    function _getOverweightBassets(uint256 _total, uint256 _grace, Basset[] memory _bAssets)
        private
        pure
        returns (OverWeightBassetsResponse memory response)
    {
        uint256 len = _bAssets.length;
        response = OverWeightBassetsResponse({
            isValid: true,
            reason: "",
        isOverWeight: new bool[](len),
            ratioedBassetVaults: new uint256[](len),
            atLeastOneOverweight: false
        });

        for(uint256 i = 0; i < len; i++) {
            BassetStatus status = _bAssets[i].status;
            if(status == BassetStatus.Liquidating || status == BassetStatus.Blacklisted || status == BassetStatus.BrokenBelowPeg) {
                response.isValid = false;
                response.reason = "bAssets undergoing liquidation";
                return response;
            }

            response.ratioedBassetVaults[i] = _bAssets[i].vaultBalance.mulRatioTruncate(_bAssets[i].ratio);
            uint256 targetWeightInUnits = _total.mulTruncate(_bAssets[i].targetWeight);

            // If the bAsset is de-pegged on the up-side, it doesn't matter if it goes above max
            bool bAssetOverWeight = response.ratioedBassetVaults[i] > targetWeightInUnits.add(_grace) && status != BassetStatus.BrokenAbovePeg;
            response.isOverWeight[i] = bAssetOverWeight;

            response.atLeastOneOverweight = response.atLeastOneOverweight || bAssetOverWeight;
        }
    }

    /**
     * @dev After the redeemed bAssets have been removed from the basket, determine
     * if there are any resulting overweight, or underweight
     * @param _newTotal                 Sum of collateral units in the basket
     * @param _grace                    Deviation allowance in units
     * @param _bAssets                  Array of all bAsset information
     * @param _ratioedBassetVaultsAfter Array of all new bAsset vaults
     * @return atLeastOneOverweight     Is there a single bAsset overweight?
     * @return underWeight              Array of bools - is this bAsset now under min weight
     */
    function _getOverweightBassetsAfter(
        uint256 _newTotal,
        uint256 _grace,
        Basset[] memory _bAssets,
        uint256[] memory _ratioedBassetVaultsAfter
    )
        private
        pure
        returns (bool atLeastOneOverweight, bool[] memory underWeight)
    {
        uint256 len = _ratioedBassetVaultsAfter.length;
        atLeastOneOverweight = false;
        underWeight = new bool[](len);

        for(uint256 i = 0; i < len; i++) {
            uint256 targetWeightInUnits = _newTotal.mulTruncate(_bAssets[i].targetWeight);
            // If the bAsset is de-pegged on the up-side, it doesn't matter if it goes above max
            bool bAssetOverWeight = _ratioedBassetVaultsAfter[i] > targetWeightInUnits.add(_grace) &&
                _bAssets[i].status != BassetStatus.BrokenAbovePeg;
            underWeight[i] = _grace > targetWeightInUnits ? false : _ratioedBassetVaultsAfter[i] < targetWeightInUnits.sub(_grace);

            atLeastOneOverweight = atLeastOneOverweight || bAssetOverWeight;
        }
    }
}
