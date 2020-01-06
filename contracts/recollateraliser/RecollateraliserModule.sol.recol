pragma solidity ^0.5.12;

import { ModuleSub } from "../shared/pubsub/ModuleSub.sol";

import { ISystok } from "../interfaces/ISystok.sol";
import { IManager } from "../interfaces/IManager.sol";

/**
 * @title ManagerModule
 */
contract RecollateraliserModule is ModuleSub {

    /** @dev Events to emit */
    event ModuleUpdated(bytes32 indexed key, address newAddress);

    /** @dev References to current system Module implementations */
    IManager manager;
    ISystok systok;

    /**
      * @dev Initialises this Module by setting the publisher on ModuleSub
      * @param _pub Address of the Publisher (Nexus) module
      */
    constructor(address _pub) ModuleSub(_pub) public {}


    /**
      * @dev Internally handles updates to the system modules
      * @param _key         Module key
      * @param _newAddress  Address of the updated Module
      */
    function _internalUpdateModule(bytes32 _key, address _newAddress)
    internal {
        emit ModuleUpdated(_key, _newAddress);
      
        if (_key == Key_Manager) {
            manager = IManager(_newAddress);
        }
    }
}