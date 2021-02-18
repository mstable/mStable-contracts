// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.0;
pragma abicoder v2;

// Internal
import { IMasset } from "../interfaces/IMasset.sol";
import { FeederPool } from "./FeederPool.sol";

// Libs
import { IERC20 } from "@openzeppelin/contracts-sol8/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-sol8/contracts/token/ERC20/SafeERC20.sol";

contract Minter {
    function cross_mint(
        address _mAsset,
        uint256 _input1,
        address _feederPool,
        uint256 _minOut,
        address _recipient
    ) external {
        // 1. mint pool 1
        // 2. mint pool 2
        // Costs increase vs local:
        //  1x safeTransferFrom
        // -2x balanceOf
    }
}
