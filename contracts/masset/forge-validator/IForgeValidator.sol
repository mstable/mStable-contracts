pragma solidity 0.5.16;
pragma experimental ABIEncoderV2;

import { MassetStructs } from "../shared/MassetStructs.sol";

/**
 * @title   IForgeValidator
 * @author  Stability Labs Pty. Lte.
 * @notice  Calculates whether or not minting or redemption is valid, based
 *          on how it affects the underlying basket collateral weightings
 * @dev     Abstract ForgeValidator contract for interacting with the Forge Validator implementation
 */
contract IForgeValidator is MassetStructs {
    function validateMint(uint256 _totalVault, uint256 _grace, Basset calldata _basset, uint256 _bassetQuantity)
        external pure returns (bool, string memory);
    function validateMint(uint256 _totalVault, uint256 _grace, Basset[] calldata _bassets, uint256[] calldata _bassetQuantity)
        external pure returns (bool, string memory);
    function validateRedemption(
        bool basketIsFailed,
        uint256 _totalVault,
        Basset[] calldata _allBassets,
        uint256 _grace,
        uint256 _indexToRedeem,
        uint256 _bassetQuantity) external pure returns (bool, string memory);
    function validateRedemption(
        bool basketIsFailed,
        uint256 _totalVault,
        uint256 _grace,
        uint8[] calldata _idxs,
        uint256[] calldata _bassetQuantity,
        Basset[] calldata _allBassets) external pure returns (bool, string memory);
}
