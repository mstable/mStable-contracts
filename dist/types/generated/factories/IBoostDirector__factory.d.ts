import { Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { IBoostDirector, IBoostDirectorInterface } from "../IBoostDirector";
export declare class IBoostDirector__factory {
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
    static createInterface(): IBoostDirectorInterface;
    static connect(address: string, signerOrProvider: Signer | Provider): IBoostDirector;
}
