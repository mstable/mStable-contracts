import { Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { ISavingsManager, ISavingsManagerInterface } from "../ISavingsManager";
export declare class ISavingsManager__factory {
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
    static createInterface(): ISavingsManagerInterface;
    static connect(address: string, signerOrProvider: Signer | Provider): ISavingsManager;
}
