pragma solidity ^0.5.12;

import { ModuleKeys } from "./ModuleKeys.sol";
import { INexus } from "../interfaces/INexus.sol";

/**
  * @title Module
  * @dev Subscribes to module updates from a given publisher and reads from its registry
  */
contract Module is ModuleKeys {

    INexus public nexus;

    /** @dev Initialises the Module by setting publisher, and reading all available system module information */
    constructor(address _nexus) internal {
        nexus = INexus(_nexus);
    }

    modifier onlyGovernor() {
        require(msg.sender == _governor(), "Only governor can execute");
        _;
    }

    modifier onlyGovernance() {
        require(msg.sender == _governor() || msg.sender == _governance(), "Only governor can execute");
        _;
    }

    modifier onlyManager() {
        require(msg.sender == _manager(), "Only manager can execute");
        _;
    }

    function _governor()
    internal
    view
    returns (address) {
        return nexus.getModule(Key_Governor);
    }

    function _governance()
    internal
    view
    returns (address) {
        return nexus.getModule(Key_Governance);
    }

    function _systok()
    internal
    view
    returns (address) {
        return nexus.getModule(Key_Systok);
    }

    function _oracle()
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

    function _recollateralizer()
    internal
    view
    returns (address) {
        return nexus.getModule(Key_Recollateraliser);
    }
}
