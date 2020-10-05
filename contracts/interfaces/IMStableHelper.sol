pragma solidity 0.5.16;

import { ISavingsContract } from "./ISavingsContract.sol";

interface IMStableHelper {

    /**
     * @dev Returns a valid bAsset with which to mint
     * @param _mAsset Masset addr
     * @return valid bool
     * @return string message
     * @return address of bAsset to mint
     */
    function suggestMintAsset(
        address _mAsset
    )
        external
        view
        returns (
            bool,
            string memory,
            address
        );

    /**
     * @dev Gets the maximum input for a valid swap pair
     * @param _mAsset mAsset address (e.g. mUSD)
     * @param _input Asset to input only bAssets accepted
     * @param _output Either a bAsset or the mAsset
     * @return valid
     * @return validity reason
     * @return max input units (in native decimals)
     * @return how much output this input would produce (in native decimals, after any fee)
     */
    function getMaxSwap(
        address _mAsset,
        address _input,
        address _output
    )
        external
        view
        returns (
            bool,
            string memory,
            uint256,
            uint256
        );


    /**
     * @dev Returns a valid bAsset to redeem
     * @param _mAsset Masset addr
     * @return valid bool
     * @return string message
     * @return address of bAsset to redeem
     */
    function suggestRedeemAsset(
        address _mAsset
    )
        external
        view
        returns (
            bool,
            string memory,
            address
        );

    /**
     * @dev Determines if a given Redemption is valid
     * @param _mAsset Address of the given mAsset (e.g. mUSD)
     * @param _mAssetQuantity Amount of mAsset to redeem (in mUSD units)
     * @param _outputBasset Desired output bAsset
     * @return valid
     * @return validity reason
     * @return output in bAsset units
     * @return bAssetQuantityArg - required input argument to the 'redeem' call
     */
    function getRedeemValidity(
        address _mAsset,
        uint256 _mAssetQuantity,
        address _outputBasset
    )
        external
        view
        returns (
            bool,
            string memory,
            uint256 output,
            uint256 bassetQuantityArg
        );

    /**
     * @dev Gets the users savings balance in Masset terms
     * @param _save SAVE contract address
     * @param _user Address of the user
     * @return balance in Masset units
     */
    function getSaveBalance(
        ISavingsContract _save,
        address _user
    )
        external
        view
        returns (
            uint256
        );

    /**
     * @dev Returns the 'credit' units required to withdraw a certain
     * amount of Masset from the SAVE contract
     * @param _save SAVE contract address
     * @param _amount Amount of mAsset to redeem from SAVE
     * @return input for the redeem function (ie. credit units to redeem)
     */
    function getSaveRedeemInput(
        ISavingsContract _save,
        uint256 _amount
    )
        external
        view
        returns (
            uint256
        );
}