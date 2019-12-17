pragma solidity ^0.5.12;
pragma experimental ABIEncoderV2;

import { MassetStructs } from "./MassetStructs.sol";

/**
  * @title IForgeLib
  * @dev Abstract ForgeLib contract for interacting with the Forge Library
  */
contract IForgeLib is MassetStructs {
    function validateMint(MassetStructs.Basket memory _basket, uint256[] memory _bassetQuantity) public pure;
    function validateRedemption(MassetStructs.Basket memory _basket, uint256[] memory _bassetQuantity) public pure;
}
