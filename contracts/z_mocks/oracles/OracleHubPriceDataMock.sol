
pragma solidity ^0.5.12;
pragma experimental ABIEncoderV2;

import { OracleHubPriceData } from "../../oracle-hub/OracleHub.sol";

/**
 * @title OracleHubPriceDataMock implementing OracleHubPrieData
 */
contract OracleHubPriceDataMock is OracleHubPriceData {


    // struct Datum {
    //     uint64 timestamp;
    //     uint64 value;
    // }

    // mapping(address => mapping(bytes32 => Datum)) private data;

    // function getPrice(address source, bytes32 key) external view returns (uint64) {
    //     return data[source][key].value;
    // }

    // function addMockPrice(uint64 value, uint64 timestamp, bytes32 symbol, address source) external {
    //     data[source][symbol] = Datum(timestamp, value);
    // }
}
