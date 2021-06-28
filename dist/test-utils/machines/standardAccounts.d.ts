import { Signer } from "ethers";
import { Account } from "types";
/**
 * @dev Standard accounts
 */
export declare class StandardAccounts {
    /**
     * @dev Default accounts as per system Migrations
     */
    all: Account[];
    default: Account;
    governor: Account;
    other: Account;
    dummy1: Account;
    dummy2: Account;
    dummy3: Account;
    dummy4: Account;
    fundManager: Account;
    fundManager2: Account;
    mockSavingsManager: Account;
    mockInterestValidator: Account;
    mockMasset: Account;
    initAccounts(signers: Signer[]): Promise<StandardAccounts>;
}
export default StandardAccounts;
