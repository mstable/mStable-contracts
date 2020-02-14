pragma solidity ^0.5.12;

import { INexus } from "../interfaces/INexus.sol";
import { ModuleKeys } from "../shared/ModuleKeys.sol";
import { Set } from "../shared/libs/Set.sol";
import { ClaimableGovernor } from "../governance/ClaimableGovernor.sol";
import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";

/**
 * @title Nexus
 * @dev The Nexus is mStable's Kernel, and allows the publishing and propagating
 * of new system Modules. Other Modules will subscribe to Nexus for reads and updates
 */
contract Nexus is INexus, ModuleKeys, ClaimableGovernor {
    using SafeMath for uint256;

    event ModuleAdded(bytes32 indexed key, address addr);
    event ModuleRequested(bytes32 indexed key, address addr, uint256 timestamp);

    /** @dev Struct to store Module props */
    struct Module {
        address addr;   // Module address
        bool isLocked;     // Module lock status
        uint256 timestamp;   // Timestamp when Module proposed
    }

    /** @dev Storage architecture for keeping module information */
    mapping(bytes32 => Module) modules;

    /** @dev Proposed modules */
    mapping (bytes32 => Module) public proposedModules;

    /** @dev 1 week delayed upgrade period  */
    uint256 public constant UPGRADE_DELAY = 1 weeks;

    /** Init flag to allow add modules at the time of deplyment without delay */
    bool public initialized = false;


    /** @dev Initialises the Nexus and adds the core data to the Kernel (itself and governor) */
    constructor(address _governor)
    public
    ClaimableGovernor(_governor) {
        _publishModule(Key_Nexus, address(this));
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

    modifier whenUpgradeDelayOver(bytes32 _key) {
        require(isUpgradeDelayOver(_key), "Upgrade delay not over");
        _;
    }

    /**
      * @dev Action can only be taken on an unlocked module
      * @param _key Bytes key for the module
     */
    modifier onlyUnlockedModule(bytes32 _key) {
        require(!modules[_key].isLocked, "Module must be unlocked");
        _;
    }


    /***************************************
                    READING
    ****************************************/


    function getModule(bytes32 _key)
    external
    view
    returns (address) {
        address addr = modules[_key].addr;
        require(addr != address(0), "Must have valid module address");
        return addr;
    }

    function isUpgradeDelayOver(bytes32 _key) public view returns (bool) {
        uint256 timestamp = proposedModules[_key].timestamp;
        require(timestamp > 0, "Timestamp was not set");
        require(now > timestamp.add(UPGRADE_DELAY), "Delay not over");
        return true;
    }

    /***************************************
                    ADDING
    ****************************************/
    /**
     * @dev Once all initialize modules are added just after deployment.
     * Call this function to enabled delayed upgrade for modules
     */
    function initalize() external onlyGovernor whenNotInitialized {
        initialized = true;
    }

    /**
     * @dev Request Nexus to add a module
     */
    function requestModule(bytes32 _key, address _addr)
    external
    onlyGovernor
    whenInitialized {
        require(modules[_key].addr == address(0), "Module with key already present");
        require(proposedModules[_key].addr == address(0), "Module already proposed");
        require(_key != 0, "Key must not be zero");
        require(_addr != address(0), "Module address must not be zero address");

        proposedModules[_key].addr = _addr;
        proposedModules[_key].timestamp = now;

        emit ModuleRequested(_key, _addr, now);
    }

    function cancelProposedModule(bytes32 _key)
    external
    onlyGovernor
    whenInitialized {
        require(proposedModules[_key].addr != address(0), "Proposed module not found");
        delete proposedModules[_key];
    }

    // TODO There could be two different modules with different keys having the
    // same address of their module. Need to find a solution to not have same
    // address again for two different module

    function addProposedModule(bytes32 _key)
    external
    onlyGovernor
    whenInitialized
    whenUpgradeDelayOver(_key) {
        _publishModule(_key, proposedModules[_key].addr);
        delete proposedModules[_key];
    }

    function addProposedModules(bytes32[] calldata _keys)
    external
    onlyGovernor
    whenInitialized {
        uint256 len = _keys.length;
        require(len > 0, "Keys array empty");
        for(uint i = 0 ; i < len; i++) {
            bytes32 key = _keys[i];
            require(isUpgradeDelayOver(key), "Upgrade delay not over");
            _publishModule(key, proposedModules[key].addr);
            delete proposedModules[key];
        }
    }


    /**
      * @dev Adds a new module to the system or updates existing
      * @param _key Key of the new module in bytes32 form
      * @param _addr Contract address of the new module
      * @return bool Success of publishing new Module
      */
    function addModule(bytes32 _key, address _addr)
    external
    onlyGovernor
    whenNotInitialized
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
    whenNotInitialized
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
        modules[_key].addr = _addr;
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
    //TODO for delayed upgrade ????
    onlyUnlockedModule(_key)
    returns (bool) {
        modules[_key].isLocked = true;
        return true;
    }
}