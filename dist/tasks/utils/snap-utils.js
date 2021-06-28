"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAaveTokens = exports.getCompTokens = exports.quoteSwap = exports.getCollectedInterest = exports.getLiquidatorInterest = exports.outputFees = exports.calcApy = exports.getMultiRedemptions = exports.getRedemptions = exports.getSwaps = exports.getMultiMints = exports.getMints = exports.getBalances = exports.getBasket = exports.snapSave = exports.snapConfig = exports.getSavingsManager = exports.getBlockRange = exports.getBlock = exports.isMusdEth = exports.isFeederPool = void 0;
const constants_1 = require("@utils/constants");
const math_1 = require("@utils/math");
const utils_1 = require("ethers/lib/utils");
const generated_1 = require("types/generated");
const uniswap_1 = require("@utils/peripheral/uniswap");
const AaveStakedTokenV2__factory_1 = require("types/generated/factories/AaveStakedTokenV2__factory");
const Comptroller__factory_1 = require("types/generated/factories/Comptroller__factory");
const quantity_formatters_1 = require("./quantity-formatters");
const tokens_1 = require("./tokens");
const compIntegrationAddress = "0xD55684f4369040C12262949Ff78299f2BC9dB735";
const liquidatorAddress = "0xe595D67181D701A5356e010D9a58EB9A341f1DbD";
const comptrollerAddress = "0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B";
// Only the FeederPool has the redeemProportionately function
function isFeederPool(asset) {
    return asset.redeemProportionately !== undefined;
}
exports.isFeederPool = isFeederPool;
// Only the mUSD deployed to Ethereum mainnet has the surplus function
function isMusdEth(asset) {
    return asset.surplus !== undefined;
}
exports.isMusdEth = isMusdEth;
const getBlock = async (ethers, _blockNumber) => {
    const blockNumber = _blockNumber || (await ethers.provider.getBlockNumber());
    const toBlock = await ethers.provider.getBlock(blockNumber);
    const blockTime = new Date(toBlock.timestamp * 1000);
    return {
        blockNumber,
        blockTime,
    };
};
exports.getBlock = getBlock;
const getBlockRange = async (ethers, fromBlockNumber, _toBlockNumber) => {
    const toBlockNumber = _toBlockNumber || (await ethers.provider.getBlockNumber());
    // const toBlock = await ethers.provider.getBlock(toBlockNumber)
    // const endTime = new Date(toBlock.timestamp * 1000)
    const toBlock = await exports.getBlock(ethers, _toBlockNumber);
    const fromBlock = await exports.getBlock(ethers, fromBlockNumber);
    console.log(`Between blocks ${fromBlock.blockNumber} and ${toBlockNumber}. ${fromBlock.blockTime.toUTCString()} and ${toBlock.blockTime.toUTCString()}`);
    return {
        fromBlock,
        toBlock,
    };
};
exports.getBlockRange = getBlockRange;
const getSavingsManager = (signer, networkName) => {
    if (networkName === "polygon_mainnet") {
        return generated_1.SavingsManager__factory.connect("0x10bFcCae079f31c451033798a4Fd9D2c33Ea5487", signer);
    }
    return generated_1.SavingsManager__factory.connect("0x9781C4E9B9cc6Ac18405891DF20Ad3566FB6B301", signer);
};
exports.getSavingsManager = getSavingsManager;
const snapConfig = async (asset, toBlock) => {
    let ampData;
    if (isMusdEth(asset)) {
        ampData = await asset.ampData();
    }
    else {
        const fpData = await asset.data();
        ampData = fpData.ampData;
    }
    const conf = await asset.getConfig({
        blockTag: toBlock,
    });
    console.log(`\nAmplification coefficient (A): ${utils_1.formatUnits(conf.a, 2)}`);
    const startDate = new Date(ampData.rampStartTime.toNumber() * 1000);
    const endDate = new Date(ampData.rampEndTime.toNumber() * 1000);
    if (startDate.valueOf() !== endDate.valueOf()) {
        console.log(`Ramp A: initial ${utils_1.formatUnits(ampData.initialA, 2)}; target ${utils_1.formatUnits(ampData.targetA, 2)}`);
        console.log(`Ramp A: start ${startDate.toUTCString()}; end ${endDate.toUTCString()}`);
    }
    console.log(`Weights: min ${utils_1.formatUnits(conf.limits.min, 16)}% max ${utils_1.formatUnits(conf.limits.max, 16)}%`);
};
exports.snapConfig = snapConfig;
const snapSave = async (signer, networkName, toBlock) => {
    const savingManagerAddress = networkName === "mainnet" ? "0x30647a72dc82d7fbb1123ea74716ab8a317eac19" : "0x5290Ad3d83476CA6A2b178Cd9727eE1EF72432af";
    const savingsManager = new generated_1.SavingsContract__factory(signer).attach(savingManagerAddress);
    const exchangeRate = await savingsManager.exchangeRate({
        blockTag: toBlock,
    });
    console.log(`\nSave rate ${utils_1.formatUnits(exchangeRate)}`);
};
exports.snapSave = snapSave;
const getTvlCap = async (signer, tvlConfig, toBlock) => {
    const validator = await new generated_1.ValidatorWithTVLCap__factory(signer).attach(tvlConfig.invariantValidatorAddress);
    const tvlStartTime = await validator.startTime({
        blockTag: toBlock,
    });
    const weeksSinceLaunch = math_1.BN.from(Date.now()).div(1000).sub(tvlStartTime).mul(constants_1.fullScale).div(604800);
    // // e.g. 1e19 + (15e18 * 2.04e36) = 1e19 + 3.06e55
    // // startingCap + (capFactor * weeksSinceLaunch**2 / 1e36);
    return tvlConfig.startingCap.add(tvlConfig.capFactor.mul(weeksSinceLaunch.pow(2)).div(constants_1.fullScale.pow(2)));
};
const getBasket = async (asset, bAssetSymbols, mAssetName = "mBTC", quantityFormatter, toBlock, tvlConfig, exposedLogic) => {
    const bAssets = await asset.getBassets({
        blockTag: toBlock,
    });
    const bAssetTotals = [];
    let bAssetsTotal = math_1.BN.from(0);
    bAssetSymbols.forEach((_, i) => {
        let scaledBassetQuantity;
        if (isMusdEth(asset)) {
            scaledBassetQuantity = math_1.applyRatio(bAssets[1][i].vaultBalance, bAssets[1][i].ratio);
        }
        else if (isFeederPool(asset)) {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            scaledBassetQuantity = math_1.applyRatio(bAssets.vaultData[i].vaultBalance, bAssets.vaultData[i].ratio);
        }
        else {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            scaledBassetQuantity = math_1.applyRatio(bAssets.bData[i].vaultBalance, bAssets.bData[i].ratio);
        }
        bAssetTotals.push(scaledBassetQuantity);
        bAssetsTotal = bAssetsTotal.add(scaledBassetQuantity);
    });
    console.log(`\n${mAssetName} basket`);
    bAssetSymbols.forEach((symbol, i) => {
        const percentage = bAssetTotals[i].mul(100).div(bAssetsTotal);
        console.log(`  ${symbol.padEnd(7)}  ${quantityFormatter(bAssetTotals[i]).padEnd(20)} ${percentage.toString().padStart(2)}%`);
    });
    let mAssetSurplus = math_1.BN.from(0);
    if (isMusdEth(asset)) {
        mAssetSurplus = await asset.surplus({
            blockTag: toBlock,
        });
    }
    else if (!isFeederPool(asset)) {
        mAssetSurplus = (await asset.data({
            blockTag: toBlock,
        })).surplus;
    }
    const mAssetSupply = await asset.totalSupply({
        blockTag: toBlock,
    });
    console.log(`Surplus    ${utils_1.formatUnits(mAssetSurplus)}`);
    console.log(`${mAssetName}       ${quantityFormatter(mAssetSupply)}`);
    const mAssetTotal = mAssetSupply.add(mAssetSurplus);
    if (exposedLogic && !isMusdEth(asset)) {
        const config = {
            ...(await asset.getConfig({
                blockTag: toBlock,
            })),
            recolFee: 0,
        };
        const k = await exposedLogic.getK(bAssets[1], config);
        console.log(`Total (K)  ${utils_1.formatUnits(k)}`);
        // Sum of base assets less mAsset total supply less mAsset surplus
        const bAssetMassetDiff = k.sub(mAssetTotal);
        const bAssetMassetDiffBasisPoints = bAssetMassetDiff.mul(10000).div(mAssetTotal);
        console.log(`Total ${mAssetName} ${utils_1.formatUnits(mAssetTotal)} (${utils_1.formatUnits(bAssetMassetDiff)} ${bAssetMassetDiffBasisPoints}bps over-collateralised)`);
    }
    if (tvlConfig) {
        const tvlCap = await getTvlCap(asset.signer, tvlConfig, toBlock);
        const tvlCapPercentage = bAssetsTotal.mul(100).div(tvlCap);
        console.log(`TVL cap   ${quantityFormatter(tvlCap)} ${tvlCapPercentage}%`);
    }
};
exports.getBasket = getBasket;
const getBalances = async (mAsset, accounts, quantityFormatter, toBlock) => {
    const mAssetBalance = await mAsset.totalSupply({
        blockTag: toBlock,
    });
    console.log("\nHolders");
    let balanceSum = math_1.BN.from(0);
    const balances = [];
    for (const account of accounts) {
        const balance = await mAsset.balanceOf(account.address, {
            blockTag: toBlock,
        });
        console.log(`${account.name.padEnd(26)} ${quantityFormatter(balance)} ${balance.mul(100).div(mAssetBalance)}%`);
        balanceSum = balanceSum.add(balance);
        balances.push(balance);
    }
    const otherBalances = mAssetBalance.sub(balanceSum);
    console.log(`${"Other".padEnd(26)} ${quantityFormatter(otherBalances)} ${otherBalances.mul(100).div(mAssetBalance)}%`);
    const surplus = isMusdEth(mAsset)
        ? await mAsset.surplus({
            blockTag: toBlock,
        })
        : (await mAsset.data({
            blockTag: toBlock,
        })).surplus;
    console.log(`Surplus                    ${quantityFormatter(surplus)}`);
    console.log(`Total                      ${quantityFormatter(mAssetBalance)}`);
    return {
        total: mAssetBalance,
        save: balances[0],
        earn: balances[1],
    };
};
exports.getBalances = getBalances;
const getMints = async (bAssets, mAsset, fromBlock, toBlock, quantityFormatter) => {
    const filter = await mAsset.filters.Minted(null, null, null, null, null);
    const logs = await mAsset.queryFilter(filter, fromBlock, toBlock);
    console.log("\nMints");
    console.log("Block#\t Tx hash\t\t\t\t\t\t\t    bAsset     Quantity");
    let total = math_1.BN.from(0);
    let count = 0;
    logs.forEach((log) => {
        const inputBasset = bAssets.find((b) => b.address === log.args.input);
        if (!inputBasset) {
            throw Error(`Failed to find bAsset with address ${log.args.input}`);
        }
        // mAssetQuantity is for Masset. output is for FeederPool
        const quantity = log.args.mAssetQuantity || log.args.output;
        console.log(`${log.blockNumber} ${log.transactionHash} ${inputBasset.symbol.padEnd(4)} ${quantityFormatter(quantity)}`);
        total = total.add(quantity);
        count += 1;
    });
    console.log(`Count ${count}, Total ${quantityFormatter(total)}`);
    return {
        count,
        total,
        fees: math_1.BN.from(0),
    };
};
exports.getMints = getMints;
const getMultiMints = async (bAssets, mAsset, fromBlock, toBlock, quantityFormatter) => {
    const filter = await mAsset.filters.MintedMulti(null, null, null, null, null);
    const logs = await mAsset.queryFilter(filter, fromBlock, toBlock);
    console.log("\nMulti Mints");
    console.log("Block#\t Tx hash\t\t\t\t\t\t\t\t  Quantity");
    let total = math_1.BN.from(0);
    let count = 0;
    logs.forEach((log) => {
        // Ignore MintMulti events from collectInterest and collectPlatformInterest
        if (!log.args.inputs.length)
            return;
        const inputBassets = log.args.inputs.map((input) => bAssets.find((b) => b.address === input));
        // mAssetQuantity is for Masset. output is for FeederPool
        const quantity = log.args.mAssetQuantity || log.args.output;
        console.log(`${log.blockNumber} ${log.transactionHash} ${quantityFormatter(quantity)}`);
        inputBassets.forEach((bAsset, i) => {
            console.log(`   ${bAsset.symbol.padEnd(4)} ${quantityFormatter(log.args.inputQuantities[i], bAsset.decimals)}`);
        });
        total = total.add(quantity);
        count += 1;
    });
    console.log(`Count ${count}, Total ${quantityFormatter(total)}`);
    return {
        count,
        total,
        fees: math_1.BN.from(0),
    };
};
exports.getMultiMints = getMultiMints;
const getSwaps = async (bAssets, mAsset, fromBlock, toBlock, quantityFormatter) => {
    const filter = await mAsset.filters.Swapped(null, null, null, null, null, null);
    const logs = await mAsset.queryFilter(filter, fromBlock, toBlock);
    console.log("\nSwaps");
    console.log("Block#\t Tx hash\t\t\t\t\t\t\t    Input Output     Quantity      Fee");
    // Scaled bAsset quantities
    let total = math_1.BN.from(0);
    let fees = math_1.BN.from(0);
    let count = 0;
    logs.forEach((log) => {
        const inputBasset = bAssets.find((b) => b.address === log.args.input);
        const outputBasset = bAssets.find((b) => b.address === log.args.output);
        const fee = log.args.scaledFee || log.args.fee;
        console.log(`${log.blockNumber} ${log.transactionHash} ${inputBasset.symbol.padEnd(4)}  ${outputBasset.symbol.padEnd(4)} ${quantityFormatter(log.args.outputAmount, outputBasset.decimals)} ${quantityFormatter(fee, 18, 8)}`);
        total = total.add(math_1.applyDecimals(log.args.outputAmount, outputBasset.decimals));
        fees = fees.add(fee);
        count += 1;
    });
    console.log(`Count ${count}, Total ${quantityFormatter(total)}`);
    return {
        count,
        total,
        fees,
    };
};
exports.getSwaps = getSwaps;
const getRedemptions = async (bAssets, mAsset, fromBlock, toBlock, quantityFormatter) => {
    const filter = await mAsset.filters.Redeemed(null, null, null, null, null, null);
    const logs = await mAsset.queryFilter(filter, fromBlock, toBlock);
    console.log("\nRedemptions");
    console.log("Block#\t Tx hash\t\t\t\t\t\t\t    bAsset     Quantity      Fee");
    let total = math_1.BN.from(0);
    let fees = math_1.BN.from(0);
    let count = 0;
    logs.forEach((log) => {
        const outputBasset = bAssets.find((b) => b.address === log.args.output);
        console.log(`${log.blockNumber} ${log.transactionHash} ${outputBasset.symbol.padEnd(4)} ${quantityFormatter(log.args.mAssetQuantity)} ${quantityFormatter(log.args.scaledFee, 18, 8)}`);
        total = total.add(log.args.mAssetQuantity);
        fees = fees.add(log.args.scaledFee);
        count += 1;
    });
    console.log(`Count ${count}, Total ${quantityFormatter(total)}`);
    return {
        count,
        total,
        fees,
    };
};
exports.getRedemptions = getRedemptions;
const getMultiRedemptions = async (bAssets, mAsset, fromBlock, toBlock, quantityFormatter) => {
    const filter = await mAsset.filters.RedeemedMulti(null, null, null, null, null, null);
    const logs = await mAsset.queryFilter(filter, fromBlock, toBlock);
    console.log("\nMulti Redemptions");
    console.log("Block#\t Tx hash\t\t\t\t\t\t\t\t  Quantity      Fee");
    let total = math_1.BN.from(0);
    let fees = math_1.BN.from(0);
    let count = 0;
    logs.forEach((log) => {
        const outputBassets = log.args.outputs.map((output) => bAssets.find((b) => b.address === output));
        console.log(`${log.blockNumber} ${log.transactionHash} ${quantityFormatter(log.args.mAssetQuantity)} ${quantityFormatter(log.args.scaledFee, 18, 8)}`);
        outputBassets.forEach((bAsset, i) => {
            console.log(`   ${bAsset.symbol.padEnd(4)} ${quantityFormatter(log.args.outputQuantity[i], bAsset.decimals)}`);
        });
        total = total.add(log.args.mAssetQuantity);
        fees = fees.add(log.args.scaledFee);
        count += 1;
    });
    console.log(`Count ${count}, Total ${quantityFormatter(total)}`);
    return {
        count,
        total,
        fees,
    };
};
exports.getMultiRedemptions = getMultiRedemptions;
// Returns the APY in basis points which is the percentage to 2 decimal places
const calcApy = (startTime, endTime, quantity, saveBalance) => {
    const periodSeconds = math_1.BN.from(endTime.valueOf() - startTime.valueOf()).div(1000);
    return quantity.mul(10000).mul(constants_1.ONE_YEAR).div(saveBalance).div(periodSeconds);
};
exports.calcApy = calcApy;
const outputFees = (mints, multiMints, swaps, redeems, multiRedeems, balances, startTime, endTime, quantityFormatter) => {
    const totalFees = redeems.fees.add(multiRedeems.fees).add(swaps.fees);
    if (totalFees.eq(0)) {
        console.log(`\nNo fees since ${startTime.toUTCString()}`);
        return;
    }
    const totalTransactions = mints.total.add(multiMints.total).add(redeems.total).add(multiRedeems.total).add(swaps.total);
    const totalFeeTransactions = redeems.total.add(multiRedeems.total).add(swaps.total);
    console.log(`\nFees since ${startTime.toUTCString()}`);
    console.log("              #          Volume      Fees    %");
    console.log(`Mints         ${mints.count.toString().padEnd(2)} ${quantityFormatter(mints.total)} ${quantityFormatter(mints.fees, 18, 9)} ${mints.fees.mul(100).div(totalFees).toString().padStart(3)}%`);
    console.log(`Multi Mints   ${multiMints.count.toString().padEnd(2)} ${quantityFormatter(multiMints.total)} ${quantityFormatter(multiMints.fees, 18, 9)} ${multiMints.fees.mul(100).div(totalFees).toString().padStart(3)}%`);
    console.log(`Redeems       ${redeems.count.toString().padEnd(2)} ${quantityFormatter(redeems.total)} ${quantityFormatter(redeems.fees, 18, 9)} ${redeems.fees.mul(100).div(totalFees).toString().padStart(3)}%`);
    console.log(`Multi Redeems ${multiRedeems.count.toString().padEnd(2)} ${quantityFormatter(multiRedeems.total)} ${quantityFormatter(multiRedeems.fees, 18, 9)} ${multiRedeems.fees.mul(100).div(totalFees).toString().padStart(3)}%`);
    console.log(`Swaps         ${swaps.count.toString().padEnd(2)} ${quantityFormatter(swaps.total)} ${quantityFormatter(swaps.fees, 18, 9)} ${swaps.fees.mul(100).div(totalFees).toString().padStart(3)}%`);
    const totalApy = exports.calcApy(startTime, endTime, totalFees, balances.save);
    const liquidityUtilization = totalFeeTransactions.mul(100).div(balances.total);
    console.log(`Total Txs        ${quantityFormatter(totalTransactions)}`);
    console.log(`Savings          ${quantityFormatter(balances.save)} ${quantityFormatter(totalFees, 18, 9)} APY ${utils_1.formatUnits(totalApy, 2)}%`);
    console.log(`${liquidityUtilization}% liquidity utilization  (${quantityFormatter(totalFeeTransactions)} of ${quantityFormatter(balances.total)} mAssets)`);
};
exports.outputFees = outputFees;
const getLiquidatorInterest = async (mAsset, savingsManager, fromBlock, toBlock, quantityFormatter) => {
    const filter = await savingsManager.filters.LiquidatorDeposited(mAsset.address, null);
    const logs = await savingsManager.queryFilter(filter, fromBlock.blockNumber, toBlock.blockNumber);
    let total = math_1.BN.from(0);
    let count = 0;
    logs.forEach((log) => {
        console.log(`${log.blockNumber} ${log.transactionHash} ${quantityFormatter(log.args.amount)}`);
        count += 1;
        total = total.add(log.args.amount);
    });
    return { total, count };
};
exports.getLiquidatorInterest = getLiquidatorInterest;
const getCollectedInterest = async (bAssets, mAsset, savingsManager, fromBlock, toBlock, quantityFormatter, savingsBalance) => {
    // Get MintedMulti events where the mAsset is the minter
    const filter = await mAsset.filters.MintedMulti(mAsset.address, null, null, null, null);
    const logs = await mAsset.queryFilter(filter, fromBlock.blockNumber, toBlock.blockNumber);
    console.log(`\nCollected Interest between ${fromBlock.blockTime.toUTCString()} and ${toBlock.blockTime.toUTCString()}`);
    console.log("Block#\t Tx hash\t\t\t\t\t\t\t\t  Quantity");
    let total = math_1.BN.from(0);
    let tradingFees = math_1.BN.from(0);
    let countTradingFees = 0;
    const platformFees = bAssets.map(() => math_1.BN.from(0));
    let totalPlatformInterest = math_1.BN.from(0);
    let countPlatformInterest = 0;
    let count = 0;
    logs.forEach((log) => {
        // Ignore MintMulti events not from collectInterest and collectPlatformInterest
        if (log.args.inputs.length)
            return;
        // Calculate the quantity of interest collected
        // For mAssets:
        // - Trading fees = mAssetQuantity
        // - Platform fees = mAssetQuantity
        // For Feeder Pools:
        // - Trading fees = log.args.output
        // - Platform fees = sum of the input quantities as log.args.output is 0
        let quantity = math_1.BN.from(0);
        if (log.args.mAssetQuantity !== undefined) {
            quantity = log.args.mAssetQuantity;
        }
        else if (log.args.output && log.args.output.gt(0)) {
            quantity = log.args.output;
        }
        else {
            quantity = log.args.inputQuantities.reduce((sum, input) => sum + input, 0);
        }
        console.log(`${log.blockNumber} ${log.transactionHash} ${quantityFormatter(quantity)}`);
        if (log.args.inputQuantities.length) {
            countPlatformInterest += 1;
            log.args.inputQuantities.forEach((inputQuantity, i) => {
                const scaledFee = math_1.applyDecimals(inputQuantity, bAssets[i].decimals);
                platformFees[i] = platformFees[i].add(scaledFee);
                totalPlatformInterest = totalPlatformInterest.add(scaledFee);
                console.log(`   ${bAssets[i].symbol.padEnd(4)} ${quantityFormatter(inputQuantity, bAssets[i].decimals)}`);
            });
        }
        else {
            countTradingFees += 1;
            tradingFees = tradingFees.add(quantity);
        }
        total = total.add(quantity);
        count += 1;
    });
    const { total: liquidatorInterest, count: countLiquidator } = await exports.getLiquidatorInterest(mAsset, savingsManager, fromBlock, toBlock, quantityFormatter);
    total = total.add(liquidatorInterest);
    if (total.eq(0)) {
        console.log("No interest was collected");
        return {
            count,
            total,
            fees: math_1.BN.from(0),
        };
    }
    const tradingFeesApy = exports.calcApy(fromBlock.blockTime, toBlock.blockTime, tradingFees, savingsBalance);
    console.log(`Trading fees           ${quantityFormatter(tradingFees)} ${utils_1.formatUnits(tradingFees.mul(10000).div(total), 2)}% ${utils_1.formatUnits(tradingFeesApy, 2)}APY`);
    const totalPlatformApy = exports.calcApy(fromBlock.blockTime, toBlock.blockTime, totalPlatformInterest, savingsBalance);
    console.log(`Platform interest      ${quantityFormatter(totalPlatformInterest)} ${utils_1.formatUnits(totalPlatformInterest.mul(10000).div(total), 2)}% ${utils_1.formatUnits(totalPlatformApy, 2)}APY`);
    // Avoid div by 0
    totalPlatformInterest = totalPlatformInterest.gt(0) ? totalPlatformInterest : math_1.BN.from(1);
    bAssets.forEach((bAsset, i) => {
        const platformFeeApy = exports.calcApy(fromBlock.blockTime, toBlock.blockTime, platformFees[i], savingsBalance);
        console.log(`   ${bAsset.symbol.padEnd(4)} ${quantityFormatter(platformFees[i])} ${utils_1.formatUnits(platformFees[i].mul(10000).div(totalPlatformInterest), 2)}% ${utils_1.formatUnits(platformFeeApy, 2)}APY`);
    });
    const totalLiquidatorApy = exports.calcApy(fromBlock.blockTime, toBlock.blockTime, liquidatorInterest, savingsBalance);
    console.log(`Liquidator interest    ${quantityFormatter(liquidatorInterest)} ${utils_1.formatUnits(liquidatorInterest.mul(10000).div(total), 2)}% ${utils_1.formatUnits(totalLiquidatorApy, 2)}APY`);
    const totalApy = exports.calcApy(fromBlock.blockTime, toBlock.blockTime, total, savingsBalance);
    console.log(`Total interest         ${quantityFormatter(total)} ${utils_1.formatUnits(totalApy)}APY`);
    console.log(`Interest collections: ${countTradingFees} trading fee, ${countPlatformInterest} platform interest, ${countLiquidator} liquidator`);
    return {
        count,
        total,
        fees: math_1.BN.from(0),
    };
};
exports.getCollectedInterest = getCollectedInterest;
const quoteSwap = async (signer, from, to, inAmount, toBlock, fee = 3000) => {
    // Get USDC value from Uniswap
    const uniswapEthToken = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
    let outAmount;
    if (toBlock.blockNumber > 12364832) {
        // Use Uniswap V3
        const path = uniswap_1.encodeUniswapPath([from.address, uniswapEthToken, to.address], [fee, fee]);
        const quoter = generated_1.IUniswapV3Quoter__factory.connect("0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6", signer);
        outAmount = await quoter.callStatic.quoteExactInput(path.encoded, inAmount, { blockTag: toBlock.blockNumber });
    }
    else {
        // Use Uniswap v2
        const router = generated_1.IUniswapV2Router02__factory.connect("0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D", signer);
        const output = await router.getAmountsOut(inAmount, [from.address, uniswapEthToken, to.address], { blockTag: toBlock.blockNumber });
        outAmount = output[2];
    }
    // exchange rate = out amount / 10**(out decimals) / in amount * (10**to decimals)
    const exchangeRate = outAmount.div(math_1.BN.from(10).pow(to.decimals)).mul(math_1.BN.from(10).pow(from.decimals)).div(inAmount);
    return { outAmount, exchangeRate };
};
exports.quoteSwap = quoteSwap;
const getCompTokens = async (signer, toBlock, quantityFormatter = quantity_formatters_1.usdFormatter) => {
    const comptroller = Comptroller__factory_1.Comptroller__factory.connect(comptrollerAddress, signer);
    const compToken = generated_1.ERC20__factory.connect(tokens_1.COMP.address, signer);
    let totalComp = math_1.BN.from(0);
    console.log(`\nCOMP accrued`);
    // Get COMP that can be claimed
    const compAccrued = await comptroller.compAccrued(compIntegrationAddress, { blockTag: toBlock.blockNumber });
    totalComp = totalComp.add(compAccrued);
    console.log(`USDC        ${quantityFormatter(compAccrued)}`);
    // Get COMP in mUSD integration
    const compIntegrationBal = await compToken.balanceOf(compIntegrationAddress, { blockTag: toBlock.blockNumber });
    totalComp = totalComp.add(compIntegrationBal);
    console.log(`Integration ${quantityFormatter(compIntegrationBal)}`);
    // Get COMP in mUSD liquidator
    const compLiquidatorBal = await compToken.balanceOf(liquidatorAddress, { blockTag: toBlock.blockNumber });
    totalComp = totalComp.add(compLiquidatorBal);
    console.log(`Liquidator  ${quantityFormatter(compLiquidatorBal)}`);
    const compUsdc = await exports.quoteSwap(signer, tokens_1.COMP, tokens_1.USDC, totalComp, toBlock);
    console.log(`Total       ${quantityFormatter(totalComp)} ${quantityFormatter(compUsdc.outAmount, tokens_1.USDC.decimals)} USDC (${compUsdc.exchangeRate} COMP/USDC)`);
};
exports.getCompTokens = getCompTokens;
const getAaveTokens = async (signer, toBlock, quantityFormatter = quantity_formatters_1.usdFormatter) => {
    const aaveTokens = tokens_1.tokens.filter((token) => token.platform === tokens_1.Platform.Aave && token.chain === tokens_1.Chain.mainnet);
    const stkAaveToken = AaveStakedTokenV2__factory_1.AaveStakedTokenV2__factory.connect(tokens_1.stkAAVE.address, signer);
    const aaveIncentivesAddress = "0xd784927Ff2f95ba542BfC824c8a8a98F3495f6b5";
    const aaveIncentives = generated_1.IAaveIncentivesController__factory.connect(aaveIncentivesAddress, signer);
    let totalStkAave = math_1.BN.from(0);
    if (toBlock.blockNumber <= 12319489) {
        console.log(`\nbefore stkAAVE`);
        return;
    }
    console.log(`\nstkAAVE accrued`);
    // Get accrued stkAave for each integration contract
    for (const token of aaveTokens) {
        const accruedBal = await aaveIncentives.getRewardsBalance([token.liquidityProvider], token.integrator, {
            blockTag: toBlock.blockNumber,
        });
        totalStkAave = totalStkAave.add(accruedBal);
        console.log(`${token.symbol.padEnd(10)} ${quantityFormatter(accruedBal)}`);
    }
    // Get stkAave and AAVE in liquidity manager
    const liquidatorStkAaveBal = await stkAaveToken.balanceOf(liquidatorAddress, { blockTag: toBlock.blockNumber });
    totalStkAave = totalStkAave.add(liquidatorStkAaveBal);
    const cooldownStart = await stkAaveToken.stakersCooldowns(liquidatorAddress, { blockTag: toBlock.blockNumber });
    const cooldownEnd = cooldownStart.add(constants_1.ONE_DAY.mul(10));
    const colldownEndDate = new Date(cooldownEnd.toNumber() * 1000);
    console.log(`Liquidator ${quantityFormatter(liquidatorStkAaveBal)} unlock ${colldownEndDate.toUTCString()}`);
    const aaveUsdc = await exports.quoteSwap(signer, tokens_1.AAVE, tokens_1.USDC, totalStkAave, toBlock);
    console.log(`Total      ${quantityFormatter(totalStkAave)} ${quantityFormatter(aaveUsdc.outAmount, tokens_1.USDC.decimals)} USDC (${aaveUsdc.exchangeRate} AAVE/USDC)`);
};
exports.getAaveTokens = getAaveTokens;
//# sourceMappingURL=snap-utils.js.map