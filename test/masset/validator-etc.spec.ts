import { ethers } from "hardhat"
import { expect } from "chai"

import { simpleToExactAmount, BN } from "@utils/math"
import { ONE_WEEK } from "@utils/constants"
import { MassetMachine, StandardAccounts } from "@utils/machines"
import { increaseTime } from "@utils/time"
import { InvariantValidator, InvariantValidator__factory } from "types/generated"

const config = {
    a: BN.from(10000),
    limits: {
        min: simpleToExactAmount(5, 16),
        max: simpleToExactAmount(55, 16),
    },
}
const looseConfig = {
    a: BN.from(10000),
    limits: {
        min: simpleToExactAmount(1, 16),
        max: simpleToExactAmount(99, 16),
    },
}
const startingCap = simpleToExactAmount(100, 24) // 100 million * 1e18
const capFactor = simpleToExactAmount(1, 18)
const fee = simpleToExactAmount(6, 15)

const getReserves = (simpleUnits: number[], decimals: number[] = simpleUnits.map(() => 18)) =>
    simpleUnits.map((s, i) => ({
        ratio: simpleToExactAmount(1, 8 + (18 - decimals[i])),
        vaultBalance: simpleToExactAmount(s, decimals[i]),
    }))

describe("Invariant Validator", () => {
    let validator: InvariantValidator
    let sa: StandardAccounts

    before(async () => {
        const accounts = await ethers.getSigners()
        const mAssetMachine = await new MassetMachine().initAccounts(accounts)
        sa = mAssetMachine.sa
        validator = await new InvariantValidator__factory(sa.default.signer).deploy(startingCap, capFactor)
    })

    const redeployValidator = async (starting: BN, factor: BN) => {
        validator = await new InvariantValidator__factory(sa.default.signer).deploy(starting, factor)
    }

    // Cap = startingCap + (capFactor * weeksSinceLaunch^2)
    describe("Enforcing the TVL cap", () => {
        describe("before 7 weeks", () => {
            it("should revert if we exceed the cap", async () => {
                await redeployValidator(simpleToExactAmount(400000), simpleToExactAmount(900000))

                await validator.computeMint(getReserves([90000, 90000, 90000, 90000]), 0, simpleToExactAmount(10000), looseConfig)
                await expect(
                    validator.computeMint(getReserves([90000, 90000, 90000, 90000]), 0, simpleToExactAmount(45000), looseConfig),
                ).to.be.revertedWith("Cannot exceed TVL cap")

                await increaseTime(ONE_WEEK)

                // After 1 week the cap should be 1300e21
                await validator.computeMint(getReserves([300000, 300000, 300000, 300000]), 0, simpleToExactAmount(50000), looseConfig)
                await expect(
                    validator.computeMint(getReserves([300000, 300000, 300000, 300000]), 0, simpleToExactAmount(150000), looseConfig),
                ).to.be.revertedWith("Cannot exceed TVL cap")
            })
            it("should handle configurable parameters", async () => {
                // Consider Bitcoin has value of ~45k
                // 400e21 = 9e18, 900e21 = 2e19
                await redeployValidator(simpleToExactAmount(9, 18), simpleToExactAmount(2, 19))

                await validator.computeMint(getReserves([2, 2, 2, 2]), 0, simpleToExactAmount(1), looseConfig)
                await expect(validator.computeMint(getReserves([2, 2, 2, 2]), 0, simpleToExactAmount(3), looseConfig)).to.be.revertedWith(
                    "Cannot exceed TVL cap",
                )

                await increaseTime(ONE_WEEK)

                // After 1 week the cap should be ~29e18
                await validator.computeMint(getReserves([6, 6, 6, 6]), 0, simpleToExactAmount(3), looseConfig)
                await expect(validator.computeMint(getReserves([6, 6, 6, 6]), 0, simpleToExactAmount(10), looseConfig)).to.be.revertedWith(
                    "Cannot exceed TVL cap",
                )
            })
        })
        describe("after 7 weeks", () => {
            it("always passes", async () => {
                await redeployValidator(simpleToExactAmount(1, 19), simpleToExactAmount(1, 19))
                await validator.computeMint(getReserves([2, 2, 2, 2]), 0, simpleToExactAmount(1), looseConfig)
                await expect(validator.computeMint(getReserves([2, 2, 2, 2]), 0, simpleToExactAmount(4), looseConfig)).to.be.revertedWith(
                    "Cannot exceed TVL cap",
                )

                await increaseTime(ONE_WEEK.mul(7).sub(20))

                // After 7 weeks the cap should be 1e19 + (1e19 * 49) = 5e20
                await validator.computeMint(getReserves([120, 120, 120, 120]), 0, simpleToExactAmount(1), looseConfig)
                await expect(
                    validator.computeMint(getReserves([120, 120, 120, 120]), 0, simpleToExactAmount(100), looseConfig),
                ).to.be.revertedWith("Cannot exceed TVL cap")

                // Increase 30 seconds, weeksSinceLaunch > 7, and test passes
                await increaseTime(30)

                await validator.computeMint(getReserves([120, 120, 120, 120]), 0, simpleToExactAmount(100), looseConfig)
            })
            it("passes even with huge amount", async () => {
                await redeployValidator(simpleToExactAmount(1, 19), simpleToExactAmount(1, 19))

                await increaseTime(ONE_WEEK.mul(7).add(5))

                await validator.computeMint(getReserves([1000, 1000, 1000, 1000]), 0, simpleToExactAmount(1000), looseConfig)
            })
        })
    })

    describe("Validating bAssets with different ratios", () => {
        const x1 = getReserves([10, 10, 10, 10], [10, 18, 6, 18])
        const x2 = getReserves([10, 10, 10, 10], [18, 18, 6, 18])

        before(async () => {
            await redeployValidator(simpleToExactAmount(100, 19), simpleToExactAmount(1, 19))
        })
        it("should treat them equally in mint", async () => {
            const r1 = await validator.computeMint(x1, 0, simpleToExactAmount(1, 10), looseConfig)
            const r2 = await validator.computeMint(x2, 0, simpleToExactAmount(1, 18), looseConfig)

            expect(r1).eq(r2)
        })
        it("should treat them equally in mint multi", async () => {
            const r1 = await validator.computeMintMulti(x1, [0, 1], [simpleToExactAmount(1, 10), simpleToExactAmount(1, 18)], looseConfig)
            const r2 = await validator.computeMintMulti(x2, [0, 1], [simpleToExactAmount(1, 18), simpleToExactAmount(1, 18)], looseConfig)

            expect(r1).eq(r2)
        })
        it("should treat them equally in swap", async () => {
            const r1 = await validator.computeSwap(x1, 0, 1, simpleToExactAmount(1, 10), fee, looseConfig)
            const r2 = await validator.computeSwap(x2, 0, 1, simpleToExactAmount(1, 18), fee, looseConfig)

            expect(r1[0]).eq(r2[0])
            expect(r1[1]).eq(r2[1])
        })
        it("should treat them equally in redeem", async () => {
            const r1 = await validator.computeRedeem(x1, 0, simpleToExactAmount(1, 18), looseConfig)
            const r2 = await validator.computeRedeem(x2, 0, simpleToExactAmount(1, 18), looseConfig)

            expect(r1).eq(r2.div(simpleToExactAmount(1, 8)))
        })
        it("should treat them equally in redeem multi", async () => {
            const r1 = await validator.computeRedeemExact(x1, [0, 1], [simpleToExactAmount(1, 10), simpleToExactAmount(1, 18)], looseConfig)
            const r2 = await validator.computeRedeemExact(x2, [0, 1], [simpleToExactAmount(1, 18), simpleToExactAmount(1, 18)], looseConfig)

            expect(r1).eq(r2)
        })
    })

    describe("With params in different orders", () => {
        const x = getReserves([10, 10, 10, 10], [10, 18, 6, 18])
        before(async () => {
            await redeployValidator(simpleToExactAmount(100, 19), simpleToExactAmount(1, 19))
        })
        it("should treat them equally in mint multi", async () => {
            const r1 = await validator.computeMintMulti(x, [0, 1], [simpleToExactAmount(1, 10), simpleToExactAmount(1, 18)], looseConfig)
            const r2 = await validator.computeMintMulti(x, [1, 0], [simpleToExactAmount(1, 18), simpleToExactAmount(1, 10)], looseConfig)

            expect(r1).eq(r2)
        })
        it("should treat them equally in redeem multi", async () => {
            const r1 = await validator.computeRedeemExact(x, [0, 1], [simpleToExactAmount(1, 10), simpleToExactAmount(1, 18)], looseConfig)
            const r2 = await validator.computeRedeemExact(x, [1, 0], [simpleToExactAmount(1, 18), simpleToExactAmount(1, 10)], looseConfig)

            expect(r1).eq(r2)
        })
    })

    describe("Exceeding max weights", () => {
        const x = getReserves([30, 10, 10, 10])
        before(async () => {
            await redeployValidator(simpleToExactAmount(100, 19), simpleToExactAmount(1, 19))
        })
        it("should throw in mint multi", async () => {
            // max weight is 55%
            await expect(
                validator.computeMintMulti(x, [0, 1], [simpleToExactAmount(9, 18), simpleToExactAmount(1, 18)], config),
            ).to.be.revertedWith("Exceeds weight limits")
        })
    })

    describe("Using invalid args", () => {
        const x = getReserves([10, 10, 10, 10], [10, 18, 6, 18])
        it("should throw in mint", async () => {
            await expect(validator.computeMint(x, 4, simpleToExactAmount(1, 18), config)).to.be.reverted
        })
        it("should throw in mint multi", async () => {
            await expect(validator.computeMintMulti(x, [4, 5], [simpleToExactAmount(1, 18), simpleToExactAmount(1, 18)], config)).to.be
                .reverted
        })
        it("should throw in swap", async () => {
            await expect(validator.computeSwap(x, 4, 1, simpleToExactAmount(1, 18), fee, config)).to.be.reverted
        })
        it("should throw in redeem", async () => {
            await expect(validator.computeRedeem(x, 4, simpleToExactAmount(1, 18), config)).to.be.reverted
        })
        it("should throw in redeem multi", async () => {
            await expect(validator.computeRedeemExact(x, [1, 4], [simpleToExactAmount(1, 18), simpleToExactAmount(1, 18)], config)).to.be
                .reverted
        })
    })
})
