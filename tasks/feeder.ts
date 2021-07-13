import "ts-node/register"
import "tsconfig-paths/register"
import { task, types } from "hardhat/config"
import { Signer } from "ethers"

import { ERC20__factory, FeederPool, FeederPool__factory, IERC20__factory, Masset, SavingsManager__factory } from "types/generated"
import { BN, simpleToExactAmount } from "@utils/math"
import { formatUnits } from "ethers/lib/utils"
import { dumpConfigStorage, dumpFassetStorage, dumpTokenStorage } from "./utils/storage-utils"
import {
    getMultiRedemptions,
    Balances,
    getBlock,
    getBlockRange,
    getBasket,
    snapConfig,
    getMints,
    getMultiMints,
    getSwaps,
    getRedemptions,
    outputFees,
    getCollectedInterest,
} from "./utils/snap-utils"
import { Chain, PFRAX, PmUSD, Token, tokens } from "./utils/tokens"
import { btcFormatter, QuantityFormatter, usdFormatter } from "./utils/quantity-formatters"
import { getSwapRates } from "./utils/rates-utils"
import { getSigner } from "./utils/defender-utils"
import { logTxDetails } from "./utils"
import { getChain, getChainAddress } from "./utils/networkAddressFactory"

const getBalances = async (
    feederPool: Masset | FeederPool,
    block: number,
    asset: Token,
    quantityFormatter: QuantityFormatter,
): Promise<Balances> => {
    const feederPoolBalance = await feederPool.totalSupply({
        blockTag: block,
    })
    const vaultBalance = await feederPool.balanceOf(asset.vault, {
        blockTag: block,
    })
    const otherBalances = feederPoolBalance.sub(vaultBalance)

    console.log("\nHolders")
    console.log(`Vault                      ${quantityFormatter(vaultBalance)} ${vaultBalance.mul(100).div(feederPoolBalance)}%`)
    console.log(`Others                     ${quantityFormatter(otherBalances)} ${otherBalances.mul(100).div(feederPoolBalance)}%`)
    console.log(`Total                      ${quantityFormatter(feederPoolBalance)}`)

    return {
        total: feederPoolBalance,
        save: vaultBalance,
        earn: BN.from(0),
    }
}

const getFeederPool = (signer: Signer, contractAddress: string, chain = Chain.mainnet): FeederPool => {
    const linkedAddress = {
        __$60670dd84d06e10bb8a5ac6f99a1c0890c$__: getChainAddress("FeederManager", chain),
        __$7791d1d5b7ea16da359ce352a2ac3a881c$__: getChainAddress("FeederLogic", chain),
    }
    const feederPoolFactory = new FeederPool__factory(linkedAddress, signer)
    return feederPoolFactory.attach(contractAddress)
}

const getQuantities = (fAsset: Token, _swapSize?: number): { quantityFormatter: QuantityFormatter; swapSize: number } => {
    let quantityFormatter: QuantityFormatter
    let swapSize: number
    if (fAsset.quantityFormatter === "USD") {
        quantityFormatter = usdFormatter
        swapSize = _swapSize || 10000
    } else if (fAsset.quantityFormatter === "BTC") {
        quantityFormatter = btcFormatter
        swapSize = _swapSize || 1
    }
    return {
        quantityFormatter,
        swapSize,
    }
}

task("feeder-storage", "Dumps feeder contract storage data")
    .addOptionalParam("block", "Block number to get storage from. (default: current block)", 0, types.int)
    .addParam("fasset", "Token symbol of the feeder pool asset.  eg HBTC, TBTC, GUSD or BUSD", undefined, types.string, false)
    .setAction(async (taskArgs, { ethers, network, hardhatArguments }) => {
        const chain = getChain(network.name, hardhatArguments.config)
        const fAsset = tokens.find((t) => t.symbol === taskArgs.fasset)
        if (!fAsset) {
            console.error(`Failed to find feeder pool asset with token symbol ${taskArgs.fasset}`)
            process.exit(1)
        }

        const { blockNumber } = await getBlock(ethers, taskArgs.block)

        const signer = await getSigner(ethers)
        const pool = getFeederPool(signer, fAsset.feederPool, chain)

        await dumpTokenStorage(pool, blockNumber)
        await dumpFassetStorage(pool, blockNumber)
        await dumpConfigStorage(pool, blockNumber)
    })

