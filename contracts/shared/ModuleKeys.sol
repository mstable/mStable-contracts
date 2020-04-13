pragma solidity 0.5.16;

/**
  * @title  ModuleKeys
  * @author Stability Labs Pty. Ltd.
  * @dev    Provides system wide access to the byte32 represntations of system modules
  *         This allows each system module to be able to reference and update one another in a
  *         friendly way
  */
contract ModuleKeys {

    // Governance                                                                   // Phases
    bytes32 public constant KEY_GOVERNANCE = keccak256("Governance");               // 2.x
    bytes32 public constant KEY_STAKING = keccak256("Staking");                     // 1.2
    bytes32 public constant KEY_PROXY_ADMIN = keccak256("ProxyAdmin");              // 1.0

    // mStable
    bytes32 public constant KEY_ORACLE_HUB = keccak256("OracleHub");                // 1.2
    bytes32 public constant KEY_MANAGER = keccak256("Manager");                     // 1.2
    bytes32 public constant KEY_RECOLLATERALISER = keccak256("Recollateraliser");   // 2.x
    bytes32 public constant KEY_META_TOKEN = keccak256("MetaToken");                // 1.1
    bytes32 public constant KEY_SAVINGS_MANAGER = keccak256("SavingsManager");      // 1.0
}