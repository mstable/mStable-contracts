pragma solidity ^0.5.16;
/**
 * @title IOracleHub
 * @dev Interface for tracking oracles
 */
interface IOracleHub {
    function readPrice(address _asset) external view returns(bool, uint64);
    function readPricePair(address[2] calldata _assets) external view returns(bool[2] memory, uint64[2] memory);
}