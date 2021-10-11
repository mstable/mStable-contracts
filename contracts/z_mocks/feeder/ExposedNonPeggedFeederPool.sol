// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import "../../masset/MassetStructs.sol";
import { NonPeggedFeederPool } from "../../feeders/NonPeggedFeederPool.sol";

contract ExposedNonPeggedFeederPool is NonPeggedFeederPool {
    constructor(
        address _nexus,
        address _mAsset,
        address _fAssetRedemptionPrice
    ) NonPeggedFeederPool(_nexus, _mAsset, _fAssetRedemptionPrice) {}
}
