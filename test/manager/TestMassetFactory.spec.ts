import { shouldFail } from "openzeppelin-test-helpers";
import { MASSET_FACTORY_BYTES } from "@utils/constants";
import envSetup from "@utils/env_setup";
import { BassetMachine, SystemMachine, MassetMachine } from "@utils/machines";
import { percentToWeight } from "@utils/math";
import { aToH, chai, BN } from "@utils/tools";
import { StandardAccounts } from "@utils/machines/standardAccounts";
import { ERC20MockInstance, ManagerInstance } from "types/generated";

const { expect, assert } = envSetup.configure();
contract("MassetFactoryManager", async (accounts) => {
    const sa = new StandardAccounts(accounts);

    let systemMachine: SystemMachine;
    let massetMachine: MassetMachine;
    const bassetMachine = new BassetMachine(sa._, sa.other, 500000);

    let manager: ManagerInstance;

    before("Init contract and create Masset", async () => {
        /** Get fresh SystemMachine */
        systemMachine = new SystemMachine(sa.all, sa.other);
        massetMachine = new MassetMachine(systemMachine);

        /** Create a basic mock representation of the deployed system */
        await systemMachine.initialiseMocks();

        manager = systemMachine.manager;
    });

    it("should revert if duplicate massetkey is added?");
    it("should apply the name and symbol to the new masset ");
    it("should emit a creation event and store the masset in the mapping");

    describe("Test basic creation of a Masset", () => {
        it("should allow the governor to add a Masset", async () => {
            const b1: ERC20MockInstance = await bassetMachine.deployERC20Async();
            const b2: ERC20MockInstance = await bassetMachine.deployERC20Async();

            // LOG FACTORY NAMES // BYTES AS CONSTANTS
            const ma = await massetMachine.createBasicMasset(2, sa.governor);
            assert(ma != null);

            // todo - check that it was added to mapping
        });

        it("should not allow a random address to add a Masset", async () => {
            // const b1: ERC20MockInstance = await bassetMachine.deployERC20Async();
            // const b2: ERC20MockInstance = await bassetMachine.deployERC20Async();
            // // LOG FACTORY NAMES // BYTES AS CONSTANTS
            // await shouldFail.reverting.withMessage(
            //     systemMachine.createMassetViaManager(sa.other),
            //     "Only the governor",
            // );
        });
    });
});
