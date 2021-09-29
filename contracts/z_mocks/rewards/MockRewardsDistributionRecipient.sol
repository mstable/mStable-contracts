// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IRewardsRecipientWithPlatformToken } from "../../interfaces/IRewardsDistributionRecipient.sol";

contract MockRewardsDistributionRecipient is IRewardsRecipientWithPlatformToken {
    IERC20 public rewardToken;
    IERC20 public platformToken;

    constructor(IERC20 _rewardToken, IERC20 _platformToken) {
        rewardToken = _rewardToken;
        platformToken = _platformToken;
    }

    function notifyRewardAmount(uint256 reward) external override {
        // do nothing
    }

    function getRewardToken() external view override returns (IERC20) {
        return rewardToken;
    }

    function getPlatformToken() external view override returns (IERC20) {
        return platformToken;
    }
}
