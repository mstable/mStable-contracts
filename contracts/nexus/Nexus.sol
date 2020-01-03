pragma solidity ^0.5.12;

import { INexus } from "../interfaces/INexus.sol";
import { ModulePub } from "../shared/pubsub/ModulePub.sol";

/**
 * @title Nexus
 * @dev The Nexus is mStable's Kernel, and allows the publishing and propagating
 * of new system Modules. Other Modules will subscribe to Nexus for reads and updates
 */
contract Nexus is INexus, ModulePub {


    /** @dev Initialises the Nexus and adds the core data to the Kernel (itself and governor) */
    constructor(address _governor)
    public {
        require(_governor != address(0), "Can't set governor to zero address");
        _publishModule(Key_Governance, _governor, false);
        _publishModule(Key_Nexus, address(this), false);
    }


    /** @dev Verifies that the caller is the System Governor as defined in the module mapping */
    modifier onlyGovernance() {
        require(moduleAddresses[Key_Governance]._address == msg.sender, "Only the governance may perform this operation");
        _;
    }

    /**
      * @dev Adds a new module to the system and publishes to subscribers
      * @param _moduleKey Key of the new module in bytes32 form
      * @param _module Contract address of the new module
      * @return bool Success of publishing new Module
      */
    function addModule(bytes32 _moduleKey, address _module)
    public
    onlyGovernance
    returns (bool) {
        _publishModule(_moduleKey, _module, true);
        return true;
    }

    /**
      * @dev Used for updating deaf module (i.e. governor)
      * @param _moduleKey Key of the new module in bytes32 form
      * @param _module Contract address of the new module
      * @return bool Success of publishing new Module
      */
    function addDeafModule(bytes32 _moduleKey, address _module)
    public
    onlyGovernance
    returns (bool) {
        _publishModule(_moduleKey, _module, false);
        return true;
    }


    /**
      * @dev Adds multiple new modules to the system and publishes them to subscribers
      * @param _moduleKeys Keys of the new modules in bytes32 form
      * @param _modules Contract addresses of the new modules
      * @return bool Success of publishing new Modules
      */
    function addModules(bytes32[] memory _moduleKeys, address[] memory _modules)
    public
    onlyGovernance
    returns (bool) {
        uint count = _moduleKeys.length;
        require(count == _modules.length, "");
        require(count > 0, "");

        for(uint i = 0 ; i < count; i++){
            _publishModule(_moduleKeys[i], _modules[i], true);
        }

        return true;
    }

    /**
      * @dev Permanently lock a module to its current settings
      * @param _moduleKey Bytes32 key of the module
      */
    function lockModule(bytes32 _moduleKey)
    public
    onlyGovernance
    returns (bool) {
        _lockModule(_moduleKey);
        return true;
    }

    /**
      * @dev Publishes the de-activating of a module from the system
      * @param _moduleKey Bytes32 key to remove from the system
      * @return bool Success of removal
      */
    function removeModule(bytes32 _moduleKey)
    public
    onlyGovernance
    returns (bool) {
        _forgetModule(_moduleKey);
        return true;
    }
}