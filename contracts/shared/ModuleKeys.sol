pragma solidity 0.5.16;

/**
  * @title ModuleKeys
  * @dev Provides system wide access to the byte32 represntations of system modules
  * This allows each system module to be able to reference and update one another in a friendly way
  */
contract ModuleKeys {

    // Governance
    bytes32 public Key_Governance = keccak256("Governance");
    bytes32 public Key_Staking = keccak256("Staking");

    // mStable
    bytes32 public Key_Nexus = keccak256("Nexus");
    bytes32 public Key_OracleHub = keccak256("OracleHub");
    bytes32 public Key_Manager = keccak256("Manager");
    bytes32 public Key_Recollateraliser = keccak256("Recollateraliser");
    bytes32 public Key_MetaToken = keccak256("MetaToken");
    bytes32 public Key_SavingsManager = keccak256("SavingsManager");

    /**
     * @dev Initialize function for upgradable proxy contracts
     */
    function _initialize() internal {
        Key_Governance = keccak256("Governance");
        Key_Staking = keccak256("Staking");

        Key_Nexus = keccak256("Nexus");
        Key_OracleHub = keccak256("OracleHub");
        Key_Manager = keccak256("Manager");
        Key_Recollateraliser = keccak256("Recollateraliser");
        Key_MetaToken = keccak256("MetaToken");
        Key_SavingsManager = keccak256("SavingsManager");
    }

}