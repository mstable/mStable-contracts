pragma solidity 0.5.16;

import { Module } from "../shared/Module.sol";
import { DictionaryAtoB } from "../shared/libs/DictionaryAtoB.sol";


/**
 * @title ManagerState
 * @dev Holds and provides read access to the core data and state required by
 * the Managment and Masset contracts
 */
contract ManagerState is Module {

    /** @dev Custom dictionary for managing data structures */
    using DictionaryAtoB for DictionaryAtoB.AddressToBytes32;

    /** @dev Data structure of the Masset and Bassets */
    DictionaryAtoB.AddressToBytes32 massets;

    /**
     * @dev Deviation thresholds for detecting peg loss and initiating re-collateralisation
     * 1e17 == 10% deviation, i.e. if Basset deviates >= 10% from its target peg
     */
    uint256 public constant base_price = 1e18;
    uint256 public constant neg_deviation_threshold = 5e16;
    uint256 public constant pos_deviation_threshold = 5e16;


    constructor(address _nexus) Module(_nexus) internal {
    }

    /**
      * @dev Get the addresses and oracle keys for all the Massets
      * @return bytes32 Array of Masset identifiers
      */
    function getMassets()
        external
        view
        returns(address[] memory addr, bytes32[] memory keys)
    {
        return (massets.keys, massets.values());
    }

}