// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import "../../masset/MassetStructs.sol";
import { FeederLogic } from "../../feeders/FeederLogic.sol";

contract ExposedFeederLogic {
    function computeMint(
        BassetData[] memory _bAssets,
        uint8 _i,
        uint256 _rawInput,
        FeederConfig memory _config
    ) public pure returns (uint256 mintAmount) {
        return FeederLogic.computeMint(_bAssets, _i, _rawInput, _config);
    }

    function computeMintMulti(
        BassetData[] memory _bAssets,
        uint8[] memory _indices,
        uint256[] memory _rawInputs,
        FeederConfig memory _config
    ) public pure returns (uint256 mintAmount) {
        return FeederLogic.computeMintMulti(_bAssets, _indices, _rawInputs, _config);
    }

    function computeSwap(
        BassetData[] memory _bAssets,
        uint8 _i,
        uint8 _o,
        uint256 _rawInput,
        uint256 _feeRate,
        FeederConfig memory _config
    ) public pure returns (uint256 bAssetOutputQuantity, uint256 scaledSwapFee) {
        return FeederLogic.computeSwap(_bAssets, _i, _o, _rawInput, _feeRate, _config);
    }

    function computeRedeem(
        BassetData[] memory _bAssets,
        uint8 _o,
        uint256 _netMassetQuantity,
        FeederConfig memory _config
    ) public pure returns (uint256 rawOutputUnits) {
        return FeederLogic.computeRedeem(_bAssets, _o, _netMassetQuantity, _config);
    }

    function computeRedeemExact(
        BassetData[] memory _bAssets,
        uint8[] memory _indices,
        uint256[] memory _rawOutputs,
        FeederConfig memory _config
    ) public pure returns (uint256 totalmAssets) {
        return FeederLogic.computeRedeemExact(_bAssets, _indices, _rawOutputs, _config);
    }
}
