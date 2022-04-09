// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

interface ITokenLocker {
    function lock(uint256 _amount) external;

    function withdraw(uint256 _lockerId) external returns (uint256 payout);

    function batchExecute() external;
}
