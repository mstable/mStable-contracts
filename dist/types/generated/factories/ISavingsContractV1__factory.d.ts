import { Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { ISavingsContractV1, ISavingsContractV1Interface } from "../ISavingsContractV1";
export declare class ISavingsContractV1__factory {
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
    static createInterface(): ISavingsContractV1Interface;
    static connect(address: string, signerOrProvider: Signer | Provider): ISavingsContractV1;
}
