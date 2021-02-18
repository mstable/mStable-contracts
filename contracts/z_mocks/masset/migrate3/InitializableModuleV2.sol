

contract InitializableModuleKeysV2 {
    // Governance                             // Phases
    bytes32 private KEY_GOVERNANCE_DEPRICATED;          // 2.x
    bytes32 private KEY_STAKING_DEPRICATED;             // 1.2
    bytes32 private KEY_PROXY_ADMIN_DEPRICATED;         // 1.0

    // mStable
    bytes32 private KEY_ORACLE_HUB_DEPRICATED;          // 1.2
    bytes32 private KEY_MANAGER_DEPRICATED;             // 1.2
    bytes32 private KEY_RECOLLATERALISER_DEPRICATED;    // 2.x
    bytes32 private KEY_META_TOKEN_DEPRICATED;          // 1.1
    bytes32 private KEY_SAVINGS_MANAGER_DEPRICATED;     // 1.0
}

contract InitializableModuleV2 is InitializableModuleKeysV2 {
    address private nexus_depricated;
}