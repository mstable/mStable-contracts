pragma solidity ^0.5.16;
pragma experimental ABIEncoderV2;

import { MassetStructs } from "../shared/MassetStructs.sol";

/**
  * @title IForgeValidator
  * @dev Abstract ForgeValidator contract for interacting with the Forge Library
  */
contract IForgeValidator is MassetStructs {
    function validateMint(uint256 _totalVault, Basset calldata _basset, uint256 _bassetQuantity)
        external pure returns (bool, string memory);
    function validateMint(uint256 _totalVault, Basset[] calldata _bassets, uint256[] calldata _bassetQuantity)
        external pure returns (bool, string memory);
    function validateRedemption(
        Basset[] calldata _allBassets,
        bool basketIsFailed,
        uint256 _totalVault,
        uint256 _indexToRedeem,
        uint256 _bassetQuantity) external pure returns (bool, string memory);
    function validateRedemption(
        Basset[] calldata _allBassets,
        bool basketIsFailed,
        uint256 _totalVault,
        uint8[] calldata _idxs,
        uint256[] calldata _bassetQuantity) external pure returns (bool, string memory);
}
