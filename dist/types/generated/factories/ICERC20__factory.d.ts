import { Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { ICERC20, ICERC20Interface } from "../ICERC20";
export declare class ICERC20__factory {
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
    static createInterface(): ICERC20Interface;
    static connect(address: string, signerOrProvider: Signer | Provider): ICERC20;
}
