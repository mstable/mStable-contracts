import { Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { IUniswapV3SwapRouter, IUniswapV3SwapRouterInterface } from "../IUniswapV3SwapRouter";
export declare class IUniswapV3SwapRouter__factory {
    static readonly abi: {
        inputs: {
            components: {
                internalType: string;
                name: string;
                type: string;
            }[];
            internalType: string;
            name: string;
            type: string;
        }[];
        name: string;
        outputs: {
            internalType: string;
            name: string;
            type: string;
        }[];
        stateMutability: string;
        type: string;
    }[];
    static createInterface(): IUniswapV3SwapRouterInterface;
    static connect(address: string, signerOrProvider: Signer | Provider): IUniswapV3SwapRouter;
}
