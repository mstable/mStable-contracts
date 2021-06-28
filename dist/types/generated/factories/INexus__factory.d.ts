import { Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { INexus, INexusInterface } from "../INexus";
export declare class INexus__factory {
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
    static createInterface(): INexusInterface;
    static connect(address: string, signerOrProvider: Signer | Provider): INexus;
}
