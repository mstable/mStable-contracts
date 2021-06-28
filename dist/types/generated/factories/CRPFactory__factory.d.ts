import { Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { CRPFactory, CRPFactoryInterface } from "../CRPFactory";
export declare class CRPFactory__factory {
    static readonly abi: {
        inputs: ({
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
        name: string;
        outputs: {
            internalType: string;
            name: string;
            type: string;
        }[];
        stateMutability: string;
        type: string;
    }[];
    static createInterface(): CRPFactoryInterface;
    static connect(address: string, signerOrProvider: Signer | Provider): CRPFactory;
}
