import { Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { PausableModule, PausableModuleInterface } from "../PausableModule";
export declare class PausableModule__factory {
    static readonly abi: ({
        anonymous: boolean;
        inputs: {
            indexed: boolean;
            internalType: string;
            name: string;
            type: string;
        }[];
        name: string;
        type: string;
        outputs?: undefined;
        stateMutability?: undefined;
    } | {
        inputs: any[];
        name: string;
        outputs: {
            internalType: string;
            name: string;
            type: string;
        }[];
        stateMutability: string;
        type: string;
        anonymous?: undefined;
    })[];
    static createInterface(): PausableModuleInterface;
    static connect(address: string, signerOrProvider: Signer | Provider): PausableModule;
}
