import "ts-node/register"
import "tsconfig-paths/register"
import { task, types } from "hardhat/config"
import { Signer } from "ethers"

import {
    ERC20__factory,
    FeederPool,
    FeederPool__factory,
    FeederWrapper__factory,
    IERC20__factory,
    InterestValidator__factory,
    Masset,
    SavingsManager__factory,
} from "types/generated"
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
import { getSigner } from "./utils/signerFactory"
import { logTxDetails } from "./utils"
import { getChain, getChainAddress, resolveAddress } from "./utils/networkAddressFactory"
import { params } from "./taskUtils"

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
        "contracts/feeders/FeederLogic.sol:FeederLogic": getChainAddress("FeederLogic", chain),
        "contracts/feeders/FeederManager.sol:FeederManager": getChainAddress("FeederManager", chain),
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
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        const fAsset = tokens.find((t) => t.symbol === taskArgs.fasset)
        if (!fAsset) {
            console.error(`Failed to find feeder pool asset with token symbol ${taskArgs.fasset}`)
            process.exit(1)
        }

        const { blockNumber } = await getBlock(hre.ethers, taskArgs.block)

        const pool = getFeederPool(signer, fAsset.feederPool, chain)

        await dumpTokenStorage(pool, blockNumber)
        await dumpFassetStorage(pool, blockNumber)
        await dumpConfigStorage(pool, blockNumber)
    })

task("feeder-snap", "Gets feeder transactions over a period of time")
    .addOptionalParam("from", "Block to query transaction events from. (default: deployment block)", 12146627, types.int)
    .addOptionalParam("to", "Block to query transaction events to. (default: current block)", 0, types.int)
    .addParam("fasset", "Token symbol of the feeder pool asset. eg HBTC, TBTC, GUSD or BUSD", undefined, types.string, false)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)
        const { fromBlock, toBlock } = await getBlockRange(hre.ethers, taskArgs.from, taskArgs.to)

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

        await getCollectedInterest(fpAssets, feederPool, savingsManager, fromBlock, toBlock, quantityFormatter, balances.save)

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
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre)
        const chain = getChain(hre)

        const block = await getBlock(hre.ethers, taskArgs.block)

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
        await getSwapRates(fpAssets, fpAssets, feederPool, block.blockNumber, quantityFormatter, swapSize, chain)
        await getSwapRates([fAsset], mpAssets, feederPool, block.blockNumber, quantityFormatter, swapSize, chain)
        await getSwapRates(mpAssets, [fAsset], feederPool, block.blockNumber, quantityFormatter, swapSize, chain)
        await snapConfig(feederPool, block.blockNumber)
    })

task("frax-post-deploy", "Mint FRAX Feeder Pool")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs)

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

task("FeederWrapper-approveAll", "Sets approvals for a Feeder Pool")
    // TODO replace these params with Token symbol
    .addParam("feeder", "Feeder Pool address", undefined, params.address, false)
    .addParam("vault", "BoostedVault contract address", undefined, params.address, false)
    .addParam("assets", "Asset addresses", undefined, params.addressArray, false)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const deployer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        const feederWrapperAddress = getChainAddress("FeederWrapper", chain)
        const feederWrapper = FeederWrapper__factory.connect(feederWrapperAddress, deployer)

        const tx = await feederWrapper["approve(address,address,address[])"](taskArgs.feeder, taskArgs.vault, taskArgs.assets)
        await logTxDetails(tx, "Approve Feeder/Vault and other assets")
    })

task("FeederWrapper-approveMulti", "Sets approvals for multiple tokens/a single spender")
    .addParam("tokens", "Token addresses", undefined, params.address, false)
    .addParam("spender", "Spender address", undefined, params.address, false)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const deployer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        const feederWrapperAddress = getChainAddress("FeederWrapper", chain)
        const feederWrapper = FeederWrapper__factory.connect(feederWrapperAddress, deployer)

        const tx = await feederWrapper["approve(address[],address)"](taskArgs.tokens, taskArgs.spender)
        await logTxDetails(tx, "Approve muliple tokens/single spender")
    })

task("FeederWrapper-approve", "Sets approvals for a single token/spender")
    .addParam("feederWrapper", "FeederWrapper address", undefined, params.address, false)
    .addParam("token", "Token address", undefined, params.address, false)
    .addParam("spender", "Spender address", undefined, params.address, false)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const deployer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)

        const feederWrapperAddress = getChainAddress("FeederWrapper", chain)

        const feederWrapper = FeederWrapper__factory.connect(feederWrapperAddress, deployer)

        const tx = await feederWrapper["approve(address,address)"](taskArgs.tokens, taskArgs.spender)
        await logTxDetails(tx, "Approve single token/spender")
    })

task("feeder-mint", "Mint some Feeder Pool tokens")
    .addOptionalParam("amount", "Amount of the mAsset and fAsset to deposit", undefined, types.float)
    .addParam("fasset", "Token symbol of the feeder pool asset. eg HBTC, GUSD, PFRAX or alUSD", undefined, types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)
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
        await logTxDetails(
            tx,
            `Mint ${fpSymbol} from ${formatUnits(mintAmount)} ${mAssetSymbol} and ${formatUnits(mintAmount)} ${fAssetSymbol}`,
        )
    })

task("feeder-redeem", "Redeem some Feeder Pool tokens")
    .addParam("fasset", "Token symbol of the feeder pool asset. eg HBTC, GUSD, PFRAX or alUSD", undefined, types.string)
    .addParam("amount", "Amount of the feeder pool liquidity tokens to proportionately redeem", undefined, types.float)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)
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
        await logTxDetails(tx, `Redeem ${fpSymbol} from ${formatUnits(fpAmount)}`)
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
    .addParam("amount", "Amount of input tokens to swap", undefined, types.float)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)
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
        await logTxDetails(tx, `swap ${formatUnits(inputAmount)} ${inputSymbol} for ${outputSymbol} using ${fpSymbol} Feeder Pool`)
    })

task("feeder-collect-interest", "Collects and interest from feeder pools")
    .addParam("fasset", "Token symbol of feeder pool. eg HBTC, alUSD or PFRAX", undefined, types.string, false)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "average", types.string)
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)
        const signer = await getSigner(hre, taskArgs.speed)

        const fpAddress = resolveAddress(taskArgs.fasset, chain, "feederPool")

        const interestValidatorAddress = resolveAddress("FeederInterestValidator", chain)
        const validator = InterestValidator__factory.connect(interestValidatorAddress, signer)

        const lastBatchCollected = await validator.lastBatchCollected(fpAddress)
        const lastBatchDate = new Date(lastBatchCollected.mul(1000).toNumber())
        console.log(`The last interest collection was ${lastBatchDate.toUTCString()}, epoch ${lastBatchCollected} seconds`)

        const currentEpoc = new Date().getTime() / 1000
        if (currentEpoc - lastBatchCollected.toNumber() < 60 * 60 * 12) {
            console.error(`Can not run again as the last run was less then 12 hours ago`)
            process.exit(3)
        }

        const tx = await validator.collectAndValidateInterest([fpAddress])
        await logTxDetails(tx, "collectAndValidateInterest")
    })

module.exports = {}
