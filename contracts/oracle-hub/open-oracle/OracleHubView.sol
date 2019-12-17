
/*
 * Based on compound-finance/open-oracle
 *
 * https://github.com/compound-finance/open-oracle
 */


pragma solidity ^0.5.12;
pragma experimental ABIEncoderV2;

import { OracleHubData } from "./OracleHubData.sol";

/**
 * @title The Open Hub View Base Contract
 * @author Stability Labs. based on compound-finance/open-oracle/OpenOracleView.sol
 */
contract OracleHubView {
    /**
     * @notice The Oracle Data Contract backing this View
     */
    OracleHubData public data;

    /**
     * @notice The static list of sources used by this View
     * @dev Note that while it is possible to create a view with dynamic sources,
     *  that would not conform to the Open Oracle Standard specification.
     */
    address[] public sources;

    /**
     * @notice Construct a view given the oracle backing address and the list of sources
     * @dev According to the protocol, Views must be immutable to be considered conforming.
     * @param data_ The address of the oracle data contract which is backing the view
     * @param sources_ The list of source addresses to include in the aggregate value
     */
    constructor(OracleHubData data_, address[] memory sources_) public {
        data = data_;
        sources = sources_;
    }
}
