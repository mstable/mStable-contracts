pragma solidity 0.5.16;

import { Initializable } from "@openzeppelin/upgrades/contracts/Initializable.sol";

contract MockImplementationV1 is Initializable {
    string public version = "";
    uint256 public uintVal = 1;

    function initialize() public initializer {
        version = "V1";
        uintVal = 2;
    }

    function method1() public pure returns (bool) {
        return true;
    }
}

contract MockImplementationV2 is Initializable {
    string public version = "";
    uint256 public uintVal = 1;

    function initializeV2() public payable {
        // function is payable to test
        version = "V2";
        uintVal = 3;
    }

    /**
     * @dev Function to check that new method2 is added in new implementation
     */
    function method2() public pure returns (bool) {
        return true;
    }

}