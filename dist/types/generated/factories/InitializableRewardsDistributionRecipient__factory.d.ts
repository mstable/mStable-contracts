import { Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { InitializableRewardsDistributionRecipient, InitializableRewardsDistributionRecipientInterface } from "../InitializableRewardsDistributionRecipient";
export declare class InitializableRewardsDistributionRecipient__factory {
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
    static createInterface(): InitializableRewardsDistributionRecipientInterface;
    static connect(address: string, signerOrProvider: Signer | Provider): InitializableRewardsDistributionRecipient;
}
