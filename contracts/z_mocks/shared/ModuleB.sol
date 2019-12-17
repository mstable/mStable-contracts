pragma solidity ^0.5.0;

import "../../../contracts/shared/pubsub/ModuleSub.sol";
import "./MockShared.sol";
import "./ModuleC.sol";

contract ModuleB is ModuleSub, MockShared {

    ModuleC public moduleC;

    constructor(address _pub) ModuleSub(_pub) public {}
    
    function _internalUpdateModule(bytes32 _key, address _newAddress) internal {
        if (_key == ModuleKeyC) {
            moduleC = ModuleC(_newAddress);
            return;
        }
    }

}