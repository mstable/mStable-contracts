import { Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { IConnector, IConnectorInterface } from "../IConnector";
export declare class IConnector__factory {
    static readonly abi: ({
        inputs: any[];
        name: string;
        outputs: {
            internalType: string;
            name: string;
            type: string;
        }[];
        stateMutability: string;
        type: string;
    } | {
        inputs: {
            internalType: string;
            name: string;
            type: string;
        }[];
        name: string;
        outputs: any[];
        stateMutability: string;
        type: string;
    })[];
    static createInterface(): IConnectorInterface;
    static connect(address: string, signerOrProvider: Signer | Provider): IConnector;
}
