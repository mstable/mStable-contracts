pragma solidity ^0.5.12;

import { INexus } from "../interfaces/INexus.sol";
import { ModulePub } from "../shared/pubsub/ModulePub.sol";

/**
 * @title Nexus
 * @dev The Nexus is mStable's Kernel, and allows the publishing and propagating
 * of new system Modules. Other Modules will subscribe to Nexus for reads and updates
 */
contract Nexus is INexus, ModulePub {

    address governor;

    /** @dev Initialises the Nexus and adds the core data to the Kernel (itself and governor) */
    constructor(address _governor)
    public {
        require(address(_governor) != address(0), "Can't set governance to zero address");
        _publishModule(Key_Governor, _governor, false);

        _publishModule(Key_Nexus, address(this), false);
    }

    /** @dev Verifies that the caller is the System Governor as defined in the module mapping */
    modifier onlyGovernor() {
        require(moduleAddresses[Key_Governor]._address == msg.sender, "Only the governor may perform this operation");
        _;
    }

    /**
      * @dev Adds a new module to the system and publishes to subscribers
      * @param _moduleKey Key of the new module in bytes32 form
      * @param _module Contract address of the new module
      * @param _isSubscriber Does this new module inherit the ModuleSub contract to subscribe for updates?
      * @return bool Success of publishing new Module
      */
    function addModule(bytes32 _moduleKey, address _module, bool _isSubscriber)
    public
    onlyGovernor
    returns (bool) {
        _publishModule(_moduleKey, _module, _isSubscriber);
        return true;
    }

    /**
      * @dev Adds multiple new modules to the system and publishes them to subscribers
      * @param _moduleKeys Keys of the new modules in bytes32 form
      * @param _modules Contract addresses of the new modules
      * @param _isSubscriber Do the new modules inherit the ModuleSub contract to subscribe for updates?
      * @return bool Success of publishing new Modules
      */
    function addModules(bytes32[] memory _moduleKeys, address[] memory _modules, bool[] memory _isSubscriber)
    public
    onlyGovernor
    returns (bool) {
        uint count = _moduleKeys.length;
        require(count == _modules.length, "");
        require(count == _isSubscriber.length, "");
        require(count > 0, "");

        for(uint i = 0 ; i < count; i++){
            _publishModule(_moduleKeys[i], _modules[i], _isSubscriber[i]);
        }

        return true;
    }

    /**
      * @dev Publishes the de-activating of a module from the system
      * @param _moduleKey Bytes32 key to remove from the system
      * @return bool Success of removal
      */
    function removeModule(bytes32 _moduleKey)
    public
    onlyGovernor
    returns (bool) {
        _forgetModule(_moduleKey);
        return true;
    }
}