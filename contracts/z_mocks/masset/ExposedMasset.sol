// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.2;

import { Masset } from "../../masset/Masset.sol";
import { MassetLogic } from "../../masset/MassetLogic.sol";

contract ExposedMasset is Masset {

    constructor(address _nexus, uint256 _recolFee) Masset(_nexus, _recolFee) {}

    function getK() external view returns (uint256 k) {
        (, k) = MassetLogic.computePrice(data.bAssetData, _getConfig());
    }

    function getA() public view returns (uint256) {
        return super._getA();
    }
}