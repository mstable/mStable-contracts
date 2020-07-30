pragma solidity 0.5.16;

import { Module } from "../shared/Module.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { Roles } from "@openzeppelin/contracts/access/Roles.sol";

/**
 * @title  GovernedMinterRole
 * @author OpenZeppelin (forked from @openzeppelin/contracts/access/roles/MinterRole.sol)
 * @dev    Forked from OpenZeppelin 'MinterRole' with changes:
 *          - `addMinter` modified from `onlyMinter` to `onlyGovernor`
 *          - `removeMinter` function added, callable by `onlyGovernor`
 */
contract GovernedMinterRole is Module {

    using Roles for Roles.Role;

    event MinterAdded(address indexed account);
    event MinterRemoved(address indexed account);

    Roles.Role private _minters;

    constructor(address _nexus) internal Module(_nexus) {
    }

    modifier onlyMinter() {
        require(isMinter(msg.sender), "MinterRole: caller does not have the Minter role");
        _;
    }

    function isMinter(address account) public view returns (bool) {
        return _minters.has(account);
    }

    function addMinter(address account) public onlyGovernor {
        _addMinter(account);
    }

    function removeMinter(address account) public onlyGovernor {
        _removeMinter(account);
    }

    function renounceMinter() public {
        _removeMinter(msg.sender);
    }

    function _addMinter(address account) internal {
        _minters.add(account);
        emit MinterAdded(account);
    }

    function _removeMinter(address account) internal {
        _minters.remove(account);
        emit MinterRemoved(account);
    }
}