// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

interface IStakedToken {
    function stake(uint256 amount, address to) external;

    function redeem(uint256 amount, address to) external;

    function cooldown() external;
}
