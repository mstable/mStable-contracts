
pragma solidity ^0.5.12;
pragma experimental ABIEncoderV2;

import { ModuleSub } from "../shared/pubsub/ModuleSub.sol";

import { IOracleHub } from "../interfaces/IOracleHub.sol";

import { OracleHubModule } from "./OracleHubModule.sol";
import { OracleHubView } from "./open-oracle/OracleHubView.sol";
import { OracleHubPriceData } from "./open-oracle/OracleHubPriceData.sol";

/**
 * @notice mStable OracleHub
 * @author Stability Labs, based on compound-finance/open-oracle/DelFiPrice.sol
 *
 *
 *    TODO ----------------------- This can be simplified so much
 *    If our initial OracleHub is only going to trust ONE single price provider
 *    Then we should simply post/read straight from the data pool.. and skip medianization
 *
 */
contract OracleHub is IOracleHub, OracleHubView, OracleHubModule {

    /**
     * @notice The event emitted when a price is written to storage
     */
    event Price(bytes32 symbol, uint64 price);

    /**
     * @notice The mapping of medianized prices per symbol
     */
    mapping(bytes32 => uint64) public prices;

    constructor(
        address _governor,
        address _nexus,
        OracleHubPriceData _data,
        address[] memory _sources
    )
        OracleHubView(_data, _sources)
        OracleHubModule(_nexus)
        public
    {
        governor = _governor;
    }

    /** @dev Verifies that the caller is the System Governor as defined in the module mapping */
    modifier onlyGovernor() {
        require(governor == msg.sender, "Only the governor may perform this operation");
        _;
    }


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
        return (true, prices[_key]);
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
    returns(bool[] memory _isFresh, uint64[] memory _prices) {
        _isFresh = new bool[](_keys.length);
        _prices = new uint64[](_keys.length);
        for(uint i = 0; i < _keys.length; i++){
          (_isFresh[i], _prices[i]) = (true, prices[_keys[i]]);
        }
    }

    /**
     * @dev Whitelist a source for use in medianizing
     * @param _newSource Address of the whitelisted source
     */
    function addSource(address _newSource)
    external
    onlyGovernor {
        sources.push(_newSource);
    }

    /**
     * @notice Primary entry point to post and recalculate prices
     * @dev We let anyone pay to post anything, but only sources count for prices.
     * @param messages The messages to post to the oracle
     * @param signatures The signatures for the corresponding messages
     */
    function postPrices(
        bytes[] calldata messages,
        bytes[] calldata signatures,
        bytes32[] calldata symbols
    ) external {
        require(messages.length == signatures.length, "messages and signatures must be 1:1");

        // Post the messages, whatever they are
        for (uint i = 0; i < messages.length; i++) {
            OracleHubPriceData(address(data)).put(messages[i], signatures[i]);
        }

        // Recalculate the asset prices for the symbols to update
        for (uint i = 0; i < symbols.length; i++) {
            bytes32 symbol = symbols[i];

            // Calculate the median price, write to storage, and emit an event
            uint64 price = medianPrice(symbol, sources);
            prices[symbol] = price;
            emit Price(symbol, price);
        }
    }

    /**
     * @notice Calculates the median price over any set of sources
     * @param symbol The symbol to calculate the median price of
     * @param sources_ The sources to use when calculating the median price
     * @return median The median price over the set of sources
     */
    function medianPrice(bytes32 symbol, address[] memory sources_)
    public
    view
    returns (uint64 median) {
        require(sources_.length > 0, "sources list must not be empty");

        uint N = sources_.length;
        uint64[] memory postedPrices = new uint64[](N);
        for (uint i = 0; i < N; i++) {
            postedPrices[i] = OracleHubPriceData(address(data)).getPrice(sources_[i], symbol);
        }

        uint64[] memory sortedPrices = sort(postedPrices);
        return sortedPrices[N / 2];
    }

    /**
     * @notice Helper to sort an array of uints
     * @param array Array of integers to sort
     * @return The sorted array of integers
     */
    function sort(uint64[] memory array)
    private
    pure
    returns (uint64[] memory) {
        uint N = array.length;
        for (uint i = 0; i < N; i++) {
            for (uint j = i + 1; j < N; j++) {
                if (array[i] > array[j]) {
                    uint64 tmp = array[i];
                    array[i] = array[j];
                    array[j] = tmp;
                }
            }
        }
        return array;
    }
}