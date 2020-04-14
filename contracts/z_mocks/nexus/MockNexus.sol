pragma solidity 0.5.16;

import { Nexus } from "../../nexus/Nexus.sol";
import { ModuleKeys } from "../../shared/ModuleKeys.sol";

contract MockNexus is Nexus, ModuleKeys {

    constructor(
        address _governorAddr,
        address _governance,
        address _manager
    )
        public
        Nexus(_governorAddr)
    {
        // Initialize Nexus with Mock addresses for Modules
        // Directly adding Mock modules

        // Governance and Manager addresses are required to be passed from the test, as these
        // addresses needs to sign the transaction to test modifiers
        modules[KEY_GOVERNANCE] = Module({addr: _governance, isLocked: false});
        modules[KEY_MANAGER] = Module({addr: _manager, isLocked: false});

        modules[KEY_STAKING] = Module({addr: address(0x1), isLocked: false});
        modules[KEY_ORACLE_HUB] = Module({addr: address(0x2), isLocked: false});
        modules[KEY_RECOLLATERALISER] = Module({addr: address(0x3), isLocked: false});
        modules[KEY_META_TOKEN] = Module({addr: address(0x4), isLocked: false});
        modules[KEY_SAVINGS_MANAGER] = Module({addr: address(0x5), isLocked: false});

        initialized = true;
    }

    function setProxyAdmin(address _proxyAdmin) external {
        modules[KEY_PROXY_ADMIN] = Module({addr: _proxyAdmin, isLocked: true});
    }

    function setSavingsManager(address _savingsManager) external {
        modules[KEY_SAVINGS_MANAGER] = Module({addr: _savingsManager, isLocked: true});
    }
}