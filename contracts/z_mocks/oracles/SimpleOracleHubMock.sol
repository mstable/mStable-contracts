
pragma solidity ^0.5.12;
pragma experimental ABIEncoderV2;

import { SimpleOracleHub } from "../../oracle-hub/SimpleOracleHub.sol";

/**
 * @title OracleHubMock allows us to put custom price data into the Oracle without signing messages
 * @notice Values stored in this contract should represent a relative price to pegged asset
 * @author Stability Labs
 */
contract SimpleOracleHubMock is SimpleOracleHub {


    constructor(
        address _nexus,
        address _source
    )
        SimpleOracleHub(
            _nexus,
            _source
        )
        public
    {}


    function addMockPrices(
        uint64[] calldata values,
        uint64[] calldata timestamps,
        bytes32[] calldata symbols
    ) external {
        require(values.length == symbols.length, "Values and symbols must be 1:1");

        // Recalculate the asset prices for the symbols to update
        for (uint i = 0; i < values.length; i++) {
            data[symbols[i]] = Datum(timestamps[i], values[i]);
        }
    }

}
