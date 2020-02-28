import { shouldFail, expectEvent } from "openzeppelin-test-helpers";
import { latest } from "openzeppelin-test-helpers/src/time";
import { ADDRESS_1, MASSET_FACTORY_BYTES } from "@utils/constants";
import {
    ERC20MockContract,
    MassetContract,
    SimpleOracleHubMockInstance,
    ManagerInstance,
} from "types/generated";
import envSetup from "@utils/env_setup";
import { BassetMachine, MassetMachine, StandardAccounts, SystemMachine } from "@utils/machines";
import { percentToWeight, simpleToExactRelativePrice } from "@utils/math";
import { aToH, BN } from "@utils/tools";
import { Basset, BassetStatus } from "@utils/mstable-objects";

const { expect, assert } = envSetup.configure();

/**
 * @notice Unit and integration tests to detect consequences of Basset deviating from peg
 * Masset created, prices injected into OracleHub and then peg detection initiated. If a
 * basset deviates beyond threshold, it is isolated and a governance proposal generated
 */
contract("Manager", async (accounts) => {
    const sa = new StandardAccounts(accounts);

    let systemMachine: SystemMachine;
    let massetMachine: MassetMachine;
    const bassetMachine = new BassetMachine(sa._, sa.other);

    let manager: ManagerInstance;
    let oracleHub: SimpleOracleHubMockInstance;

    before("Init contracts", async () => {
        /** Get fresh SystemMachine */
        systemMachine = new SystemMachine(sa.all, sa.other);

        /** Create a basic mock representation of the deployed system */
        await systemMachine.initialiseMocks();
        massetMachine = new MassetMachine(systemMachine);

        manager = systemMachine.manager;
        oracleHub = systemMachine.oracleHub;
    });

    describe("Detect peg loss for Bassets on a Masset", () => {
        it("should revert if the Masset doesn't exist", async () => {
            await shouldFail.reverting(manager.detectPegDeviation(ADDRESS_1));
        });

        it("should do nothing if we have no pricing information", async () => {
            await massetMachine.createBasicMasset();

            const massets = await manager.getMassets();
            const masset = massets[0][0];

            // todo: check no events are emitted
            const res = await manager.detectPegDeviation(masset);
            // await expectNoEvent.inTransactionReceipt(res, "BassetBrokenPeg");
        });

        it("should do nothing if the Basset has already been auctioned");
        it("should do nothing if the failed Basset has already been proposed");
        it("should create multiple proposals if multiple Bassets fail");

        it("should emit event, isolate Basset and trigger a proposal for a new upwards peg loss", async () => {
            // Set up the masset and get generated keys
            const massets = await manager.getMassets();
            const masset = massets[0][0];
            const bassets = await massetMachine.getBassetsInMasset(masset);

            // Fresh basset should have normal status
            expect(bassets[0].status).to.equal(BassetStatus.Normal);

            // Inject arbitrary prices into mock oracle data
            const time = await latest();
            await oracleHub.addMockPrices(
                [new BN("1150000"), new BN("999980")],
                [time, time],
                [bassets[0].addr, bassets[1].addr],
            );

            // Detect peg for the Masset we created
            const txReceipt = await manager.detectPegDeviation(masset);

            // It should emit an event
            expectEvent.inLogs(txReceipt.logs, "BassetBrokenPeg", {
                underPeg: false,
            });

            // It should isolate the basset
            const bassetsPostTrigger = await massetMachine.getBassetsInMasset(masset);
            assert(
                bassetsPostTrigger[0].status === BassetStatus.BrokenAbovePeg,
                "Should have set to broken peg",
            );

            // Check the invariants too

            // It should create a new re-collateralisation proposal
            // await expectEvent.inBlockByContract(
            //     governancePortal,
            //     txReceipt.blockNumber,
            //     "NewVoteProposed",
            //     { masset, basset: bassetsPostTrigger[0].addr },
            // );
        });
        it("should emit broken downwards peg when basset deviates to 1.2x");
        it("should emit no events if there are no fresh prices");
        it("should emit no events if there are no price deviations breaking the threshold");
    });

    describe("Subsequent action triggered by peg loss", () => {
        it("Should set stuff up in the Masset", async () => {
            return Promise.resolve(true);
        });
    });
});
