pragma solidity ^0.5.0;

import "../../../contracts/shared/pubsub/ModuleSub.sol";

contract ModuleC is ModuleSub {

    constructor(address _pub) ModuleSub(_pub) public {}
    function _internalUpdateModule(bytes32 _key, address _newAddress) internal { }

}