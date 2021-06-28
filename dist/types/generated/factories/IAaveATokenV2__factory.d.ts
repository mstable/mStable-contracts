import { Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { IAaveATokenV2, IAaveATokenV2Interface } from "../IAaveATokenV2";
export declare class IAaveATokenV2__factory {
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
    static createInterface(): IAaveATokenV2Interface;
    static connect(address: string, signerOrProvider: Signer | Provider): IAaveATokenV2;
}
