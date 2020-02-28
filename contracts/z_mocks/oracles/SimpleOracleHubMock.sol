
pragma solidity ^0.5.16;
pragma experimental ABIEncoderV2;

import { SimpleOracleHub } from "../../oracle-hub/SimpleOracleHub.sol";

/**
 * @title OracleHubMock allows us to put custom price data into the Oracle without signing messages
 * @notice Values stored in this contract should represent a relative price to pegged asset
 * @author Stability Labs
 */
contract SimpleOracleHubMock is SimpleOracleHub {

    event ReadPrice(address symbol, uint64 timestampSaved, uint64 timestampNow);

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
        address[] calldata assets
    ) external {
        require(values.length == assets.length, "Values and symbols must be 1:1");

        // Recalculate the asset prices for the symbols to update
        for (uint256 i = 0; i < values.length; i++) {
            data[assets[i]] = Datum(timestamps[i], values[i]);
        }
    }

    /**
     * @dev Read a medianized price from our storage
     * @param _asset Key of the asset to read price
     * @return bool price is fresh
     * @return uint64 Price as $1 == 1e6
     */
    function readPriceNow(address _asset)
    external
    view
    returns(bool, uint64, uint64, uint64) {
        Datum memory m = data[_asset];
        bool isFresh = m.timestamp <= now && m.timestamp > (now - 24 hours);
        return (isFresh, m.value, m.timestamp, uint64(now));
    }

}
