pragma solidity ^0.5.16;

import { IPlatform } from "./IPlatform.sol";

contract AbstractPlatform is IPlatform {

    address public platformAddress;

    constructor(address _platformAddress) internal {
        require(_platformAddress != address(0), "Platform address zero");
        platformAddress = _platformAddress;
    }
}