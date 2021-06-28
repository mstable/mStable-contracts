import { Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { RevenueRecipientV1, RevenueRecipientV1Interface } from "../RevenueRecipientV1";
export declare class RevenueRecipientV1__factory {
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
    static createInterface(): RevenueRecipientV1Interface;
    static connect(address: string, signerOrProvider: Signer | Provider): RevenueRecipientV1;
}
