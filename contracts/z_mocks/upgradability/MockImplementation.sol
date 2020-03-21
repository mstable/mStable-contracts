pragma solidity 0.5.16;

import { Initializable } from "@openzeppelin/upgrades/contracts/Initializable.sol";

contract MockImplementationV1 is Initializable {
    string public version = "";
    uint256 public uintVal = 1;

    function initialize() public initializer {
        version = "V1";
        uintVal = 2;
    }
}

contract MockImplementationV2 is Initializable {
    string public version = "";
    uint256 public uintVal = 1;

    function initializeV2() public initializer {
        version = "V2";
        uintVal = 3;
    }
}