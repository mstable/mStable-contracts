import { Signer } from "ethers";
export declare type Address = string;
export declare type Bytes32 = string;
export interface Account {
    signer: Signer;
    address: string;
}
