pragma solidity 0.5.16;

import { InitializableAdminUpgradeabilityProxy } from "@openzeppelin/upgrades/contracts/upgradeability/InitializableAdminUpgradeabilityProxy.sol";

/**
 * @notice MassetProxy delegates calls to a Masset implementation
 * @dev    Extending on OpenZeppelin's InitializableAdminUpgradabilityProxy
 * means that the proxy is upgradable through a ProxyAdmin. MassetProxy upgrades
 * are implemented by a DelayedProxyAdmin, which enforces a 1 week opt-out period.
 * All upgrades are governed through the current mStable governance.
 */
contract MassetProxy is InitializableAdminUpgradeabilityProxy {
}

/**
 * @notice BasketManagerProxy delegates calls to a BasketManager implementation
 * @dev    Extending on OpenZeppelin's InitializableAdminUpgradabilityProxy
 * means that the proxy is upgradable through a ProxyAdmin. BasketManagerProxy upgrades
 * are implemented by a DelayedProxyAdmin, which enforces a 1 week opt-out period.
 * All upgrades are governed through the current mStable governance.
 */
contract BasketManagerProxy is InitializableAdminUpgradeabilityProxy {
}

/**
 * @notice VaultProxy delegates calls to a Vault implementation
 * @dev    Extending on OpenZeppelin's InitializableAdminUpgradabilityProxy
 * means that the proxy is upgradable through a ProxyAdmin. VaultProxy upgrades
 * are implemented by a DelayedProxyAdmin, which enforces a 1 week opt-out period.
 * All upgrades are governed through the current mStable governance.
 */
contract VaultProxy is InitializableAdminUpgradeabilityProxy {
}