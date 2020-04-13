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
    bytes32 public KEY_GOVERNANCE;          // 2.x
    bytes32 public KEY_STAKING;             // 1.2
    bytes32 public KEY_PROXY_ADMIN;         // 1.0

    // mStable
    bytes32 public KEY_ORACLE_HUB;          // 1.2
    bytes32 public KEY_MANAGER;             // 1.2
    bytes32 public KEY_RECOLLATERALISER;    // 2.x
    bytes32 public KEY_META_TOKEN;          // 1.1
    bytes32 public KEY_SAVINGS_MANAGER;     // 1.0

    /**
     * @dev Initialize function for upgradable proxy contracts. This function should be called
     *      via Proxy to initialize constants in the Proxy contract.
     */
    function _initialize() internal {
        KEY_GOVERNANCE = keccak256("Governance");
        KEY_STAKING = keccak256("Staking");
        KEY_PROXY_ADMIN = keccak256("ProxyAdmin");

        KEY_ORACLE_HUB = keccak256("OracleHub");
        KEY_MANAGER = keccak256("Manager");
        KEY_RECOLLATERALISER = keccak256("Recollateraliser");
        KEY_META_TOKEN = keccak256("MetaToken");
        KEY_SAVINGS_MANAGER = keccak256("SavingsManager");
    }
}