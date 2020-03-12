pragma solidity ^0.5.16;

import { Module } from "../shared/Module.sol";
import { AdminUpgradeabilityProxy } from "../openzeppelin-sdk/upgradeability/AdminUpgradeabilityProxy.sol";
import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";

contract DelayedProxyAdmin is Module {
    using SafeMath for uint256;

    event UpgradeProposed(address indexed proxy, address implementation, bytes data);
    event UpgradeCancelled(address indexed proxy);
    event Upgraded(address indexed proxy, address oldImpl, address newImpl, bytes data);

    struct Request{
        address implementation;
        bytes data;
        uint256 timestamp;
    }

    uint256 public constant UPGRADE_DELAY = 1 weeks;

    // ProxyAddress => Request
    mapping(address => Request) public requests;

    // propose upgrade
    function proposeUpgrade(
        address _proxy,
        address _implementation,
        bytes calldata _data
    )
        external
        onlyGovernor
    {
        require(_proxy != address(0), "Proxy address zero");
        require(_implementation != address(0), "Implementation address zero");
        require(requests[_proxy].implementation != address(0), "Upgrade already proposed");

        Request storage request = requests[_proxy];
        request.implementation = _implementation;
        request.data = _data;
        request.timestamp = now;

        emit UpgradeProposed(_proxy, _implementation, _data);
    }

    // cancel request
    function cancelUpgrade(address _proxy) external onlyGovernor {
        require(_proxy != address(0), "Proxy address zero");
        delete requests[_proxy];
        emit UpgradeCancelled(_proxy);
    }

    // accept request
    function acceptRequest(AdminUpgradeabilityProxy _proxy) external payable onlyGovernor {
        Request memory request = requests[address(_proxy)];
        require(_isDelayOver(request.timestamp), "Delay not over");
        address newImpl = request.implementation;
        bytes memory data = request.data;

        if(data.length == 0) {
            _proxy.upgradeTo(newImpl);
        } else {
            _proxy.upgradeToAndCall.value(msg.value)(newImpl, data);
        }

        address oldImpl = getProxyImplementation(_proxy);

        delete requests[address(_proxy)];
        emit Upgraded(address(_proxy), oldImpl, newImpl, data);
    }

    function _isDelayOver(uint256 _timestamp) private view returns (bool) {
        if(_timestamp > 0 && now >= _timestamp.add(UPGRADE_DELAY))
            return true;
        return false;
    }

    /**
    * @dev Returns the current implementation of a proxy.
    * This is needed because only the proxy admin can query it.
    * @return The address of the current implementation of the proxy.
    */
    function getProxyImplementation(AdminUpgradeabilityProxy proxy) public view returns (address) {
        // We need to manually run the static call since the getter cannot be flagged as view
        // bytes4(keccak256("implementation()")) == 0x5c60da1b
        (bool success, bytes memory returndata) = address(proxy).staticcall(hex"5c60da1b");
        require(success, "Call failed");
        return abi.decode(returndata, (address));
    }

    /**
    * @dev Returns the admin of a proxy. Only the admin can query it.
    * @return The address of the current admin of the proxy.
    */
    function getProxyAdmin(AdminUpgradeabilityProxy proxy) public view returns (address) {
        // We need to manually run the static call since the getter cannot be flagged as view
        // bytes4(keccak256("admin()")) == 0xf851a440
        (bool success, bytes memory returndata) = address(proxy).staticcall(hex"f851a440");
        require(success, "Call failed");
        return abi.decode(returndata, (address));
    }

    /**
    * @dev Changes the admin of a proxy.
    * @param proxy Proxy to change admin.
    * @param newAdmin Address to transfer proxy administration to.
    */
    // Not allow changing admin
    // function changeProxyAdmin(AdminUpgradeabilityProxy proxy, address newAdmin) public onlyGovernor {
    //     proxy.changeAdmin(newAdmin);
    // }



}