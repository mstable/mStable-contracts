import * as t from "types/generated";
import { increase } from "openzeppelin-test-helpers/src/time";
import { expectEvent, shouldFail } from "openzeppelin-test-helpers";
import { keccak256 } from "web3-utils";

import { MassetMachine, StandardAccounts, SystemMachine, MassetDetails } from "@utils/machines";
import { createMultiple, percentToWeight, simpleToExactAmount } from "@utils/math";
import { createBasket, Basket } from "@utils/mstable-objects";
import { ZERO_ADDRESS, ONE_WEEK, TEN_MINS } from "@utils/constants";
import { aToH, BN, assertBNSlightlyGTPercent } from "@utils/tools";

import shouldBehaveLikeModule from "../shared/behaviours/Module.behaviour";
import shouldBehaveLikePausableModule from "../shared/behaviours/PausableModule.behaviour";

import envSetup from "@utils/env_setup";
import * as chai from "chai";

const Masset: t.MassetContract = artifacts.require("Masset");
const Nexus: t.NexusContract = artifacts.require("Nexus");

const { expect, assert } = envSetup.configure();

contract("Masset", async (accounts) => {
    const ctx: { module?: t.PausableModuleInstance } = {};
    const sa = new StandardAccounts(accounts);
    let systemMachine: SystemMachine;
    let massetMachine: MassetMachine;
    let massetDetails: MassetDetails;

    before("Init contract", async () => {
        systemMachine = new SystemMachine(sa.all);
        await systemMachine.initialiseMocks(false, true);
        massetMachine = systemMachine.massetMachine;
        await runSetup();
    });

    const runSetup = async (initBasket = false) => {
        massetDetails = initBasket
            ? await massetMachine.deployMassetAndSeedBasket()
            : await massetMachine.deployMasset();
        ctx.module = massetDetails.mAsset;
    };

    describe("initializing mAsset", async () => {
        describe("verifying Module initialization", async () => {
            beforeEach("reset contracts", async () => {
                await runSetup();
            });

            shouldBehaveLikeModule(ctx as Required<typeof ctx>, sa);
            shouldBehaveLikePausableModule(ctx as Required<typeof ctx>, sa);

            it("should properly store valid arguments", async () => {
                // Check for nexus addr
                expect(await massetDetails.mAsset.nexus()).eq(systemMachine.nexus.address);
            });
        });
        describe("verifying default storage", async () => {
            before("reset contracts", async () => {
                await runSetup();
            });
            it("should set valid arguments", async () => {
                expect(await massetDetails.mAsset.feeRecipient()).eq(sa.feeRecipient);
                expect(await massetDetails.mAsset.forgeValidator()).eq(
                    massetDetails.forgeValidator.address,
                );
                expect(await massetDetails.mAsset.getBasketManager()).eq(
                    massetDetails.basketManager.address,
                );
                expect(await massetDetails.mAsset.redemptionFee()).bignumber.eq(
                    simpleToExactAmount(2, 16),
                );
                expect(await massetDetails.mAsset.decimals()).bignumber.eq(new BN(18));
                expect(await massetDetails.mAsset.balanceOf(sa.dummy1)).bignumber.eq(new BN(0));
            });
        });
    });
    describe("using basic setters", async () => {
        it("should allow upgrades of the ForgeValidator by governor with valid params", async () => {
            // update by the governor
            await massetDetails.mAsset.upgradeForgeValidator(sa.other, { from: sa.governor });
            expect(sa.governor).eq(await systemMachine.nexus.governor());
            expect(await massetDetails.mAsset.forgeValidator()).eq(sa.other);
            // rejected if not governor
            await shouldFail.reverting.withMessage(
                massetDetails.mAsset.upgradeForgeValidator(sa.dummy2, { from: sa.default }),
                "Must be manager or governance",
            );
            // rejected if invalid params
            await shouldFail.reverting.withMessage(
                massetDetails.mAsset.upgradeForgeValidator(ZERO_ADDRESS, { from: sa.governor }),
                "Must be non null address",
            );
        });
        it("should allow locking of the ForgeValidator", async () => {
            // rejected if not governor
            await shouldFail.reverting.withMessage(
                massetDetails.mAsset.lockForgeValidator({ from: sa.default }),
                "Only governor can execute",
            );
            // Lock
            await massetDetails.mAsset.lockForgeValidator({ from: sa.governor });
            // no setting when locked
            await shouldFail.reverting.withMessage(
                massetDetails.mAsset.upgradeForgeValidator(sa.dummy2, { from: sa.governor }),
                "Must be allowed to upgrade",
            );
        });
        it("should allow the fee recipient to be changed by governor", async () => {
            // update by the governor
            let oldFeeRecipient = await massetDetails.mAsset.feeRecipient();
            expect(oldFeeRecipient).not.eq(sa.other);
            await massetDetails.mAsset.setFeeRecipient(sa.other, { from: sa.governor });
            expect(await massetDetails.mAsset.feeRecipient()).eq(sa.other);
            // rejected if not governor
            await shouldFail.reverting.withMessage(
                massetDetails.mAsset.setFeeRecipient(sa.dummy1, { from: sa.default }),
                "Must be manager or governance",
            );
            // no zero
            await shouldFail.reverting.withMessage(
                massetDetails.mAsset.setFeeRecipient(ZERO_ADDRESS, { from: sa.governor }),
                "Must be valid address",
            );
        });
        it("should allow the fee rate to be changed", async () => {
            // update by the governor
            let oldFee = await massetDetails.mAsset.redemptionFee();
            let newfee = simpleToExactAmount(1, 16); // 1%
            expect(oldFee).bignumber.not.eq(newfee);
            await massetDetails.mAsset.setRedemptionFee(newfee, { from: sa.governor });
            expect(await massetDetails.mAsset.redemptionFee()).bignumber.eq(newfee);
            // rejected if not governor
            await shouldFail.reverting.withMessage(
                massetDetails.mAsset.setRedemptionFee(newfee, { from: sa.default }),
                "Must be manager or governance",
            );
            // cannot exceed cap
            let feeExceedingCap = simpleToExactAmount(11, 16); // 11%
            await shouldFail.reverting.withMessage(
                massetDetails.mAsset.setRedemptionFee(feeExceedingCap, { from: sa.governor }),
                "Rate must be within bounds",
            );
            // cannot exceed min
            let feeExceedingMin = new BN(-1); // 11%
            await shouldFail.reverting.withMessage(
                massetDetails.mAsset.setRedemptionFee(feeExceedingMin, { from: sa.governor }),
                "Rate must be within bounds",
            );
        });
    });

    describe("collecting interest", async () => {
        beforeEach("init basset with vaults", async () => {
            await runSetup(true);
        });
        it("should allow the SavingsManager to collect interest", async () => {
            // 1.0. Simulate some activity on the lending markets
            // Fast forward a bit
            await increase(TEN_MINS);

            // 1.1. Simulate some activity on the lending markets
            // Mint with all bAssets
            const { bAssets } = massetDetails;
            const approvals = await massetMachine.approveMassetMulti(
                bAssets,
                massetDetails.mAsset,
                1,
                sa.default,
            );
            const mUSD_balBefore = await massetDetails.mAsset.balanceOf(sa.default);
            await massetDetails.mAsset.mintMulti(
                await massetDetails.basketManager.getBitmapFor(bAssets.map((b) => b.address)),
                approvals,
                sa.default,
            );

            // 2.0 Get all balances and data before
            let mUSDBalBefore = await massetDetails.mAsset.balanceOf(sa.dummy1);
            let bassetsBefore = await massetMachine.getBassetsInMasset(massetDetails);
            let totalSupplyBefore = await massetDetails.mAsset.totalSupply();

            // 3.0 Collect the interest
            let nexus = await Nexus.at(await massetDetails.mAsset.nexus());
            let [savingsManagerInNexus] = await nexus.modules(keccak256("SavingsManager"));
            expect(sa.dummy1).eq(savingsManagerInNexus);
            let tx = await massetDetails.mAsset.collectInterest({ from: sa.dummy1 });

            // 4.0 Check outputs
            let mUSDBalAfter = await massetDetails.mAsset.balanceOf(sa.dummy1);
            expect;
            let bassetsAfter = await massetMachine.getBassetsInMasset(massetDetails);
            let totalSupplyAfter = await massetDetails.mAsset.totalSupply();

            // expectEvent.inLogs(tx.logs, "MintedMulti", { _amount: amount });
        });
        it("should increase at <=10% APY");
        it("should set all the vars on the basket composition");
        it("should have a minimal increase if called in quick succession");
    });
});
