// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.6;

import { IAaveATokenV2, IAaveLendingPoolV2, ILendingPoolAddressesProviderV2 } from "../peripheral/Aave/IAave.sol";
import { AaveV2Integration } from "../masset/peripheral/AaveV2Integration.sol";
import { IAaveIncentivesController } from "../peripheral/Aave/IAaveIncentivesController.sol";

/**
 * @title   PAaveIntegration
 * @author  mStable
 * @notice  A simple connection to deposit and withdraw bAssets from Aave on Polygon
 * @dev     VERSION: 1.0
 *          DATE:    2020-16-11
 */
contract PAaveIntegration is AaveV2Integration {
    event RewardsClaimed(address[] assets, uint256 amount);

    IAaveIncentivesController public immutable rewardController;

    /**
     * @param _nexus            Address of the Nexus
     * @param _lp               Address of LP
     * @param _platformAddress  Generic platform address
     * @param _rewardToken      Reward token, if any
     * @param _rewardController AaveIncentivesController
     */
    constructor(
        address _nexus,
        address _lp,
        address _platformAddress,
        address _rewardToken,
        address _rewardController
    ) AaveV2Integration(_nexus, _lp, _platformAddress, _rewardToken) {
        require(_rewardController != address(0), "Invalid controller address");

        rewardController = IAaveIncentivesController(_rewardController);
    }

    /**
     * @dev Claims outstanding rewards from market
     */
    function claimRewards() external {
        uint256 len = bAssetsMapped.length;
        address[] memory pTokens = new address[](len);
        for (uint256 i = 0; i < len; i++) {
            pTokens[i] = bAssetToPToken[bAssetsMapped[i]];
        }
        uint256 rewards = rewardController.claimRewards(pTokens, type(uint256).max, address(this));

        emit RewardsClaimed(pTokens, rewards);
    }
}
