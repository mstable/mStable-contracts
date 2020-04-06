/* eslint-disable @typescript-eslint/camelcase */

import { simpleToExactAmount } from "@utils/math";
import { createBasket, Basket } from "@utils/mstable-objects";
import { expectRevert } from "@openzeppelin/test-helpers";
import { MassetMachine, StandardAccounts, SystemMachine, MassetDetails } from "@utils/machines";
import { aToH, BN } from "@utils/tools";

import envSetup from "@utils/env_setup";
import * as chai from "chai";
import { MockERC20Instance, MassetInstance } from "types/generated";
import { fullScale } from "@utils/constants";

const { expect, assert } = envSetup.configure();

contract("SavingsContract", async (accounts) => {
    const sa = new StandardAccounts(accounts);
    let systemMachine: SystemMachine;
    let massetMachine: MassetMachine;
    let massetDetails: MassetDetails;

    describe("Simply depositing and withdrawing", () => {
        before("Init contract", async () => {
            // Create the system Mock machines
            systemMachine = new SystemMachine(sa.all);
            await systemMachine.initialiseMocks(true);
            massetMachine = systemMachine.massetMachine;
            massetDetails = systemMachine.mUSD;
        });
        describe("depositing mUSD into savings", () => {
            it("Should deposit the mUSD and assign credits to the saver", async () => {
                const depositAmount = simpleToExactAmount(1, 18);
                // const exchangeRate_before = await systemMachine.savingsContract.exchangeRate();
                const credits_balBefore = await systemMachine.savingsContract.creditBalances(
                    sa.default,
                );
                const credits_totalBefore = await systemMachine.savingsContract.totalCredits();
                const mUSD_balBefore = await massetDetails.mAsset.balanceOf(sa.default);
                const mUSD_totalBefore = await systemMachine.savingsContract.totalSavings();
                // 1. Approve the savings contract to spend mUSD
                await massetDetails.mAsset.approve(
                    systemMachine.savingsContract.address,
                    depositAmount,
                    { from: sa.default },
                );
                // 2. Deposit the mUSD
                await systemMachine.savingsContract.depositSavings(depositAmount, {
                    from: sa.default,
                });
                const credits_balAfter = await systemMachine.savingsContract.creditBalances(
                    sa.default,
                );
                expect(credits_balAfter, "Must receive some savings credits").bignumber.eq(
                    simpleToExactAmount(1, 18),
                );
                const credits_totalAfter = await systemMachine.savingsContract.totalCredits();
                expect(credits_totalAfter, "Must deposit 1 full units of mUSD").bignumber.eq(
                    credits_totalBefore.add(simpleToExactAmount(1, 18)),
                );
                const mUSD_balAfter = await massetDetails.mAsset.balanceOf(sa.default);
                expect(mUSD_balAfter, "Must deposit 1 full units of mUSD").bignumber.eq(
                    mUSD_balBefore.sub(depositAmount),
                );
                const mUSD_totalAfter = await systemMachine.savingsContract.totalSavings();
                expect(mUSD_totalAfter, "Must deposit 1 full units of mUSD").bignumber.eq(
                    mUSD_totalBefore.add(simpleToExactAmount(1, 18)),
                );
            });
        });
        describe("Withdrawing mUSD from savings", () => {
            it("Should withdraw the mUSD and burn the credits", async () => {
                const redemptionAmount = simpleToExactAmount(1, 18);
                const credits_balBefore = await systemMachine.savingsContract.creditBalances(
                    sa.default,
                );
                const mUSD_balBefore = await massetDetails.mAsset.balanceOf(sa.default);
                // Redeem all the credits
                await systemMachine.savingsContract.redeem(credits_balBefore, { from: sa.default });

                const credits_balAfter = await systemMachine.savingsContract.creditBalances(
                    sa.default,
                );
                const mUSD_balAfter = await massetDetails.mAsset.balanceOf(sa.default);
                expect(credits_balAfter, "Must burn all the credits").bignumber.eq(new BN(0));
                expect(mUSD_balAfter, "Must receive back mUSD").bignumber.eq(
                    mUSD_balBefore.add(redemptionAmount),
                );
            });
        });
    });
});
