import { increase, latest } from "openzeppelin-test-helpers/src/time";
import { createMultiple, percentToWeight, simpleToExactAmount } from "@utils/math";
import { createBasket, createBasset, Basket } from "@utils/mstable-objects";
import { constants, expectEvent, shouldFail } from "openzeppelin-test-helpers";
import { BassetMachine, MassetMachine, StandardAccounts, SystemMachine } from "@utils/machines";
import { aToH, padRight, BN } from "@utils/tools";
import {
    NexusInstance,
    ClaimableGovernorInstance,
    DelayedClaimableGovernorInstance,
} from "types/generated";

import shouldBehaveLikeClaimable from "../governance/ClaimableGovernor.behaviour";
import shouldBehaveLikeDelayedClaimable from "../governance/DelayedClaimableGovernor.behaviour";

import envSetup from "@utils/env_setup";
import * as chai from "chai";

const { ZERO_ADDRESS } = constants;
const Nexus = artifacts.require("Nexus");

envSetup.configure();
const { expect, assert } = chai;

contract("Nexus", async (accounts) => {
    const sa = new StandardAccounts(accounts);
    let systemMachine: SystemMachine;
    let nexus: NexusInstance;
    const ONE_DAY = new BN(60 * 60 * 24);
    const TEN_DAYS = new BN(60 * 60 * 24 * 10);
    const WEEK = new BN(60 * 60 * 24 * 7);

    let newAddress: string;
    let timestamp: BN;
    let addr: string;
    let isLocked: boolean;

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
                const { other } = sa;
                await ctx.claimable.requestGovernorChange(other, { from: sa.governor });
            });

            shouldBehaveLikeDelayedClaimable(ctx as Required<typeof ctx>, sa);
        });
    });

    beforeEach("Init contract", async () => {
        systemMachine = new SystemMachine(accounts, sa.other);
        nexus = await systemMachine.deployNexus();
        await nexus.initialize(
            [aToH("dummy3"), aToH("dummy4")],
            [sa.dummy3, sa.dummy4],
            [true, false],
            sa.governor,
            { from: sa.governor },
        );
    });

    describe("Before initialize", () => {
        it("should have correct default parameters", async () => {
            // Deploy new nexus
            nexus = await systemMachine.deployNexus();
            const governor = await nexus.governor();
            const initialized = await nexus.initialized();
            const upgradeDelay = await nexus.UPGRADE_DELAY();
            expect(governor).to.equal(sa.governor);
            expect(initialized).to.equal(false);
            expect(upgradeDelay).to.bignumber.equals(WEEK);
        });
    });

    describe("initialize()", () => {
        beforeEach("deploy nexus instance", async () => {
            // Deploy new nexus, to override
            nexus = await systemMachine.deployNexus();
        });
        context("should succeed", () => {
            it("with default modules", async () => {
                await systemMachine.initialiseMocks();
                nexus = systemMachine.nexus;
                // initialized
                const initialized = await nexus.initialized();
                expect(initialized).to.equal(true);

                // validate modules
                [addr, isLocked] = await nexus.modules(await nexus.Key_Systok());
                expect(addr).to.equal(systemMachine.systok.address);
                expect(isLocked).to.equal(true);

                [addr, isLocked] = await nexus.modules(await nexus.Key_OracleHub());
                expect(addr).to.equal(systemMachine.oracleHub.address);
                expect(isLocked).to.equal(false);

                [addr, isLocked] = await nexus.modules(await nexus.Key_Manager());
                expect(addr).to.equal(systemMachine.manager.address);
                expect(isLocked).to.equal(false);

            });
            it("when current governor called the function", async () => {
                await nexus.initialize(
                    [aToH("dummy")],
                    [sa._],
                    [true],
                    sa.governor,
                    { from: sa.governor },
                );
            });
            it("when different governor address passed", async () => {
                const govBefore = await nexus.governor();
                await nexus.initialize(
                    [aToH("dummy")],
                    [sa._],
                    [true],
                    sa.other,
                    { from: sa.governor },
                );
                const govAfter = await nexus.governor();
                expect(govBefore).to.not.equal(govAfter);
                expect(govBefore).to.equal(sa.governor);
                expect(govAfter).to.equal(sa.other);
            });
        });
        context("should fail", () => {
            it("when called by other than governor", async () => {
                await shouldFail.reverting.withMessage(
                    nexus.initialize([], [], [], sa.governor),
                    "GOV: caller is not the Governor",
                );
            });
            it("when initialized with same address for different modules", async () => {
                await shouldFail.reverting.withMessage(
                    nexus.initialize(
                        [aToH("dummy1"), aToH("dummy2")],
                        [sa.dummy1, sa.dummy1],
                        [false, false],
                        sa.governor,
                        { from: sa.governor },
                    ),
                    "Modules must have unique addr",
                );
            });
            it("when initialized with an empty array", async () => {
                await shouldFail.reverting.withMessage(
                    nexus.initialize([], [], [], sa.governor, { from: sa.governor }),
                    "No keys provided",
                );
            });
            it("when initialized with wrong array length for addresses array", async () => {
                await shouldFail.reverting.withMessage(
                    nexus.initialize(
                        [aToH("dummy")],
                        [sa._, sa.other],
                        [true],
                        sa.governor,
                        { from: sa.governor },
                    ),
                    "Insuffecient address data",
                );
            });
            it("when initialized with wrong array length for isLocked array", async () => {
                await shouldFail.reverting.withMessage(
                    nexus.initialize(
                        [aToH("dummy")],
                        [sa._],
                        [true, false],
                        sa.governor,
                        { from: sa.governor },
                    ),
                    "Insuffecient locked statuses",
                );
            });

            it("when already initialized", async () => {
                await nexus.initialize(
                    [aToH("dummy")],
                    [sa._],
                    [true],
                    sa.governor,
                    { from: sa.governor },
                );
                // must fail
                await shouldFail.reverting.withMessage(
                    nexus.initialize(
                        [aToH("dummy")],
                        [sa._],
                        [true],
                        sa.governor,
                        { from: sa.governor },
                    ),
                    "Nexus is already initialized",
                );
            });
        });
    });

    describe("proposeModule()", () => {
        context("should fail", () => {
            it("when not initialized", async () => {
                const initialized = await nexus.initialized();
                expect(initialized).to.equal(true);
            });
            it("when not called by Governor", async () => {
                await shouldFail.reverting.withMessage(
                    nexus.proposeModule(aToH("dummy"), sa._, { from: sa.other }),
                    "GOV: caller is not the Governor",
                );
            });
            it("when empty key", async () => {
                await shouldFail.reverting.withMessage(
                    nexus.proposeModule("0x00", sa._, { from: sa.governor }),
                    "Key must not be zero",
                );
            });
            it("when zero address", async () => {
                await shouldFail.reverting.withMessage(
                    nexus.proposeModule(aToH("dummy"), ZERO_ADDRESS, { from: sa.governor }),
                    "Module address must not be 0",
                );
            });
            it("when module key & address are same", async () => {
                await shouldFail.reverting.withMessage(
                    nexus.proposeModule(aToH("dummy4"), sa.dummy4, { from: sa.governor }),
                    "Module already has same address",
                );
            });
            it("when module is locked (update for existing module)", async () => {
                await shouldFail.reverting.withMessage(
                    nexus.proposeModule(aToH("dummy3"), sa.other, { from: sa.governor }),
                    "Module must be unlocked",
                );
            });
            it("when module already proposed", async () => {
                await nexus.proposeModule(aToH("dummy2"), sa.dummy2, { from: sa.governor });
                await shouldFail.reverting.withMessage(
                    nexus.proposeModule(aToH("dummy2"), sa.dummy3, { from: sa.governor }),
                    "Module already proposed",
                );
            });
        });
        context("should succeed", () => {
            it("when a new module is proposed", async () => {
                await nexus.proposeModule(aToH("dummy1"), sa.dummy1, { from: sa.governor });
                const lastTimestamp = await latest();
                [newAddress, timestamp] = await nexus.proposedModules(aToH("dummy1"));
                expect(newAddress).to.equal(sa.dummy1);
                expect(timestamp).to.bignumber.equal(lastTimestamp);
            });
            it("when an existing module address is updated", async () => {
                let prevAddr: string;
                let prevIsLocked: boolean;
                [prevAddr, prevIsLocked] = await nexus.modules(aToH("dummy4"));
                expect(prevAddr).to.equal(sa.dummy4);
                expect(prevIsLocked).to.equal(false);

                // propose new address
                await nexus.proposeModule(aToH("dummy4"), sa.other, { from: sa.governor });
                const lastTimestamp = await latest();
                [newAddress, timestamp] = await nexus.proposedModules(aToH("dummy4"));
                expect(newAddress).to.equal(sa.other);
                expect(timestamp).to.bignumber.equal(lastTimestamp);

                // address is not updated in modules mapping
                let currentAddr: string;
                let currentIsLocked: boolean;
                [currentAddr, currentIsLocked] = await nexus.modules(aToH("dummy4"));
                expect(currentAddr).to.equal(sa.dummy4);
                expect(currentIsLocked).to.equal(false);
            });
        });
    });

    describe("cancelProposedModule()", () => {
        context("should fail", () => {
            it("when not initialized", async () => {
                const initialized = await nexus.initialized();
                expect(initialized).to.equal(true);
            });
            it("when not called by Governor", async () => {
                await shouldFail.reverting.withMessage(
                    nexus.cancelProposedModule(aToH("dummy"), { from: sa.other }),
                    "GOV: caller is not the Governor",
                );
            });
            it("when proposed module not found", async () => {
                await shouldFail.reverting.withMessage(
                    nexus.cancelProposedModule(aToH("dummy"), { from: sa.governor }),
                    "Proposed module not found",
                );
            });
        });
        context("should succeed", () => {
            it("when cancelling existing proposed module", async () => {
                // propose a new module
                // =====================
                await nexus.proposeModule(aToH("dummy1"), sa.dummy1, { from: sa.governor });
                // validate proposed module

                [newAddress, timestamp] = await nexus.proposedModules(aToH("dummy1"));
                // validate dummy1 added
                const latestTimestamp = await latest();
                expect(newAddress).to.equal(sa.dummy1);
                expect(timestamp).to.bignumber.equal(latestTimestamp);

                // validate dummy3 still exist
                [addr, isLocked] = await nexus.modules(aToH("dummy3"));
                expect(addr).to.equal(sa.dummy3);
                expect(isLocked).to.equal(true);

                // cancel the module
                // ==================
                const tx = await nexus.cancelProposedModule(aToH("dummy1"), { from: sa.governor });
                // validate cancelled
                [newAddress, timestamp] = await nexus.proposedModules(aToH("dummy1"));
                expect(newAddress).to.equal(ZERO_ADDRESS);
                expect(timestamp).to.bignumber.equal(new BN(0));

                // expect event
                expectEvent.inLogs(
                    tx.logs,
                    "ModuleCancelled",
                    { key: padRight(aToH("dummy1"), 64) },
                );

                // validate dummy3 still exist
                [addr, isLocked] = await nexus.modules(aToH("dummy3"));
                expect(addr).to.equal(sa.dummy3);
                expect(isLocked).to.equal(true);
            });
        });
    });

    describe("acceptProposedModule()", () => {
        context("should fail", () => {
            it("when not initialized", async () => {
                const initialized = await nexus.initialized();
                expect(initialized).to.equal(true);
            });
            it("when not called by Governor", async () => {
                await shouldFail.reverting.withMessage(
                    nexus.acceptProposedModule(aToH("dummy"), { from: sa.other }),
                    "GOV: caller is not the Governor",
                );
            });
            it("when non existing key passed", async () => {
                await shouldFail.reverting.withMessage(
                    nexus.acceptProposedModule(aToH("dummy"), { from: sa.governor }),
                    "Module upgrade delay not over",
                );
            });
            it("when delay not over", async () => {
                await nexus.proposeModule(aToH("dummy1"), sa.dummy1, { from: sa.governor });
                const timeWhenModuleProposed = await latest();
                await increase(ONE_DAY);
                await shouldFail.reverting.withMessage(
                    nexus.acceptProposedModule(aToH("dummy1"), { from: sa.governor }),
                    "Module upgrade delay not over",
                );

                // validate
                [newAddress, timestamp] = await nexus.proposedModules(aToH("dummy1"));
                expect(newAddress).to.equal(sa.dummy1);
                expect(timestamp).to.bignumber.equal(timeWhenModuleProposed);

                // validate module still not accepted
                [addr, isLocked] = await nexus.modules(aToH("dummy1"));
                expect(addr).to.equal(ZERO_ADDRESS);
                expect(isLocked).to.equal(false);
            });
        });
        context("should succeed", () => {
            it("when accepted after delay is over", async () => {
                await nexus.proposeModule(aToH("dummy1"), sa.dummy1, { from: sa.governor });
                const timeWhenModuleProposed = await latest();

                // validate
                [newAddress, timestamp] = await nexus.proposedModules(aToH("dummy1"));
                expect(newAddress).to.equal(sa.dummy1);
                expect(timestamp).to.bignumber.equal(timeWhenModuleProposed);

                await increase(WEEK);
                await nexus.acceptProposedModule(aToH("dummy1"), { from: sa.governor });

                // validate module accepted
                [addr, isLocked] = await nexus.modules(aToH("dummy1"));
                expect(addr).to.equal(sa.dummy1);
                expect(isLocked).to.equal(false);

                // validate data deleted from proposedModules map
                [newAddress, timestamp] = await nexus.proposedModules(aToH("dummy1"));
                expect(newAddress).to.equal(ZERO_ADDRESS);
                expect(timestamp).to.bignumber.equal(new BN(0));
            });
        });
    });

    describe("acceptProposedModules()", () => {
        context("should fail", () => {
            it("when not initialized", async () => {
                const initialized = await nexus.initialized();
                expect(initialized).to.equal(true);
            });
            it("when not called by Governor", async () => {
                await shouldFail.reverting.withMessage(
                    nexus.acceptProposedModules([aToH("dummy")], { from: sa.other }),
                    "GOV: caller is not the Governor",
                );
            });
            it("when empty array", async () => {
                await shouldFail.reverting.withMessage(
                    nexus.acceptProposedModules([], { from: sa.governor }),
                    "Keys array empty",
                );
            });
            it("when non existing key passed", async () => {
                await shouldFail.reverting.withMessage(
                    nexus.acceptProposedModules([aToH("dummy")], { from: sa.governor }),
                    "Module upgrade delay not over",
                );
            });
            it("when module not proposed", async () => {
                await shouldFail.reverting.withMessage(
                    nexus.acceptProposedModules([aToH("dummy1")], { from: sa.governor }),
                    "Module upgrade delay not over",
                );
            });
            it("when module is locked");
            it("when address is already used by another module");
            it("when delay is not over");
            it("when new proposed address is zero");
            it("when delay is less then 1 second of opt out period");
            it("when delay is equal to opt out period");
        });
        context("should succeed", () => {
            it("when called by Governor");
            it("when accepted already proposed Module"); // validate event
            it("when delay is more then 1 second of opt out period");
            it("should remove the proposed module from mapping");
            it("should remove the old address from the system");
            it("should set new module info");
        });
    });

    describe("requestLockModule()", () => {
        context("should fail", () => {
            it("when not initialized", async () => {
                const initialized = await nexus.initialized();
                expect(initialized).to.equal(true);
            });
            it("when not called by the Governor", async () => {
                await shouldFail.reverting.withMessage(
                    nexus.requestLockModule(aToH("dummy"), { from: sa.other }),
                    "GOV: caller is not the Governor",
                );
            });
            it("when module not exist", async () => {
                await shouldFail.reverting.withMessage(
                    nexus.requestLockModule(aToH("dummy"), { from: sa.governor }),
                    "Module must exist",
                );
            });
            it("when module key is zero", async () => {
                await shouldFail.reverting.withMessage(
                    nexus.requestLockModule("0x00", { from: sa.governor }),
                    "Module must exist",
                );
            });
            it("when module already locked", async () => {
                await shouldFail.reverting.withMessage(
                    nexus.requestLockModule(aToH("dummy3"), { from: sa.governor }),
                    "Module must be unlocked",
                );
            });
            it("when locked already proposed", async () => {
                // lock proposed
                nexus.requestLockModule(aToH("dummy4"), { from: sa.governor });
                await shouldFail.reverting.withMessage(
                    nexus.requestLockModule(aToH("dummy4"), { from: sa.governor }),
                    "Lock already proposed",
                );
            });
        });
        context("should succeed", () => {
            it("when a fresh lock request initiated", async () => {
                // lock proposed
                const tx = await nexus.requestLockModule(aToH("dummy4"), { from: sa.governor });
                const latestTimestamp = await latest();
                expectEvent.inLogs(
                    tx.logs,
                    "ModuleLockRequested",
                    { key: padRight(aToH("dummy4"), 64), timestamp: latestTimestamp },
                );
                const requestTimestamp = await nexus.proposedLockModules(aToH("dummy4"));
                expect(requestTimestamp).to.bignumber.equal(latestTimestamp);
            });
        });
    });

    describe("cancelLockModule()", () => {
        context("should fail", () => {
            it("when not initialized", async () => {
                const initialized = await nexus.initialized();
                expect(initialized).to.equal(true);
            });
            it("when not called by Governor", async () => {
                await shouldFail.reverting.withMessage(
                    nexus.cancelLockModule(aToH("dummy"), { from: sa.other }),
                    "GOV: caller is not the Governor",
                );
            });
            it("when not proposed lock before", async () => {
                await shouldFail.reverting.withMessage(
                    nexus.cancelLockModule(aToH("dummy"), { from: sa.governor }),
                    "Module lock request not found",
                );
            });
            it("when zero key", async () => {
                await shouldFail.reverting.withMessage(
                    nexus.cancelLockModule("0x00", { from: sa.governor }),
                    "Module lock request not found",
                );
            });
            it("when lock request not found", async () => {
                await shouldFail.reverting.withMessage(
                    nexus.cancelLockModule(aToH("dummy4"), { from: sa.governor }),
                    "Module lock request not found",
                );
            });
        });
        context("should succeed", () => {
            it("when a valid cancel lock request", async () => {
                timestamp = await nexus.proposedLockModules(aToH("dummy4"));
                expect(timestamp).to.bignumber.equal(new BN(0));

                await nexus.requestLockModule(aToH("dummy4"), { from: sa.governor });

                const latestTimestamp = await latest();
                timestamp = await nexus.proposedLockModules(aToH("dummy4"));
                expect(timestamp).to.bignumber.equal(latestTimestamp);

                const tx = await nexus.cancelLockModule(aToH("dummy4"), { from: sa.governor });

                // validate event
                expectEvent.inLogs(
                    tx.logs,
                    "ModuleLockCancelled",
                    { key: padRight(aToH("dummy4"), 64) },
                );

                timestamp = await nexus.proposedLockModules(aToH("dummy4"));
                expect(timestamp).to.bignumber.equal(new BN(0));

                [addr, isLocked] = await nexus.modules(aToH("dummy4"));
                expect(addr).to.equal(sa.dummy4);
                expect(isLocked).to.equal(false);
            });
        });
    });

    describe("lockModule()", () => {
        context("should fail", () => {
            it("when not initialized", async () => {
                const initialized = await nexus.initialized();
                expect(initialized).to.equal(true);
            });
            it("when not called by Governor", async () => {
                await shouldFail.reverting.withMessage(
                    nexus.lockModule(aToH("dummy"), { from: sa.other }),
                    "GOV: caller is not the Governor",
                );
            });
            it("when not existing key passed", async () => {
                await shouldFail.reverting.withMessage(
                    nexus.lockModule(aToH("dummy"), { from: sa.governor }),
                    "Delay not over",
                );
            });
            it("when delay not over", async () => {
                await nexus.requestLockModule(aToH("dummy4"), { from: sa.governor });
                await increase(ONE_DAY);
                await shouldFail.reverting.withMessage(
                    nexus.lockModule(aToH("dummy4"), { from: sa.governor }),
                    "Delay not over",
                );
            });
            it("when delay is less then 1 second of opt out period");
            it("when delay is equal to opt out period");
        });
        context("should succeed", () => {
            it("when a valid lock Module", async () => {
                [addr, isLocked] = await nexus.modules(aToH("dummy4"));
                expect(addr).to.equal(sa.dummy4);
                expect(isLocked).to.equal(false);

                await nexus.requestLockModule(aToH("dummy4"), { from: sa.governor });

                await increase(WEEK);

                const tx = await nexus.lockModule(aToH("dummy4"), { from: sa.governor });
                // validate event
                expectEvent.inLogs(
                    tx.logs,
                    "ModuleLockEnabled",
                    { key: padRight(aToH("dummy4"), 64) },
                );

                [addr, isLocked] = await nexus.modules(aToH("dummy4"));
                expect(addr).to.equal(sa.dummy4);
                expect(isLocked).to.equal(true);
            });
            it("when delay is more then 10 second of opt out period");
        });
    });

    describe("moduleExists()", () => {
        context("should return false", () => {
            it("when key not exist", async () => {
                const result = await nexus.moduleExists(aToH("dummy"));
                expect(result).to.equal(false);
            });
            it("when key is zero");
        });
        context("should return true", () => {
            it("when a valid module key", async () => {
                const result = await nexus.moduleExists(aToH("dummy3"));
                expect(result).to.equal(true);
            });
        });
    });

    describe("Extra tests", () => {
        context("should not allow", () => {
            it("having same address with different module keys");
            it("proposeModule + requestLockModule for a same key");
        });
        context("", () => {
            it("can propose a module, cancel it and then propose the same module it again");
            it("can propose multiple modules and cancel one, and accept one, and leave one");
            it("should fail when we propose a module, and then lock it, and then try to accept the proposal");
        });
    });
});
