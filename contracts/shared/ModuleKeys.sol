pragma solidity 0.5.16;

/**
  * @title ModuleKeys
  * @dev Provides system wide access to the byte32 represntations of system modules
  * This allows each system module to be able to reference and update one another in a friendly way
  */
contract ModuleKeys {

    // Governance
    bytes32 constant public Key_Governance = keccak256("Governance");
    bytes32 constant public Key_Staking = keccak256("Staking");

    // mStable
    bytes32 constant public Key_Nexus = keccak256("Nexus");
    bytes32 constant public Key_OracleHub = keccak256("OracleHub");
    bytes32 constant public Key_Manager = keccak256("Manager");
    bytes32 constant public Key_Recollateraliser = keccak256("Recollateraliser");
    bytes32 constant public Key_MetaToken = keccak256("MetaToken");
    bytes32 constant public Key_SavingsManager = keccak256("SavingsManager");

}