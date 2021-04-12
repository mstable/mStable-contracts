// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.2;

/**
 * @title IEjector
 * @dev interface is used for Hardhat task integration
 */
interface IEjector {
    function ejectMany(address[] calldata _users) external;

    function votingLockup() view external returns (address);
}
