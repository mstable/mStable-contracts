import { Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { IGateway, IGatewayInterface } from "../IGateway";
export declare class IGateway__factory {
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
    static createInterface(): IGatewayInterface;
    static connect(address: string, signerOrProvider: Signer | Provider): IGateway;
}
