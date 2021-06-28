import { Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { IMassetV1, IMassetV1Interface } from "../IMassetV1";
export declare class IMassetV1__factory {
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
    static createInterface(): IMassetV1Interface;
    static connect(address: string, signerOrProvider: Signer | Provider): IMassetV1;
}
