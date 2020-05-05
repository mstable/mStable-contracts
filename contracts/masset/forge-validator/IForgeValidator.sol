pragma solidity 0.5.16;
pragma experimental ABIEncoderV2;

import { MassetStructs } from "../shared/MassetStructs.sol";

/**
 * @title   IForgeValidator
 * @author  Stability Labs Pty. Ltd.
 * @notice  Calculates whether or not minting or redemption is valid, based
 *          on how it affects the underlying basket collateral weightings
 * @dev     Abstract ForgeValidator contract for interacting with the Forge Validator implementation
 */
contract IForgeValidator is MassetStructs {
    function validateMint(uint256 _totalVault, Basset calldata _basset, uint256 _bAssetQuantity)
        external pure returns (bool, string memory);
    function validateMintMulti(uint256 _totalVault, Basset[] calldata _bassets, uint256[] calldata _bAssetQuantities)
        external pure returns (bool, string memory);
    function validateSwap(uint256 _totalVault, Basset calldata _inputBasset, Basset calldata _outputBasset, uint256 _quantity)
        external pure returns (bool, string memory, uint256, bool);
    function validateRedemption(
        bool basketIsFailed,
        uint256 _totalVault,
        Basset[] calldata _allBassets,
        uint8[] calldata _indices,
        uint256[] calldata _bassetQuantities) external pure returns (bool, string memory, bool);
    function calculateRedemptionMulti(
        uint256 _mAssetQuantity,
        Basset[] calldata _allBassets) external pure returns (bool, string memory, uint256[] memory);
}
