import { Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { IPlatformIntegration, IPlatformIntegrationInterface } from "../IPlatformIntegration";
export declare class IPlatformIntegration__factory {
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
    static createInterface(): IPlatformIntegrationInterface;
    static connect(address: string, signerOrProvider: Signer | Provider): IPlatformIntegration;
}
