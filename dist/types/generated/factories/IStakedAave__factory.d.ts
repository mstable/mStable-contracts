import { Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { IStakedAave, IStakedAaveInterface } from "../IStakedAave";
export declare class IStakedAave__factory {
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
    static createInterface(): IStakedAaveInterface;
    static connect(address: string, signerOrProvider: Signer | Provider): IStakedAave;
}
