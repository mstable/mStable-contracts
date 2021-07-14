// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;
pragma abicoder v2;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { StakedToken } from "./StakedToken.sol";

/**
 * @title StakedMTA
 * @notice StakedToken with MTA token as staked token
 * @author Aave
 **/
contract StakedMeta is StakedToken {
    string internal constant NAME = "Staked MTA";
    string internal constant SYMBOL = "stkMTA";
    uint8 internal constant DECIMALS = 18;

    constructor(
        IERC20 stakedToken,
        IERC20 rewardToken,
        uint256 cooldownSeconds,
        uint256 unstakeWindow,
        address rewardsVault,
        address emissionManager,
        uint128 distributionDuration,
        address governance
    )
        public
        StakedTokenV2(
            stakedToken,
            rewardToken,
            cooldownSeconds,
            unstakeWindow,
            rewardsVault,
            emissionManager,
            distributionDuration,
            NAME,
            SYMBOL,
            DECIMALS,
            governance
        )
    {}
}
