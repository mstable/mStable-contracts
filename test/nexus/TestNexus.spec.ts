import { createMultiple, percentToWeight, simpleToExactAmount } from "@utils/math";
import { createBasket, createBasset, Basket } from "@utils/mstable-objects";
import { constants, expectEvent, shouldFail } from "openzeppelin-test-helpers";
import { BassetMachine, MassetMachine, StandardAccounts, SystemMachine } from "@utils/machines";
import { aToH, BN } from "@utils/tools";
import { shouldBehaveLikeClaimable } from "../governance/ClaimableGovernor.behaviour";
import { shouldBehaveLikeDelayedClaimable } from "../governance/DelayedClaimableGovernor.behaviour";
import { ClaimableGovernorInstance, DelayedClaimableGovernorInstance } from "../../types/generated";

import envSetup from "@utils/env_setup";
import * as chai from "chai";
import { NexusInstance } from "types/generated";

const Nexus = artifacts.require("Nexus");

envSetup.configure();
const { expect, assert } = chai;

contract("Nexus", async (accounts) => {
    const sa = new StandardAccounts(accounts);
    let systemMachine: SystemMachine;
    let nexus: NexusInstance;

    beforeEach("Init contract", async () => {
        systemMachine = new SystemMachine(accounts, sa.other);
        nexus = await systemMachine.deployNexus();
    });

    describe("Behavior like...", () => {
        const ctx: { claimable?: DelayedClaimableGovernorInstance } = {};
        beforeEach("Init contract", async () => {
            systemMachine = new SystemMachine(accounts, sa.other);
            ctx.claimable = await systemMachine.deployNexus();
        });
        context("should behave like ClaimableGovernor", () => {
            shouldBehaveLikeClaimable(ctx as Required<typeof ctx>, sa);
        });

        context("should behave like DelayedClaimableGovernor", () => {
            beforeEach("", async () => {
                const other = sa.other;
                await ctx.claimable.requestGovernorChange(other, { from: sa.governor });
            });

            shouldBehaveLikeDelayedClaimable(ctx as Required<typeof ctx>, sa);
        });
    });

    describe("Setup", () => {
        it("should have correct default parameters");
    });

    describe("initialize()", () => {
        context("Should Success", () => {
            it("with default module");
            it("with all modules");
            it("default with locked Systok module");
            it("default with unlocked module");
            it("only allowed with governor");
            it("should be initialized");
        });
        context("Should Fail", () => {
            it("not initialize with same module address");
            it("not initialize when empty array");
            it("not initialize when wrong array length");
            it("not initialize other than governor");
            it("should not be initialized");
        });
    });

    describe("proposeModule()", () => {
        context("should fail", () => {
            it("when not initialized");
            it("when not called by Governor");
            it("when empty key");
            it("when zero address");
            it("when module already exist");
            it("when module already proposed");
        });
        context("should pass", () => {
            it("when called by Governor");
            it("when a valid module is proposed");
        });
    });

    describe("cancelProposedModule()", () => {
        context("should fail", () => {
            it("when not initialized");
            it("when not called by Governor");
            it("when empty key");
            it("when proposed module not found");
        });
        context("should pass", () => {
            it("when called by Governor");
            it("when cancelling existing proposed module"); // validate deleted entry + event
            it("during opt out period");
            it("after opt out period");
        });
    });

    describe("acceptProposedModules()", () => {
        context("should fail", () => {
            it("when not initialized");
            it("when not called by Governor");
            it("when empty key");
            it("when empty array");
            it("when module not proposed");
            it("when delay is not over");
            it("when new proposed address is zero");
            it("when delay is less then 1 second of opt out period");
            it("when delay is equal to opt out period");
        });
        context("should pass", () => {
            it("when called by Governor");
            it("when accepted already proposed Module"); // validate event
            it("when delay is more then 1 second of opt out period");
        });
    });

    describe("requestLockModule()", () => {
        context("should fail", () => {
            it("when not initialized");
            it("when not called by Governor");
            it("when empty key");
            it("when module not exist");
            it("when module already locked");
            it("when locked already proposed");
        });
        context("should pass", () => {
            it("when called by Governor");
            it("when a valid lock request"); // validate event
        });
    });

    describe("cancelLockModule()", () => {
        context("should fail", () => {
            it("when not initialized");
            it("when not called by Governor");
            it("when empty key");
            it("when not proposed lock before");
        });
        context("should pass", () => {
            it("when called by Governor");
            it("when a valid cancel lock request"); // validate event
            it("during opt out period");
            it("after opt out period");
        });
    });

    describe("lockModule()", () => {
        context("should fail", () => {
            it("when not initialized");
            it("when not called by Governor");
            it("when empty key");
            it("when lock not proposed before");
            it("when delay not over");
            it("when delay is less then 1 second of opt out period");
            it("when delay is equal to opt out period");
        });
        context("should pass", () => {
            it("when called by Governor");
            it("when a valid lock Module"); // validate event
            it("when delay is more then 1 second of opt out period");
        });
    });

    describe("moduleExists()", () => {
        context("should return false", () => {
            it("when empty key");
            it("when zero address");
        });
        context("should return true", () => {
            it("when a valid module key");
        });
    });

    describe("Extra tests", () => {
        context("should not allow", () => {
            it("having same address with different module keys");
            it("proposeModule + requestLockModule for a same key");
        });
    });
});
