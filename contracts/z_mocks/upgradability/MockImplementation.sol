pragma solidity 0.5.16;

import { Initializable } from "@openzeppelin/upgrades/contracts/Initializable.sol";

contract MockImplementationV1 is Initializable {
    string public version = "";
    uint256 public uintVal = 1;
    address private proxyAdmin;

    modifier onlyProxyAdmin() {
        require(msg.sender == proxyAdmin, "Only proxyAdmin can execute");
        _;
    }

    function initialize(address _proxyAdmin) public initializer {
        version = "V1";
        uintVal = 2;
        // Initialize the proxy address (DelayedProxyAdmin's address)
        proxyAdmin = _proxyAdmin;
    }
}

contract MockImplementationV2 is Initializable{
    string public version = "";
    uint256 public uintVal = 1;
    address private proxyAdmin;

    modifier onlyProxyAdmin() {
        require(msg.sender == proxyAdmin, "Only proxyAdmin can execute");
        _;
    }

    function initializeV2() public payable onlyProxyAdmin {
        // function is payable to test
        version = "V2";
        uintVal = 3;
    }
}

contract MockImplementationV3 is Initializable{
    string public version = "";
    uint256 public uintVal = 1;
    address private proxyAdmin;

    modifier onlyProxyAdmin() {
        require(msg.sender == proxyAdmin, "Only proxyAdmin can execute");
        _;
    }

    function initializeV3() public payable onlyProxyAdmin {
        // function is payable to test
        version = "V3";
        uintVal = 4;
    }
}