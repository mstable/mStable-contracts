pragma solidity ^0.5.0;

import "../../../contracts/shared/pubsub/ModulePub.sol";
import "./MockShared.sol";

import "./ModuleA.sol";
import "./ModuleB.sol";
import "./ModuleC.sol";

contract MockPub is ModulePub, MockShared {
    function createModuleA() external returns(ModuleA) {
        ModuleA a = new ModuleA(address(this));
        _publishModule(ModuleKeyA, address(a), true);
        return a;
    }

    function createModuleB() external returns(ModuleB) {
        ModuleB b = new ModuleB(address(this));
        _publishModule(ModuleKeyB, address(b), true);
        return b;
    }

    function createModuleC() external returns (ModuleC) {
        ModuleC c = new ModuleC(address(this));
        _publishModule(ModuleKeyC, address(c), true);
        return c;
    }
}