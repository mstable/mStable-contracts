import { Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { IBPool, IBPoolInterface } from "../IBPool";
export declare class IBPool__factory {
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
    static createInterface(): IBPoolInterface;
    static connect(address: string, signerOrProvider: Signer | Provider): IBPool;
}
