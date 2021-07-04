import { expect } from "chai"
import { keccak256, toUtf8Bytes, hexlify } from "ethers/lib/utils"
import { ethers } from "hardhat"
import { MassetMachine, StandardAccounts } from "@utils/machines"
import { BN } from "@utils/math"
import { DelayedClaimableGovernor, Nexus, Nexus__factory } from "types/generated"
import { getTimestamp, increaseTime } from "@utils/time"
import { ONE_WEEK, ZERO_ADDRESS, KEY_SAVINGS_MANAGER, ONE_DAY, ZERO, ZERO_KEY } from "@utils/constants"
import { shouldBehaveLikeDelayedClaimable, IGovernableBehaviourContext } from "../governance/DelayedClaimableGovernor.behaviour"
import { shouldBehaveLikeClaimable } from "../governance/ClaimableGovernor.behaviour"

/** @dev Uses generic module getter to validate that a module exists with the specified properties */
async function expectInModules(nexus: Nexus, _key: string, _addr: string, _isLocked: boolean): Promise<void> {
    /* eslint-disable prefer-const */
    let addr: string
    let isLocked: boolean
    const encodedKey = keccak256(toUtf8Bytes(_key))
    ;[addr, isLocked] = await nexus.modules(encodedKey)
    expect(addr, "Module address not matched").to.equal(_addr)
    expect(isLocked, "Module isLocked not matched").to.equal(_isLocked)
    const exists = await nexus.moduleExists(encodedKey)
    if (addr !== ZERO_ADDRESS) {
        expect(exists, "moduleExists true").to.equal(true)
    } else {
        expect(exists, "moduleExists false").to.equal(false)
    }
    expect(await nexus.getModule(encodedKey), "getModule").to.eq(_addr)
}

async function expectInProposedModules(nexus: Nexus, _key: string, _newAddress: string, _timestamp: BN): Promise<void> {
    let newAddress: string
    let timestamp: BN
    ;[newAddress, timestamp] = await nexus.proposedModules(keccak256(toUtf8Bytes(_key)))
    /* eslint-enable prefer-const */
    expect(newAddress, "New address not matched in proposed modules").to.equal(_newAddress)
    expect(timestamp, "The timestamp not matched in proposed modules").to.equal(_timestamp)
}

async function expectInProposedLockModules(nexus: Nexus, _key: string, _timestamp: BN): Promise<void> {
    const timestamp: BN = await nexus.proposedLockModules(keccak256(toUtf8Bytes(_key)))
    expect(timestamp, "The timestamp not matched in proposed lock modules").to.equal(_timestamp)
}

async function deployNexus(sa: StandardAccounts): Promise<Nexus> {
    return new Nexus__factory(sa.governor.signer).deploy(sa.governor.address)
}

