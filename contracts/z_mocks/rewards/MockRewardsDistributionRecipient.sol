pragma solidity 0.5.16;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IRewardsDistributionRecipient } from "../../interfaces/IRewardsDistributionRecipient.sol";

contract MockRewardsDistributionRecipient is IRewardsDistributionRecipient {

    IERC20 public rewardToken;

    constructor(IERC20 _rewardToken) public {
        rewardToken = _rewardToken;
    }

    function notifyRewardAmount(uint256 reward)
      external
    {
      // do nothing
    }

    function getRewardToken() external view returns (IERC20) {
        return rewardToken;
    }
}
