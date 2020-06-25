pragma solidity 0.5.16;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IRewardsDistributionRecipient {
    function notifyRewardAmount(uint256 reward) external;
    function getRewardToken() external view returns (IERC20);
}