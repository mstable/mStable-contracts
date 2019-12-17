pragma solidity ^0.5.12;

import "../../../contracts/shared/pubsub/ModuleSub.sol";
import "./MockShared.sol";
import "./ModuleB.sol";
import "./ModuleC.sol";

contract ModuleA is ModuleSub, MockShared {

    ModuleB public moduleB;
    ModuleC public moduleC;

    constructor(address _pub) ModuleSub(_pub) public {}

    function _internalUpdateModule(bytes32 _key, address _newAddress) internal {
        if (_key == ModuleKeyB) {
            moduleB = ModuleB(_newAddress);
            return;
        }

        if (_key == ModuleKeyC) {
            moduleC = ModuleC(_newAddress);
            return;
        }
    }

}