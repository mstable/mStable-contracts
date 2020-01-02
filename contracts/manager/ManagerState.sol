pragma solidity ^0.5.12;

import { IMasset } from "../interfaces/IMasset.sol";
import { IManager } from "../interfaces/IManager.sol";
import { IGovernancePortal } from "../interfaces/IGovernancePortal.sol";
import { IRecollateraliser } from "../interfaces/IRecollateraliser.sol";
import { ISystok } from "../interfaces/ISystok.sol";
import { IOracleHub } from "../interfaces/IOracleHub.sol";

import { DictionaryAtoB } from "../shared/libs/DictionaryAtoB.sol";


/**
 * @title ManagerState
 * @dev Holds and provides read access to the core data and state required by
 * the Managment and Masset contracts
 *
 * TODO
 * Optimise data structure as shown in comments
 * The Basket adjustments and oracle interaction will likely dictate requirements here
 */
contract ManagerState  {

    /** @dev Custom dictionary for managing data structures */
    using DictionaryAtoB for DictionaryAtoB.AddressToBytes32;

    /** @dev References to current system Module implementations */
    address public governor;
    IGovernancePortal governance;
    ISystok systok;
    IOracleHub oracleHub;
    IRecollateraliser recollateraliser;

    /** @dev Address of latest ForgeLib implementation */
    address public forgeLib;


    /** @dev Hard coded Systok key for calling OracleHub */
    bytes32 oracle_key_systok = "MTA";


    /**
     * @dev Deviation thresholds for detecting peg loss and initiating re-collateralisation
     * 1e17 == 10% deviation, i.e. if Basset deviates >= 10% from its target peg
     */
    uint256 constant base_price = 1e18;
    uint256 constant neg_deviation_threshold = 1e17;
    uint256 constant pos_deviation_threshold = 1e17;
    /* solium-disable-next-line */
    uint internal lastPegDetection = block.timestamp;


    /** @dev Data structure of the Masset and Bassets
      * TODO - Can we combine this data structure into some struct to optimise reading data
      * Maybe a Dictionary of Bytes32 to Masset struct
      * What purpose do these byte8 identifiers make over addresses? */
    DictionaryAtoB.AddressToBytes32 massets;


    /**
      * @dev Verifies that the caller is the Governor
      */
    modifier onlyGovernance() {
        require(governor == msg.sender || address(governance) == msg.sender, "Only the governor");
        _;
    }

    /** @dev ??? */
    modifier onlyAuction() {
        require(msg.sender == address(recollateraliser), "Must be recol module");
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

    /**
      * @dev Get the addresses and oracle keys for all the Massets
      * @return bytes32 Array of Masset identifiers
      */
    function _getBassets(address _masset)
    internal
    view
    returns(address[] memory, bytes32[] memory) {
        require(massets.contains(_masset), "Masset must exist");
        IMasset masset = IMasset(_masset);
        (address[] memory addresses, bytes32[] memory keys, , , , ) = masset.getBassets();
        return (addresses, keys);
    }

}