/* eslint-disable @typescript-eslint/camelcase */

import { expectRevert, expectEvent, time } from "@openzeppelin/test-helpers";

import { simpleToExactAmount } from "@utils/math";
import { assertBNClose, assertBNSlightlyGT } from "@utils/assertions";
import { StandardAccounts, SystemMachine, MassetDetails } from "@utils/machines";
import { BN } from "@utils/tools";
import { fullScale, ZERO_ADDRESS, ZERO, MAX_UINT256, ONE_DAY } from "@utils/constants";
import envSetup from "@utils/env_setup";
import * as t from "types/generated";

contract("SavingsContract", async (accounts) => {
    const sa = new StandardAccounts(accounts);

    const setupEnvironment = async (): Promise<void> => {
        // deploy mAsset, savingsContract, mock uniswap (if necessary)
    };

    before(async () => {
        await setupEnvironment();
    });

    describe("saving via mint", async () => {
        it("should do something");
    });
});
