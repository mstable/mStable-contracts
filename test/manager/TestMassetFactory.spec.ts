import { ERC20MockInstance, ManagerInstance } from "../../types/generated";
import { shouldFail } from "openzeppelin-test-helpers";
import { MASSET_FACTORY_BYTES } from "@utils/constants";
import envSetup from "@utils/env_setup";
import { BassetMachine, SystemMachine } from "@utils/machines";
import { percentToWeight } from "@utils/math";
import { aToH, chai, BigNumber } from "@utils/tools";
import { StandardAccounts } from "@utils/machines/standardAccounts";

envSetup.configure();
const { expect, assert } = chai;

contract("MassetFactoryManager", async (accounts) => {
    const sa = new StandardAccounts(accounts);

    let systemMachine: SystemMachine;
    const bassetMachine = new BassetMachine(sa._, sa.other, 500000);

    let manager: ManagerInstance;

    before("Init contract and create Masset", async () => {
        /** Get fresh SystemMachine */
        systemMachine = new SystemMachine(accounts, sa.other);

        /** Create a basic mock representation of the deployed system */
        await systemMachine.initialiseMocks();

        manager = systemMachine.manager;
    });

    // TODO - Test these cases/contracts
    it("should revert if Factory 'key' does not exist");
    it("should revert if one of the Bassets is non ERC20 compliant");
    it("should revert if the BasketWeightings != 100");
    it("should revert if there are missing items (mismatch array lens) in the args");
    it("should revert if duplicate massetkey is added?");
    it("should give the Masset privs to burn the systok?");
    it("should return the address of the newly created Masset");
    it("should apply the basset weightings, fees and keys assigned from the creation ");
    it("should apply the name and symbol to the new masset ");
    it("should emit a creation event and store the masset in the mapping");
    it("should allow the governor to add or update a factory");
    // contract("MassetFactoryV1")
    it("should only allow the Manager to create tokens");
    it("should only allow the Manager to update its own address");

    describe("Test basic creation of a Masset", () => {
        it("should allow the governor create a basic Masset", async () => {
            const b1: ERC20MockInstance = await bassetMachine.deployERC20Async();
            const b2: ERC20MockInstance = await bassetMachine.deployERC20Async();

            // LOG FACTORY NAMES // BYTES AS CONSTANTS
            const ma = await systemMachine.createMassetViaManager(sa.governor);
            assert(ma != null);

            // todo - check that it was added to mapping
        });

        it("should not allow a random address to create Masset", async () => {
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
