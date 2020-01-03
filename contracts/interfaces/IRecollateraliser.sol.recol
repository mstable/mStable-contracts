
pragma solidity ^0.5.12;
pragma experimental ABIEncoderV2;

/**
  * @title IRecollateraliser
  * @dev Internal interface for the recollateralisation module
  */
interface IRecollateraliser {
    function recollateraliseBasset(
        address _masset,
        address _basset,
        uint256 _bassetUnits,
        uint256 _bassetRatio,
        uint256 _massetPrice,
        uint256 _metaPrice
    ) external returns(uint256);
}
