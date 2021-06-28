import { Signer } from "ethers";
import { Provider } from "@ethersproject/providers";
import type { IBoostedVaultWithLockup, IBoostedVaultWithLockupInterface } from "../IBoostedVaultWithLockup";
export declare class IBoostedVaultWithLockup__factory {
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
    static createInterface(): IBoostedVaultWithLockupInterface;
    static connect(address: string, signerOrProvider: Signer | Provider): IBoostedVaultWithLockup;
}
