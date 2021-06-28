import { Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { IInvariantValidator, IInvariantValidatorInterface } from "../IInvariantValidator";
export declare class IInvariantValidator__factory {
    static readonly abi: {
        inputs: ({
            internalType: string;
            name: string;
            type: string;
            components?: undefined;
        } | {
            components: ({
                internalType: string;
                name: string;
                type: string;
                components?: undefined;
            } | {
                components: {
                    internalType: string;
                    name: string;
                    type: string;
                }[];
                internalType: string;
                name: string;
                type: string;
            })[];
            internalType: string;
            name: string;
            type: string;
        })[];
        name: string;
        outputs: {
            internalType: string;
            name: string;
            type: string;
        }[];
        stateMutability: string;
        type: string;
    }[];
    static createInterface(): IInvariantValidatorInterface;
    static connect(address: string, signerOrProvider: Signer | Provider): IInvariantValidator;
}
