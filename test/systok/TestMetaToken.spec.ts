import { shouldFail } from "openzeppelin-test-helpers";
import { ADDRESS_1, MASSET_FACTORY_BYTES } from "@utils/constants";
import envSetup from "@utils/env_setup";
import { BassetMachine, MassetMachine, SystemMachine } from "@utils/machines";
import { percentToWeight, simpleToExactRelativePrice } from "@utils/math";
import { aToH, chai, BigNumber } from "@utils/tools";
import { Basset, BassetStatus } from "@utils/mstable-objects";
import { expectEvent, expectNoEvent } from "@utils/helpers";

envSetup.configure();
const { expect, assert } = chai;

/**
 * @notice Unit and integration tests to detect consequences of Basset deviating from peg
 * Masset created, prices injected into OracleHub and then peg detection initiated. If a
 * basset deviates beyond threshold, it is isolated and a governance proposal generated
 */
contract("MetaToken", async (accounts) => {
    let systemMachine: SystemMachine;

    before("Init contracts", async () => {
        /** Get fresh SystemMachine */
        systemMachine = new SystemMachine(accounts, accounts[0]);

        /** Create a basic mock representation of the deployed system */
        await systemMachine.initialiseMocks();
    });

    describe("Burning", () => {
        it("Should only allow self & Recollateraliser to mint", async () => {
            const systok = systemMachine.systok;
            assert((await systok.decimals()) === new BigNumber(18));
        });
        it("Should allow anyone to burn, with allowance");
    });
});