task("feeder-snap", "Gets feeder transactions over a period of time")
    .addOptionalParam("from", "Block to query transaction events from. (default: deployment block)", 12146627, types.int)
    .addOptionalParam("to", "Block to query transaction events to. (default: current block)", 0, types.int)
    .addParam("fasset", "Token symbol of the feeder pool asset. eg HBTC, TBTC, GUSD or BUSD", undefined, types.string, false)
    .setAction(async (taskArgs, { ethers, network, hardhatArguments }) => {
        const chain = getChain(network.name, hardhatArguments.config)
        const signer = await getSigner(ethers)
        const { fromBlock, toBlock } = await getBlockRange(ethers, taskArgs.from, taskArgs.to)

        const fAsset = tokens.find((t) => t.symbol === taskArgs.fasset)
        if (!fAsset) {
            console.error(`Failed to find feeder pool asset with token symbol ${taskArgs.fasset}`)
            process.exit(1)
        }
        console.log(`\nGetting snap for feeder pool ${fAsset.symbol} from block ${fromBlock.blockNumber}, to ${toBlock.blockNumber}`)
        const mAsset = tokens.find((t) => t.symbol === fAsset.parent)
        const fpAssets = [mAsset, fAsset]

        const feederPool = getFeederPool(signer, fAsset.feederPool)
        const savingsManagerAddress = getChainAddress("SavingsManager", chain)
        const savingsManager = SavingsManager__factory.connect(savingsManagerAddress, signer)

        const { quantityFormatter } = getQuantities(fAsset, taskArgs.swapSize)

        const mintSummary = await getMints(tokens, feederPool, fromBlock.blockNumber, toBlock.blockNumber, quantityFormatter)
        const mintMultiSummary = await getMultiMints(tokens, feederPool, fromBlock.blockNumber, toBlock.blockNumber, quantityFormatter)
        const swapSummary = await getSwaps(tokens, feederPool, fromBlock.blockNumber, toBlock.blockNumber, quantityFormatter)
        const redeemSummary = await getRedemptions(tokens, feederPool, fromBlock.blockNumber, toBlock.blockNumber, quantityFormatter)
        const redeemMultiSummary = await getMultiRedemptions(
            tokens,
            feederPool,
            fromBlock.blockNumber,
            toBlock.blockNumber,
            quantityFormatter,
        )

        await snapConfig(feederPool, toBlock.blockNumber)
        await getBasket(
            feederPool,
            fpAssets.map((b) => b.symbol),
            mAsset.symbol,
            usdFormatter,
            toBlock.blockNumber,
        )

        const balances = await getBalances(feederPool, toBlock.blockNumber, fAsset, quantityFormatter)

        const collectedInterestSummary = await getCollectedInterest(
            fpAssets,
            feederPool,
            savingsManager,
            fromBlock,
            toBlock,
            quantityFormatter,
            balances.save,
        )

        const data = await feederPool.data()
        console.log(`\nPending gov fees ${quantityFormatter(data.pendingFees)}`)

        outputFees(
            mintSummary,
            mintMultiSummary,
            swapSummary,
            redeemSummary,
            redeemMultiSummary,
            balances,
            fromBlock.blockTime,
            toBlock.blockTime,
            quantityFormatter,
        )
    })

