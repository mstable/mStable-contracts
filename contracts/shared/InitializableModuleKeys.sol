pragma solidity 0.5.16;

/**
 * @title  InitializableModuleKeys
 * @author Stability Labs Pty. Ltd.
 * @notice Provides system wide access to the byte32 represntations of system modules
 *         This allows each system module to be able to reference and update one another in a
 *         friendly way. Contract is used for upgradable proxy contracts.
 * @dev    The contract is a replica of ModuleKeys.sol
 *         The following variables are to be assigned only once from initialize() function.
 *         Hence, the variable names are declared in UPPER_CASE to indicate constants.
 */
contract InitializableModuleKeys {

    // Governance                             // Phases
    bytes32 internal KEY_GOVERNANCE;          // 2.x
    bytes32 internal KEY_STAKING;             // 1.2
    bytes32 internal KEY_PROXY_ADMIN;         // 1.0

    // mStable
    bytes32 internal KEY_ORACLE_HUB;          // 1.2
    bytes32 internal KEY_MANAGER;             // 1.2
    bytes32 internal KEY_RECOLLATERALISER;    // 2.x
    bytes32 internal KEY_META_TOKEN;          // 1.1
    bytes32 internal KEY_SAVINGS_MANAGER;     // 1.0

    /**
     * @dev Initialize function for upgradable proxy contracts. This function should be called
     *      via Proxy to initialize constants in the Proxy contract.
     */
    function _initialize() internal {
        // keccak256() values are evaluated only once at the time of this function call.
        // Hence, no need to assign hard-coded values to these variables.
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