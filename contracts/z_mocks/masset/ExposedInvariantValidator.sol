// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.2;

import { InvariantValidator } from "../../masset/InvariantValidator.sol";
import "../../masset/MassetStructs.sol";

contract ExposedInvariantValidator is InvariantValidator {


    function getK(
        BassetData[] calldata _bAssets,
        InvariantConfig memory _config
    ) external pure returns (uint256 k) {
        (uint256[] memory x, uint256 sum) = _getReserves(_bAssets);
        k = _invariant(x, sum, _config.a);
    }
}