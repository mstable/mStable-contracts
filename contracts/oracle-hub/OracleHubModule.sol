pragma solidity ^0.5.12;

import { ModuleSub } from "../shared/pubsub/ModuleSub.sol";

import { IManager } from "../interfaces/IManager.sol";


/**
 * @title OracleHubModule
 * @dev Acts as a subscriber to the Nexus, which publishes each new Module that is introduced
 * to the system.
 */
contract OracleHubModule is ModuleSub {

    /** @dev The governor is permitted to take action throughout the system */
    address governor;


    /** @dev Events to emit */
    event ModuleUpdated(bytes32 indexed key, address newAddress);

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

        if (_key == Key_Governor) {
            governor = _newAddress;
        }
    }
}