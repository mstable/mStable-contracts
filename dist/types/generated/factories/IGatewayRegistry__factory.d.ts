import { Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { IGatewayRegistry, IGatewayRegistryInterface } from "../IGatewayRegistry";
export declare class IGatewayRegistry__factory {
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
    static createInterface(): IGatewayRegistryInterface;
    static connect(address: string, signerOrProvider: Signer | Provider): IGatewayRegistry;
}
