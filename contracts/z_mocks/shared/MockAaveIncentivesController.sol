// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IAaveIncentivesController } from "../../peripheral/Aave/IAaveIncentivesController.sol";

contract MockAaveIncentivesController is IAaveIncentivesController {
    address public immutable rewardsToken;

    constructor(address _rewardsToken) {
        rewardsToken = _rewardsToken;
    }

    function claimRewards(
        address[] calldata, /* assets*/
        uint256, /* amount */
        address /* to */
    ) external override returns (uint256) {
        IERC20(rewardsToken).transfer(msg.sender, 1e20);
        return 1e20;
    }

    function getRewardsBalance(
        address[] calldata, /*assets*/
        address /*user*/
    ) external pure override returns (uint256) {
        return 1e20;
    }

    function getUserUnclaimedRewards(
        address /*user*/
    ) external pure override returns (uint256) {
        return 1e20;
    }
}
