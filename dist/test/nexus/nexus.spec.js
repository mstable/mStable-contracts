"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const utils_1 = require("ethers/lib/utils");
const hardhat_1 = require("hardhat");
const machines_1 = require("@utils/machines");
const math_1 = require("@utils/math");
const generated_1 = require("types/generated");
const time_1 = require("@utils/time");
const constants_1 = require("@utils/constants");
const DelayedClaimableGovernor_behaviour_1 = require("../governance/DelayedClaimableGovernor.behaviour");
const ClaimableGovernor_behaviour_1 = require("../governance/ClaimableGovernor.behaviour");
/** @dev Uses generic module getter to validate that a module exists with the specified properties */
async function expectInModules(nexus, _key, _addr, _isLocked) {
    /* eslint-disable prefer-const */
    let addr;
    let isLocked;
    [addr, isLocked] = await nexus.modules(utils_1.keccak256(utils_1.toUtf8Bytes(_key)));
    chai_1.expect(addr, "Module address not matched").to.equal(_addr);
    chai_1.expect(isLocked, "Module isLocked not matched").to.equal(_isLocked);
    const exists = await nexus.moduleExists(utils_1.keccak256(utils_1.toUtf8Bytes(_key)));
    if (addr !== constants_1.ZERO_ADDRESS) {
        chai_1.expect(exists).to.equal(true);
    }
    else {
        chai_1.expect(exists).to.equal(false);
    }
}
async function expectInProposedModules(nexus, _key, _newAddress, _timestamp) {
    let newAddress;
    let timestamp;
    [newAddress, timestamp] = await nexus.proposedModules(utils_1.keccak256(utils_1.toUtf8Bytes(_key)));
    /* eslint-enable prefer-const */
    chai_1.expect(newAddress, "New address not matched in proposed modules").to.equal(_newAddress);
    chai_1.expect(timestamp, "The timestamp not matched in proposed modules").to.equal(_timestamp);
}
async function expectInProposedLockModules(nexus, _key, _timestamp) {
    const timestamp = await nexus.proposedLockModules(utils_1.keccak256(utils_1.toUtf8Bytes(_key)));
    chai_1.expect(timestamp, "The timestamp not matched in proposed lock modules").to.equal(_timestamp);
}
async function deployNexus(sa) {
    return new generated_1.Nexus__factory(sa.governor.signer).deploy(sa.governor.address);
}
describe("Nexus", () => {
    let sa;
    let nexus;
    describe("Behavior like...", () => {
        const ctx = {};
        before(async () => {
            const accounts = await hardhat_1.ethers.getSigners();
            const mAssetMachine = await new machines_1.MassetMachine().initAccounts(accounts);
            sa = mAssetMachine.sa;
            ctx.default = sa.default;
            ctx.governor = sa.governor;
            ctx.other = sa.other;
        });
        beforeEach("Init contract", async () => {
            ctx.claimable = (await deployNexus(sa));
        });
        context("should behave like ClaimableGovernor", () => {
            ClaimableGovernor_behaviour_1.shouldBehaveLikeClaimable(ctx);
        });
        context("should behave like DelayedClaimableGovernor", () => {
            beforeEach("", async () => {
                const { other } = sa;
                await ctx.claimable.connect(sa.governor.signer).requestGovernorChange(other.address);
            });
            DelayedClaimableGovernor_behaviour_1.shouldBehaveLikeDelayedClaimable(ctx);
        });
    });
    describe("Before initialize", () => {
        it("should have correct default parameters", async () => {
            // Deploy new nexus
            nexus = await deployNexus(sa);
            const governor = await nexus.governor();
            const initialized = await nexus.initialized();
            const upgradeDelay = await nexus.UPGRADE_DELAY();
            chai_1.expect(governor).to.equal(sa.governor.address);
            chai_1.expect(initialized).to.equal(false);
            chai_1.expect(upgradeDelay).to.equal(constants_1.ONE_WEEK);
        });
    });
    describe("initialize()", () => {
        beforeEach("deploy nexus instance", async () => {
            // Deploy new nexus, to override
            nexus = await deployNexus(sa);
        });
        context("should succeed", () => {
            it("with default modules", async () => {
                await nexus.initialize([constants_1.KEY_SAVINGS_MANAGER], [sa.mockSavingsManager.address], [false], sa.governor.address);
                // initialized
                const initialized = await nexus.initialized();
                chai_1.expect(initialized).to.equal(true);
                // validate modules
                await expectInModules(nexus, "SavingsManager", sa.mockSavingsManager.address, false);
            });
            it("when current governor called the function", async () => {
                await nexus
                    .connect(sa.governor.signer)
                    .initialize([utils_1.keccak256(utils_1.toUtf8Bytes("dummy1"))], [sa.dummy1.address], [true], sa.governor.address);
                await expectInModules(nexus, "dummy1", sa.dummy1.address, true);
            });
            it("when different governor address passed", async () => {
                const govBefore = await nexus.governor();
                await nexus
                    .connect(sa.governor.signer)
                    .initialize([utils_1.keccak256(utils_1.toUtf8Bytes("dummy"))], [sa.default.address], [true], sa.other.address);
                await expectInModules(nexus, "dummy", sa.default.address, true);
                const govAfter = await nexus.governor();
                chai_1.expect(govBefore).to.not.equal(govAfter);
                chai_1.expect(govBefore).to.equal(sa.governor.address);
                chai_1.expect(govAfter).to.equal(sa.other.address);
            });
        });
        context("should fail", () => {
            it("when called by other than governor", async () => {
                await chai_1.expect(nexus.connect(sa.default.signer).initialize([], [], [], sa.governor.address)).to.be.revertedWith("GOV: caller is not the Governor");
            });
            it("when initialized with same address for different modules", async () => {
                await chai_1.expect(nexus
                    .connect(sa.governor.signer)
                    .initialize([utils_1.keccak256(utils_1.toUtf8Bytes("dummy1")), utils_1.keccak256(utils_1.toUtf8Bytes("dummy2"))], [sa.dummy1.address, sa.dummy1.address], [false, false], sa.governor.address)).to.be.revertedWith("Modules must have unique addr");
                await expectInModules(nexus, "dummy1", constants_1.ZERO_ADDRESS, false);
                await expectInModules(nexus, "dummy2", constants_1.ZERO_ADDRESS, false);
            });
            it("when initialized with an empty array", async () => {
                await chai_1.expect(nexus.connect(sa.governor.signer).initialize([], [], [], sa.governor.address)).to.be.revertedWith("No keys provided");
            });
            it("when initialized with wrong array length for addresses array", async () => {
                await chai_1.expect(nexus
                    .connect(sa.governor.signer)
                    .initialize([utils_1.keccak256(utils_1.toUtf8Bytes("dummy"))], [sa.default.address, sa.other.address], [true], sa.governor.address)).to.be.revertedWith("Insufficient address data");
                await expectInModules(nexus, "dummy", constants_1.ZERO_ADDRESS, false);
            });
            it("when initialized with wrong array length for isLocked array", async () => {
                await chai_1.expect(nexus
                    .connect(sa.governor.signer)
                    .initialize([utils_1.keccak256(utils_1.toUtf8Bytes("dummy"))], [sa.default.address], [true, false], sa.governor.address)).to.be.revertedWith("Insufficient locked statuses");
                await expectInModules(nexus, "dummy", constants_1.ZERO_ADDRESS, false);
            });
            it("when already initialized", async () => {
                await nexus
                    .connect(sa.governor.signer)
                    .initialize([utils_1.keccak256(utils_1.toUtf8Bytes("dummy1"))], [sa.dummy1.address], [true], sa.governor.address);
                await expectInModules(nexus, "dummy1", sa.dummy1.address, true);
                // must fail
                await chai_1.expect(nexus
                    .connect(sa.governor.signer)
                    .initialize([utils_1.keccak256(utils_1.toUtf8Bytes("dummy"))], [sa.default.address], [true], sa.governor.address)).to.be.revertedWith("Nexus is already initialized");
                await expectInModules(nexus, "dummy1", sa.dummy1.address, true);
            });
        });
    });
    beforeEach("Init contract", async () => {
        nexus = await deployNexus(sa);
        await nexus
            .connect(sa.governor.signer)
            .initialize([utils_1.keccak256(utils_1.toUtf8Bytes("dummy3")), utils_1.keccak256(utils_1.toUtf8Bytes("dummy4"))], [sa.dummy3.address, sa.dummy4.address], [true, false], sa.governor.address);
        await expectInModules(nexus, "dummy3", sa.dummy3.address, true);
        await expectInModules(nexus, "dummy4", sa.dummy4.address, false);
    });
    describe("proposeModule()", () => {
        context("should fail", () => {
            it("when not initialized", async () => {
                const initialized = await nexus.initialized();
                chai_1.expect(initialized).to.equal(true);
            });
            it("when not called by Governor", async () => {
                await chai_1.expect(nexus.connect(sa.other.signer).proposeModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy")), sa.default.address)).to.be.revertedWith("GOV: caller is not the Governor");
                await expectInProposedModules(nexus, "dummy", constants_1.ZERO_ADDRESS, constants_1.ZERO);
            });
            it("when empty key", async () => {
                await chai_1.expect(nexus.connect(sa.governor.signer).proposeModule(constants_1.ZERO_KEY, sa.default.address)).to.be.revertedWith("Key must not be zero");
                await expectInProposedModules(nexus, constants_1.ZERO_KEY, constants_1.ZERO_ADDRESS, constants_1.ZERO);
            });
            it("when zero address", async () => {
                await chai_1.expect(nexus.connect(sa.governor.signer).proposeModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy")), constants_1.ZERO_ADDRESS)).to.be.revertedWith("Module address must not be 0");
                await expectInProposedModules(nexus, "dummy", constants_1.ZERO_ADDRESS, constants_1.ZERO);
            });
            it("when module key & address are same", async () => {
                await expectInModules(nexus, "dummy4", sa.dummy4.address, false);
                await chai_1.expect(nexus.connect(sa.governor.signer).proposeModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy4")), sa.dummy4.address)).to.be.revertedWith("Module already has same address");
                await expectInProposedModules(nexus, "dummy4", constants_1.ZERO_ADDRESS, constants_1.ZERO);
            });
            it("when module is locked (update for existing module)", async () => {
                await expectInModules(nexus, "dummy3", sa.dummy3.address, true);
                await chai_1.expect(nexus.connect(sa.governor.signer).proposeModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy3")), sa.other.address)).to.be.revertedWith("Module must be unlocked");
                await expectInProposedModules(nexus, "dummy3", constants_1.ZERO_ADDRESS, constants_1.ZERO);
            });
            it("when module already proposed", async () => {
                await nexus.connect(sa.governor.signer).proposeModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy2")), sa.dummy2.address);
                const timestamp = await time_1.getTimestamp();
                await expectInProposedModules(nexus, "dummy2", sa.dummy2.address, timestamp);
                await chai_1.expect(nexus.connect(sa.governor.signer).proposeModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy2")), sa.dummy3.address)).to.be.revertedWith("Module already proposed");
                await expectInProposedModules(nexus, "dummy2", sa.dummy2.address, timestamp);
            });
        });
        context("should succeed", () => {
            it("when a new module is proposed", async () => {
                await nexus.connect(sa.governor.signer).proposeModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy1")), sa.dummy1.address);
                const lastTimestamp = await time_1.getTimestamp();
                await expectInProposedModules(nexus, "dummy1", sa.dummy1.address, lastTimestamp);
            });
            it("when an existing module address is updated", async () => {
                await expectInModules(nexus, "dummy4", sa.dummy4.address, false);
                // propose new address
                await nexus.connect(sa.governor.signer).proposeModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy4")), sa.other.address);
                const lastTimestamp = await time_1.getTimestamp();
                await expectInProposedModules(nexus, "dummy4", sa.other.address, lastTimestamp);
                // address is not updated in modules mapping
                await expectInModules(nexus, "dummy4", sa.dummy4.address, false);
            });
        });
    });
    describe("cancelProposedModule()", () => {
        context("should fail", () => {
            it("when not initialized", async () => {
                const initialized = await nexus.initialized();
                chai_1.expect(initialized).to.equal(true);
            });
            it("when not called by Governor", async () => {
                await chai_1.expect(nexus.connect(sa.other.signer).cancelProposedModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy")))).to.be.revertedWith("GOV: caller is not the Governor");
            });
            it("when proposed module not found", async () => {
                await chai_1.expect(nexus.connect(sa.governor.signer).cancelProposedModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy")))).to.be.revertedWith("Proposed module not found");
            });
        });
        context("should succeed", () => {
            it("when cancelling existing proposed module", async () => {
                // propose a new module
                // =====================
                await nexus.connect(sa.governor.signer).proposeModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy1")), sa.dummy1.address);
                // validate proposed module
                // validate dummy1 added
                const latestTimestamp = await time_1.getTimestamp();
                await expectInProposedModules(nexus, "dummy1", sa.dummy1.address, latestTimestamp);
                // validate dummy3 still exist
                await expectInModules(nexus, "dummy3", sa.dummy3.address, true);
                // cancel the module
                // ==================
                const tx = nexus.connect(sa.governor.signer).cancelProposedModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy1")));
                // expect event
                await chai_1.expect(tx)
                    .to.emit(nexus, "ModuleCancelled")
                    .withArgs(utils_1.hexlify(utils_1.keccak256(utils_1.toUtf8Bytes("dummy1"))));
                // validate cancelled
                await expectInProposedModules(nexus, "dummy1", constants_1.ZERO_ADDRESS, constants_1.ZERO);
                // validate dummy3 still exist
                await expectInModules(nexus, "dummy3", sa.dummy3.address, true);
            });
        });
    });
    describe("acceptProposedModule()", () => {
        context("should fail", () => {
            it("when not initialized", async () => {
                const initialized = await nexus.initialized();
                chai_1.expect(initialized).to.equal(true);
            });
            it("when not called by Governor", async () => {
                await chai_1.expect(nexus.connect(sa.other.signer).acceptProposedModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy")))).to.be.revertedWith("GOV: caller is not the Governor");
            });
            it("when non existing key passed", async () => {
                await chai_1.expect(nexus.connect(sa.governor.signer).acceptProposedModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy")))).to.be.revertedWith("Module upgrade delay not over");
            });
            it("when delay not over", async () => {
                await nexus.connect(sa.governor.signer).proposeModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy1")), sa.dummy1.address);
                const timeWhenModuleProposed = await time_1.getTimestamp();
                await time_1.increaseTime(constants_1.ONE_DAY);
                await chai_1.expect(nexus.connect(sa.governor.signer).acceptProposedModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy1")))).to.be.revertedWith("Module upgrade delay not over");
                // validate
                await expectInProposedModules(nexus, "dummy1", sa.dummy1.address, timeWhenModuleProposed);
                // validate module still not accepted
                await expectInModules(nexus, "dummy1", constants_1.ZERO_ADDRESS, false);
            });
        });
        context("should succeed", () => {
            it("when accepted after delay is over", async () => {
                await nexus.connect(sa.governor.signer).proposeModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy1")), sa.dummy1.address);
                const timeWhenModuleProposed = await time_1.getTimestamp();
                // validate
                await expectInProposedModules(nexus, "dummy1", sa.dummy1.address, timeWhenModuleProposed);
                await time_1.increaseTime(constants_1.ONE_WEEK);
                await nexus.connect(sa.governor.signer).acceptProposedModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy1")));
                // validate module accepted
                await expectInModules(nexus, "dummy1", sa.dummy1.address, false);
                // validate data deleted from proposedModules map
                await expectInProposedModules(nexus, "dummy1", constants_1.ZERO_ADDRESS, constants_1.ZERO);
            });
        });
    });
    describe("acceptProposedModules()", () => {
        context("should fail", () => {
            it("when not initialized", async () => {
                const initialized = await nexus.initialized();
                chai_1.expect(initialized).to.equal(true);
            });
            it("when not called by Governor", async () => {
                await chai_1.expect(nexus.connect(sa.other.signer).acceptProposedModules([utils_1.keccak256(utils_1.toUtf8Bytes("dummy"))])).to.be.revertedWith("GOV: caller is not the Governor");
            });
            it("when empty array", async () => {
                await chai_1.expect(nexus.connect(sa.governor.signer).acceptProposedModules([])).to.be.revertedWith("Keys array empty");
            });
            it("when non existing key passed", async () => {
                await chai_1.expect(nexus.connect(sa.governor.signer).acceptProposedModules([utils_1.keccak256(utils_1.toUtf8Bytes("dummy"))])).to.be.revertedWith("Module upgrade delay not over");
            });
            it("when module not proposed", async () => {
                await chai_1.expect(nexus.connect(sa.governor.signer).acceptProposedModules([utils_1.keccak256(utils_1.toUtf8Bytes("dummy1"))])).to.be.revertedWith("Module upgrade delay not over");
            });
            it("when module is locked", async () => {
                // update address request
                await expectInModules(nexus, "dummy4", sa.dummy4.address, false);
                await nexus.connect(sa.governor.signer).proposeModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy4")), sa.other.address);
                const timestampWhenProposed = await time_1.getTimestamp();
                await expectInProposedModules(nexus, "dummy4", sa.other.address, timestampWhenProposed);
                await time_1.increaseTime(constants_1.ONE_DAY);
                // lock request
                await nexus.connect(sa.governor.signer).requestLockModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy4")));
                await expectInProposedLockModules(nexus, "dummy4", await time_1.getTimestamp());
                await time_1.increaseTime(constants_1.ONE_WEEK);
                // module locked
                await nexus.connect(sa.governor.signer).lockModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy4")));
                await expectInModules(nexus, "dummy4", sa.dummy4.address, true);
                // now accpet update request - must fail
                await chai_1.expect(nexus.connect(sa.governor.signer).acceptProposedModules([utils_1.keccak256(utils_1.toUtf8Bytes("dummy4"))])).to.be.revertedWith("Module must be unlocked");
                await expectInProposedModules(nexus, "dummy4", sa.other.address, timestampWhenProposed);
            });
            it("when address is already used by another module", async () => {
                // proposed new module - dummy1
                await nexus.connect(sa.governor.signer).proposeModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy1")), sa.dummy1.address);
                await expectInProposedModules(nexus, "dummy1", sa.dummy1.address, await time_1.getTimestamp());
                // propose new module - dummy2 with dummy1 as address
                await nexus.connect(sa.governor.signer).proposeModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy2")), sa.dummy1.address);
                await expectInProposedModules(nexus, "dummy2", sa.dummy1.address, await time_1.getTimestamp());
                await time_1.increaseTime(constants_1.ONE_WEEK);
                // dummy1 accepted
                await nexus.connect(sa.governor.signer).acceptProposedModules([utils_1.keccak256(utils_1.toUtf8Bytes("dummy1"))]);
                await expectInModules(nexus, "dummy1", sa.dummy1.address, false);
                // dummy2 must be rejected
                await chai_1.expect(nexus.connect(sa.governor.signer).acceptProposedModules([utils_1.keccak256(utils_1.toUtf8Bytes("dummy2"))])).to.be.revertedWith("Modules must have unique addr");
            });
            it("when delay is not over", async () => {
                await nexus.connect(sa.governor.signer).proposeModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy1")), sa.dummy1.address);
                await time_1.increaseTime(constants_1.ONE_DAY);
                await chai_1.expect(nexus.connect(sa.governor.signer).acceptProposedModules([utils_1.keccak256(utils_1.toUtf8Bytes("dummy1"))])).to.be.revertedWith("Module upgrade delay not over");
                // not present in modules
                await expectInModules(nexus, "dummy1", constants_1.ZERO_ADDRESS, false);
            });
            it("when delay is less then 10 second of opt out period", async () => {
                await nexus.connect(sa.governor.signer).proposeModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy1")), sa.dummy1.address);
                await time_1.increaseTime(constants_1.ONE_WEEK.sub(math_1.BN.from(10)));
                await chai_1.expect(nexus.connect(sa.governor.signer).acceptProposedModules([utils_1.keccak256(utils_1.toUtf8Bytes("dummy1"))])).to.be.revertedWith("Module upgrade delay not over");
                // not present in modules
                await expectInModules(nexus, "dummy1", constants_1.ZERO_ADDRESS, false);
            });
        });
        context("should succeed", () => {
            it("when accepted a proposed Module", async () => {
                await nexus.connect(sa.governor.signer).proposeModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy1")), sa.dummy1.address);
                await time_1.increaseTime(constants_1.ONE_WEEK);
                const tx = nexus.connect(sa.governor.signer).acceptProposedModules([utils_1.keccak256(utils_1.toUtf8Bytes("dummy1"))]);
                // validate event
                await chai_1.expect(tx)
                    .to.emit(nexus, "ModuleAdded")
                    .withArgs(utils_1.hexlify(utils_1.keccak256(utils_1.toUtf8Bytes("dummy1"))), sa.dummy1.address, false);
                // validate - added in "modules" mapping
                await expectInModules(nexus, "dummy1", sa.dummy1.address, false);
                // validate - removed from "proposedModules" mapping
                await expectInProposedModules(nexus, "dummy1", constants_1.ZERO_ADDRESS, constants_1.ZERO);
            });
            it("when delay is more then 10 second of opt out period", async () => {
                await nexus.connect(sa.governor.signer).proposeModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy1")), sa.dummy1.address);
                await time_1.increaseTime(constants_1.ONE_WEEK.add(math_1.BN.from(10)));
                const tx = nexus.connect(sa.governor.signer).acceptProposedModules([utils_1.keccak256(utils_1.toUtf8Bytes("dummy1"))]);
                // validate event
                await chai_1.expect(tx)
                    .to.emit(nexus, "ModuleAdded")
                    .withArgs(utils_1.hexlify(utils_1.keccak256(utils_1.toUtf8Bytes("dummy1"))), sa.dummy1.address, false);
            });
            it("when module address update request accepted", async () => {
                // validate - existing module present in "modules" mapping
                await expectInModules(nexus, "dummy4", sa.dummy4.address, false);
                await nexus.connect(sa.governor.signer).proposeModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy4")), sa.other.address);
                await time_1.increaseTime(constants_1.ONE_WEEK);
                const tx = nexus.connect(sa.governor.signer).acceptProposedModules([utils_1.keccak256(utils_1.toUtf8Bytes("dummy4"))]);
                // validate event
                await chai_1.expect(tx)
                    .to.emit(nexus, "ModuleAdded")
                    .withArgs(utils_1.hexlify(utils_1.keccak256(utils_1.toUtf8Bytes("dummy4"))), sa.other.address, false);
                // validate - added in "modules" mapping
                await expectInModules(nexus, "dummy4", sa.other.address, false);
                // validate - removed from "proposedModules" mapping
                await expectInProposedModules(nexus, "dummy4", constants_1.ZERO_ADDRESS, constants_1.ZERO);
            });
        });
    });
    describe("requestLockModule()", () => {
        context("should fail", () => {
            it("when not initialized", async () => {
                const initialized = await nexus.initialized();
                chai_1.expect(initialized).to.equal(true);
            });
            it("when not called by the Governor", async () => {
                await chai_1.expect(nexus.connect(sa.other.signer).requestLockModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy")))).to.be.revertedWith("GOV: caller is not the Governor");
            });
            it("when module not exist", async () => {
                await chai_1.expect(nexus.connect(sa.governor.signer).requestLockModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy")))).to.be.revertedWith("Module must exist");
            });
            it("when module key is zero", async () => {
                await chai_1.expect(nexus.connect(sa.governor.signer).requestLockModule(constants_1.ZERO_KEY)).to.be.revertedWith("Module must exist");
            });
            it("when module already locked", async () => {
                await chai_1.expect(nexus.connect(sa.governor.signer).requestLockModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy3")))).to.be.revertedWith("Module must be unlocked");
            });
            it("when locked already proposed", async () => {
                // lock proposed
                await nexus.connect(sa.governor.signer).requestLockModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy4")));
                await chai_1.expect(nexus.connect(sa.governor.signer).requestLockModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy4")))).to.be.revertedWith("Lock already proposed");
            });
        });
        context("should succeed", () => {
            it("when a fresh lock request initiated", async () => {
                // lock proposed
                const latestTimestamp = await time_1.getTimestamp();
                const tx = nexus.connect(sa.governor.signer).requestLockModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy4")));
                await chai_1.expect(tx)
                    .to.emit(nexus, "ModuleLockRequested")
                    .withArgs(utils_1.hexlify(utils_1.keccak256(utils_1.toUtf8Bytes("dummy4"))), latestTimestamp.add(1));
                const requestTimestamp = await nexus.proposedLockModules(utils_1.keccak256(utils_1.toUtf8Bytes("dummy4")));
                chai_1.expect(requestTimestamp).to.equal(latestTimestamp.add(1));
            });
        });
    });
    describe("cancelLockModule()", () => {
        context("should fail", () => {
            it("when not initialized", async () => {
                const initialized = await nexus.initialized();
                chai_1.expect(initialized).to.equal(true);
            });
            it("when not called by Governor", async () => {
                await chai_1.expect(nexus.connect(sa.other.signer).cancelLockModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy")))).to.be.revertedWith("GOV: caller is not the Governor");
            });
            it("when not proposed lock before", async () => {
                await chai_1.expect(nexus.connect(sa.governor.signer).cancelLockModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy")))).to.be.revertedWith("Module lock request not found");
            });
            it("when zero key", async () => {
                await chai_1.expect(nexus.connect(sa.governor.signer).cancelLockModule(constants_1.ZERO_KEY)).to.be.revertedWith("Module lock request not found");
            });
            it("when lock request not found", async () => {
                await chai_1.expect(nexus.connect(sa.governor.signer).cancelLockModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy4")))).to.be.revertedWith("Module lock request not found");
            });
        });
        context("should succeed", () => {
            it("when a valid cancel lock request", async () => {
                await expectInProposedLockModules(nexus, "dummy4", constants_1.ZERO);
                await nexus.connect(sa.governor.signer).requestLockModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy4")));
                const latestTimestamp = await time_1.getTimestamp();
                await expectInProposedLockModules(nexus, "dummy4", latestTimestamp);
                const tx = nexus.connect(sa.governor.signer).cancelLockModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy4")));
                // validate event
                await chai_1.expect(tx)
                    .to.emit(nexus, "ModuleLockCancelled")
                    .withArgs(utils_1.hexlify(utils_1.keccak256(utils_1.toUtf8Bytes("dummy4"))));
                await expectInProposedLockModules(nexus, "dummy4", constants_1.ZERO);
                await expectInModules(nexus, "dummy4", sa.dummy4.address, false);
            });
        });
    });
    describe("lockModule()", () => {
        context("should fail", () => {
            it("when not initialized", async () => {
                const initialized = await nexus.initialized();
                chai_1.expect(initialized).to.equal(true);
            });
            it("when not called by Governor", async () => {
                await chai_1.expect(nexus.connect(sa.other.signer).lockModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy")))).to.be.revertedWith("GOV: caller is not the Governor");
            });
            it("when not existing key passed", async () => {
                await chai_1.expect(nexus.connect(sa.governor.signer).lockModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy")))).to.be.revertedWith("Delay not over");
            });
            it("when delay not over", async () => {
                await nexus.connect(sa.governor.signer).requestLockModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy4")));
                await time_1.increaseTime(constants_1.ONE_DAY);
                await chai_1.expect(nexus.connect(sa.governor.signer).lockModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy4")))).to.be.revertedWith("Delay not over");
            });
            it("when delay is less then 10 second of opt out period", async () => {
                await nexus.connect(sa.governor.signer).requestLockModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy4")));
                await time_1.increaseTime(constants_1.ONE_WEEK.sub(math_1.BN.from(10)));
                await chai_1.expect(nexus.connect(sa.governor.signer).lockModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy4")))).to.be.revertedWith("Delay not over");
            });
        });
        context("should succeed", () => {
            it("when a valid lock Module", async () => {
                await expectInModules(nexus, "dummy4", sa.dummy4.address, false);
                await nexus.connect(sa.governor.signer).requestLockModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy4")));
                await expectInProposedLockModules(nexus, "dummy4", await time_1.getTimestamp());
                await time_1.increaseTime(constants_1.ONE_WEEK);
                const tx = nexus.connect(sa.governor.signer).lockModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy4")));
                // validate event
                await chai_1.expect(tx)
                    .to.emit(nexus, "ModuleLockEnabled")
                    .withArgs(utils_1.hexlify(utils_1.keccak256(utils_1.toUtf8Bytes("dummy4"))));
                await expectInModules(nexus, "dummy4", sa.dummy4.address, true);
            });
            it("when delay is more then 10 second of opt out period", async () => {
                await expectInModules(nexus, "dummy4", sa.dummy4.address, false);
                await nexus.connect(sa.governor.signer).requestLockModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy4")));
                await expectInProposedLockModules(nexus, "dummy4", await time_1.getTimestamp());
                await time_1.increaseTime(constants_1.ONE_WEEK.add(math_1.BN.from(10)));
                const tx = nexus.connect(sa.governor.signer).lockModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy4")));
                // validate event
                await chai_1.expect(tx)
                    .to.emit(nexus, "ModuleLockEnabled")
                    .withArgs(utils_1.hexlify(utils_1.keccak256(utils_1.toUtf8Bytes("dummy4"))));
                await expectInProposedLockModules(nexus, "dummy4", constants_1.ZERO);
                await expectInModules(nexus, "dummy4", sa.dummy4.address, true);
            });
        });
    });
    describe("moduleExists()", () => {
        context("should return false", () => {
            it("when key not exist", async () => {
                const result = await nexus.moduleExists(utils_1.keccak256(utils_1.toUtf8Bytes("dummy")));
                chai_1.expect(result).to.equal(false);
            });
            it("when key is zero", async () => {
                const result = await nexus.moduleExists(constants_1.ZERO_KEY);
                chai_1.expect(result).to.equal(false);
            });
        });
        context("should return true", () => {
            it("when a valid module key", async () => {
                const result = await nexus.moduleExists(utils_1.keccak256(utils_1.toUtf8Bytes("dummy3")));
                chai_1.expect(result).to.equal(true);
            });
        });
    });
    describe("Extra tests", () => {
        context("should not allow", () => {
            it("proposeModule + requestLockModule for a same key", async () => {
                await nexus.connect(sa.governor.signer).proposeModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy1")), sa.dummy1.address);
                await expectInProposedModules(nexus, "dummy1", sa.dummy1.address, await time_1.getTimestamp());
                await expectInModules(nexus, "dummy1", constants_1.ZERO_ADDRESS, false);
                await time_1.increaseTime(constants_1.ONE_WEEK);
                await nexus.connect(sa.governor.signer).acceptProposedModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy1")));
                await expectInModules(nexus, "dummy1", sa.dummy1.address, false);
                await nexus.connect(sa.governor.signer).requestLockModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy1")));
                await expectInProposedLockModules(nexus, "dummy1", await time_1.getTimestamp());
                await time_1.increaseTime(constants_1.ONE_WEEK);
                await nexus.connect(sa.governor.signer).lockModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy1")));
                await expectInProposedLockModules(nexus, "dummy1", constants_1.ZERO);
                await expectInModules(nexus, "dummy1", sa.dummy1.address, true);
            });
        });
        context("should succeed", () => {
            it("when propose a module, cancel it and then propose the same module it again", async () => {
                await nexus.connect(sa.governor.signer).proposeModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy1")), sa.dummy1.address);
                await expectInProposedModules(nexus, "dummy1", sa.dummy1.address, await time_1.getTimestamp());
                await expectInModules(nexus, "dummy1", constants_1.ZERO_ADDRESS, false);
                await nexus.connect(sa.governor.signer).cancelProposedModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy1")));
                await expectInProposedModules(nexus, "dummy1", constants_1.ZERO_ADDRESS, constants_1.ZERO);
                await expectInModules(nexus, "dummy1", constants_1.ZERO_ADDRESS, false);
                await nexus.connect(sa.governor.signer).proposeModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy1")), sa.dummy1.address);
                await expectInProposedModules(nexus, "dummy1", sa.dummy1.address, await time_1.getTimestamp());
                await expectInModules(nexus, "dummy1", constants_1.ZERO_ADDRESS, false);
            });
            it("can propose multiple modules and cancel one, and accept one, and leave one", async () => {
                await nexus.connect(sa.governor.signer).proposeModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy1")), sa.dummy1.address);
                await expectInProposedModules(nexus, "dummy1", sa.dummy1.address, await time_1.getTimestamp());
                await expectInModules(nexus, "dummy1", constants_1.ZERO_ADDRESS, false);
                await nexus.connect(sa.governor.signer).proposeModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy2")), sa.dummy2.address);
                await expectInProposedModules(nexus, "dummy2", sa.dummy2.address, await time_1.getTimestamp());
                await expectInModules(nexus, "dummy2", constants_1.ZERO_ADDRESS, false);
                await nexus.connect(sa.governor.signer).proposeModule(utils_1.keccak256(utils_1.toUtf8Bytes("other")), sa.other.address);
                const timestampOther = await time_1.getTimestamp();
                await expectInProposedModules(nexus, "other", sa.other.address, timestampOther);
                await expectInModules(nexus, "other", constants_1.ZERO_ADDRESS, false);
                await time_1.increaseTime(constants_1.ONE_WEEK);
                // accept
                await nexus.connect(sa.governor.signer).acceptProposedModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy1")));
                await expectInProposedModules(nexus, "dummy1", constants_1.ZERO_ADDRESS, constants_1.ZERO);
                await expectInModules(nexus, "dummy1", sa.dummy1.address, false);
                // cancel
                await nexus.connect(sa.governor.signer).cancelProposedModule(utils_1.keccak256(utils_1.toUtf8Bytes("dummy2")));
                await expectInProposedModules(nexus, "dummy2", constants_1.ZERO_ADDRESS, constants_1.ZERO);
                await expectInModules(nexus, "dummy2", constants_1.ZERO_ADDRESS, false);
                // "other" is un-affected
                await expectInProposedModules(nexus, "other", sa.other.address, timestampOther);
                await expectInModules(nexus, "other", constants_1.ZERO_ADDRESS, false);
            });
        });
    });
});
//# sourceMappingURL=nexus.spec.js.map