import { Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { IAaveLendingPoolV2, IAaveLendingPoolV2Interface } from "../IAaveLendingPoolV2";
export declare class IAaveLendingPoolV2__factory {
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
    static createInterface(): IAaveLendingPoolV2Interface;
    static connect(address: string, signerOrProvider: Signer | Provider): IAaveLendingPoolV2;
}
