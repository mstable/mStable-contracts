pragma solidity 0.5.16;

/**
  * @title ModuleKeys
  * @dev Provides system wide access to the byte32 represntations of system modules
  * This allows each system module to be able to reference and update one another in a friendly way
  */
contract ModuleKeys {

    // Governance
    bytes32 public Key_Governance = keccak256("Governance"); // 2.x
    bytes32 public Key_Staking = keccak256("Staking"); // 1.2

    // mStable
    bytes32 public Key_OracleHub = keccak256("OracleHub"); // 1.2
    bytes32 public Key_Manager = keccak256("Manager"); // 1.2
    bytes32 public Key_Recollateraliser = keccak256("Recollateraliser"); // 2.x
    bytes32 public Key_MetaToken = keccak256("MetaToken"); // 1.1
    bytes32 public Key_SavingsManager = keccak256("SavingsManager"); // 1.0

    /**
     * @dev Initialize function for upgradable proxy contracts
     */
    function _initialize() internal {
        Key_Governance = keccak256("Governance");
        Key_Staking = keccak256("Staking");

        Key_OracleHub = keccak256("OracleHub");
        Key_Manager = keccak256("Manager");
        Key_Recollateraliser = keccak256("Recollateraliser");
        Key_MetaToken = keccak256("MetaToken");
        Key_SavingsManager = keccak256("SavingsManager");
    }

}