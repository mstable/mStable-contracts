pragma solidity 0.5.16;

import { InitializableModuleKeys } from "../shared/InitializableModuleKeys.sol";
import { INexus } from "../interfaces/INexus.sol";

/**
  * @title InitializableModule
  * @dev Subscribes to module updates from a given publisher and reads from its registry.
  *      Contrat is used for upgradable proxy contracts.
  */
contract InitializableModule is InitializableModuleKeys {

    INexus public nexus;

    /** @dev Initialises the Module by setting publisher, and reading all available system module information */
    constructor(address _nexus) internal {
        InitializableModule._initialize(_nexus);
    }

    modifier onlyGovernor() {
        require(msg.sender == _governor(), "Only governor can execute");
        _;
    }

    modifier onlyGovernance() {
        require(msg.sender == _governor() || msg.sender == _governance(), "Only governance can execute");
        _;
    }

    modifier onlyManager() {
        require(msg.sender == _manager(), "Only manager can execute");
        _;
    }

    /**
     * @dev Initialization function for upgradable proxy contracts
     * @param _nexus Nexus contract address
     */
    function _initialize(address _nexus) internal {
        nexus = INexus(_nexus);
        InitializableModuleKeys._initialize();
    }

    function _governor()
    internal
    view
    returns (address) {
        return nexus.governor();
    }

    // Phase 2
    function _governance()
    internal
    view
    returns (address) {
        return nexus.getModule(Key_Governance);
    }

    // Phase 2
    function _staking()
    internal
    view
    returns (address) {
        return nexus.getModule(Key_Staking);
    }

    function _metaToken()
    internal
    view
    returns (address) {
        return nexus.getModule(Key_MetaToken);
    }

    function _oracleHub()
    internal
    view
    returns (address) {
        return nexus.getModule(Key_OracleHub);
    }

    function _manager()
    internal
    view
    returns (address) {
        return nexus.getModule(Key_Manager);
    }

    function _savingsManager()
    internal
    view
    returns (address) {
        return nexus.getModule(Key_SavingsManager);
    }

    // Phase 2
    function _recollateraliser()
    internal
    view
    returns (address) {
        return nexus.getModule(Key_Recollateraliser);
    }
}
