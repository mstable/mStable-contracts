import { Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { IBasketManager, IBasketManagerInterface } from "../IBasketManager";
export declare class IBasketManager__factory {
    static readonly abi: ({
        inputs: any[];
        name: string;
        outputs: {
            components: ({
                components: {
                    internalType: string;
                    name: string;
                    type: string;
                }[];
                internalType: string;
                name: string;
                type: string;
            } | {
                internalType: string;
                name: string;
                type: string;
                components?: undefined;
            })[];
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
        outputs: {
            internalType: string;
            name: string;
            type: string;
        }[];
        stateMutability: string;
        type: string;
    })[];
    static createInterface(): IBasketManagerInterface;
    static connect(address: string, signerOrProvider: Signer | Provider): IBasketManager;
}
