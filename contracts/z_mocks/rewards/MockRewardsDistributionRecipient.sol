// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.7.6;

import { IERC20 } from "@openzeppelin/contracts-solc7/token/ERC20/IERC20.sol";
import { IRewardsDistributionRecipient } from "../../interfaces/IRewardsDistributionRecipient.sol";

contract MockRewardsDistributionRecipient is IRewardsDistributionRecipient {

    IERC20 public rewardToken;

    constructor(IERC20 _rewardToken) {
        rewardToken = _rewardToken;
    }

    function notifyRewardAmount(uint256 reward)
      external
      override
    {
      // do nothing
    }

    function getRewardToken() external override view returns (IERC20) {
        return rewardToken;
    }
}
