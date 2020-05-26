pragma solidity 0.5.16;

import { Initializable } from "@openzeppelin/upgrades/contracts/Initializable.sol";

contract EchidnaMockImplementationV1 is Initializable {
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

contract EchidnaMockImplementationV2 is Initializable {
    string public version = "";
    uint256 public uintVal = 1;
    address private proxyAdmin;
    uinit256 temp = 0;

    modifier onlyProxyAdmin() {
        require(msg.sender == proxyAdmin, "Only proxyAdmin can execute");
        _;
    }

    function initializeV2() public payable onlyProxyAdmin {
        // function is payable to test
        version = "V2";
        uintVal = 3;
        temp = 1;
    }

    function echidna_proxy_admin_notzero() public returns(bool) {
        return (proxyAdmin != address(0));
    }

    function echidna_proxy_admin_not_locked() public returns(bool) {
        return (temp == 0);
    }
}

contract EchidnaMockImplementationV3 is Initializable {
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

    function echidna_V1_initialized() public returns(bool) {
        return (version == "V1");
    }

    function echidna_V2_initialized() public returns(bool) {
        return (version == "V2");
    }
    
    function echidna_V3_initialized() public returns(bool) {
        return (version == "V3");
    }
}