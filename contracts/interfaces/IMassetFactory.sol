pragma solidity ^0.5.12;


/**
 * @title IMassetFactory
 */
contract IMassetFactory {

    function createMasset(
        string calldata _name,
        string calldata _symbol,
        address[] calldata _bassets,
        bytes32[] calldata _bassetKeys,
        uint256[] calldata _bassetWeights,
        uint256[] calldata _bassetMultiples
        ) external returns(address);


}