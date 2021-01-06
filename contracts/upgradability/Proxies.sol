// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.7.6;

import { InitializableAdminUpgradeabilityProxy } from "../shared/@openzeppelin-2.5/upgrades/InitializableAdminUpgradeabilityProxy.sol";

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


/**
 * @notice LiquidatorProxy delegates calls to a Liquidator implementation
 * @dev    Extending on OpenZeppelin's InitializableAdminUpgradabilityProxy
 * means that the proxy is upgradable through a ProxyAdmin. LiquidatorProxy upgrades
 * are implemented by a DelayedProxyAdmin, which enforces a 1 week opt-out period.
 * All upgrades are governed through the current mStable governance.
 */
contract LiquidatorProxy is InitializableAdminUpgradeabilityProxy {
}