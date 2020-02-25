pragma solidity ^0.5.16;

/**
  * @title ModuleKeys
  * @dev Provides system wide access to the byte32 represntations of system modules
  * This allows each system module to be able to reference and update one another in a friendly way
  */
contract ModuleKeys {
    bytes32 constant public Key_Nexus = "Nexus";

    bytes32 constant public Key_Governance = "Governance";

    bytes32 constant public Key_Staking = "Staking";

    bytes32 constant public Key_Systok = "Systok";

    bytes32 constant public Key_OracleHub = "OracleHub";

    bytes32 constant public Key_Manager = "Manager";

    bytes32 constant public Key_Recollateraliser = "Recollateraliser";
}