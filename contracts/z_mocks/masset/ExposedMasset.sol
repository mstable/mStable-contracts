// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.0;

import { Masset } from "../../masset/Masset.sol";
import { ExposedInvariantValidator } from "./ExposedInvariantValidator.sol";

contract ExposedMasset is Masset {

    constructor(address _nexus) Masset(_nexus) {}

    function getK() external view returns (uint256 k) {
        k = ExposedInvariantValidator(address(forgeValidator)).getK(bAssetData, _getConfig());
    }

    function getA() public view returns (uint256) {
        return super._getA();
    }
}