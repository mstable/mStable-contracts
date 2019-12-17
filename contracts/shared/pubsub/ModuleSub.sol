pragma solidity ^0.5.12;

import { ModuleKeys } from "./ModuleKeys.sol";

/**
  * @title ModulePub
  * @dev Lite interface for ModulePub to avoid recursive imports
  */
interface IModulePub {
  function getModule(bytes32 key) external returns (address);
  function getModules() external returns (uint count, bytes32[] memory keys, address[] memory addresses);
}

/**
  * @title ModuleSub
  * @dev Subscribes to module updates from a given publisher and reads from its registry
  */
contract ModuleSub is ModuleKeys {

    /** @dev Publisher of information */
    address publisher;

    /** @dev Initialises the Module by setting publisher, and reading all available system module information */
    constructor(address _pub) internal {
        publisher = _pub;

        // Get all available modules from the Publisher and sanitize them
        (uint count, bytes32[] memory mKeys, address[] memory mAddresses) = IModulePub(_pub).getModules();
        for(uint i = 0; i < count; i++){
            _internalUpdateModule(mKeys[i], mAddresses[i]);
        }
    }

    /** @dev Ensures that the caller of the function is the publisher */
    modifier onlyPub() {
        require(publisher == msg.sender, "Only publisher may call this method");
        _;
    }

    /** @dev Ensures that the caller of the function is a specific system module */
    modifier onlyModule(bytes32 _module) {
        require(msg.sender == IModulePub(publisher).getModule(_module), "Method not called by the whitelisted module");
        _;
    }

    /**
      * @dev Higher order function to allow for module updates only via publisher
      * @param _key Key of the new module
      * @param _newAddress Address of the new module
      */
    function updateModule(bytes32 _key, address _newAddress)
    external
    onlyPub {
        if (_key == ModuleKeys.Key_Nexus) {
            publisher = _newAddress;
        }
        _internalUpdateModule(_key, _newAddress);
    }

    /**
      * @dev Internal, lower order function to allow for module updates only via publisher
      * Implementers of ModuleSub will override this abstract function.
      * @param _key Key of the new module
      * @param _newAddress Address of the new module
      */
    function _internalUpdateModule(bytes32 _key, address _newAddress) internal;
}
