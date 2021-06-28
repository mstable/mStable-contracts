import { Signer } from "ethers";
import { Account } from "types";
export declare const impersonate: (addr: string) => Promise<Signer>;
export declare const impersonateAccount: (address: string) => Promise<Account>;
