// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.2;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IRewardsDistributionRecipient {
    function notifyRewardAmount(uint256 reward) external;

    function getRewardToken() external view returns (IERC20);
}
