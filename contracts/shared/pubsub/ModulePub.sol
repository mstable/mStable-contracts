pragma solidity ^0.5.12;

import { Set } from "../libs/Set.sol";
import { ModuleKeys } from "./ModuleKeys.sol";

/**
  * @title IModuleSub
  * @dev Lite interface for ModuleSub to avoid recursive imports
  */
interface IModuleSub {
    function updateModule(bytes32 _key, address _address) external;
}

/**
  * @title ModulePub
  * @dev Publishes module information to subscribers and maintains registry for lookup
  */
contract ModulePub is ModuleKeys {

    using Set for Set.Bytes32;

    /** @dev Struct to store Module props */
    struct Module {
        address _address;
        bool _isSub;
    }

    /** @dev Storage architecture for keeping module information */
    Set.Bytes32 moduleKeys;
    mapping(bytes32 => Module) moduleAddresses;

    /**
      * @dev Internal func to publish a module and broadcast to subscribers
      * @param _key Key of the new module in bytes32 form
      * @param _moduleAddress Contract address of the new module
      * @param _isSubscriber Should we publish new updates to the module?
      */
    function _publishModule(bytes32 _key, address _moduleAddress, bool _isSubscriber)
    internal {
        // Broadcast the new module to all other modules
        for(uint256 i = 0; i < moduleKeys.values.length; i++) {
            Module memory m = moduleAddresses[moduleKeys.values[i]];

            // Module must have specifically subscribed for updates to reveive broadcast
            if(m._isSub == false) continue;

            IModuleSub(m._address).updateModule(_key,  _moduleAddress);
        }

        // Add new module to internal mappings
        moduleKeys.add(_key);
        moduleAddresses[_key] = Module(_moduleAddress, _isSubscriber);
    }

    /**
      * @dev Internal func to remove a module from the system
      * @param _key Key of the module to remove
      */
    function _forgetModule(bytes32 _key)
    internal {
        // Firstly, remove the module from local storage
        moduleKeys.remove(_key);
        delete moduleAddresses[_key];

        // Propagate the removal to all other modules
        for(uint256 i = 0; i < moduleKeys.values.length; i++) {
            Module memory m = moduleAddresses[moduleKeys.values[i]];

            // Module must have specifically subscribed for updates
            if(m._isSub == false) continue;

            IModuleSub(m._address).updateModule(_key,  address(0));
        }
    }

    /**
      * @dev Gets the current address of a particular module
      * @param _key Bytes32 key of the target module
      * @return Current address of the module
      */
    function getModule(bytes32 _key)
    external
    view
    returns (address) {
        return moduleAddresses[_key]._address;
    }

    /**
      * @dev Gets all active modules in the system
      * @return uint256 count of all modules
      * @return bytes32[] keys of all modules
      * @return address[] current addresses of all modules
      */
    function getModules()
    external
    view
    returns (uint count, bytes32[] memory keys, address[] memory addresses) {
        count = moduleKeys.values.length;
        keys = new bytes32[](count);
        addresses = new address[](count);
        for(uint i = 0; i < count; i++){
            keys[i] = moduleKeys.values[i];
            addresses[i] = moduleAddresses[keys[i]]._address;
        }
    }
}
