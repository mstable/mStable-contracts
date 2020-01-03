pragma solidity ^0.5.12;
pragma experimental ABIEncoderV2;


import { IMassetFactory } from "../interfaces/IMassetFactory.sol";

import { ManagerState, IMasset, IManager } from "./ManagerState.sol";

import { DictionaryBtoA } from "../shared/libs/DictionaryBtoA.sol";


/**
 * @title MassetFactory
 * @dev This Factory creates and manages mStable Assets under direction of the governor
 * It also allows governor to add or remove specific MassetFactories from the stack, allowing
 * the creation of various types of Massets
 */
contract MassetFactory is ManagerState {

    /** @dev Custom dictionary for managing data structures */
    using DictionaryBtoA for DictionaryBtoA.Bytes32ToAddress;

    /** @dev Events to emit */
    event MassetAdded(bytes32 indexed key, address addr);
    event MassetEjected(bytes32 indexed key, address addr);


    /**
      * @dev Adds an already and initialised Masset to the stack, storing the relevant data in the ManagerState
      * @param _massetKey     Key identifier for the Masset
      * @param _masset        Address of the Masset contract
      * @return               Address of new Masset
      */
    function addMasset(
        bytes32 _massetKey,
        address _masset
    )
        external
        onlyGovernance
        returns (address)
    {
        require(_masset != address(0), "Masset must be a referenced implementation");

        massets.add(_masset, _massetKey);

        emit MassetAdded(_massetKey, _masset);
        return _masset;
    }

    /**
      * @dev Removes a Masset from the system and thus releases from protection
      * @param _masset        Address of the Masset contract
      */
    function ejectMasset(
        address _masset
    )
        external
        onlyGovernance
    {
        require(_masset != address(0), "Masset must be a referenced implementation");
        bytes32 key = massets.get(_masset);
        require(key != bytes32(0x0), "Masset must be a referenced implementation");

        IMasset(_masset).setManager(IManager(address(0)));

        massets.remove(_masset);

        emit MassetEjected(key, _masset);
    }
}