// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

interface IVotes {
    function getVotes(address account) external view returns (uint256);
}
