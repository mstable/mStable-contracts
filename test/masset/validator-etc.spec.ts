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
        validator = await new InvariantValidator__factory(sa.default.signer).deploy()
    })

    const redeployValidator = async () => {
        validator = await new InvariantValidator__factory(sa.default.signer).deploy()
    }

    describe("Validating bAssets with different ratios", () => {
        const x1 = getReserves([10, 10, 10, 10], [10, 18, 6, 18])
        const x2 = getReserves([10, 10, 10, 10], [18, 18, 6, 18])

        before(async () => {
            await redeployValidator()
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
            await redeployValidator()
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
            await redeployValidator()
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
