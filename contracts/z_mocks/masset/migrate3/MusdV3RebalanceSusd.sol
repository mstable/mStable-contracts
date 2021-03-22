// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.0;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ITether } from "../../../shared/ITether.sol";
import { IMassetV2 } from "./IMassetV2.sol";

/**
 * @title   Contract to balance mUSD bAssets using sUSD in preparation for the mUSD V3 upgrade.
 * @author  mStable
 * @notice  Should only be used if sUSD is under the target mUSD basket weight. eg 25%.
 *          The bAssets to be swapped with should be over the target mUSD basket weight. eg TUSD and USDT.
 * @dev     VERSION: 1.0
 *          DATE:    2021-03-22
 */
contract MusdV3SusdBalancer {

    using SafeERC20 for IERC20;

    // address immutable private owner;
    IMassetV2 constant mUsdV2 = IMassetV2(0xe2f2a5C287993345a840Db3B0845fbC70f5935a5);
    IERC20 constant sUSD = IERC20(0x57Ab1ec28D129707052df4dF418D58a2D46d5f51);
    
    /**
    * @notice balances mUSD bAssets like TUSD and USDT using borrowed sUSD.
    * Assumes the sUSD funding account has already approved a transfer to this contract.
    * @param bAssets address of the tokens the sUSD will be swapped for in the mUSD basket. eg TUSD and USDT.
    * @param amounts sUSD input quantities for each mUSD swap.
    * @param funderAccount account that the sUSD will be borrowed from and swap output returned to.
    */
    function balanceSusd(address[] memory bAssets, uint256[] memory amounts, address funderAccount) public {
        // sum the total sUSD to be swapped on mUSD
        uint256 len = bAssets.length;
        require(amounts.length == len, "bAssets and amounts lengths");
        uint256 sUsdTotal;
        for (uint256 i = 0; i < len; i++) {
            sUsdTotal += amounts[i];
        }

        // transfer sUSD to this contracts
        sUSD.transferFrom(funderAccount, address(this), sUsdTotal);

        // Approve mUSD contract to transfer sUSD from this contract
        IERC20(sUSD).approve(address(mUsdV2), sUsdTotal);

        uint256 output;
        for (uint256 i = 0; i < len; i++) {
            // Swap sUSD for bAsset using mUSD to balance the bAsset
            output = mUsdV2.swap(address(sUSD), bAssets[i], amounts[i], address(this));

            // Send the swap output back to the funder account
            if (bAssets[i] == 0xdAC17F958D2ee523a2206206994597C13D831ec7) {
                // If USD Tether (USDT) which does not return bool
                ITether(bAssets[i]).transfer(funderAccount, output);
            } else {
                // Standard ERC20 that does return a bool
                IERC20(bAssets[i]).transfer(funderAccount, output);
            }
        }
    }
}
