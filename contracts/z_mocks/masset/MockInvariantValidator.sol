// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.0;

import { IInvariantValidator } from "../../masset/IInvariantValidator.sol";

// Mock Invariant Validator simply returns 1:1 swap for swap, accounting for decimals
// Deducts any fee, too
contract MockInvariantValidator is IInvariantValidator {

    // Set this to output a diff amount than 1:1
    uint256 public outputMultiplier = 1000e15;

    /**
     * @dev Set this to multiply output
     * @param _multiplier Where 1.001x = 1001e15
     */
    function setMultiplier(uint256 _multiplier) external {
        outputMultiplier = _multiplier;
    }

    function _multiplyOutput(uint256 _output) internal view returns (uint256) {
        return _output * outputMultiplier / 1e18;
    }

    function computeMint(
        BassetData[] calldata _bAssets,
        uint8 _i,
        uint256 _rawInput,
        InvariantConfig memory _config
    ) external view override returns (uint256) {
        uint256 scaledInput = (_rawInput * _bAssets[_i].ratio) / 1e8;
        return _multiplyOutput(scaledInput);
    }

    function computeMintMulti(
        BassetData[] calldata _bAssets,
        uint8[] calldata _indices,
        uint256[] calldata _rawInputs,
        InvariantConfig memory _config
    ) external view override returns (uint256) {
        uint256 scaledInput;
        uint8 idx;
        uint256 len = _indices.length;
        for (uint256 i = 0; i < len; i++) {
            idx = _indices[i];
            scaledInput += (_rawInputs[i] * _bAssets[idx].ratio) / 1e8;
        }
        return _multiplyOutput(scaledInput);
    }

    // Swap
    function computeSwap(
        BassetData[] calldata _bAssets,
        uint8 _i,
        uint8 _o,
        uint256 _rawInput,
        uint256 _feeRate,
        InvariantConfig memory _config
    ) external view override returns (uint256 bAssetOutputQuantity, uint256 scaledSwapFee) {
        uint256 totalReceived = (_rawInput * _bAssets[_i].ratio) / 1e8;
        scaledSwapFee = (totalReceived * _feeRate) / 1e18;
        uint256 delta = totalReceived - scaledSwapFee;
        bAssetOutputQuantity = _multiplyOutput((delta * 1e8) / _bAssets[_o].ratio);
    }

    // Redeem
    function computeRedeem(
        BassetData[] calldata _bAssets,
        uint8 _i,
        uint256 _mAssetQuantity,
        InvariantConfig memory _config
    ) external view override returns (uint256) {
        return _multiplyOutput((_mAssetQuantity * 1e8) / _bAssets[_i].ratio);
    }

    function computeRedeemExact(
        BassetData[] calldata _bAssets,
        uint8[] calldata _indices,
        uint256[] calldata _rawOutputs,
        InvariantConfig memory _config
    ) external view override returns (uint256) {
        uint256 scaledOutput;
        uint8 idx;
        uint256 len = _indices.length;
        for (uint256 i = 0; i < len; i++) {
            idx = _indices[i];
            scaledOutput += (_rawOutputs[i] * _bAssets[idx].ratio) / 1e8;
        }
        return _multiplyOutput(scaledOutput);
    }
}