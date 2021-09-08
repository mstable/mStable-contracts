import { Signer } from "ethers"
import { Account } from "types"

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

    public dummy5: Account

    public dummy6: Account

    public dummy7: Account

    public fundManager: Account

    public fundManager2: Account

    public questMaster: Account

    public questSigner: Account

    public mockSavingsManager: Account

    public mockInterestValidator: Account

    public mockRecollateraliser: Account

    public mockMasset: Account

    public mockRewardsDistributor: Account

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
            this.dummy5,
            this.dummy6,
            this.dummy7,
            this.fundManager,
            this.fundManager2,
            this.questMaster,
            this.questSigner,
            this.mockSavingsManager,
            this.mockInterestValidator,
            this.mockRecollateraliser,
            this.mockMasset,
            this.mockRewardsDistributor,
        ] = this.all
        return this
    }
}

export default StandardAccounts
