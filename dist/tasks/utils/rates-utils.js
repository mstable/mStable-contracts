"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSwapRates = exports.outputSwapRate = void 0;
const math_1 = require("@utils/math");
const generated_1 = require("types/generated");
const CurveRegistryExchange__factory_1 = require("types/generated/factories/CurveRegistryExchange__factory");
const outputSwapRate = (swap, quantityFormatter) => {
    const { inputToken, outputToken, mOutputRaw, curveOutputRaw } = swap;
    const inputScaled = math_1.applyDecimals(swap.inputAmountRaw, inputToken.decimals);
    // Process mUSD swap output
    const mOutputScaled = math_1.applyDecimals(mOutputRaw, outputToken.decimals);
    const mBasicPoints = mOutputScaled.sub(inputScaled).mul(10000).div(inputScaled);
    // Process Curve's swap output
    const curveOutputScaled = math_1.applyDecimals(curveOutputRaw, outputToken.decimals);
    const curvePercent = curveOutputScaled.sub(inputScaled).mul(10000).div(inputScaled);
    // Calculate the difference between the mUSD and Curve outputs in basis points
    const diffOutputs = mOutputRaw.sub(curveOutputRaw).mul(10000).div(mOutputRaw);
    // Calculate if there's an arbitrage = inverse curve output - input
    const curveInverseOutputScaled = math_1.applyDecimals(swap.curveInverseOutputRaw, swap.inputToken.decimals);
    const arbProfit = curveInverseOutputScaled.sub(inputScaled);
    if (curveOutputRaw.gt(0)) {
        console.log(`${swap.inputDisplay.padStart(9)} ${inputToken.symbol.padEnd(6)} -> ${outputToken.symbol.padEnd(6)} ${quantityFormatter(mOutputRaw, outputToken.decimals, 12)} ${mBasicPoints.toString().padStart(4)}bps Curve ${quantityFormatter(curveOutputRaw, outputToken.decimals, 12)} ${curvePercent.toString().padStart(4)}bps ${diffOutputs.toString().padStart(3)}bps ${quantityFormatter(arbProfit, 18, 8)}`);
    }
    else {
        console.log(`${swap.inputDisplay.padStart(9)} ${inputToken.symbol.padEnd(6)} -> ${outputToken.symbol.padEnd(6)} ${quantityFormatter(mOutputRaw, outputToken.decimals, 12)} ${mBasicPoints.toString().padStart(4)}bps`);
    }
};
exports.outputSwapRate = outputSwapRate;
const getSwapRates = async (inputTokens, outputTokens, mAsset, toBlock, quantityFormatter, networkName, inputAmount = math_1.BN.from("1000")) => {
    const callOverride = {
        blockTag: toBlock,
    };
    const pairs = [];
    const mAssetSwapPromises = [];
    // Get mUSD swap rates
    for (const inputToken of inputTokens) {
        for (const outputToken of outputTokens) {
            if (inputToken.symbol !== outputToken.symbol) {
                pairs.push({
                    inputToken,
                    outputToken,
                });
                const inputAmountRaw = math_1.simpleToExactAmount(inputAmount, inputToken.decimals);
                mAssetSwapPromises.push(mAsset.getSwapOutput(inputToken.address, outputToken.address, inputAmountRaw, callOverride));
            }
        }
    }
    // Resolve all the mUSD promises
    const mAssetSwaps = await Promise.all(mAssetSwapPromises);
    // Get Curve's best swap rate for each pair and the inverse swap
    const curveSwapsPromises = [];
    pairs.forEach(({ inputToken, outputToken }, i) => {
        if (networkName === "mainnet") {
            const curveRegistryExchange = CurveRegistryExchange__factory_1.CurveRegistryExchange__factory.connect("0xD1602F68CC7C4c7B59D686243EA35a9C73B0c6a2", mAsset.signer);
            // Get the matching Curve swap rate
            const curveSwapPromise = curveRegistryExchange.get_best_rate(inputToken.address, outputToken.address, math_1.simpleToExactAmount(inputAmount, inputToken.decimals), callOverride);
            // Get the Curve inverse swap rate using mUSD swap output as the input
            const curveInverseSwapPromise = curveRegistryExchange.get_best_rate(outputToken.address, inputToken.address, mAssetSwaps[i], callOverride);
            curveSwapsPromises.push(curveSwapPromise, curveInverseSwapPromise);
        }
        else if (networkName === "polygon_mainnet") {
            const curvePool = generated_1.ICurve__factory.connect("0x445FE580eF8d70FF569aB36e80c647af338db351", mAsset.signer);
            // Just hard code the mapping for now
            const curveIndexMap = {
                "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063": 0,
                "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174": 1,
                "0xc2132D05D31c914a87C6611C10748AEb04B58e8F": 2, // Tether
            };
            const inputIndex = curveIndexMap[inputToken.address];
            const outputIndex = curveIndexMap[outputToken.address];
            // Get the matching Curve swap rate
            const curveSwapPromise = curvePool.get_dy(inputIndex, outputIndex, math_1.simpleToExactAmount(inputAmount, inputToken.decimals), callOverride);
            // Get the Curve inverse swap rate using mUSD swap output as the input
            const curveInverseSwapPromise = curvePool.get_dy(outputIndex, inputIndex, mAssetSwaps[i], callOverride);
            curveSwapsPromises.push(curveSwapPromise, curveInverseSwapPromise);
        }
    });
    // Resolve all the Curve promises
    const curveSwaps = await Promise.all(curveSwapsPromises);
    // Merge the mUSD and Curve swaps into one array
    const swaps = pairs.map(({ inputToken, outputToken }, i) => ({
        inputToken,
        inputAmountRaw: math_1.simpleToExactAmount(inputAmount, inputToken.decimals),
        inputDisplay: inputAmount.toString(),
        outputToken,
        mOutputRaw: mAssetSwaps[i],
        // For mainnet, this first param of the Curve result is the pool address, the second is the output amount
        curveOutputRaw: networkName === "mainnet" ? curveSwaps[i * 2][1] : curveSwaps[i * 2],
        curveInverseOutputRaw: networkName === "mainnet" ? curveSwaps[i * 2 + 1][1] : curveSwaps[i * 2 + 1],
    }));
    swaps.forEach((swap) => {
        exports.outputSwapRate(swap, quantityFormatter);
    });
    return swaps;
};
exports.getSwapRates = getSwapRates;
//# sourceMappingURL=rates-utils.js.map