task("feeder-rates", "Feeder rate comparison to Curve")
    .addOptionalParam("block", "Block number to compare rates at. (default: current block)", 0, types.int)
    .addOptionalParam("swapSize", "Swap size to compare rates with Curve", undefined, types.float)
    .addParam("fasset", "Token symbol of the feeder pool asset. eg HBTC, TBTC, GUSD or BUSD", undefined, types.string, false)
    .setAction(async (taskArgs, { ethers, network }) => {
        const signer = await getSigner(ethers)

        const block = await getBlock(ethers, taskArgs.block)

        const fAsset = tokens.find((t) => t.symbol === taskArgs.fasset)
        if (!fAsset) {
            console.error(`Failed to find feeder pool asset with token symbol ${taskArgs.fasset}`)
            process.exit(1)
        }
        console.log(`\nGetting rates for feeder pool ${fAsset.symbol} at block ${block.blockNumber}, ${block.blockTime.toUTCString()}`)
        const feederPool = getFeederPool(signer, fAsset.feederPool)

        const mAsset = tokens.find((t) => t.symbol === fAsset.parent)
        const fpAssets = [mAsset, fAsset]

        // Get the bAssets for the main pool. eg bAssets in mUSD or mBTC
        // These are the assets that are not feeder pools and parent matches the fAsset's parent
        const mpAssets = tokens.filter((t) => t.parent === fAsset.parent && !t.feederPool)

        const { quantityFormatter, swapSize } = getQuantities(fAsset, taskArgs.swapSize)

        console.log("      Qty Input     Output      Qty Out    Rate             Output    Rate   Diff      Arb$")
        await getSwapRates(fpAssets, fpAssets, feederPool, block.blockNumber, quantityFormatter, network.name, swapSize)
        await getSwapRates([fAsset], mpAssets, feederPool, block.blockNumber, quantityFormatter, network.name, swapSize)
        await getSwapRates(mpAssets, [fAsset], feederPool, block.blockNumber, quantityFormatter, network.name, swapSize)
        await snapConfig(feederPool, block.blockNumber)
    })

task("frax-post-deploy", "Mint FRAX Feeder Pool").setAction(async (_, { ethers }) => {
    const signer = await getSigner(ethers)

    const frax = ERC20__factory.connect(PFRAX.address, signer)
    const fraxFp = FeederPool__factory.connect(PFRAX.feederPool, signer)
    const musd = await IERC20__factory.connect(PmUSD.address, signer)

    const approveAmount = simpleToExactAmount(100)
    const bAssetAmount = simpleToExactAmount(10)
    const minAmount = simpleToExactAmount(9)

    let tx = await frax.approve(PFRAX.feederPool, approveAmount)
    await logTxDetails(tx, "approve FRAX")

    tx = await musd.approve(PFRAX.feederPool, approveAmount)
    await logTxDetails(tx, "approve mUSD")

    tx = await fraxFp.mintMulti([PFRAX.address, PmUSD.address], [bAssetAmount, bAssetAmount], minAmount, await signer.getAddress())
    await logTxDetails(tx, "mint FRAX FP")
})

task("feeder-mint", "Mint some Feeder Pool tokens")
    .addOptionalParam("amount", "Amount of the mAsset and fAsset to deposit", undefined, types.int)
    .addParam("fasset", "Token symbol of the feeder pool asset. eg HBTC, GUSD, PFRAX or alUSD", undefined, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, { ethers, network }) => {
        const chain = getChain(network.name)
        const signer = await getSigner(ethers, taskArgs.speed)
        const signerAddress = await signer.getAddress()

        const fAssetSymbol = taskArgs.fasset
        const feederPoolToken = tokens.find((t) => t.symbol === fAssetSymbol && t.chain === chain)
        if (!feederPoolToken) throw Error(`Could not find feeder pool asset token with symbol ${fAssetSymbol}`)
        if (!feederPoolToken.feederPool) throw Error(`No feeder pool configured for token ${fAssetSymbol}`)

        const mAssetSymbol = feederPoolToken.parent
        if (!mAssetSymbol) throw Error(`No parent mAsset configured for feeder pool asset ${mAssetSymbol}`)
        const mAssetToken = tokens.find((t) => t.symbol === mAssetSymbol && t.chain === chain)
        if (!mAssetToken) throw Error(`Could not find mAsset token with symbol ${mAssetToken}`)

        const fp = FeederPool__factory.connect(feederPoolToken.feederPool, signer)
        const fpSymbol = await fp.symbol()

        const mintAmount = simpleToExactAmount(taskArgs.amount)

        // mint Feeder Pool tokens
        const tx = await fp.mintMulti([mAssetToken.address, feederPoolToken.address], [mintAmount, mintAmount], 0, signerAddress)
        logTxDetails(tx, `Mint ${fpSymbol} from ${formatUnits(mintAmount)} ${mAssetSymbol} and ${formatUnits(mintAmount)} ${fAssetSymbol}`)
    })

