// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

library DistributionTypes {
    struct AssetConfigInput {
        uint128 emissionPerSecond;
        uint256 totalStaked;
        address underlyingAsset;
    }

    struct UserStakeInput {
        address underlyingAsset;
        uint256 stakedByUser;
        uint256 totalStaked;
    }
}
