import { Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { CurveRegistryExchange, CurveRegistryExchangeInterface } from "../CurveRegistryExchange";
export declare class CurveRegistryExchange__factory {
    static readonly abi: ({
        name: string;
        inputs: {
            type: string;
            name: string;
            indexed: boolean;
        }[];
        anonymous: boolean;
        type: string;
        outputs?: undefined;
        stateMutability?: undefined;
    } | {
        outputs: any[];
        inputs: {
            type: string;
            name: string;
        }[];
        stateMutability: string;
        type: string;
        name?: undefined;
        anonymous?: undefined;
    } | {
        stateMutability: string;
        type: string;
        name?: undefined;
        inputs?: undefined;
        anonymous?: undefined;
        outputs?: undefined;
    } | {
        name: string;
        outputs: {
            type: string;
            name: string;
        }[];
        inputs: {
            type: string;
            name: string;
        }[];
        stateMutability: string;
        type: string;
        anonymous?: undefined;
    })[];
    static createInterface(): CurveRegistryExchangeInterface;
    static connect(address: string, signerOrProvider: Signer | Provider): CurveRegistryExchange;
}
