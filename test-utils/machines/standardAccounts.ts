import { Address } from "../../types/common";

/**
 * @dev Standard accounts
 */
export class StandardAccounts {
    /**
     * @dev Default accounts as per system Migrations
     */
    public all: Address[];

    public default: Address;

    public governor: Address;

    public other: Address;

    public dummy1: Address;

    public dummy2: Address;

    public dummy3: Address;

    public dummy4: Address;

    public fundManager: Address;

    public fundManager2: Address;

    constructor(accounts: Address[]) {
        this.all = accounts;

        [
            this.default,
            this.governor,
            this.other,
            this.dummy1,
            this.dummy2,
            this.dummy3,
            this.dummy4,
            this.fundManager,
            this.fundManager2,
        ] = accounts;
    }
}

export default StandardAccounts;
