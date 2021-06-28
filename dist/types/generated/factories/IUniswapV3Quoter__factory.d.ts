import { Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { IUniswapV3Quoter, IUniswapV3QuoterInterface } from "../IUniswapV3Quoter";
export declare class IUniswapV3Quoter__factory {
    static readonly abi: {
        inputs: {
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
    static createInterface(): IUniswapV3QuoterInterface;
    static connect(address: string, signerOrProvider: Signer | Provider): IUniswapV3Quoter;
}
