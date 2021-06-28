import { Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { ImmutableModule, ImmutableModuleInterface } from "../ImmutableModule";
export declare class ImmutableModule__factory {
    static readonly abi: {
        inputs: any[];
        name: string;
        outputs: {
            internalType: string;
            name: string;
            type: string;
        }[];
        stateMutability: string;
        type: string;
    }[];
    static createInterface(): ImmutableModuleInterface;
    static connect(address: string, signerOrProvider: Signer | Provider): ImmutableModule;
}
