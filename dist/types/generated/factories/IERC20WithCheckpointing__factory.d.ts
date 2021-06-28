import { Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { IERC20WithCheckpointing, IERC20WithCheckpointingInterface } from "../IERC20WithCheckpointing";
export declare class IERC20WithCheckpointing__factory {
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
    static createInterface(): IERC20WithCheckpointingInterface;
    static connect(address: string, signerOrProvider: Signer | Provider): IERC20WithCheckpointing;
}
