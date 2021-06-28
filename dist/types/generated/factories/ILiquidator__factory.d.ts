import { Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { ILiquidator, ILiquidatorInterface } from "../ILiquidator";
export declare class ILiquidator__factory {
    static readonly abi: {
        inputs: {
            internalType: string;
            name: string;
            type: string;
        }[];
        name: string;
        outputs: any[];
        stateMutability: string;
        type: string;
    }[];
    static createInterface(): ILiquidatorInterface;
    static connect(address: string, signerOrProvider: Signer | Provider): ILiquidator;
}
