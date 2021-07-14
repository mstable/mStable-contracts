// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;
pragma abicoder v2;

import { DistributionTypes } from "./DistributionTypes.sol";

interface IAaveDistributionManager {
    function configureAssets(DistributionTypes.AssetConfigInput[] calldata assetsConfigInput)
        external;
}
