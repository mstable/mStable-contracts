import { Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { ILendingPoolAddressesProviderV2, ILendingPoolAddressesProviderV2Interface } from "../ILendingPoolAddressesProviderV2";
export declare class ILendingPoolAddressesProviderV2__factory {
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
    static createInterface(): ILendingPoolAddressesProviderV2Interface;
    static connect(address: string, signerOrProvider: Signer | Provider): ILendingPoolAddressesProviderV2;
}
