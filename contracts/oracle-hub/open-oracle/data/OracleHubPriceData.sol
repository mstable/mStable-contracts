
/*
 * Based on compound-finance/open-oracle
 *
 * https://github.com/compound-finance/open-oracle
 */


pragma solidity ^0.5.12;
pragma experimental ABIEncoderV2;

import "./OracleHubData.sol";

/**
 * @title The Oracle Hub Price Data Contract
 * @notice Values stored in this contract should represent a USD price with 6 decimals precision
 * @author Stability Labs. based on compound-finance/open-oracle/OpenOraclePriceData.sol
 */
contract OracleHubPriceData is OracleHubData {
    /**
     * @notice The event emitted when a source writes to its storage
     */
    event Write(address indexed source, bytes32 key, uint64 timestamp, uint64 value);

    /**
     * @notice The fundamental unit of storage for a reporter source
     */
    struct Datum {
        uint64 timestamp;
        uint64 value;
    }

    /**
     * @notice The most recent authenticated data from all sources
     * @dev This is private because dynamic mapping keys preclude auto-generated getters.
     */
    mapping(address => mapping(bytes32 => Datum)) private data;

    /**
     * @notice Write a bunch of signed datum to the authenticated storage mapping
     * @param message The payload containing the timestamp, and (key, value) pairs
     * @param signature The cryptographic signature of the message payload, authorizing the source to write
     * @return The keys that were written
     */
    function put(bytes calldata message, bytes calldata signature) external returns (bytes32) {
        // Recover the source address
        address source = source(message, signature);

        // Decode the message and check the kind
        (string memory kind, uint64 timestamp, bytes32 key, uint64 value) = abi.decode(message, (string, uint64, bytes32, uint64));
        require(keccak256(abi.encodePacked(kind)) == keccak256(abi.encodePacked("prices")), "Kind of data must be 'prices'");

        // Only update if newer than stored, according to source
        Datum storage prior = data[source][key];
        if (prior.timestamp < timestamp) {
            data[source][key] = Datum(timestamp, value);
            emit Write(source, key, timestamp, value);
        }

        return key;
    }

    /**
     * @notice Read a single key from an authenticated source
     * @param source The verifiable author of the data
     * @param key The selector for the value to return
     * @return The claimed Unix timestamp for the data and the price value (defaults to (0, 0))
     */
    function get(address source, bytes32 key) external view returns (uint64, uint64) {
        Datum storage datum = data[source][key];
        return (datum.timestamp, datum.value);
    }

    /**
     * @notice Read only the value for a single key from an authenticated source
     * @param source The verifiable author of the data
     * @param key The selector for the value to return
     * @return The price value (defaults to 0)
     */
    function getPrice(address source, bytes32 key) external view returns (uint64) {
        return data[source][key].value;
    }
}
