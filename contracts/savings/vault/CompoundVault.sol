pragma solidity ^0.5.16;

import { AbstractPlatform } from "../platform/AbstractPlatform.sol";

contract CompoundVault is AbstractPlatform {

    constructor(address _compoundAddress)
        AbstractPlatform(_compoundAddress)
        public
    {

    }
}