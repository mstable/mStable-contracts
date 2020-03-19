import { MockERC20Instance } from "types/generated/index.d";
import { Address } from "../../types/common";
import { BN } from "../tools";
import { DEFAULT_DECIMALS, DEFAULT_SUPPLY } from "../constants";

const MockERC20Artifact = artifacts.require("MockERC20");

export class BassetMachine {
    private deployer: Address;

    private TX_DEFAULTS: any;

    constructor(deployer: Address, defaultSender: Address, defaultGas = 500000) {
        this.deployer = deployer;
        this.TX_DEFAULTS = {
            from: defaultSender,
            gas: defaultGas,
        };
    }

    public async deployERC20Async(
        name = "BassetMock",
        symbol = "BMT",
        decimals: BN = DEFAULT_DECIMALS,
        initialRecipient: Address = this.deployer,
        initialMint: BN = DEFAULT_SUPPLY,
    ): Promise<MockERC20Instance> {
        const mockInstance = await MockERC20Artifact.new(
            name,
            symbol,
            decimals,
            initialRecipient,
            initialMint,
            { from: this.deployer },
        );

        return mockInstance;
    }
}
