import { expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { StandardAccounts, SystemMachine } from "@utils/machines";
import { padRight, BN } from "@utils/tools";
import { ZERO_ADDRESS, ZERO, ONE_DAY, ONE_WEEK } from "@utils/constants";
import { keccak256 } from "web3-utils";

import envSetup from "@utils/env_setup";
import * as t from "types/generated";

import shouldBehaveLikeClaimable from "../governance/ClaimableGovernor.behaviour";
import shouldBehaveLikeDelayedClaimable from "../governance/DelayedClaimableGovernor.behaviour";

const { expect } = envSetup.configure();

/** @dev Uses generic module getter to validate that a module exists with the specified properties */
async function expectInModules(
    nexus: t.NexusInstance,
    _key: string,
    _addr: string,
    _isLocked: boolean,
): Promise<void> {
    /* eslint-disable prefer-const */
    let addr: string;
    let isLocked: boolean;
    [addr, isLocked] = await nexus.modules(keccak256(_key));
    expect(addr, "Module address not matched").to.equal(_addr);
    expect(isLocked, "Module isLocked not matched").to.equal(_isLocked);
    const exists = await nexus.moduleExists(keccak256(_key));
    if (addr !== ZERO_ADDRESS) {
        expect(exists).to.equal(true);
    } else {
        expect(exists).to.equal(false);
    }
}

async function expectInProposedModules(
    nexus: t.NexusInstance,
    _key: string,
    _newAddress: string,
    _timestamp: BN,
): Promise<void> {
    let newAddress: string;
    let timestamp: BN;
    [newAddress, timestamp] = await nexus.proposedModules(keccak256(_key));
    /* eslint-enable prefer-const */
    expect(newAddress, "New address not matched in proposed modules").to.equal(_newAddress);
    expect(timestamp, "The timestamp not matched in proposed modules").to.bignumber.equal(
        _timestamp,
    );
}

async function expectInProposedLockModules(
    nexus: t.NexusInstance,
    _key: string,
    _timestamp: BN,
): Promise<void> {
    const timestamp: BN = await nexus.proposedLockModules(keccak256(_key));
    expect(timestamp, "The timestamp not matched in proposed lock modules").to.bignumber.equal(
        _timestamp,
    );
}

contract("Nexus", async (accounts) => {
    const sa = new StandardAccounts(accounts);
    let systemMachine: SystemMachine;
    let nexus: t.NexusInstance;

    describe("Behavior like...", () => {
        const ctx: { claimable?: t.DelayedClaimableGovernorInstance } = {};
        before("", async () => {
            systemMachine = new SystemMachine(sa.all);
        });
        beforeEach("Init contract", async () => {
            ctx.claimable = await systemMachine.deployNexus() as t.DelayedClaimableGovernorInstance;
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

    describe("Before initialize", () => {
        it("should have correct default parameters", async () => {
            // Deploy new nexus
            nexus = await systemMachine.deployNexus();
            const governor = await nexus.governor();
            const initialized = await nexus.initialized();
            const upgradeDelay = await nexus.UPGRADE_DELAY();
            expect(governor).to.equal(sa.governor);
            expect(initialized).to.equal(false);
            expect(upgradeDelay).to.bignumber.equals(ONE_WEEK);
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
                await expectInModules(
                    nexus,
                    "SavingsManager",
                    systemMachine.savingsManager.address,
                    false,
                );
            });
            it("when current governor called the function", async () => {
                await nexus.initialize([keccak256("dummy1")], [sa.dummy1], [true], sa.governor, {
                    from: sa.governor,
                });
                await expectInModules(nexus, "dummy1", sa.dummy1, true);
            });
            it("when different governor address passed", async () => {
                const govBefore = await nexus.governor();
                await nexus.initialize([keccak256("dummy")], [sa.default], [true], sa.other, {
                    from: sa.governor,
                });
                await expectInModules(nexus, "dummy", sa.default, true);
                const govAfter = await nexus.governor();
                expect(govBefore).to.not.equal(govAfter);
                expect(govBefore).to.equal(sa.governor);
                expect(govAfter).to.equal(sa.other);
            });
        });
        context("should fail", () => {
            it("when called by other than governor", async () => {
                await expectRevert(
                    nexus.initialize([], [], [], sa.governor),
                    "GOV: caller is not the Governor",
                );
            });
            it("when initialized with same address for different modules", async () => {
                await expectRevert(
                    nexus.initialize(
                        [keccak256("dummy1"), keccak256("dummy2")],
                        [sa.dummy1, sa.dummy1],
                        [false, false],
                        sa.governor,
                        { from: sa.governor },
                    ),
                    "Modules must have unique addr",
                );
                await expectInModules(nexus, "dummy1", ZERO_ADDRESS, false);
                await expectInModules(nexus, "dummy2", ZERO_ADDRESS, false);
            });
            it("when initialized with an empty array", async () => {
                await expectRevert(
                    nexus.initialize([], [], [], sa.governor, { from: sa.governor }),
                    "No keys provided",
                );
            });
            it("when initialized with wrong array length for addresses array", async () => {
                await expectRevert(
                    nexus.initialize(
                        [keccak256("dummy")],
                        [sa.default, sa.other],
                        [true],
                        sa.governor,
                        {
                            from: sa.governor,
                        },
                    ),
                    "Insufficient address data",
                );
                await expectInModules(nexus, "dummy", ZERO_ADDRESS, false);
            });
            it("when initialized with wrong array length for isLocked array", async () => {
                await expectRevert(
                    nexus.initialize(
                        [keccak256("dummy")],
                        [sa.default],
                        [true, false],
                        sa.governor,
                        {
                            from: sa.governor,
                        },
                    ),
                    "Insufficient locked statuses",
                );
                await expectInModules(nexus, "dummy", ZERO_ADDRESS, false);
            });

            it("when already initialized", async () => {
                await nexus.initialize([keccak256("dummy1")], [sa.dummy1], [true], sa.governor, {
                    from: sa.governor,
                });
                await expectInModules(nexus, "dummy1", sa.dummy1, true);
                // must fail
                await expectRevert(
                    nexus.initialize([keccak256("dummy")], [sa.default], [true], sa.governor, {
                        from: sa.governor,
                    }),
                    "Nexus is already initialized",
                );
                await expectInModules(nexus, "dummy1", sa.dummy1, true);
            });
        });
    });

    beforeEach("Init contract", async () => {
        nexus = await systemMachine.deployNexus();
        await nexus.initialize(
            [keccak256("dummy3"), keccak256("dummy4")],
            [sa.dummy3, sa.dummy4],
            [true, false],
            sa.governor,
            { from: sa.governor },
        );
        await expectInModules(nexus, "dummy3", sa.dummy3, true);
        await expectInModules(nexus, "dummy4", sa.dummy4, false);
    });

    describe("proposeModule()", () => {
        context("should fail", () => {
            it("when not initialized", async () => {
                const initialized = await nexus.initialized();
                expect(initialized).to.equal(true);
            });
            it("when not called by Governor", async () => {
                await expectRevert(
                    nexus.proposeModule(keccak256("dummy"), sa.default, { from: sa.other }),
                    "GOV: caller is not the Governor",
                );
                await expectInProposedModules(nexus, "dummy", ZERO_ADDRESS, ZERO);
            });
            it("when empty key", async () => {
                await expectRevert(
                    nexus.proposeModule("0x00", sa.default, { from: sa.governor }),
                    "Key must not be zero",
                );
                await expectInProposedModules(nexus, "0x00", ZERO_ADDRESS, ZERO);
            });
            it("when zero address", async () => {
                await expectRevert(
                    nexus.proposeModule(keccak256("dummy"), ZERO_ADDRESS, { from: sa.governor }),
                    "Module address must not be 0",
                );
                await expectInProposedModules(nexus, "dummy", ZERO_ADDRESS, ZERO);
            });
            it("when module key & address are same", async () => {
                await expectInModules(nexus, "dummy4", sa.dummy4, false);
                await expectRevert(
                    nexus.proposeModule(keccak256("dummy4"), sa.dummy4, { from: sa.governor }),
                    "Module already has same address",
                );
                await expectInProposedModules(nexus, "dummy4", ZERO_ADDRESS, ZERO);
            });
            it("when module is locked (update for existing module)", async () => {
                await expectInModules(nexus, "dummy3", sa.dummy3, true);
                await expectRevert(
                    nexus.proposeModule(keccak256("dummy3"), sa.other, { from: sa.governor }),
                    "Module must be unlocked",
                );
                await expectInProposedModules(nexus, "dummy3", ZERO_ADDRESS, ZERO);
            });
            it("when module already proposed", async () => {
                await nexus.proposeModule(keccak256("dummy2"), sa.dummy2, { from: sa.governor });
                const timestamp = await time.latest();
                await expectInProposedModules(nexus, "dummy2", sa.dummy2, timestamp);

                await expectRevert(
                    nexus.proposeModule(keccak256("dummy2"), sa.dummy3, { from: sa.governor }),
                    "Module already proposed",
                );
                await expectInProposedModules(nexus, "dummy2", sa.dummy2, timestamp);
            });
        });
        context("should succeed", () => {
            it("when a new module is proposed", async () => {
                await nexus.proposeModule(keccak256("dummy1"), sa.dummy1, { from: sa.governor });
                const lastTimestamp = await time.latest();

                await expectInProposedModules(nexus, "dummy1", sa.dummy1, lastTimestamp);
            });
            it("when an existing module address is updated", async () => {
                await expectInModules(nexus, "dummy4", sa.dummy4, false);

                // propose new address
                await nexus.proposeModule(keccak256("dummy4"), sa.other, { from: sa.governor });
                const lastTimestamp = await time.latest();

                await expectInProposedModules(nexus, "dummy4", sa.other, lastTimestamp);

                // address is not updated in modules mapping
                await expectInModules(nexus, "dummy4", sa.dummy4, false);
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
                await expectRevert(
                    nexus.cancelProposedModule(keccak256("dummy"), { from: sa.other }),
                    "GOV: caller is not the Governor",
                );
            });
            it("when proposed module not found", async () => {
                await expectRevert(
                    nexus.cancelProposedModule(keccak256("dummy"), { from: sa.governor }),
                    "Proposed module not found",
                );
            });
        });
        context("should succeed", () => {
            it("when cancelling existing proposed module", async () => {
                // propose a new module
                // =====================
                await nexus.proposeModule(keccak256("dummy1"), sa.dummy1, { from: sa.governor });
                // validate proposed module

                // validate dummy1 added
                const latestTimestamp = await time.latest();
                await expectInProposedModules(nexus, "dummy1", sa.dummy1, latestTimestamp);

                // validate dummy3 still exist
                await expectInModules(nexus, "dummy3", sa.dummy3, true);

                // cancel the module
                // ==================
                const tx = await nexus.cancelProposedModule(keccak256("dummy1"), {
                    from: sa.governor,
                });
                // validate cancelled
                await expectInProposedModules(nexus, "dummy1", ZERO_ADDRESS, ZERO);

                // expect event
                expectEvent(tx.receipt, "ModuleCancelled", {
                    key: padRight(keccak256("dummy1"), 64),
                });

                // validate dummy3 still exist
                await expectInModules(nexus, "dummy3", sa.dummy3, true);
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
                await expectRevert(
                    nexus.acceptProposedModule(keccak256("dummy"), { from: sa.other }),
                    "GOV: caller is not the Governor",
                );
            });
            it("when non existing key passed", async () => {
                await expectRevert(
                    nexus.acceptProposedModule(keccak256("dummy"), { from: sa.governor }),
                    "Module upgrade delay not over",
                );
            });
            it("when delay not over", async () => {
                await nexus.proposeModule(keccak256("dummy1"), sa.dummy1, { from: sa.governor });
                const timeWhenModuleProposed = await time.latest();
                await time.increase(ONE_DAY);
                await expectRevert(
                    nexus.acceptProposedModule(keccak256("dummy1"), { from: sa.governor }),
                    "Module upgrade delay not over",
                );

                // validate
                await expectInProposedModules(nexus, "dummy1", sa.dummy1, timeWhenModuleProposed);

                // validate module still not accepted
                await expectInModules(nexus, "dummy1", ZERO_ADDRESS, false);
            });
        });
        context("should succeed", () => {
            it("when accepted after delay is over", async () => {
                await nexus.proposeModule(keccak256("dummy1"), sa.dummy1, { from: sa.governor });
                const timeWhenModuleProposed = await time.latest();

                // validate
                await expectInProposedModules(nexus, "dummy1", sa.dummy1, timeWhenModuleProposed);

                await time.increase(ONE_WEEK);
                await nexus.acceptProposedModule(keccak256("dummy1"), { from: sa.governor });

                // validate module accepted
                await expectInModules(nexus, "dummy1", sa.dummy1, false);

                // validate data deleted from proposedModules map
                await expectInProposedModules(nexus, "dummy1", ZERO_ADDRESS, ZERO);
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
                await expectRevert(
                    nexus.acceptProposedModules([keccak256("dummy")], { from: sa.other }),
                    "GOV: caller is not the Governor",
                );
            });
            it("when empty array", async () => {
                await expectRevert(
                    nexus.acceptProposedModules([], { from: sa.governor }),
                    "Keys array empty",
                );
            });
            it("when non existing key passed", async () => {
                await expectRevert(
                    nexus.acceptProposedModules([keccak256("dummy")], { from: sa.governor }),
                    "Module upgrade delay not over",
                );
            });
            it("when module not proposed", async () => {
                await expectRevert(
                    nexus.acceptProposedModules([keccak256("dummy1")], { from: sa.governor }),
                    "Module upgrade delay not over",
                );
            });
            it("when module is locked", async () => {
                // update address request
                await expectInModules(nexus, "dummy4", sa.dummy4, false);
                await nexus.proposeModule(keccak256("dummy4"), sa.other, { from: sa.governor });
                const timestampWhenProposed = await time.latest();
                await expectInProposedModules(nexus, "dummy4", sa.other, timestampWhenProposed);
                await time.increase(ONE_DAY);
                // lock request
                await nexus.requestLockModule(keccak256("dummy4"), { from: sa.governor });
                await expectInProposedLockModules(nexus, "dummy4", await time.latest());

                await time.increase(ONE_WEEK);
                // module locked
                await nexus.lockModule(keccak256("dummy4"), { from: sa.governor });
                await expectInModules(nexus, "dummy4", sa.dummy4, true);

                // now accpet update request - must fail
                await expectRevert(
                    nexus.acceptProposedModules([keccak256("dummy4")], { from: sa.governor }),
                    "Module must be unlocked",
                );
                await expectInProposedModules(nexus, "dummy4", sa.other, timestampWhenProposed);
            });
            it("when address is already used by another module", async () => {
                // proposed new module - dummy1
                await nexus.proposeModule(keccak256("dummy1"), sa.dummy1, { from: sa.governor });
                await expectInProposedModules(nexus, "dummy1", sa.dummy1, await time.latest());

                // propose new module - dummy2 with dummy1 as address
                await nexus.proposeModule(keccak256("dummy2"), sa.dummy1, { from: sa.governor });
                await expectInProposedModules(nexus, "dummy2", sa.dummy1, await time.latest());

                await time.increase(ONE_WEEK);

                // dummy1 accepted
                await nexus.acceptProposedModules([keccak256("dummy1")], { from: sa.governor });
                await expectInModules(nexus, "dummy1", sa.dummy1, false);

                // dummy2 must be rejected
                await expectRevert(
                    nexus.acceptProposedModules([keccak256("dummy2")], { from: sa.governor }),
                    "Modules must have unique addr",
                );
            });
            it("when delay is not over", async () => {
                await nexus.proposeModule(keccak256("dummy1"), sa.dummy1, { from: sa.governor });
                await time.increase(ONE_DAY);
                await expectRevert(
                    nexus.acceptProposedModules([keccak256("dummy1")], { from: sa.governor }),
                    "Module upgrade delay not over",
                );

                // not present in modules
                await expectInModules(nexus, "dummy1", ZERO_ADDRESS, false);
            });
            it("when delay is less then 10 second of opt out period", async () => {
                await nexus.proposeModule(keccak256("dummy1"), sa.dummy1, { from: sa.governor });
                await time.increase(ONE_WEEK.sub(new BN(10)));
                await expectRevert(
                    nexus.acceptProposedModules([keccak256("dummy1")], { from: sa.governor }),
                    "Module upgrade delay not over",
                );

                // not present in modules
                await expectInModules(nexus, "dummy1", ZERO_ADDRESS, false);
            });
        });
        context("should succeed", () => {
            it("when accepted a proposed Module", async () => {
                await nexus.proposeModule(keccak256("dummy1"), sa.dummy1, { from: sa.governor });
                await time.increase(ONE_WEEK);
                const tx = await nexus.acceptProposedModules([keccak256("dummy1")], {
                    from: sa.governor,
                });

                // validate event
                await expectEvent(tx.receipt, "ModuleAdded", {
                    key: padRight(keccak256("dummy1"), 64),
                    addr: sa.dummy1,
                    isLocked: false,
                });

                // validate - added in "modules" mapping
                await expectInModules(nexus, "dummy1", sa.dummy1, false);

                // validate - removed from "proposedModules" mapping
                await expectInProposedModules(nexus, "dummy1", ZERO_ADDRESS, ZERO);
            });
            it("when delay is more then 10 second of opt out period", async () => {
                await nexus.proposeModule(keccak256("dummy1"), sa.dummy1, { from: sa.governor });
                await time.increase(ONE_WEEK.add(new BN(10)));
                const tx = await nexus.acceptProposedModules([keccak256("dummy1")], {
                    from: sa.governor,
                });

                // validate event
                await expectEvent(tx.receipt, "ModuleAdded", {
                    key: padRight(keccak256("dummy1"), 64),
                    addr: sa.dummy1,
                    isLocked: false,
                });
            });
            it("when module address update request accepted", async () => {
                // validate - existing module present in "modules" mapping
                await expectInModules(nexus, "dummy4", sa.dummy4, false);

                await nexus.proposeModule(keccak256("dummy4"), sa.other, { from: sa.governor });

                await time.increase(ONE_WEEK);

                const tx = await nexus.acceptProposedModules([keccak256("dummy4")], {
                    from: sa.governor,
                });

                // validate event
                await expectEvent(tx.receipt, "ModuleAdded", {
                    key: padRight(keccak256("dummy4"), 64),
                    addr: sa.other,
                    isLocked: false,
                });

                // validate - added in "modules" mapping
                await expectInModules(nexus, "dummy4", sa.other, false);

                // validate - removed from "proposedModules" mapping
                await expectInProposedModules(nexus, "dummy4", ZERO_ADDRESS, ZERO);
            });
        });
    });

    describe("requestLockModule()", () => {
        context("should fail", () => {
            it("when not initialized", async () => {
                const initialized = await nexus.initialized();
                expect(initialized).to.equal(true);
            });
            it("when not called by the Governor", async () => {
                await expectRevert(
                    nexus.requestLockModule(keccak256("dummy"), { from: sa.other }),
                    "GOV: caller is not the Governor",
                );
            });
            it("when module not exist", async () => {
                await expectRevert(
                    nexus.requestLockModule(keccak256("dummy"), { from: sa.governor }),
                    "Module must exist",
                );
            });
            it("when module key is zero", async () => {
                await expectRevert(
                    nexus.requestLockModule("0x00", { from: sa.governor }),
                    "Module must exist",
                );
            });
            it("when module already locked", async () => {
                await expectRevert(
                    nexus.requestLockModule(keccak256("dummy3"), { from: sa.governor }),
                    "Module must be unlocked",
                );
            });
            it("when locked already proposed", async () => {
                // lock proposed
                nexus.requestLockModule(keccak256("dummy4"), { from: sa.governor });
                await expectRevert(
                    nexus.requestLockModule(keccak256("dummy4"), { from: sa.governor }),
                    "Lock already proposed",
                );
            });
        });
        context("should succeed", () => {
            it("when a fresh lock request initiated", async () => {
                // lock proposed
                const tx = await nexus.requestLockModule(keccak256("dummy4"), {
                    from: sa.governor,
                });
                const latestTimestamp = await time.latest();
                expectEvent(tx.receipt, "ModuleLockRequested", {
                    key: padRight(keccak256("dummy4"), 64),
                    timestamp: latestTimestamp,
                });
                const requestTimestamp = await nexus.proposedLockModules(keccak256("dummy4"));
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
                await expectRevert(
                    nexus.cancelLockModule(keccak256("dummy"), { from: sa.other }),
                    "GOV: caller is not the Governor",
                );
            });
            it("when not proposed lock before", async () => {
                await expectRevert(
                    nexus.cancelLockModule(keccak256("dummy"), { from: sa.governor }),
                    "Module lock request not found",
                );
            });
            it("when zero key", async () => {
                await expectRevert(
                    nexus.cancelLockModule("0x00", { from: sa.governor }),
                    "Module lock request not found",
                );
            });
            it("when lock request not found", async () => {
                await expectRevert(
                    nexus.cancelLockModule(keccak256("dummy4"), { from: sa.governor }),
                    "Module lock request not found",
                );
            });
        });
        context("should succeed", () => {
            it("when a valid cancel lock request", async () => {
                await expectInProposedLockModules(nexus, "dummy4", ZERO);

                await nexus.requestLockModule(keccak256("dummy4"), { from: sa.governor });

                const latestTimestamp = await time.latest();
                await expectInProposedLockModules(nexus, "dummy4", latestTimestamp);

                const tx = await nexus.cancelLockModule(keccak256("dummy4"), { from: sa.governor });

                // validate event
                expectEvent(tx.receipt, "ModuleLockCancelled", {
                    key: padRight(keccak256("dummy4"), 64),
                });

                await expectInProposedLockModules(nexus, "dummy4", ZERO);

                await expectInModules(nexus, "dummy4", sa.dummy4, false);
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
                await expectRevert(
                    nexus.lockModule(keccak256("dummy"), { from: sa.other }),
                    "GOV: caller is not the Governor",
                );
            });
            it("when not existing key passed", async () => {
                await expectRevert(
                    nexus.lockModule(keccak256("dummy"), { from: sa.governor }),
                    "Delay not over",
                );
            });
            it("when delay not over", async () => {
                await nexus.requestLockModule(keccak256("dummy4"), { from: sa.governor });
                await time.increase(ONE_DAY);
                await expectRevert(
                    nexus.lockModule(keccak256("dummy4"), { from: sa.governor }),
                    "Delay not over",
                );
            });
            it("when delay is less then 10 second of opt out period", async () => {
                await nexus.requestLockModule(keccak256("dummy4"), { from: sa.governor });
                await time.increase(ONE_WEEK.sub(new BN(10)));
                await expectRevert(
                    nexus.lockModule(keccak256("dummy4"), { from: sa.governor }),
                    "Delay not over",
                );
            });
        });
        context("should succeed", () => {
            it("when a valid lock Module", async () => {
                await expectInModules(nexus, "dummy4", sa.dummy4, false);

                await nexus.requestLockModule(keccak256("dummy4"), { from: sa.governor });
                await expectInProposedLockModules(nexus, "dummy4", await time.latest());

                await time.increase(ONE_WEEK);

                const tx = await nexus.lockModule(keccak256("dummy4"), { from: sa.governor });
                // validate event
                expectEvent(tx.receipt, "ModuleLockEnabled", {
                    key: padRight(keccak256("dummy4"), 64),
                });

                await expectInModules(nexus, "dummy4", sa.dummy4, true);
            });
            it("when delay is more then 10 second of opt out period", async () => {
                await expectInModules(nexus, "dummy4", sa.dummy4, false);

                await nexus.requestLockModule(keccak256("dummy4"), { from: sa.governor });
                await expectInProposedLockModules(nexus, "dummy4", await time.latest());

                await time.increase(ONE_WEEK.add(new BN(10)));

                const tx = await nexus.lockModule(keccak256("dummy4"), { from: sa.governor });
                await expectInProposedLockModules(nexus, "dummy4", ZERO);
                // validate event
                expectEvent(tx.receipt, "ModuleLockEnabled", {
                    key: padRight(keccak256("dummy4"), 64),
                });

                await expectInModules(nexus, "dummy4", sa.dummy4, true);
            });
        });
    });

    describe("moduleExists()", () => {
        context("should return false", () => {
            it("when key not exist", async () => {
                const result = await nexus.moduleExists(keccak256("dummy"));
                expect(result).to.equal(false);
            });
            it("when key is zero", async () => {
                const result = await nexus.moduleExists("0x00");
                expect(result).to.equal(false);
            });
        });
        context("should return true", () => {
            it("when a valid module key", async () => {
                const result = await nexus.moduleExists(keccak256("dummy3"));
                expect(result).to.equal(true);
            });
        });
    });

    describe("Extra tests", () => {
        context("should not allow", () => {
            it("proposeModule + requestLockModule for a same key", async () => {
                await nexus.proposeModule(keccak256("dummy1"), sa.dummy1, { from: sa.governor });
                await expectInProposedModules(nexus, "dummy1", sa.dummy1, await time.latest());
                await expectInModules(nexus, "dummy1", ZERO_ADDRESS, false);

                await time.increase(ONE_WEEK);

                await nexus.acceptProposedModule(keccak256("dummy1"), { from: sa.governor });
                await expectInModules(nexus, "dummy1", sa.dummy1, false);

                await nexus.requestLockModule(keccak256("dummy1"), { from: sa.governor });
                await expectInProposedLockModules(nexus, "dummy1", await time.latest());

                await time.increase(ONE_WEEK);

                await nexus.lockModule(keccak256("dummy1"), { from: sa.governor });
                await expectInProposedLockModules(nexus, "dummy1", ZERO);
                await expectInModules(nexus, "dummy1", sa.dummy1, true);
            });
        });
        context("should succeed", () => {
            it("when propose a module, cancel it and then propose the same module it again", async () => {
                await nexus.proposeModule(keccak256("dummy1"), sa.dummy1, { from: sa.governor });
                await expectInProposedModules(nexus, "dummy1", sa.dummy1, await time.latest());
                await expectInModules(nexus, "dummy1", ZERO_ADDRESS, false);

                await nexus.cancelProposedModule(keccak256("dummy1"), { from: sa.governor });
                await expectInProposedModules(nexus, "dummy1", ZERO_ADDRESS, ZERO);
                await expectInModules(nexus, "dummy1", ZERO_ADDRESS, false);

                await nexus.proposeModule(keccak256("dummy1"), sa.dummy1, { from: sa.governor });
                await expectInProposedModules(nexus, "dummy1", sa.dummy1, await time.latest());
                await expectInModules(nexus, "dummy1", ZERO_ADDRESS, false);
            });
            it("can propose multiple modules and cancel one, and accept one, and leave one", async () => {
                await nexus.proposeModule(keccak256("dummy1"), sa.dummy1, { from: sa.governor });
                await expectInProposedModules(nexus, "dummy1", sa.dummy1, await time.latest());
                await expectInModules(nexus, "dummy1", ZERO_ADDRESS, false);

                await nexus.proposeModule(keccak256("dummy2"), sa.dummy2, { from: sa.governor });
                await expectInProposedModules(nexus, "dummy2", sa.dummy2, await time.latest());
                await expectInModules(nexus, "dummy2", ZERO_ADDRESS, false);

                await nexus.proposeModule(keccak256("other"), sa.other, { from: sa.governor });
                const timestampOther = await time.latest();
                await expectInProposedModules(nexus, "other", sa.other, timestampOther);
                await expectInModules(nexus, "other", ZERO_ADDRESS, false);

                await time.increase(ONE_WEEK);

                // accept
                await nexus.acceptProposedModule(keccak256("dummy1"), { from: sa.governor });
                await expectInProposedModules(nexus, "dummy1", ZERO_ADDRESS, ZERO);
                await expectInModules(nexus, "dummy1", sa.dummy1, false);

                // cancel
                await nexus.cancelProposedModule(keccak256("dummy2"), { from: sa.governor });
                await expectInProposedModules(nexus, "dummy2", ZERO_ADDRESS, ZERO);
                await expectInModules(nexus, "dummy2", ZERO_ADDRESS, false);

                // "other" is un-affected
                await expectInProposedModules(nexus, "other", sa.other, timestampOther);
                await expectInModules(nexus, "other", ZERO_ADDRESS, false);
            });
        });
    });
});
