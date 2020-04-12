pragma solidity 0.5.16;

import { Nexus } from "../../nexus/Nexus.sol";
import { ModuleKeys } from "../../shared/ModuleKeys.sol";

contract MockNexus is Nexus, ModuleKeys {

    constructor(
        address _governor,
        address _governance,
        address _manager
    )
        public
        Nexus(_governor)
    {
        // Initialize Nexus with Mock addresses for Modules
        // Directly adding Mock modules

        // Governance and Manager addresses are required to be passed from the test, as these
        // addresses needs to sign the transaction to test modifiers
        modules[Key_Governance] = Module({addr: _governance, isLocked: false});
        modules[Key_Manager] = Module({addr: _manager, isLocked: false});

        modules[Key_Staking] = Module({addr: address(0x1), isLocked: false});
        modules[Key_OracleHub] = Module({addr: address(0x2), isLocked: false});
        modules[Key_Recollateraliser] = Module({addr: address(0x3), isLocked: false});
        modules[Key_MetaToken] = Module({addr: address(0x4), isLocked: false});
        modules[Key_SavingsManager] = Module({addr: address(0x5), isLocked: false});

        initialized = true;
    }

    function setProxyAdmin(address _proxyAdmin) external {
        modules[Key_ProxyAdmin] = Module({addr: _proxyAdmin, isLocked: true});
    }

    function setSavingsManager(address _savingsManager) external {
        modules[Key_SavingsManager] = Module({addr: _savingsManager, isLocked: true});
    }

}