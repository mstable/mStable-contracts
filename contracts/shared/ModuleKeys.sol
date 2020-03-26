pragma solidity 0.5.16;

/**
  * @title  ModuleKeys
  * @author Stability Labs Pty. Lte.
  * @dev    Provides system wide access to the byte32 represntations of system modules
  *         This allows each system module to be able to reference and update one another in a
  *         friendly way
  */
contract ModuleKeys {

    // Governance                                                                   // Phases
    bytes32 public constant Key_Governance = keccak256("Governance");               // 2.x
    bytes32 public constant Key_Staking = keccak256("Staking");                     // 1.2
    bytes32 public constant Key_ProxyAdmin = keccak256("ProxyAdmin");               // 1.0

    // mStable
    bytes32 public constant Key_OracleHub = keccak256("OracleHub");                 // 1.2
    bytes32 public constant Key_Manager = keccak256("Manager");                     // 1.2
    bytes32 public constant Key_Recollateraliser = keccak256("Recollateraliser");   // 2.x
    bytes32 public constant Key_MetaToken = keccak256("MetaToken");                 // 1.1
    bytes32 public constant Key_SavingsManager = keccak256("SavingsManager");       // 1.0
}