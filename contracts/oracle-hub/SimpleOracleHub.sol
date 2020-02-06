
pragma solidity ^0.5.12;
pragma experimental ABIEncoderV2;

import { IOracleHub } from "../interfaces/IOracleHub.sol";
import { Module } from "../shared/Module.sol";

/**
 * @notice mStable SimpleOracleHub
 * @author Stability Labs, based on compound-finance/open-oracle/DelFiPrice.sol
 */
contract SimpleOracleHub is IOracleHub, Module {

    /**
     * @notice The event emitted when a price is written to storage
     */
    event Price(bytes32 symbol, uint64 timestamp, uint64 price);

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
    mapping(bytes32 => Datum) internal data;

    address validatedSource;

    constructor(
        address _nexus,
        address _source
    )
        Module(_nexus)
        public
    {
        validatedSource = _source;
    }

    /**
     * @dev Whitelist a source for use in medianizing
     * @param _newSource Address of the whitelisted source
     */
    function changeSource(address _newSource)
    external
    onlyGovernor {
        validatedSource = _newSource;
    }


    /***************************************
                    READING
    ****************************************/


    /**
     * @dev Read a medianized price from our storage
     * @param _key Key of the asset to read price
     * @return bool price is fresh
     * @return uint64 Price as $1 == 1e6
     */
    function readPrice(bytes32 _key)
    external
    view
    returns(bool, uint64) {
        Datum memory m = data[_key];
        bool isFresh = m.timestamp < now && m.timestamp > (now - 24 hours);
        return (isFresh, m.value);
    }

    /**
     * @dev Read a medianized price from our storage
     * @param _keys Keys of the asset to read price
     * @return bool price is fresh
     * @return uint64 Price as $1 == 1e6
     */
    function readPricePair(bytes32[2] calldata _keys)
    external
    view
    returns(bool[2] memory _isFresh, uint64[2] memory _prices) {
        require(_keys.length == 2,  "Valid array");
        for(uint i = 0; i < 2; i++){
            Datum memory m = data[_keys[i]];
            bool isFresh = m.timestamp < now && m.timestamp > (now - 24 hours);
            (_isFresh[i], _prices[i]) = (isFresh, m.value);
        }
    }


    /***************************************
                    WRITING
    ****************************************/

    /**
     * @notice Primary entry point to post and recalculate prices
     * @dev Message must be signed by the validated source in order to be valid
     * @param messages The messages to post to the oracle
     * @param signatures The signatures for the corresponding messages
     */
    function postPrices(
        bytes[] calldata messages,
        bytes[] calldata signatures
    ) external {
        require(messages.length == signatures.length, "messages and signatures must be 1:1");

        // Post the messages, whatever they are
        for (uint i = 0; i < messages.length; i++) {
            put(messages[i], signatures[i]);
        }
    }

    /**
     * @notice Write a bunch of signed datum to the authenticated storage mapping
     * @param message The payload containing the timestamp, and (key, value) pairs
     * @param signature The cryptographic signature of the message payload, authorizing the source to write
     * @return The keys that were written
     */
    function put(bytes memory message, bytes memory signature) internal returns (bytes32) {
        // Recover the source address
        address _source = source(message, signature);

        require(_source == validatedSource, "Only prices signed by the validated source are allowed");

        // Decode the message and check the kind
        (string memory kind, uint64 timestamp, bytes32 key, uint64 value) = abi.decode(message, (string, uint64, bytes32, uint64));
        require(keccak256(abi.encodePacked(kind)) == keccak256(abi.encodePacked("prices")), "Kind of data must be 'prices'");

        // Only update if newer than stored, according to source
        Datum storage prior = data[key];
        if (prior.timestamp < timestamp) {
            data[key] = Datum(timestamp, value);
            emit Price(key, timestamp, value);
        }

        return key;
    }

    /**
     * @notice Recovers the source address which signed a message
     * @dev Comparing to a claimed address would add nothing,
     *  as the caller could simply perform the recover and claim that address.
     * @param message The data that was presumably signed
     * @param signature The fingerprint of the data + private key
     * @return The source address which signed the message, presumably
     */
    function source(bytes memory message, bytes memory signature) internal pure returns (address) {
        (bytes32 r, bytes32 s, uint8 v) = abi.decode(signature, (bytes32, bytes32, uint8));
        bytes32 hash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", keccak256(message)));
        return ecrecover(hash, v, r, s);
    }
}