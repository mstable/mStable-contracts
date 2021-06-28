declare const _default: {
    integrationData: {
        reserve0: string;
        reserve1: string;
        A: number;
        hardMin: number;
        hardMax: number;
        swapFeeRate: number;
        redemptionFeeRate: number;
        actions: ({
            type: string;
            inputIndex: number;
            inputQty: string;
            expectedQty: string;
            swapFee: string;
            reserves: string[];
            LPTokenSupply: string;
            inputQtys?: undefined;
            expectedQtys?: undefined;
            redemptionFee?: undefined;
            outputIndex?: undefined;
            hardLimitError?: undefined;
            insufficientLiquidityError?: undefined;
        } | {
            type: string;
            inputIndex: number;
            inputQty: string;
            expectedQty: string;
            reserves: string[];
            swapFee?: undefined;
            LPTokenSupply?: undefined;
            inputQtys?: undefined;
            expectedQtys?: undefined;
            redemptionFee?: undefined;
            outputIndex?: undefined;
            hardLimitError?: undefined;
            insufficientLiquidityError?: undefined;
        } | {
            type: string;
            inputQtys: string[];
            expectedQty: string;
            swapFee: string;
            reserves: string[];
            LPTokenSupply: string;
            inputIndex?: undefined;
            inputQty?: undefined;
            expectedQtys?: undefined;
            redemptionFee?: undefined;
            outputIndex?: undefined;
            hardLimitError?: undefined;
            insufficientLiquidityError?: undefined;
        } | {
            type: string;
            inputQtys: string[];
            expectedQty: string;
            reserves: string[];
            LPTokenSupply: string;
            inputIndex?: undefined;
            inputQty?: undefined;
            swapFee?: undefined;
            expectedQtys?: undefined;
            redemptionFee?: undefined;
            outputIndex?: undefined;
            hardLimitError?: undefined;
            insufficientLiquidityError?: undefined;
        } | {
            type: string;
            inputQty: string;
            expectedQtys: string[];
            redemptionFee: string;
            reserves: string[];
            LPTokenSupply: string;
            inputIndex?: undefined;
            expectedQty?: undefined;
            swapFee?: undefined;
            inputQtys?: undefined;
            outputIndex?: undefined;
            hardLimitError?: undefined;
            insufficientLiquidityError?: undefined;
        } | {
            type: string;
            inputIndex: number;
            inputQty: string;
            outputIndex: number;
            expectedQty: string;
            swapFee: string;
            reserves: string[];
            LPTokenSupply: string;
            hardLimitError: boolean;
            insufficientLiquidityError: boolean;
            inputQtys?: undefined;
            expectedQtys?: undefined;
            redemptionFee?: undefined;
        } | {
            type: string;
            inputIndex: number;
            inputQty: string;
            hardLimitError: boolean;
            expectedQty?: undefined;
            swapFee?: undefined;
            reserves?: undefined;
            LPTokenSupply?: undefined;
            inputQtys?: undefined;
            expectedQtys?: undefined;
            redemptionFee?: undefined;
            outputIndex?: undefined;
            insufficientLiquidityError?: undefined;
        } | {
            type: string;
            inputQtys: string[];
            hardLimitError: boolean;
            inputIndex?: undefined;
            inputQty?: undefined;
            expectedQty?: undefined;
            swapFee?: undefined;
            reserves?: undefined;
            LPTokenSupply?: undefined;
            expectedQtys?: undefined;
            redemptionFee?: undefined;
            outputIndex?: undefined;
            insufficientLiquidityError?: undefined;
        } | {
            type: string;
            inputIndex: number;
            inputQty: string;
            outputIndex: number;
            hardLimitError: boolean;
            expectedQty?: undefined;
            swapFee?: undefined;
            reserves?: undefined;
            LPTokenSupply?: undefined;
            inputQtys?: undefined;
            expectedQtys?: undefined;
            redemptionFee?: undefined;
            insufficientLiquidityError?: undefined;
        })[];
    };
    mintData: {
        reserve0: string;
        reserve1: string;
        A: number;
        LPTokenSupply: string;
        hardMin: number;
        hardMax: number;
        swapFeeRate: number;
        mints: ({
            bAssetIndex: number;
            bAssetQty: string;
            expectedQty: string;
            priceReceived: number;
            hardLimitError?: undefined;
        } | {
            bAssetIndex: number;
            bAssetQty: string;
            hardLimitError: boolean;
            expectedQty?: undefined;
            priceReceived?: undefined;
        })[];
    }[];
    mintMultiData: {
        reserve0: string;
        reserve1: string;
        A: number;
        LPTokenSupply: string;
        hardMin: number;
        hardMax: number;
        swapFeeRate: number;
        mints: {
            bAssetQtys: string[];
            expectedQty: string;
        }[];
    }[];
    swapData: {
        reserve0: string;
        reserve1: string;
        A: number;
        LPTokenSupply: string;
        hardMin: number;
        hardMax: number;
        swapFeeRate: number;
        swaps: ({
            inputIndex: number;
            inputQty: string;
            outputIndex: number;
            outputQty: string;
            swapFee: string;
            priceReceived: number;
            hardLimitError?: undefined;
        } | {
            inputIndex: number;
            inputQty: string;
            outputIndex: number;
            hardLimitError: boolean;
            outputQty?: undefined;
            swapFee?: undefined;
            priceReceived?: undefined;
        })[];
    }[];
    redeemData: {
        reserve0: string;
        reserve1: string;
        A: number;
        LPTokenSupply: string;
        hardMin: number;
        hardMax: number;
        redemptionFeeRate: number;
        redeems: ({
            bAssetIndex: number;
            mAssetQty: string;
            outputQty: string;
            swapFee: string;
            priceReceived: number;
            hardLimitError?: undefined;
        } | {
            bAssetIndex: number;
            mAssetQty: string;
            hardLimitError: boolean;
            outputQty?: undefined;
            swapFee?: undefined;
            priceReceived?: undefined;
        })[];
    }[];
    redeemProportionalData: {
        reserve0: string;
        reserve1: string;
        A: number;
        LPTokenSupply: string;
        hardMin: number;
        hardMax: number;
        redemptionFeeRate: number;
        redeems: {
            mAssetQty: string;
            bAssetQtys: string[];
            redemptionFee: string;
        }[];
    }[];
    redeemExactData: {
        reserve0: string;
        reserve1: string;
        A: number;
        LPTokenSupply: string;
        hardMin: number;
        hardMax: number;
        redemptionFeeRate: number;
        redeems: ({
            bAssetQtys: string[];
            mAssetQty: string;
            swapFee: string;
            hardLimitError?: undefined;
            insufficientLiquidityError?: undefined;
        } | {
            bAssetQtys: string[];
            hardLimitError: boolean;
            mAssetQty?: undefined;
            swapFee?: undefined;
            insufficientLiquidityError?: undefined;
        } | {
            bAssetQtys: string[];
            insufficientLiquidityError: boolean;
            mAssetQty?: undefined;
            swapFee?: undefined;
            hardLimitError?: undefined;
        })[];
    }[];
};
export default _default;
