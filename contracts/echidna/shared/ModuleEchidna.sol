pragma solidity 0.5.16;

import { Module } from "../../shared/Module.sol";

contract ModuleEchidna is Module {

    // Initialize Module with "0x1" (Nexus contract address)
    constructor() public Module(address(0x1)) {}

    function echidna_nexus_always_non_zero() public view returns (bool) {
        return address(nexus) != address(0);
    }

    function echidna_keccack_module_keys() public pure returns (bool) {
        return (
            KEY_GOVERNANCE == keccak256("Governance") &&
            KEY_STAKING == keccak256("Staking") &&
            KEY_PROXY_ADMIN == keccak256("ProxyAdmin") &&
            KEY_ORACLE_HUB == keccak256("OracleHub") &&
            KEY_MANAGER == keccak256("Manager") &&
            KEY_RECOLLATERALISER == keccak256("Recollateraliser") &&
            KEY_META_TOKEN == keccak256("MetaToken") &&
            KEY_SAVINGS_MANAGER == keccak256("SavingsManager")
        );
    }
}