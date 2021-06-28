import { Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { ConfigurableRightsPool, ConfigurableRightsPoolInterface } from "../ConfigurableRightsPool";
export declare class ConfigurableRightsPool__factory {
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
    static createInterface(): ConfigurableRightsPoolInterface;
    static connect(address: string, signerOrProvider: Signer | Provider): ConfigurableRightsPool;
}
