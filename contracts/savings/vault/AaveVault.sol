pragma solidity ^0.5.16;

import { AbstractPlatform } from "../platform/AbstractPlatform.sol";

contract AaveVault is AbstractPlatform {

    constructor(address _aaveAddress)
        AbstractPlatform(_aaveAddress)
        public
    {

    }

}