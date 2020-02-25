import { ERC20MockInstance } from "types/generated/index.d";
import { Address } from "../../types/common";
import { BN } from "../tools";
import { DEFAULT_DECIMALS, DEFAULT_SUPPLY } from "../constants";

const ERC20MockArtifact = artifacts.require("ERC20Mock");

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
    ): Promise<ERC20MockInstance> {
        const mockInstance = await ERC20MockArtifact.new(
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
