import { Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { ISavingsContractV2, ISavingsContractV2Interface } from "../ISavingsContractV2";
export declare class ISavingsContractV2__factory {
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
    static createInterface(): ISavingsContractV2Interface;
    static connect(address: string, signerOrProvider: Signer | Provider): ISavingsContractV2;
}
