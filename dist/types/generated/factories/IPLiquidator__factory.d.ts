import { Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { IPLiquidator, IPLiquidatorInterface } from "../IPLiquidator";
export declare class IPLiquidator__factory {
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
    static createInterface(): IPLiquidatorInterface;
    static connect(address: string, signerOrProvider: Signer | Provider): IPLiquidator;
}
