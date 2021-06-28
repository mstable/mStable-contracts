import { Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { ICurve, ICurveInterface } from "../ICurve";
export declare class ICurve__factory {
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
    static createInterface(): ICurveInterface;
    static connect(address: string, signerOrProvider: Signer | Provider): ICurve;
}
