/* eslint-disable no-await-in-loop */
/* eslint-disable no-restricted-syntax */
import { FeederPool, Masset, MV1, MV2 } from "types/generated"
import { BasketManager__factory } from "types/generated/factories/BasketManager__factory"
import { MusdEth } from "types/generated/MusdEth"
import { MusdLegacy } from "types/generated/MusdLegacy"
import { getChainAddress } from "./networkAddressFactory"
import { isFeederPool, isMusdEth, isMusdLegacy } from "./snap-utils"
import { Chain } from "./tokens"

// Get mAsset token storage variables
export const dumpTokenStorage = async (token: Masset | MusdEth | MusdLegacy | FeederPool, toBlock: number): Promise<void> => {
    const override = {
        blockTag: toBlock,
    }
    console.log("\nSymbol  : ", (await token.symbol(override)).toString())
    console.log("Name    : ", (await token.name(override)).toString())
    console.log("Decimals: ", (await token.decimals(override)).toString())
    console.log("Supply  : ", (await token.totalSupply(override)).toString())
}

// Get bAsset storage variables
export const dumpBassetStorage = async (
    mAsset: Masset | MusdEth | MusdLegacy | MV1 | MV2,
    block: number,
    chain = Chain.mainnet,
): Promise<void> => {
    const override = {
        blockTag: block,
    }

    console.log("\nbAssets")
    // After the mUSD upgrade to MusdV3
    if (!isMusdLegacy(mAsset)) {
        const bAssets = await mAsset.getBassets(override)
        bAssets.personal.forEach(async (personal, i) => {
            console.log(`bAsset with index ${i}`)
            console.log(` Address    :`, personal.addr.toString())
            console.log(` Integration:`, personal.integrator.toString())
            console.log(` Tx fee     :`, personal.hasTxFee.toString())
            console.log(` Status     :`, personal.status.toString())
            console.log(` Ratio      :`, bAssets[1][i].ratio.toString())
            console.log(` Vault bal  :`, bAssets[1][i].vaultBalance.toString())
            console.log("\n")
        })
    } else {
        // Before the mUSD upgrade to MusdV3 where the bAssets were in a separate Basket Manager contract
        const basketManagerAddress = getChainAddress("BasketManager", chain)
        const basketManager = BasketManager__factory.connect(basketManagerAddress, mAsset.signer)
        const basket = await basketManager.getBassets(override)
        let i = 0
        for (const bAsset of basket.bAssets) {
            console.log(`bAsset with index ${i}`)
            console.log(` Address    :`, bAsset.addr.toString())
            const integrationAddress = await basketManager.integrations(i, override)
            console.log(` Integration:`, integrationAddress)
            console.log(` Tx fee     :`, bAsset.isTransferFeeCharged.toString())
            console.log(` Status     :`, bAsset.status.toString())
            console.log(` Ratio      :`, bAsset.ratio.toString())
            console.log(` Vault bal  :`, bAsset.vaultBalance.toString())
            console.log(` Max weight :`, bAsset.maxWeight.toString())
            console.log("\n")
            i += 1
        }
    }
}

// Get fAsset storage variables
export const dumpFassetStorage = async (pool: FeederPool, bock: number): Promise<void> => {
    const override = {
        blockTag: bock,
    }

    console.log("\nbAssets")
    const fAssets = await pool.getBassets(override)
    fAssets.forEach(async (_, i) => {
        console.log(`bAsset with index ${i}`)
        console.log(` Address    :`, fAssets[0][i].addr.toString())
        console.log(` Integration:`, fAssets[0][i].integrator.toString())
        console.log(` Tx fee     :`, fAssets[0][i].hasTxFee.toString())
        console.log(` Status     :`, fAssets[0][i].status.toString())
        console.log(` Ratio      :`, fAssets[1][i].ratio.toString())
        console.log(` Vault      :`, fAssets[1][i].vaultBalance.toString())
        console.log("\n")
    })
}

// Get Masset storage variables
export const dumpConfigStorage = async (mAsset: Masset | MusdEth | MusdLegacy | FeederPool, block: number): Promise<void> => {
    const override = {
        blockTag: block,
    }

    if (!isMusdLegacy(mAsset)) {
        const invariantConfig = await mAsset.getConfig(override)
        console.log("A              : ", invariantConfig.a.toString())
        console.log("Min            : ", invariantConfig.limits.min.toString())
        console.log("Max            : ", invariantConfig.limits.max.toString())
    }

    if (!isMusdEth(mAsset) && !isMusdLegacy(mAsset)) {
        // Masset and FeederPool
        const data = await (mAsset as FeederPool).data(override)

        console.log("\nCacheSize      : ", data.cacheSize.toString())
        console.log("\nSwapFee        : ", data.swapFee.toString())
        console.log("RedemptionFee  : ", data.redemptionFee.toString())

        if (isFeederPool(mAsset)) {
            // Only FeederPools
            console.log("GovFee         : ", data.govFee.toString())
            console.log("pendingFees    : ", data.pendingFees.toString())
        }
    } else {
        // mUSD or mBTC
        console.log(
            "\nSwapFee        : ",
            (
                await mAsset.swapFee({
                    blockTag: block,
                })
            ).toString(),
        )
        console.log(
            "RedemptionFee  : ",
            (
                await mAsset.redemptionFee({
                    blockTag: block,
                })
            ).toString(),
        )
        console.log(
            "Surplus        : ",
            (
                await mAsset.surplus({
                    blockTag: block,
                })
            ).toString(),
        )
    }
}
