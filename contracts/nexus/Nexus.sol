pragma solidity ^0.5.12;

import { INexus } from "../interfaces/INexus.sol";
import { ModuleKeys } from "../shared/ModuleKeys.sol";
import { DelayedClaimableGovernance } from "../governance/DelayedClaimableGovernance.sol";

import { Set } from "../shared/libs/Set.sol";

/**
 * @title Nexus
 * @dev The Nexus is mStable's Kernel, and allows the publishing and propagating
 * of new system Modules. Other Modules will read from the Nexus
 */
contract Nexus is INexus, ModuleKeys, DelayedClaimableGovernance {

    event ModuleRequested(bytes32 indexed key, address addr, uint256 timestamp);
    event ModuleCancelled(bytes32 indexed key, address addr, uint256 timestamp);
    event ModuleAdded(bytes32 indexed key, address addr, bool isLocked);

    event ModuleLockRequested(bytes32 indexed key, uint256 timestamp);
    event ModuleLockCancelled(bytes32 indexed key, uint256 timestamp);
    event ModuleLockEnabled(bytes32 indexed key, bool isLocked);


    /** @dev Struct to store Module props */
    struct Module {
        address addr;   // Module address
        bool isLocked;  // Module lock status
    }

    /** @dev Storage architecture for keeping module information */
    mapping(bytes32 => Module) public modules;
    mapping(address => bytes32) private addresses;

    /** @dev Struct to store Proposal props */
    struct Proposal {
        address newAddress;
        uint256 timestamp;
    }

    /** @dev Proposed modules */
    mapping (bytes32 => Proposal) public proposedModules;
    mapping (bytes32 => uint256) public proposedLockModules;

    /** @dev 1 week delayed upgrade period  */
    uint256 public constant UPGRADE_DELAY = 1 weeks;

    /** Init flag to allow add modules at the time of deplyment without delay */
    bool public initialized = false;


    /** @dev Initialises the Nexus and adds the core data to the Kernel (itself and governor) */
    constructor(address _governor)
    public
    DelayedClaimableGovernance(_governor, UPGRADE_DELAY) {
        // _publishModule(Key_Nexus, address(this), true);
        // Technically we don't need the above anymore.. Nexus is immutable kernel
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
        returns (bool)
    {
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


    /***************************************
                    ADDING
    ****************************************/

    /**
     * @dev Request Nexus to add a module
     */
    function proposeModule(bytes32 _key, address _addr)
    external
    onlyGovernor
    whenInitialized {
        require(_key != bytes32(0x0), "Key must not be zero");
        require(_addr != address(0), "Module address must not be zero address");
        require(!modules[_key].isLocked, "Module must be unlocked");
        // require(moduleExists(_key) == false, "Module already exist"); // Alex - it should be possible to add new modules
        Proposal storage p = proposedModules[_key];
        require(p.timestamp == 0, "Module already proposed");

        p.newAddress = _addr;
        p.timestamp = now;
        emit ModuleRequested(_key, _addr, now);
    }

    function cancelProposedModule(bytes32 _key)
    external
    onlyGovernor
    whenInitialized {
        uint256 timestamp = proposedModules[_key].timestamp;
        require(timestamp > 0, "Proposed module not found");
        delete proposedModules[_key];
        emit ModuleCancelled(_key, _addr, timestamp);
    }

    function acceptProposedModule(bytes32 _key)
    external
    onlyGovernor
    whenInitialized {
        _acceptProposedModule(_key);
    }

    function acceptProposedModules(bytes32[] calldata _keys)
    external
    onlyGovernor
    whenInitialized {
        uint256 len = _keys.length;
        require(len > 0, "Keys array empty");

        for(uint i = 0 ; i < len; i++) {
            _acceptProposedModule(keys[i]);
        }
    }

    function _acceptProposedModule(bytes32 _key) internal {
        Proposal memory p = proposedModules[_key];
        require(_isDelayOver(p.timestamp) && p.newAddress != address(0), "Module upgrade delay not over");
        _publishModule(_key, p.newAddress, false);
        delete proposedModules[_key];
    }

    /**
      * @dev Internal func to publish a module to kernel
      * @param _key Key of the new module in bytes32 form
      * @param _addr Contract address of the new module
      */
    function _publishModule(bytes32 _key, address _addr, bool _isLocked) internal {
        require(addresses[_addr] == bytes32(0x0), "Modules must have unique addr");
        // Old no longer points to a moduleAddress
        address oldModuleAddr = modules[_key].addr;
        if(oldAddr != address(0x0)){
            addresses[oldModuleAddr] = address(0x0);
        }
        modules[_key].addr = _addr;
        modules[_key].isLocked = _isLocked;
        addresses[_addr] = _key;
        emit ModuleAdded(_key, _addr, _isLocked);
    }


    /***************************************
                    LOCKING
    ****************************************/

    function requestLockModule(bytes32 _key)
    external
    onlyGovernor
    whenInitialized {
        require(moduleExists(_key), "Module must exist");
        require(!modules[_key].isLocked, "Module must be unlocked");

        require(proposedLockModules[_key] == 0, "Lock already proposed");

        proposedLockModules[_key].timestamp = now;
        emit ModuleLockRequested(_key, now);
    }

    function cancelLockModule(bytes32 _key)
    external
    onlyGovernor
    whenInitialized {
        require(proposedLockModules[_key] > 0, "Module lock request not found");
        delete proposedLockModules[_key];
        emit ModuleLockCancelled(_key, timestamp);
    }

    /**
      * @dev Permanently lock a module to its current settings
      * @param _key Bytes32 key of the module
      */
    function lockModule(bytes32 _key)
    external
    onlyGovernor
    whenInitialized {
        require(_isDelayOver(proposedLockModules[_key]), "Delay not over");
        modules[_key].isLocked = true;
        delete proposedLockModules[_key];
        emit ModuleLockEnabled(_key, true);
    }

    /***************************************
                HELPERS & GETTERS
    ****************************************/

    function moduleExists(bytes32 _key) public returns (bool) {
        if(_key != 0 && modules[_key].addr != address(0))
            return true;
        return false;
    }

    function getModule(bytes32 _key) public view returns (address addr) {
        addr = modules[_key].addr;
    }

    function _isDelayOver(uint256 _timestamp) private view returns (bool) {
        if(_timestamp > 0 && now >= _timestamp.add(UPGRADE_DELAY))
            return true;
        return false;
    }
}