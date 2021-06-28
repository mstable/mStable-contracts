import { Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { IClaimRewards, IClaimRewardsInterface } from "../IClaimRewards";
export declare class IClaimRewards__factory {
    static readonly abi: {
        inputs: any[];
        name: string;
        outputs: any[];
        stateMutability: string;
        type: string;
    }[];
    static createInterface(): IClaimRewardsInterface;
    static connect(address: string, signerOrProvider: Signer | Provider): IClaimRewards;
}
