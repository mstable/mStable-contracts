import { Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { IIncentivisedVotingLockup, IIncentivisedVotingLockupInterface } from "../IIncentivisedVotingLockup";
export declare class IIncentivisedVotingLockup__factory {
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
    static createInterface(): IIncentivisedVotingLockupInterface;
    static connect(address: string, signerOrProvider: Signer | Provider): IIncentivisedVotingLockup;
}
