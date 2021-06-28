import { Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { IAaveIncentivesController, IAaveIncentivesControllerInterface } from "../IAaveIncentivesController";
export declare class IAaveIncentivesController__factory {
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
    static createInterface(): IAaveIncentivesControllerInterface;
    static connect(address: string, signerOrProvider: Signer | Provider): IAaveIncentivesController;
}
