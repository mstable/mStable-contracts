pragma solidity ^0.5.16;

import { Module } from "../shared/Module.sol";
import { AdminUpgradeabilityProxy } from "../openzeppelin-sdk/upgradeability/AdminUpgradeabilityProxy.sol";
import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";

/**
 * @title   Whitelist
 * @author  Stability Labs Pty. Lte.
 * @notice  Proxy admin contract to upgrade the upgradable contracts. The upgradable contracts
 *          are transparent proxy contracts from OpenZeppelin-SDK.
 * @dev     The contract has a delyed upgradability. The Governor can propose a new implementation
 *          for a proxy contract. After 1 week of opt-out delay, upgrade request can be accepted
 *          and upgrade of contract is performed.
 */
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

    // Opt-out upgrade delay
    uint256 public constant UPGRADE_DELAY = 1 weeks;

    // ProxyAddress => Request
    mapping(address => Request) public requests;

    /**
     * @dev The Governor can propose a new contract implementation for a given proxy.
     * @param _proxy Proxy address which is to be upgraded
     * @param _implementation Contract address of new implementation
     * @param _data calldata to execute initialization function upon upgrade
     */
    function proposeUpgrade(
        address _proxy,
        address _implementation,
        bytes calldata _data
    )
        external
        onlyGovernor
    {
        require(_proxy != address(0), "Proxy address zero");
        require(isValidProxy(_proxy), "No proxy found");
        require(_implementation != address(0), "Implementation address zero");
        require(requests[_proxy].implementation != address(0), "Upgrade already proposed");

        Request storage request = requests[_proxy];
        request.implementation = _implementation;
        request.data = _data;
        request.timestamp = now;

        emit UpgradeProposed(_proxy, _implementation, _data);
    }

    /**
     * @dev The Governor can cancel any existing upgrade request.
     * @param _proxy The proxy address of the existing request
     */
    function cancelUpgrade(address _proxy) external onlyGovernor {
        require(_proxy != address(0), "Proxy address zero");
        require(requests[_proxy].implementation != address(0), "No request found");
        delete requests[_proxy];
        emit UpgradeCancelled(_proxy);
    }

    /**
     * @dev The Governor can accept upgrade request after opt-out delay over. The function is
     *      payable, to forward any ETH to initialize function call upon upgrade.
     * @param _proxy The address of the proxy
     */
    function acceptRequest(address payable _proxy) external payable onlyGovernor {
        // _proxy is payable, because AdminUpgradeabilityProxy has fallback function
        Request memory request = requests[_proxy];
        require(_isDelayOver(request.timestamp), "Delay not over");
        address newImpl = request.implementation;
        bytes memory data = request.data;

        if(data.length == 0) {
            AdminUpgradeabilityProxy(_proxy).upgradeTo(newImpl);
        } else {
            AdminUpgradeabilityProxy(_proxy).upgradeToAndCall.value(msg.value)(newImpl, data);
        }

        address oldImpl = getProxyImplementation(_proxy);

        delete requests[_proxy];
        emit Upgraded(_proxy, oldImpl, newImpl, data);
    }

    /**
     * @dev Checks that the opt-out delay is over
     * @return Returns `true` when upgrade delay is over, otherwise `false`
     */
    function _isDelayOver(uint256 _timestamp) private view returns (bool) {
        if(_timestamp > 0 && now >= _timestamp.add(UPGRADE_DELAY))
            return true;
        return false;
    }

    /**
     * @dev Checks the given proxy address is a valid proxy for this contract
     * @param _proxy The address of the proxy
     * @return Returns `true` when proxy address is valid, otherwise `false`
     */
    function isValidProxy(address _proxy) internal view returns (bool) {
        // Proxy has an implementation
        address impl = getProxyImplementation(_proxy);
        if(impl == address(0)) return false;

        // This contract is the Proxy admin of the given _proxy address
        address admin = getProxyAdmin(_proxy);
        if(admin != address(this)) return false;

        return true;
    }

    /**
    * @dev Returns the current implementation of a proxy.
    * This is needed because only the proxy admin can query it.
    * @return The address of the current implementation of the proxy.
    */
    function getProxyImplementation(address proxy) public view returns (address) {
        // We need to manually run the static call since the getter cannot be flagged as view
        // bytes4(keccak256("implementation()")) == 0x5c60da1b
        (bool success, bytes memory returndata) = proxy.staticcall(hex"5c60da1b");
        require(success, "Call failed");
        return abi.decode(returndata, (address));
    }

    /**
    * @dev Returns the admin of a proxy. Only the admin can query it.
    * @return The address of the current admin of the proxy.
    */
    function getProxyAdmin(address proxy) public view returns (address) {
        // We need to manually run the static call since the getter cannot be flagged as view
        // bytes4(keccak256("admin()")) == 0xf851a440
        (bool success, bytes memory returndata) = proxy.staticcall(hex"f851a440");
        require(success, "Call failed");
        return abi.decode(returndata, (address));
    }

    // TODO this can be removed. However, kept it for us to remind that we are not calling this fn.
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