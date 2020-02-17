pragma solidity ^0.5.12;

import { INexus } from "../interfaces/INexus.sol";
import { ModuleKeys } from "../shared/ModuleKeys.sol";
import { Set } from "../shared/libs/Set.sol";
import { DelayedClaimableGovernance } from "../governance/DelayedClaimableGovernance.sol";

/**
 * @title Nexus
 * @dev The Nexus is mStable's Kernel, and allows the publishing and propagating
 * of new system Modules. Other Modules will subscribe to Nexus for reads and updates
 */
contract Nexus is INexus, ModuleKeys, DelayedClaimableGovernance {

    event ModuleRequested(bytes32 indexed key, address addr, uint256 timestamp);
    event ModuleCancelled(bytes32 indexed key, address addr, uint256 timestamp);
    event ModuleAdded(bytes32 indexed key, address addr, bool isLocked);

    event ModuleLockRequested(bytes32 indexed key, address addr, uint256 timestamp);
    event ModuleLockCancelled(bytes32 indexed key, address addr, uint256 timestamp);
    event ModuleLockEnabled(bytes32 indexed key, address addr, bool isLocked);


    /** @dev Struct to store Module props */
    struct Module {
        address addr;   // Module address
        bool isLocked;  // Module lock status
    }

    /** @dev Storage architecture for keeping module information */
    mapping(bytes32 => Module) public modules;

    /** @dev Proposed modules */
    mapping (bytes32 => mapping(address => uint256)) public proposedModules;

    mapping (bytes32 => mapping(address => uint256)) public proposedLockModules;

    /** @dev 1 week delayed upgrade period  */
    uint256 public constant UPGRADE_DELAY = 1 weeks;

    /** Init flag to allow add modules at the time of deplyment without delay */
    bool public initialized = false;


    /** @dev Initialises the Nexus and adds the core data to the Kernel (itself and governor) */
    constructor(address _governor)
    public
    DelayedClaimableGovernance(_governor, UPGRADE_DELAY) {
        //TODO: Is Nexus Locked when init???
        _publishModule(Key_Nexus, address(this), false);
    }


    /***************************************
                  MODIFIERS
    ****************************************/
    modifier whenInitialized() {
        require(initialized, "Nexus not initialized");
        _;
    }

    modifier whenNotInitialized() {
        require(!initialized, "Nexus is already initialized");
        _;
    }

    /**
      * @dev Adds multiple new modules to the system to initialize the
      * Nexus contract with default modules.
      * @param _keys Keys of the new modules in bytes32 form
      * @param _addresses Contract addresses of the new modules
      * @param _isLocked IsLocked flag for the new modules
      * @return bool Success of publishing new Modules
      */
    function initialize(
        bytes32[] calldata _keys,
        address[] calldata _addresses,
        bool[] calldata _isLocked
    )
    external
    onlyGovernor
    whenNotInitialized
    returns (bool) {
        uint256 len = _keys.length;
        require(len > 0, "No keys provided");
        require(len == _addresses.length, "Insuffecient address data provided");
        require(len == _isLocked.length, "Insuffecient locked status provided");

        for(uint i = 0 ; i < len; i++) {
            _publishModule(_keys[i], _addresses[i], _isLocked[i]);
        }

        initialized = true;
        return true;
    }



    /***************************************
                    ADDING
    ****************************************/

    /**
     * @dev Request Nexus to add a module
     */
    function requestModule(bytes32 _key, address _addr)
    external
    onlyGovernor
    whenInitialized {
        require(_key != 0, "Key must not be zero");
        require(_addr != address(0), "Module address must not be zero address");
        require(isModuleExist(_key) == false, "Module already exist");
        require(proposedModules[_key][_addr] > 0, "Module already proposed");

        proposedModules[_key][_addr] = now;
        emit ModuleRequested(_key, _addr, now);
    }

    function cancelProposedModule(bytes32 _key, address _addr)
    external
    onlyGovernor
    whenInitialized {
        uint256 timestamp = proposedModules[_key][_addr];
        require(timestamp > 0, "Proposed module not found");
        delete proposedModules[_key][_addr];
        emit ModuleCancelled(_key, _addr, timestamp);
    }

    // TODO There could be two different modules with different keys having the
    // same address of their module. Need to find a solution to not have same
    // address again for two different module

    function addProposedModule(bytes32 _key, address _addr)
    external
    onlyGovernor
    whenInitialized {
        require(isDelayOver(proposedModules[_key][_addr]), "Module upgrade delay not over");
        _publishModule(_key, _addr, false);
        delete proposedModules[_key][_addr];
    }

    function addProposedModules(bytes32[] calldata _keys, address[] calldata _addrs)
    external
    onlyGovernor
    whenInitialized {
        uint256 len = _keys.length;
        require(len > 0, "Keys array empty");
        require(len == _addrs.length, "Insuffecient data");

        for(uint i = 0 ; i < len; i++) {
            bytes32 key = _keys[i];
            address addr = _addrs[i];
            uint256 timestamp = proposedModules[key][addr];
            require(isDelayOver(timestamp), "Upgrade delay not over");
            _publishModule(key, addr, false);
            delete proposedModules[key][addr];
        }
    }



    /**
      * @dev Internal func to publish a module and broadcast to subscribers
      * @param _key Key of the new module in bytes32 form
      * @param _addr Contract address of the new module
      */
    function _publishModule(bytes32 _key, address _addr, bool _isLocked) internal {
        modules[_key].addr = _addr;
        emit ModuleAdded(_key, _addr, _isLocked);
    }


    /***************************************
                    LOCKING
    ****************************************/

    function requestLockModule(bytes32 _key)
    external
    onlyGovernor
    whenInitialized {
        require(isModuleExist(_key), "Module not exist");
        require(!modules[_key].isLocked, "Module must be unlocked");
        address addr = modules[_key].addr;
        require(proposedLockModules[_key][addr] > 0, "Module already proposed");

        proposedLockModules[_key][addr] = now;
        emit ModuleLockRequested(_key, addr, now);
    }

    function cancelLockModule(bytes32 _key) external onlyGovernor whenInitialized {
        address addr = modules[_key].addr;
        uint256 timestamp = proposedLockModules[_key][addr];
        require(timestamp > 0, "Module lock request not found");
        delete proposedLockModules[_key][addr];
        emit ModuleLockCancelled(_key, addr, timestamp);
    }

    /**
      * @dev Permanently lock a module to its current settings
      * @param _key Bytes32 key of the module
      */
    function lockModule(bytes32 _key)
    external
    onlyGovernor
    whenInitialized
    returns (bool) {
        address addr = modules[_key].addr;
        uint256 timestamp = proposedLockModules[_key][addr];
        require(isDelayOver(timestamp), "Delay not over");
        modules[_key].isLocked = true;

        delete proposedLockModules[_key][addr];
        emit ModuleLockEnabled(_key, addr, true);
        //TODO Do we need boolean return???
        return true;
    }

    function isModuleExist(bytes32 _key) public returns (bool) {
        if(_key != 0 && modules[_key].addr != address(0))
            return true;
        return false;
    }

    function getModule(bytes32 _key) public view returns (address addr) {
        addr = modules[_key].addr;
    }

    function isDelayOver(uint256 _timestamp) private view returns (bool) {
        if(_timestamp > 0 && now >= _timestamp.add(UPGRADE_DELAY))
            return true;
        return false;
    }

}