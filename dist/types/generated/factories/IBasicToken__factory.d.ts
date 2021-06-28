import { Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { IBasicToken, IBasicTokenInterface } from "../IBasicToken";
export declare class IBasicToken__factory {
    static readonly abi: {
        inputs: any[];
        name: string;
        outputs: {
            internalType: string;
            name: string;
            type: string;
        }[];
        stateMutability: string;
        type: string;
    }[];
    static createInterface(): IBasicTokenInterface;
    static connect(address: string, signerOrProvider: Signer | Provider): IBasicToken;
}