task("feeder-redeem", "Redeem some Feeder Pool tokens")
    .addParam("fasset", "Token symbol of the feeder pool asset. eg HBTC, GUSD, PFRAX or alUSD", undefined, types.string)
    .addParam("amount", "Amount of the feeder pool liquidity tokens to proportionately redeem", undefined, types.int)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, { ethers, network }) => {
        const chain = getChain(network.name)
        const signer = await getSigner(ethers, taskArgs.speed)
        const signerAddress = await signer.getAddress()

        const fAssetSymbol = taskArgs.fasset
        const feederPoolToken = tokens.find((t) => t.symbol === fAssetSymbol && t.chain === chain)
        if (!feederPoolToken) throw Error(`Could not find feeder pool asset token with symbol ${fAssetSymbol}`)
        if (!feederPoolToken.feederPool) throw Error(`No feeder pool configured for token ${fAssetSymbol}`)

        const fp = FeederPool__factory.connect(feederPoolToken.feederPool, signer)
        const fpSymbol = await fp.symbol()

        const fpAmount = simpleToExactAmount(taskArgs.amount)
        const minBassetAmount = fpAmount.mul(40).div(100) // min 40% for each bAsset

        // redeem Feeder Pool tokens
        const tx = await fp.redeemProportionately(fpAmount, [minBassetAmount, minBassetAmount], signerAddress)
        logTxDetails(tx, `Redeem ${fpSymbol} from ${formatUnits(fpAmount)}`)
    })

task("feeder-swap", "Swap some Feeder Pool tokens")
    .addParam(
        "input",
        "Token symbol of the input token to the swap. eg mUSD, PmUSD, mBTC, HBTC, GUSD, PFRAX or alUSD",
        undefined,
        types.string,
    )
    .addParam(
        "output",
        "Token symbol of the output token from the swap. eg mUSD, PmUSD, mBTC, HBTC, GUSD, PFRAX or alUSD",
        undefined,
        types.string,
    )
    .addParam("amount", "Amount of input tokens to swap", undefined, types.int)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, { ethers, network }) => {
        const chain = getChain(network.name)
        const signer = await getSigner(ethers, taskArgs.speed)
        const signerAddress = await signer.getAddress()

        const inputSymbol = taskArgs.input
        const inputToken = tokens.find((t) => t.symbol === inputSymbol && t.chain === chain)
        if (!inputToken) throw Error(`Could not find input asset token with symbol ${inputSymbol}`)

        const outputSymbol = taskArgs.output
        const outputToken = tokens.find((t) => t.symbol === outputSymbol && t.chain === chain)
        if (!outputToken) throw Error(`Could not find output asset token with symbol ${outputSymbol}`)

        let fp: FeederPool
        if (inputToken.feederPool && !outputToken.feederPool) {
            fp = FeederPool__factory.connect(inputToken.feederPool, signer)
        } else if (!inputToken.feederPool && outputToken.feederPool) {
            fp = FeederPool__factory.connect(outputToken.feederPool, signer)
        } else {
            throw Error(`Could not find Feeder Pool for input ${inputSymbol} and output ${outputSymbol}`)
        }

        const fpSymbol = await fp.symbol()

        const inputAmount = simpleToExactAmount(taskArgs.amount)
        const minOutputAmount = inputAmount.mul(90).div(100) // min 90% of the input

        const tx = await fp.swap(inputToken.address, outputToken.address, inputAmount, minOutputAmount, signerAddress)
        logTxDetails(tx, `swap ${formatUnits(inputAmount)} ${inputSymbol} for ${outputSymbol} using ${fpSymbol} Feeder Pool`)
    })

module.exports = {}
