// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.0;
pragma abicoder v2;

import { MassetStructs } from "../../../masset/MassetStructs.sol";

import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import { IBasketManager } from "./IBasketManager.sol";
import { Basket, Basset } from "./MassetStructsV2.sol";


library Migrator {

    function upgrade(
        IBasketManager basketManager,
        MassetStructs.BassetPersonal[] storage bAssetPersonal,
        MassetStructs.BassetData[] storage bAssetData,
        mapping(address => uint8) storage bAssetIndexes
    ) external {
        Basket memory importedBasket = basketManager.getBasket();

        uint256 len = importedBasket.bassets.length;
        uint256[] memory scaledVaultBalances = new uint[](len);
        uint256 maxScaledVaultBalance;
        for (uint8 i = 0; i < len; i++) {
            Basset memory bAsset = importedBasket.bassets[i];
            address bAssetAddress = bAsset.addr;
            bAssetIndexes[bAssetAddress] = i;

            address integratorAddress = basketManager.getBassetIntegrator(bAssetAddress);
            bAssetPersonal.push(
                MassetStructs.BassetPersonal({
                    addr: bAssetAddress,
                    integrator: integratorAddress,
                    hasTxFee: false,
                    status: MassetStructs.BassetStatus.Normal
                })
            );

            uint128 ratio = SafeCast.toUint128(bAsset.ratio);
            uint128 vaultBalance = SafeCast.toUint128(bAsset.vaultBalance);
            bAssetData.push(
                MassetStructs.BassetData({ ratio: ratio, vaultBalance: vaultBalance })
            );

            // caclulate scaled vault bAsset balance and totoal vault balance
            uint128 scaledVaultBalance = (vaultBalance * ratio) / 1e8;
            scaledVaultBalances[i] = scaledVaultBalance;
            maxScaledVaultBalance += scaledVaultBalance;
        }

        // Check each bAsset is under 25.01% weight
        maxScaledVaultBalance = maxScaledVaultBalance * 2501 / 10000;
        for (uint8 i = 0; i < len; i++) {
            require(scaledVaultBalances[i] < maxScaledVaultBalance, "imbalanced");
        }
    }
}