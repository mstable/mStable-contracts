pragma solidity ^0.5.12;

import { INexus } from "../interfaces/INexus.sol";
import { ModuleKeys } from "../shared/ModuleKeys.sol";
import { Set } from "../shared/libs/Set.sol";

/**
 * @title Nexus
 * @dev The Nexus is mStable's Kernel, and allows the publishing and propagating
 * of new system Modules. Other Modules will subscribe to Nexus for reads and updates
 */
contract Nexus is INexus, ModuleKeys {

    event ModuleAdded(bytes32 key, address addr);

    /** @dev Struct to store Module props */
    struct Module {
        address _address;
        bool _isLocked;
    }

    /** @dev Storage architecture for keeping module information */
    mapping(bytes32 => Module) moduleAddresses;


    /** @dev Initialises the Nexus and adds the core data to the Kernel (itself and governor) */
    constructor(address _governor)
    public {
        require(_governor != address(0), "Can't set governor to zero address");
        _publishModule(Key_Governor, _governor);
        _publishModule(Key_Nexus, address(this));
    }


    /***************************************
                  MODIFIERS
    ****************************************/

    /** @dev Verifies that the caller is the System Governor as defined in the module mapping */
    modifier onlyGovernor() {
        require(moduleAddresses[Key_Governor]._address == msg.sender, "Only the governance may perform this operation");
        _;
    }

    /**
      * @dev Action can only be taken on an unlocked module
      * @param _key Bytes key for the module
     */
    modifier onlyUnlockedModule(bytes32 _key) {
        Module memory m = moduleAddresses[_key];
        require(!m._isLocked, "Module must be unlocked");
        _;
    }


    /***************************************
                    READING
    ****************************************/


    function getModule(bytes32 _key)
    external
    view
    returns (address) {
        address addr = moduleAddresses[_key]._address;
        require(addr != address(0), "Must have valid module address");
        return addr;
    }


    /***************************************
                    ADDING
    ****************************************/

    /**
      * @dev Adds a new module to the system or updates existing
      * @param _key Key of the new module in bytes32 form
      * @param _addr Contract address of the new module
      * @return bool Success of publishing new Module
      */
    function addModule(bytes32 _key, address _addr)
    external
    onlyGovernor
    returns (bool) {
        _publishModule(_key, _addr);
        return true;
    }

    /**
      * @dev Adds multiple new modules to the system
      * @param _keys Keys of the new modules in bytes32 form
      * @param _addresses Contract addresses of the new modules
      * @return bool Success of publishing new Modules
      */
    function addModules(bytes32[] calldata _keys, address[] calldata _addresses)
    external
    onlyGovernor
    returns (bool) {
        uint count = _keys.length;
        require(count == _addresses.length, "");
        require(count > 0, "");

        for(uint i = 0 ; i < count; i++){
            _publishModule(_keys[i], _addresses[i]);
        }

        return true;
    }

    /**
      * @dev Internal func to publish a module and broadcast to subscribers
      * @param _key Key of the new module in bytes32 form
      * @param _addr Contract address of the new module
      */
    function _publishModule(bytes32 _key, address _addr)
    internal
    onlyUnlockedModule(_key) {
        moduleAddresses[_key]._address = _addr;
    }


    /***************************************
                    LOCKING
    ****************************************/

    /**
      * @dev Permanently lock a module to its current settings
      * @param _key Bytes32 key of the module
      */
    function lockModule(bytes32 _key)
    external
    onlyGovernor
    onlyUnlockedModule(_key)
    returns (bool) {
        moduleAddresses[_key]._isLocked = true;
        return true;
    }
}