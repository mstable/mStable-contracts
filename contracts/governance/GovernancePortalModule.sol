pragma solidity ^0.5.12;

import { ModuleSub, IModulePub } from "../shared/pubsub/ModuleSub.sol";

import { IManager } from "../interfaces/IManager.sol";

/**
 * @title GovernancePortalModule
 * @dev Acts as a subscriber to the Nexus, which publishes each new Module that is introduced
 * to the system
 */
contract GovernancePortalModule is ModuleSub {

    /** @dev Events to emit */
    event ModuleActivated(bytes32 indexed key, address addr);

    /** @dev Keep track of the Manager address */
    IManager manager;

    /**
      * @dev Initialises this Module by setting the publisher on ModuleSub
      * @param _pub Address of the Publisher (Nexus) module
      */
    constructor(address _pub) ModuleSub(_pub) public {}


    modifier onlyManager() {
        require(msg.sender == address(manager), "Only Manager may perform this action");
        _;
    }

    /**
      * @dev Internally handles updates to the system modules
      * @param _key         Module key
      * @param _newAddress  Address of the updated Module
      */
    function _internalUpdateModule(bytes32 _key, address _newAddress)
    internal {
        if(_key == Key_Manager){
            manager = IManager(_newAddress);
        }
        emit ModuleActivated(_key, _newAddress);
    }
}