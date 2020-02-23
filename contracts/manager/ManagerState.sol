pragma solidity ^0.5.12;

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

    /** @dev Hard coded Systok key for calling OracleHub */
    bytes32 internal oracle_key_systok = "MTA";

    /** @dev Data structure of the Masset and Bassets */
    DictionaryAtoB.AddressToBytes32 massets;


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