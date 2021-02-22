// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.0;

import { MassetStructs } from "../masset/MassetStructs.sol";

abstract contract IFeederValidator is MassetStructs {
    // Mint
    function computeMint(
        BassetData[] calldata _bAssets,
        uint8 _i,
        uint256 _rawInput,
        FeederConfig memory _config
    ) external view virtual returns (uint256);

    function computeMintMulti(
        BassetData[] calldata _bAssets,
        uint8[] calldata _indices,
        uint256[] calldata _rawInputs,
        FeederConfig memory _config
    ) external view virtual returns (uint256);

    // Swap
    function computeSwap(
        BassetData[] calldata _bAssets,
        uint8 _i,
        uint8 _o,
        uint256 _rawInput,
        uint256 _feeRate,
        FeederConfig memory _config
    ) external view virtual returns (uint256, uint256);

    // Redeem
    function computeRedeem(
        BassetData[] calldata _bAssets,
        uint8 _i,
        uint256 _mAssetQuantity,
        FeederConfig memory _config
    ) external view virtual returns (uint256);

    function computeRedeemExact(
        BassetData[] calldata _bAssets,
        uint8[] calldata _indices,
        uint256[] calldata _rawOutputs,
        FeederConfig memory _config
    ) external view virtual returns (uint256);
}
