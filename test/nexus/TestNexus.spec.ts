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

const { ZERO_ADDRESS } = constants;
const Nexus = artifacts.require("Nexus");

envSetup.configure();
const { expect, assert } = chai;

contract("Nexus", async (accounts) => {
    const sa = new StandardAccounts(accounts);
    let systemMachine: SystemMachine;
    let nexus: NexusInstance;

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

    beforeEach("Init contract", async () => {
        systemMachine = new SystemMachine(accounts, sa.other);
        nexus = await systemMachine.deployNexus();
    });

    describe("Setup", () => {
        it("should have correct default parameters", async () => {
            const governor = await nexus.governor();
            const initialized = await nexus.initialized();
            const upgradeDelay = await nexus.UPGRADE_DELAY();
            expect(governor).to.equal(sa.governor);
            expect(initialized).to.equal(false);
            const A_WEEK = new BN(60 * 60 * 24 * 7);
            expect(upgradeDelay).to.bignumber.equals(A_WEEK);
        });
    });

    describe("initialize()", () => {
        context("Should Succeed", () => {
            it("with default module", async () => {
                //await systemMachine.initialiseMocks();
                //const newNexus = systemMachine.nexus;

            });
            it("with all modules");
            it("default with locked Systok module");
            it("default with unlocked module");
            it("only allowed with governor", async () => {
                await nexus.initialize(
                    [aToH("dummy")],
                    [sa._],
                    [true],
                    sa.governor,
                    { from: sa.governor },
                );
            });
            it("allowed to set new governor address", async () => {
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
            it("should be initialized");
        });
        context("Should Fail", () => {
            it("not initialize other than governor", async () => {
                await shouldFail.reverting.withMessage(
                    nexus.initialize([], [], [], sa.governor),
                    "GOV: caller is not the Governor",
                );
            });
            it("not initialize with same module address");
            it("not initialize with same address for different modules");
            it("not initialize when empty array", async () => {
                await shouldFail.reverting.withMessage(
                    nexus.initialize([], [], [], sa.governor, { from: sa.governor }),
                    "No keys provided",
                );
            });
            it("not initialize when wrong array length for addresses array", async () => {
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
            it("not initialize when wrong array length for isLocked array", async () => {
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
        context("should Fail", () => {
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
                await nexus.initialize(
                    [aToH("dummy")],
                    [sa.other],
                    [false], // not locked
                    sa.governor,
                    { from: sa.governor },
                );
                await shouldFail.reverting.withMessage(
                    nexus.proposeModule(aToH("dummy"), sa.other, { from: sa.governor }),
                    "Module already has same address",
                );
            });
            it("when module is locked (update for existing module)", async () => {
                await nexus.initialize(
                    [aToH("dummy")],
                    [sa._],
                    [true], // locked
                    sa.governor,
                    { from: sa.governor },
                );
                await shouldFail.reverting.withMessage(
                    nexus.proposeModule(aToH("dummy"), sa.other, { from: sa.governor }),
                    "Module must be unlocked",
                );
            });
            it("when module already proposed", async () => {
                await nexus.initialize(
                    [aToH("dummy")],
                    [sa.dummy1],
                    [false], // not locked
                    sa.governor,
                    { from: sa.governor },
                );
                await nexus.proposeModule(aToH("dummy"), sa.dummy2, { from: sa.governor });
                await shouldFail.reverting.withMessage(
                    nexus.proposeModule(aToH("dummy"), sa.dummy3, { from: sa.governor }),
                    "Module already proposed",
                );
            });
        });
        context("Should Succeed", () => {
            it("when called by Governor");
            it("when a new module is proposed");
            it("when an existing module address is updated");
        });
    });

    describe("cancelProposedModule()", () => {
        context("Should Fail", () => {
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
        context("Should Succeed", () => {
            it("when called by Governor");
            it("when cancelling existing proposed module"); // validate deleted entry + event
            it("during opt out period");
            it("after opt out period");
            it("should remove the proposed module from mapping");
        });
    });

    describe("acceptProposedModule()", () => {
        context("Should Fail", () => {
            it("when not called by Governor", async () => {
                await shouldFail.reverting.withMessage(
                    nexus.acceptProposedModule(aToH("dummy"), { from: sa.other }),
                    "GOV: caller is not the Governor",
                );
            });
        });
        context("Should Succeed", () => {
            it("when called by Governor");
        });
    });

    describe("acceptProposedModules()", () => {
        context("Should Fail", () => {
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
            it("when module not proposed");
            it("when module is locked");
            it("when address is already used by another module");
            it("when delay is not over");
            it("when new proposed address is zero");
            it("when delay is less then 1 second of opt out period");
            it("when delay is equal to opt out period");
        });
        context("Should Succeed", () => {
            it("when called by Governor");
            it("when accepted already proposed Module"); // validate event
            it("when delay is more then 1 second of opt out period");
            it("should remove the proposed module from mapping");
            it("should remove the old address from the system");
            it("should set new module info");
        });
    });

    describe("requestLockModule()", () => {
        context("Should Fail", () => {
            it("when not initialized");
            it("when not called by Governor", async () => {
                await shouldFail.reverting.withMessage(
                    nexus.requestLockModule(aToH("dummy"), { from: sa.other }),
                    "GOV: caller is not the Governor",
                );
            });
            it("when empty key");
            it("when module not exist", async () => {
                await shouldFail.reverting.withMessage(
                    nexus.requestLockModule(aToH("dummy"), { from: sa.governor }),
                    "Module must exist",
                );
            });
            it("when module already locked");
            it("when locked already proposed");
        });
        context("Should Succeed", () => {
            it("when called by Governor");
            it("when a valid lock request"); // validate event
        });
    });

    describe("cancelLockModule()", () => {
        context("Should Fail", () => {
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
        });
        context("Should Succeed", () => {
            it("when called by Governor");
            it("when a valid cancel lock request"); // validate event
            it("during opt out period");
            it("after opt out period");
        });
    });

    describe("lockModule()", () => {
        context("Should Fail", () => {
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
            it("when lock not proposed before");
            it("when delay not over");
            it("when delay is less then 1 second of opt out period");
            it("when delay is equal to opt out period");
        });
        context("Should Succeed", () => {
            it("when called by Governor");
            it("when a valid lock Module"); // validate event
            it("when delay is more then 1 second of opt out period");
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
                await nexus.initialize(
                    [aToH("dummy")],
                    [sa._],
                    [true],
                    sa.governor,
                    { from: sa.governor },
                );
                const result = await nexus.moduleExists(aToH("dummy"));
                expect(result).to.equal(true);
            });
        });
    });

    describe("Extra tests", () => {
        context("should not allow", () => {
            it("having same address with different module keys");
            it("proposeModule + requestLockModule for a same key");
        });
    });
});
