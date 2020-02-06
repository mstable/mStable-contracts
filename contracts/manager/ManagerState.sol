pragma solidity ^0.5.12;

import { IMasset } from "../interfaces/IMasset.sol";
import { ISystok } from "../interfaces/ISystok.sol";
import { IOracleHub } from "../interfaces/IOracleHub.sol";

import { Module } from "../shared/

import { DictionaryAtoB } from "../shared/libs/DictionaryAtoB.sol";


/**
 * @title ManagerState
 * @dev Holds and provides read access to the core data and state required by
 * the Managment and Masset contracts
 */
contract ManagerState is Module {

    /** @dev Custom dictionary for managing data structures */
    using DictionaryAtoB for DictionaryAtoB.AddressToBytes32;

    /** @dev References to current system Module implementations */
    IGovernancePortal governance;
    ISystok systok;
    IOracleHub oracleHub;

    /** @dev Address of latest ForgeLib implementation */
    address public forgeLib;


    /** @dev Hard coded Systok key for calling OracleHub */
    bytes32 oracle_key_systok = "MTA";


    /** @dev Data structure of the Masset and Bassets */
    DictionaryAtoB.AddressToBytes32 massets;


    /**
      * @dev Verifies that the caller is the Governor
      */
    modifier onlyGovernance() {
        require(address(governance) == msg.sender, "Only the governor");
        _;
    }

    /**
      * @dev Get the addresses and oracle keys for all the Massets
      * @return bytes32 Array of Masset identifiers
      */
    function getMassets()
    external
    view
    returns(address[] memory addr, bytes32[] memory keys) {
        return (massets.keys, massets.values());
    }

}