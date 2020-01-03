pragma solidity ^0.5.12;

import { ManagerState } from "./ManagerState.sol";
import { IOracleHub } from "../interfaces/IOracleHub.sol";

/**
 * @title ManagerPortal
 * @dev Provides Massets with prices and general interface into system by
 * hooking into the current OracleHub Implementation and parsing the data
 */
contract ManagerPortal is ManagerState {

    /**
      * @dev Fetch relevant information used for setting up a Masset
      * @return Systok address
      * @return ForgeLib address
      * @return Governance address
      */
    function getModuleAddresses()
    external
    view
    returns(address, address, address) {
        return (address(systok), address(forgeLib), address(governance));
    }

    /**
      * @dev Fetch the price of Systok from OracleHub
      * Reverts if price is not available
      * @return uint256 Price of Systok where $1 == 1e18
      */
    function getSystokPrice()
    external
    view
    returns(uint256) {
        return _mustGetPriceFromOracle(oracle_key_systok);
    }

    /**
      * @dev Fetch the price of a Masset from OracleHub
      * Reverts if price is not available
      * @param _addr Address of the Masset
      * @return uint256 Price of Masset where $1 == 1e18
      * @return uint256 Price of Systok where $1 == 1e18
      */
    function getMassetPrice(address _addr)
    external
    view
    returns(uint256 massetPrice, uint256 systokPrice) {
        // Get the relevant masset key
        bytes32 key = massets.get(_addr);

        // Fetch the prices where $1 == 1e6
        (bool[2] memory isFresh, uint64[2] memory prices) = oracleHub.readPricePair([key, oracle_key_systok]);

        // Validate state of the response
        require(prices.length == 2, "Must return valid pair");
        for(uint i = 0; i < prices.length; i++){
          require(isFresh[i] && prices[i] > 0, "Prices must exist and be fresh");
        }

        // Cast prices into relevant format
        return (prices[0] * 1e12, prices[1] * 1e12);
    }

    /**
      * @dev Fetch a price from OracleHub - revert if specified conditions are not met
      * @param _key Identifier of the asset
      * @return uint256 Price of asset where $1 == 1e18
      */
    function _mustGetPriceFromOracle(bytes32 _key)
    internal
    view
    returns(uint256) {
        (bool isFresh, uint256 price) = _getPriceFromOracle(_key);
        require(price > 0, "Price must exist in Oracle");
        require(isFresh, "Price must be fresh in Oracle");
        return price;
    }

    /**
      * @dev Fetch a price from OracleHub - revert if specified conditions are not met
      * @param _key Identifier of the asset
      * @return bool isFresh price is fresh
      * @return uint256 Price of asset where $1 == 1e18
      */
    function _getPriceFromOracle(bytes32 _key)
    internal
    view
    returns(bool, uint256) {
        // Get price as 1e6
        (bool isFresh, uint64 price) = oracleHub.readPrice(_key);
        // Convert price from 1e6 to 1e18
        return (isFresh, price * 1e12);
    }

}