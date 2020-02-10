pragma solidity ^0.5.12;
pragma experimental ABIEncoderV2;

import { MassetStructs } from "../shared/MassetStructs.sol";

/**
  * @title IForgeValidator
  * @dev Abstract ForgeValidator contract for interacting with the Forge Library
  */
contract IForgeValidator is MassetStructs {
    function validateMint(uint256 _totalVault, Basset calldata _basset, uint256 _bassetQuantity) external pure;
    function validateMint(uint256 _totalVault, Basset[] calldata _bassets, uint256[] calldata _bassetQuantity) external pure;
    function validateRedemption(
        Basset[] memory _allBassets,
        bool basketIsFailed,
        uint256 _totalVault,
        uint256 _indexToRedeem,
        uint256 _bassetQuantity) public pure;
    function validateRedemption(
        Basset[] memory _allBassets,
        bool basketIsFailed,
        uint256 _totalVault,
        uint256[] memory _idxs,
        uint256[] memory _bassetQuantity) public pure;
}
