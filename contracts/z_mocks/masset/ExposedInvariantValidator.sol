// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.0;

import { InvariantValidator } from "../../masset/InvariantValidator.sol";

contract ExposedInvariantValidator is InvariantValidator {


    function getK(
        BassetData[] calldata _bAssets,
        InvariantConfig memory _config
    ) external view returns (uint256 k) {
        (uint256[] memory x, uint256 sum) = _getReserves(_bAssets);
        k = _invariant(x, sum, _config.a);
    }
}