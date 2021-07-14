// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

interface IStakedMTA {
    function stake(address to, uint256 amount) external;

    function redeem(address to, uint256 amount) external;

    function cooldown() external;

    function claimRewards(address to, uint256 amount) external;
}
