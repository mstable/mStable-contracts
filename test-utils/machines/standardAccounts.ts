import { Signer } from "ethers"

export interface Account {
    signer: Signer
    address: string
}

/**
 * @dev Standard accounts
 */
export class StandardAccounts {
    /**
     * @dev Default accounts as per system Migrations
     */
    public all: Account[]

    public default: Account

    public governor: Account

    public other: Account

    public dummy1: Account

    public dummy2: Account

    public dummy3: Account

    public dummy4: Account

    public fundManager: Account

    public fundManager2: Account

    public mockSavingsManager: Account

    public mockInterestValidator: Account

    public async initAccounts(signers: Signer[]): Promise<StandardAccounts> {
        this.all = await Promise.all(
            signers.map(async (s) => ({
                signer: s,
                address: await s.getAddress(),
            })),
        )
        ;[
            this.default,
            this.governor,
            this.other,
            this.dummy1,
            this.dummy2,
            this.dummy3,
            this.dummy4,
            this.fundManager,
            this.fundManager2,
            this.mockSavingsManager,
            this.mockInterestValidator,
        ] = this.all
        return this
    }
}

export default StandardAccounts
