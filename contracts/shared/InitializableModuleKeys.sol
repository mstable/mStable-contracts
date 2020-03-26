pragma solidity 0.5.16;

/**
 * @title  InitializableModuleKeys
 * @author Stability Labs Pty. Lte.
 * @dev    Provides system wide access to the byte32 represntations of system modules
 *         This allows each system module to be able to reference and update one another in a
 *         friendly way. Contract is used for upgradable proxy contracts.
 */
contract InitializableModuleKeys {

    // Governance                           // Phases
    bytes32 public Key_Governance;          // 2.x
    bytes32 public Key_Staking;             // 1.2
    bytes32 public Key_ProxyAdmin;          // 1.0

    // mStable
    bytes32 public Key_OracleHub;           // 1.2
    bytes32 public Key_Manager;             // 1.2
    bytes32 public Key_Recollateraliser;    // 2.x
    bytes32 public Key_MetaToken;           // 1.1
    bytes32 public Key_SavingsManager;      // 1.0

    /**
     * @dev Initialize function for upgradable proxy contracts. This function should be called
     *      via Proxy to initialize constants in the Proxy contract.
     */
    function _initialize() internal {
        Key_Governance = keccak256("Governance");
        Key_Staking = keccak256("Staking");
        Key_ProxyAdmin = keccak256("ProxyAdmin");

        Key_OracleHub = keccak256("OracleHub");
        Key_Manager = keccak256("Manager");
        Key_Recollateraliser = keccak256("Recollateraliser");
        Key_MetaToken = keccak256("MetaToken");
        Key_SavingsManager = keccak256("SavingsManager");
    }
}