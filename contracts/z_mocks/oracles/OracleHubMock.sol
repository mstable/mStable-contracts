
pragma solidity ^0.5.12;
pragma experimental ABIEncoderV2;

import { OracleHub, OracleHubPriceData } from "../../oracle-hub/OracleHub.sol";

/**
 * @title OracleHubMock allows us to put custom price data into the Oracle without signing messages
 * @notice Values stored in this contract should represent a relative price to pegged asset
 * @author Stability Labs
 */
contract OracleHubMock is OracleHub {


    constructor(
        address _governor,
        address _nexus,
        OracleHubPriceData _data,
        address[] memory _sources
    )
        OracleHub(
            _governor,
            _nexus,
            _data,
            _sources
        )
        public
    {}


    function addMockPrices(
        uint64[] calldata values,
        // uint64[] calldata timestamps,
        bytes32[] calldata symbols
    ) external {
        require(values.length == symbols.length, "values and symbols must be 1:1");

        // Recalculate the asset prices for the symbols to update
        for (uint i = 0; i < values.length; i++) {
            prices[symbols[i]] = values[i];
        }
    }

}
