import { Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { IRevenueRecipient, IRevenueRecipientInterface } from "../IRevenueRecipient";
export declare class IRevenueRecipient__factory {
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
    static createInterface(): IRevenueRecipientInterface;
    static connect(address: string, signerOrProvider: Signer | Provider): IRevenueRecipient;
}