describe("Nexus", () => {
    let sa: StandardAccounts
    let nexus: Nexus

    describe("Behavior like...", () => {
        const ctx: Partial<IGovernableBehaviourContext> = {}
        before(async () => {
            const accounts = await ethers.getSigners()
            const mAssetMachine = await new MassetMachine().initAccounts(accounts)
            sa = mAssetMachine.sa
            ctx.default = sa.default
            ctx.governor = sa.governor
            ctx.other = sa.other
        })
        beforeEach("Init contract", async () => {
            ctx.claimable = (await deployNexus(sa)) as DelayedClaimableGovernor
        })
        context("should behave like ClaimableGovernor", () => {
            shouldBehaveLikeClaimable(ctx as Required<typeof ctx>)
        })

        context("should behave like DelayedClaimableGovernor", () => {
            beforeEach("", async () => {
                const { other } = sa
                await ctx.claimable.connect(sa.governor.signer).requestGovernorChange(other.address)
            })

            shouldBehaveLikeDelayedClaimable(ctx as Required<typeof ctx>)
        })
    })

    describe("Before initialize", () => {
        it("should have correct default parameters", async () => {
            // Deploy new nexus
            nexus = await deployNexus(sa)
            const governor = await nexus.governor()
            const initialized = await nexus.initialized()
            const upgradeDelay = await nexus.UPGRADE_DELAY()
            expect(governor).to.equal(sa.governor.address)
            expect(initialized).to.equal(false)
            expect(upgradeDelay).to.equal(ONE_WEEK)
        })
    })

    describe("initialize()", () => {
        beforeEach("deploy nexus instance", async () => {
            // Deploy new nexus, to override
            nexus = await deployNexus(sa)
        })
        context("should succeed", () => {
            it("with default modules", async () => {
                await nexus.initialize([KEY_SAVINGS_MANAGER], [sa.mockSavingsManager.address], [false], sa.governor.address)
                // initialized
                const initialized = await nexus.initialized()
                expect(initialized).to.equal(true)

                // validate modules
                await expectInModules(nexus, "SavingsManager", sa.mockSavingsManager.address, false)
            })
            it("when current governor called the function", async () => {
                await nexus
                    .connect(sa.governor.signer)
                    .initialize([keccak256(toUtf8Bytes("dummy1"))], [sa.dummy1.address], [true], sa.governor.address)
                await expectInModules(nexus, "dummy1", sa.dummy1.address, true)
            })
            it("when different governor address passed", async () => {
                const govBefore = await nexus.governor()
                await nexus
                    .connect(sa.governor.signer)
                    .initialize([keccak256(toUtf8Bytes("dummy"))], [sa.default.address], [true], sa.other.address)
                await expectInModules(nexus, "dummy", sa.default.address, true)
                const govAfter = await nexus.governor()
                expect(govBefore).to.not.equal(govAfter)
                expect(govBefore).to.equal(sa.governor.address)
                expect(govAfter).to.equal(sa.other.address)
            })
        })
        context("should fail", () => {
            it("when called by other than governor", async () => {
                await expect(nexus.connect(sa.default.signer).initialize([], [], [], sa.governor.address)).to.be.revertedWith(
                    "GOV: caller is not the Governor",
                )
            })
            it("when initialized with same address for different modules", async () => {
                await expect(
                    nexus
                        .connect(sa.governor.signer)
                        .initialize(
                            [keccak256(toUtf8Bytes("dummy1")), keccak256(toUtf8Bytes("dummy2"))],
                            [sa.dummy1.address, sa.dummy1.address],
                            [false, false],
                            sa.governor.address,
                        ),
                ).to.be.revertedWith("Modules must have unique addr")
                await expectInModules(nexus, "dummy1", ZERO_ADDRESS, false)
                await expectInModules(nexus, "dummy2", ZERO_ADDRESS, false)
            })
            it("when initialized with an empty array", async () => {
                await expect(nexus.connect(sa.governor.signer).initialize([], [], [], sa.governor.address)).to.be.revertedWith(
                    "No keys provided",
                )
            })
            it("when initialized with wrong array length for addresses array", async () => {
                await expect(
                    nexus
                        .connect(sa.governor.signer)
                        .initialize([keccak256(toUtf8Bytes("dummy"))], [sa.default.address, sa.other.address], [true], sa.governor.address),
                ).to.be.revertedWith("Insufficient address data")
                await expectInModules(nexus, "dummy", ZERO_ADDRESS, false)
            })
            it("when initialized with wrong array length for isLocked array", async () => {
                await expect(
                    nexus
                        .connect(sa.governor.signer)
                        .initialize([keccak256(toUtf8Bytes("dummy"))], [sa.default.address], [true, false], sa.governor.address),
                ).to.be.revertedWith("Insufficient locked statuses")
                await expectInModules(nexus, "dummy", ZERO_ADDRESS, false)
            })

            it("when already initialized", async () => {
                await nexus
                    .connect(sa.governor.signer)
                    .initialize([keccak256(toUtf8Bytes("dummy1"))], [sa.dummy1.address], [true], sa.governor.address)
                await expectInModules(nexus, "dummy1", sa.dummy1.address, true)
                // must fail
                await expect(
                    nexus
                        .connect(sa.governor.signer)
                        .initialize([keccak256(toUtf8Bytes("dummy"))], [sa.default.address], [true], sa.governor.address),
                ).to.be.revertedWith("Nexus is already initialized")
                await expectInModules(nexus, "dummy1", sa.dummy1.address, true)
            })
        })
    })

    beforeEach("Init contract", async () => {
        nexus = await deployNexus(sa)
        await nexus
            .connect(sa.governor.signer)
            .initialize(
                [keccak256(toUtf8Bytes("dummy3")), keccak256(toUtf8Bytes("dummy4"))],
                [sa.dummy3.address, sa.dummy4.address],
                [true, false],
                sa.governor.address,
            )
        await expectInModules(nexus, "dummy3", sa.dummy3.address, true)
        await expectInModules(nexus, "dummy4", sa.dummy4.address, false)
    })

    describe("proposeModule()", () => {
        context("should fail", () => {
            it("when not initialized", async () => {
                const initialized = await nexus.initialized()
                expect(initialized).to.equal(true)
            })
            it("when not called by Governor", async () => {
                await expect(
                    nexus.connect(sa.other.signer).proposeModule(keccak256(toUtf8Bytes("dummy")), sa.default.address),
                ).to.be.revertedWith("GOV: caller is not the Governor")
                await expectInProposedModules(nexus, "dummy", ZERO_ADDRESS, ZERO)
            })
            it("when empty key", async () => {
                await expect(nexus.connect(sa.governor.signer).proposeModule(ZERO_KEY, sa.default.address)).to.be.revertedWith(
                    "Key must not be zero",
                )
                await expectInProposedModules(nexus, ZERO_KEY, ZERO_ADDRESS, ZERO)
            })
            it("when zero address", async () => {
                await expect(
                    nexus.connect(sa.governor.signer).proposeModule(keccak256(toUtf8Bytes("dummy")), ZERO_ADDRESS),
                ).to.be.revertedWith("Module address must not be 0")
                await expectInProposedModules(nexus, "dummy", ZERO_ADDRESS, ZERO)
            })
            it("when module key & address are same", async () => {
                await expectInModules(nexus, "dummy4", sa.dummy4.address, false)
                await expect(
                    nexus.connect(sa.governor.signer).proposeModule(keccak256(toUtf8Bytes("dummy4")), sa.dummy4.address),
                ).to.be.revertedWith("Module already has same address")
                await expectInProposedModules(nexus, "dummy4", ZERO_ADDRESS, ZERO)
            })
            it("when module is locked (update for existing module)", async () => {
                await expectInModules(nexus, "dummy3", sa.dummy3.address, true)
                await expect(
                    nexus.connect(sa.governor.signer).proposeModule(keccak256(toUtf8Bytes("dummy3")), sa.other.address),
                ).to.be.revertedWith("Module must be unlocked")
                await expectInProposedModules(nexus, "dummy3", ZERO_ADDRESS, ZERO)
            })
            it("when module already proposed", async () => {
                await nexus.connect(sa.governor.signer).proposeModule(keccak256(toUtf8Bytes("dummy2")), sa.dummy2.address)
                const timestamp = await getTimestamp()
                await expectInProposedModules(nexus, "dummy2", sa.dummy2.address, timestamp)

                await expect(
                    nexus.connect(sa.governor.signer).proposeModule(keccak256(toUtf8Bytes("dummy2")), sa.dummy3.address),
                ).to.be.revertedWith("Module already proposed")
                await expectInProposedModules(nexus, "dummy2", sa.dummy2.address, timestamp)
            })
        })
        context("should succeed", () => {
            it("when a new module is proposed", async () => {
                await nexus.connect(sa.governor.signer).proposeModule(keccak256(toUtf8Bytes("dummy1")), sa.dummy1.address)
                const lastTimestamp = await getTimestamp()

                await expectInProposedModules(nexus, "dummy1", sa.dummy1.address, lastTimestamp)
            })
            it("when an existing module address is updated", async () => {
                await expectInModules(nexus, "dummy4", sa.dummy4.address, false)

                // propose new address
                await nexus.connect(sa.governor.signer).proposeModule(keccak256(toUtf8Bytes("dummy4")), sa.other.address)
                const lastTimestamp = await getTimestamp()

                await expectInProposedModules(nexus, "dummy4", sa.other.address, lastTimestamp)

                // address is not updated in modules mapping
                await expectInModules(nexus, "dummy4", sa.dummy4.address, false)
            })
        })
    })

    describe("cancelProposedModule()", () => {
        context("should fail", () => {
            it("when not initialized", async () => {
                const initialized = await nexus.initialized()
                expect(initialized).to.equal(true)
            })
            it("when not called by Governor", async () => {
                await expect(nexus.connect(sa.other.signer).cancelProposedModule(keccak256(toUtf8Bytes("dummy")))).to.be.revertedWith(
                    "GOV: caller is not the Governor",
                )
            })
            it("when proposed module not found", async () => {
                await expect(nexus.connect(sa.governor.signer).cancelProposedModule(keccak256(toUtf8Bytes("dummy")))).to.be.revertedWith(
                    "Proposed module not found",
                )
            })
        })
        context("should succeed", () => {
            it("when cancelling existing proposed module", async () => {
                // propose a new module
                // =====================
                await nexus.connect(sa.governor.signer).proposeModule(keccak256(toUtf8Bytes("dummy1")), sa.dummy1.address)
                // validate proposed module

                // validate dummy1 added
                const latestTimestamp = await getTimestamp()
                await expectInProposedModules(nexus, "dummy1", sa.dummy1.address, latestTimestamp)

                // validate dummy3 still exist
                await expectInModules(nexus, "dummy3", sa.dummy3.address, true)

                // cancel the module
                // ==================
                const tx = nexus.connect(sa.governor.signer).cancelProposedModule(keccak256(toUtf8Bytes("dummy1")))
                // expect event
                await expect(tx)
                    .to.emit(nexus, "ModuleCancelled")
                    .withArgs(hexlify(keccak256(toUtf8Bytes("dummy1"))))

                // validate cancelled
                await expectInProposedModules(nexus, "dummy1", ZERO_ADDRESS, ZERO)

                // validate dummy3 still exist
                await expectInModules(nexus, "dummy3", sa.dummy3.address, true)
            })
        })
    })

    describe("acceptProposedModule()", () => {
        context("should fail", () => {
            it("when not initialized", async () => {
                const initialized = await nexus.initialized()
                expect(initialized).to.equal(true)
            })
            it("when not called by Governor", async () => {
                await expect(nexus.connect(sa.other.signer).acceptProposedModule(keccak256(toUtf8Bytes("dummy")))).to.be.revertedWith(
                    "GOV: caller is not the Governor",
                )
            })
            it("when non existing key passed", async () => {
                await expect(nexus.connect(sa.governor.signer).acceptProposedModule(keccak256(toUtf8Bytes("dummy")))).to.be.revertedWith(
                    "Module upgrade delay not over",
                )
            })
            it("when delay not over", async () => {
                await nexus.connect(sa.governor.signer).proposeModule(keccak256(toUtf8Bytes("dummy1")), sa.dummy1.address)
                const timeWhenModuleProposed = await getTimestamp()
                await increaseTime(ONE_DAY)
                await expect(nexus.connect(sa.governor.signer).acceptProposedModule(keccak256(toUtf8Bytes("dummy1")))).to.be.revertedWith(
                    "Module upgrade delay not over",
                )

                // validate
                await expectInProposedModules(nexus, "dummy1", sa.dummy1.address, timeWhenModuleProposed)

                // validate module still not accepted
                await expectInModules(nexus, "dummy1", ZERO_ADDRESS, false)
            })
        })
        context("should succeed", () => {
            it("when accepted after delay is over", async () => {
                await nexus.connect(sa.governor.signer).proposeModule(keccak256(toUtf8Bytes("dummy1")), sa.dummy1.address)
                const timeWhenModuleProposed = await getTimestamp()

                // validate
                await expectInProposedModules(nexus, "dummy1", sa.dummy1.address, timeWhenModuleProposed)

                await increaseTime(ONE_WEEK)
                await nexus.connect(sa.governor.signer).acceptProposedModule(keccak256(toUtf8Bytes("dummy1")))

                // validate module accepted
                await expectInModules(nexus, "dummy1", sa.dummy1.address, false)

                // validate data deleted from proposedModules map
                await expectInProposedModules(nexus, "dummy1", ZERO_ADDRESS, ZERO)
            })
        })
    })

    describe("acceptProposedModules()", () => {
        context("should fail", () => {
            it("when not initialized", async () => {
                const initialized = await nexus.initialized()
                expect(initialized).to.equal(true)
            })
            it("when not called by Governor", async () => {
                await expect(nexus.connect(sa.other.signer).acceptProposedModules([keccak256(toUtf8Bytes("dummy"))])).to.be.revertedWith(
                    "GOV: caller is not the Governor",
                )
            })
            it("when empty array", async () => {
                await expect(nexus.connect(sa.governor.signer).acceptProposedModules([])).to.be.revertedWith("Keys array empty")
            })
            it("when non existing key passed", async () => {
                await expect(nexus.connect(sa.governor.signer).acceptProposedModules([keccak256(toUtf8Bytes("dummy"))])).to.be.revertedWith(
                    "Module upgrade delay not over",
                )
            })
            it("when module not proposed", async () => {
                await expect(
                    nexus.connect(sa.governor.signer).acceptProposedModules([keccak256(toUtf8Bytes("dummy1"))]),
                ).to.be.revertedWith("Module upgrade delay not over")
            })
            it("when module is locked", async () => {
                // update address request
                await expectInModules(nexus, "dummy4", sa.dummy4.address, false)
                await nexus.connect(sa.governor.signer).proposeModule(keccak256(toUtf8Bytes("dummy4")), sa.other.address)
                const timestampWhenProposed = await getTimestamp()
                await expectInProposedModules(nexus, "dummy4", sa.other.address, timestampWhenProposed)
                await increaseTime(ONE_DAY)
                // lock request
                await nexus.connect(sa.governor.signer).requestLockModule(keccak256(toUtf8Bytes("dummy4")))
                await expectInProposedLockModules(nexus, "dummy4", await getTimestamp())

                await increaseTime(ONE_WEEK)
                // module locked
                await nexus.connect(sa.governor.signer).lockModule(keccak256(toUtf8Bytes("dummy4")))
                await expectInModules(nexus, "dummy4", sa.dummy4.address, true)

                // now accpet update request - must fail
                await expect(
                    nexus.connect(sa.governor.signer).acceptProposedModules([keccak256(toUtf8Bytes("dummy4"))]),
                ).to.be.revertedWith("Module must be unlocked")
                await expectInProposedModules(nexus, "dummy4", sa.other.address, timestampWhenProposed)
            })
            it("when address is already used by another module", async () => {
                // proposed new module - dummy1
                await nexus.connect(sa.governor.signer).proposeModule(keccak256(toUtf8Bytes("dummy1")), sa.dummy1.address)
                await expectInProposedModules(nexus, "dummy1", sa.dummy1.address, await getTimestamp())

                // propose new module - dummy2 with dummy1 as address
                await nexus.connect(sa.governor.signer).proposeModule(keccak256(toUtf8Bytes("dummy2")), sa.dummy1.address)
                await expectInProposedModules(nexus, "dummy2", sa.dummy1.address, await getTimestamp())

                await increaseTime(ONE_WEEK)

                // dummy1 accepted
                await nexus.connect(sa.governor.signer).acceptProposedModules([keccak256(toUtf8Bytes("dummy1"))])
                await expectInModules(nexus, "dummy1", sa.dummy1.address, false)

                // dummy2 must be rejected
                await expect(
                    nexus.connect(sa.governor.signer).acceptProposedModules([keccak256(toUtf8Bytes("dummy2"))]),
                ).to.be.revertedWith("Modules must have unique addr")
            })
            it("when delay is not over", async () => {
                await nexus.connect(sa.governor.signer).proposeModule(keccak256(toUtf8Bytes("dummy1")), sa.dummy1.address)
                await increaseTime(ONE_DAY)
                await expect(
                    nexus.connect(sa.governor.signer).acceptProposedModules([keccak256(toUtf8Bytes("dummy1"))]),
                ).to.be.revertedWith("Module upgrade delay not over")

                // not present in modules
                await expectInModules(nexus, "dummy1", ZERO_ADDRESS, false)
            })
            it("when delay is less then 10 second of opt out period", async () => {
                await nexus.connect(sa.governor.signer).proposeModule(keccak256(toUtf8Bytes("dummy1")), sa.dummy1.address)
                await increaseTime(ONE_WEEK.sub(BN.from(10)))
                await expect(
                    nexus.connect(sa.governor.signer).acceptProposedModules([keccak256(toUtf8Bytes("dummy1"))]),
                ).to.be.revertedWith("Module upgrade delay not over")

                // not present in modules
                await expectInModules(nexus, "dummy1", ZERO_ADDRESS, false)
            })
        })
        context("should succeed", () => {
            it("when accepted a proposed Module", async () => {
                await nexus.connect(sa.governor.signer).proposeModule(keccak256(toUtf8Bytes("dummy1")), sa.dummy1.address)
                await increaseTime(ONE_WEEK)
                const tx = nexus.connect(sa.governor.signer).acceptProposedModules([keccak256(toUtf8Bytes("dummy1"))])

                // validate event
                await expect(tx)
                    .to.emit(nexus, "ModuleAdded")
                    .withArgs(hexlify(keccak256(toUtf8Bytes("dummy1"))), sa.dummy1.address, false)

                // validate - added in "modules" mapping
                await expectInModules(nexus, "dummy1", sa.dummy1.address, false)

                // validate - removed from "proposedModules" mapping
                await expectInProposedModules(nexus, "dummy1", ZERO_ADDRESS, ZERO)
            })
            it("when delay is more then 10 second of opt out period", async () => {
                await nexus.connect(sa.governor.signer).proposeModule(keccak256(toUtf8Bytes("dummy1")), sa.dummy1.address)
                await increaseTime(ONE_WEEK.add(BN.from(10)))
                const tx = nexus.connect(sa.governor.signer).acceptProposedModules([keccak256(toUtf8Bytes("dummy1"))])

                // validate event
                await expect(tx)
                    .to.emit(nexus, "ModuleAdded")
                    .withArgs(hexlify(keccak256(toUtf8Bytes("dummy1"))), sa.dummy1.address, false)
            })
            it("when module address update request accepted", async () => {
                // validate - existing module present in "modules" mapping
                await expectInModules(nexus, "dummy4", sa.dummy4.address, false)

                await nexus.connect(sa.governor.signer).proposeModule(keccak256(toUtf8Bytes("dummy4")), sa.other.address)

                await increaseTime(ONE_WEEK)

                const tx = nexus.connect(sa.governor.signer).acceptProposedModules([keccak256(toUtf8Bytes("dummy4"))])

                // validate event
                await expect(tx)
                    .to.emit(nexus, "ModuleAdded")
                    .withArgs(hexlify(keccak256(toUtf8Bytes("dummy4"))), sa.other.address, false)

                // validate - added in "modules" mapping
                await expectInModules(nexus, "dummy4", sa.other.address, false)

                // validate - removed from "proposedModules" mapping
                await expectInProposedModules(nexus, "dummy4", ZERO_ADDRESS, ZERO)
            })
        })
    })

    describe("requestLockModule()", () => {
        context("should fail", () => {
            it("when not initialized", async () => {
                const initialized = await nexus.initialized()
                expect(initialized).to.equal(true)
            })
            it("when not called by the Governor", async () => {
                await expect(nexus.connect(sa.other.signer).requestLockModule(keccak256(toUtf8Bytes("dummy")))).to.be.revertedWith(
                    "GOV: caller is not the Governor",
                )
            })
            it("when module not exist", async () => {
                await expect(nexus.connect(sa.governor.signer).requestLockModule(keccak256(toUtf8Bytes("dummy")))).to.be.revertedWith(
                    "Module must exist",
                )
            })
            it("when module key is zero", async () => {
                await expect(nexus.connect(sa.governor.signer).requestLockModule(ZERO_KEY)).to.be.revertedWith("Module must exist")
            })
            it("when module already locked", async () => {
                await expect(nexus.connect(sa.governor.signer).requestLockModule(keccak256(toUtf8Bytes("dummy3")))).to.be.revertedWith(
                    "Module must be unlocked",
                )
            })
            it("when locked already proposed", async () => {
                // lock proposed
                await nexus.connect(sa.governor.signer).requestLockModule(keccak256(toUtf8Bytes("dummy4")))
                await expect(nexus.connect(sa.governor.signer).requestLockModule(keccak256(toUtf8Bytes("dummy4")))).to.be.revertedWith(
                    "Lock already proposed",
                )
            })
        })
        context("should succeed", () => {
            it("when a fresh lock request initiated", async () => {
                // lock proposed
                const latestTimestamp = await getTimestamp()
                const tx = nexus.connect(sa.governor.signer).requestLockModule(keccak256(toUtf8Bytes("dummy4")))
                await expect(tx)
                    .to.emit(nexus, "ModuleLockRequested")
                    .withArgs(hexlify(keccak256(toUtf8Bytes("dummy4"))), latestTimestamp.add(1))
                const requestTimestamp = await nexus.proposedLockModules(keccak256(toUtf8Bytes("dummy4")))
                expect(requestTimestamp).to.equal(latestTimestamp.add(1))
            })
        })
    })

    describe("cancelLockModule()", () => {
        context("should fail", () => {
            it("when not initialized", async () => {
                const initialized = await nexus.initialized()
                expect(initialized).to.equal(true)
            })
            it("when not called by Governor", async () => {
                await expect(nexus.connect(sa.other.signer).cancelLockModule(keccak256(toUtf8Bytes("dummy")))).to.be.revertedWith(
                    "GOV: caller is not the Governor",
                )
            })
            it("when not proposed lock before", async () => {
                await expect(nexus.connect(sa.governor.signer).cancelLockModule(keccak256(toUtf8Bytes("dummy")))).to.be.revertedWith(
                    "Module lock request not found",
                )
            })
            it("when zero key", async () => {
                await expect(nexus.connect(sa.governor.signer).cancelLockModule(ZERO_KEY)).to.be.revertedWith(
                    "Module lock request not found",
                )
            })
            it("when lock request not found", async () => {
                await expect(nexus.connect(sa.governor.signer).cancelLockModule(keccak256(toUtf8Bytes("dummy4")))).to.be.revertedWith(
                    "Module lock request not found",
                )
            })
        })
        context("should succeed", () => {
            it("when a valid cancel lock request", async () => {
                await expectInProposedLockModules(nexus, "dummy4", ZERO)

                await nexus.connect(sa.governor.signer).requestLockModule(keccak256(toUtf8Bytes("dummy4")))

                const latestTimestamp = await getTimestamp()
                await expectInProposedLockModules(nexus, "dummy4", latestTimestamp)

                const tx = nexus.connect(sa.governor.signer).cancelLockModule(keccak256(toUtf8Bytes("dummy4")))

                // validate event
                await expect(tx)
                    .to.emit(nexus, "ModuleLockCancelled")
                    .withArgs(hexlify(keccak256(toUtf8Bytes("dummy4"))))

                await expectInProposedLockModules(nexus, "dummy4", ZERO)

                await expectInModules(nexus, "dummy4", sa.dummy4.address, false)
            })
        })
    })

    describe("lockModule()", () => {
        context("should fail", () => {
            it("when not initialized", async () => {
                const initialized = await nexus.initialized()
                expect(initialized).to.equal(true)
            })
            it("when not called by Governor", async () => {
                await expect(nexus.connect(sa.other.signer).lockModule(keccak256(toUtf8Bytes("dummy")))).to.be.revertedWith(
                    "GOV: caller is not the Governor",
                )
            })
            it("when not existing key passed", async () => {
                await expect(nexus.connect(sa.governor.signer).lockModule(keccak256(toUtf8Bytes("dummy")))).to.be.revertedWith(
                    "Delay not over",
                )
            })
            it("when delay not over", async () => {
                await nexus.connect(sa.governor.signer).requestLockModule(keccak256(toUtf8Bytes("dummy4")))
                await increaseTime(ONE_DAY)
                await expect(nexus.connect(sa.governor.signer).lockModule(keccak256(toUtf8Bytes("dummy4")))).to.be.revertedWith(
                    "Delay not over",
                )
            })
            it("when delay is less then 10 second of opt out period", async () => {
                await nexus.connect(sa.governor.signer).requestLockModule(keccak256(toUtf8Bytes("dummy4")))
                await increaseTime(ONE_WEEK.sub(BN.from(10)))
                await expect(nexus.connect(sa.governor.signer).lockModule(keccak256(toUtf8Bytes("dummy4")))).to.be.revertedWith(
                    "Delay not over",
                )
            })
        })
        context("should succeed", () => {
            it("when a valid lock Module", async () => {
                await expectInModules(nexus, "dummy4", sa.dummy4.address, false)

                await nexus.connect(sa.governor.signer).requestLockModule(keccak256(toUtf8Bytes("dummy4")))
                await expectInProposedLockModules(nexus, "dummy4", await getTimestamp())

                await increaseTime(ONE_WEEK)

                const tx = nexus.connect(sa.governor.signer).lockModule(keccak256(toUtf8Bytes("dummy4")))
                // validate event
                await expect(tx)
                    .to.emit(nexus, "ModuleLockEnabled")
                    .withArgs(hexlify(keccak256(toUtf8Bytes("dummy4"))))

                await expectInModules(nexus, "dummy4", sa.dummy4.address, true)
            })
            it("when delay is more then 10 second of opt out period", async () => {
                await expectInModules(nexus, "dummy4", sa.dummy4.address, false)

                await nexus.connect(sa.governor.signer).requestLockModule(keccak256(toUtf8Bytes("dummy4")))
                await expectInProposedLockModules(nexus, "dummy4", await getTimestamp())

                await increaseTime(ONE_WEEK.add(BN.from(10)))

                const tx = nexus.connect(sa.governor.signer).lockModule(keccak256(toUtf8Bytes("dummy4")))
                // validate event
                await expect(tx)
                    .to.emit(nexus, "ModuleLockEnabled")
                    .withArgs(hexlify(keccak256(toUtf8Bytes("dummy4"))))

                await expectInProposedLockModules(nexus, "dummy4", ZERO)
                await expectInModules(nexus, "dummy4", sa.dummy4.address, true)
            })
        })
    })

    describe("moduleExists()", () => {
        context("should return false", () => {
            it("when key not exist", async () => {
                const result = await nexus.moduleExists(keccak256(toUtf8Bytes("dummy")))
                expect(result).to.equal(false)
            })
            it("when key is zero", async () => {
                const result = await nexus.moduleExists(ZERO_KEY)
                expect(result).to.equal(false)
            })
        })
        context("should return true", () => {
            it("when a valid module key", async () => {
                const result = await nexus.moduleExists(keccak256(toUtf8Bytes("dummy3")))
                expect(result).to.equal(true)
            })
        })
    })

    describe("Extra tests", () => {
        context("should not allow", () => {
            it("proposeModule + requestLockModule for a same key", async () => {
                await nexus.connect(sa.governor.signer).proposeModule(keccak256(toUtf8Bytes("dummy1")), sa.dummy1.address)
                await expectInProposedModules(nexus, "dummy1", sa.dummy1.address, await getTimestamp())
                await expectInModules(nexus, "dummy1", ZERO_ADDRESS, false)

                await increaseTime(ONE_WEEK)

                await nexus.connect(sa.governor.signer).acceptProposedModule(keccak256(toUtf8Bytes("dummy1")))
                await expectInModules(nexus, "dummy1", sa.dummy1.address, false)

                await nexus.connect(sa.governor.signer).requestLockModule(keccak256(toUtf8Bytes("dummy1")))
                await expectInProposedLockModules(nexus, "dummy1", await getTimestamp())

                await increaseTime(ONE_WEEK)

                await nexus.connect(sa.governor.signer).lockModule(keccak256(toUtf8Bytes("dummy1")))
                await expectInProposedLockModules(nexus, "dummy1", ZERO)
                await expectInModules(nexus, "dummy1", sa.dummy1.address, true)
            })
        })
        context("should succeed", () => {
            it("when propose a module, cancel it and then propose the same module it again", async () => {
                await nexus.connect(sa.governor.signer).proposeModule(keccak256(toUtf8Bytes("dummy1")), sa.dummy1.address)
                await expectInProposedModules(nexus, "dummy1", sa.dummy1.address, await getTimestamp())
                await expectInModules(nexus, "dummy1", ZERO_ADDRESS, false)

                await nexus.connect(sa.governor.signer).cancelProposedModule(keccak256(toUtf8Bytes("dummy1")))
                await expectInProposedModules(nexus, "dummy1", ZERO_ADDRESS, ZERO)
                await expectInModules(nexus, "dummy1", ZERO_ADDRESS, false)

                await nexus.connect(sa.governor.signer).proposeModule(keccak256(toUtf8Bytes("dummy1")), sa.dummy1.address)
                await expectInProposedModules(nexus, "dummy1", sa.dummy1.address, await getTimestamp())
                await expectInModules(nexus, "dummy1", ZERO_ADDRESS, false)
            })
            it("can propose multiple modules and cancel one, and accept one, and leave one", async () => {
                await nexus.connect(sa.governor.signer).proposeModule(keccak256(toUtf8Bytes("dummy1")), sa.dummy1.address)
                await expectInProposedModules(nexus, "dummy1", sa.dummy1.address, await getTimestamp())
                await expectInModules(nexus, "dummy1", ZERO_ADDRESS, false)

                await nexus.connect(sa.governor.signer).proposeModule(keccak256(toUtf8Bytes("dummy2")), sa.dummy2.address)
                await expectInProposedModules(nexus, "dummy2", sa.dummy2.address, await getTimestamp())
                await expectInModules(nexus, "dummy2", ZERO_ADDRESS, false)

                await nexus.connect(sa.governor.signer).proposeModule(keccak256(toUtf8Bytes("other")), sa.other.address)
                const timestampOther = await getTimestamp()
                await expectInProposedModules(nexus, "other", sa.other.address, timestampOther)
                await expectInModules(nexus, "other", ZERO_ADDRESS, false)

                await increaseTime(ONE_WEEK)

                // accept
                await nexus.connect(sa.governor.signer).acceptProposedModule(keccak256(toUtf8Bytes("dummy1")))
                await expectInProposedModules(nexus, "dummy1", ZERO_ADDRESS, ZERO)
                await expectInModules(nexus, "dummy1", sa.dummy1.address, false)

                // cancel
                await nexus.connect(sa.governor.signer).cancelProposedModule(keccak256(toUtf8Bytes("dummy2")))
                await expectInProposedModules(nexus, "dummy2", ZERO_ADDRESS, ZERO)
                await expectInModules(nexus, "dummy2", ZERO_ADDRESS, false)

                // "other" is un-affected
                await expectInProposedModules(nexus, "other", sa.other.address, timestampOther)
                await expectInModules(nexus, "other", ZERO_ADDRESS, false)
            })
        })
    })
})
