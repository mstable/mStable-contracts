import { fullScale, ratioScale } from "@utils/constants"
import { BN, simpleToExactAmount } from "@utils/math"
import { ethers } from "hardhat"
import { PublicStableMath, PublicStableMath__factory } from "types/generated"
import { expect } from "chai"

describe("StableMath", async () => {
    let math: PublicStableMath

    before(async () => {
        const accounts = await ethers.getSigners()
        math = await (await new PublicStableMath__factory(accounts[0])).deploy()
    })

    /** *************************************
                    GETTERS
    *************************************** */

    describe("calling the getters", async () => {
        it("should return the correct scale", async () => {
            expect(await math.getFullScale()).to.be.eq(simpleToExactAmount(1, 18))
            expect(await math.getFullScale()).to.be.eq(fullScale)
        })

        it("should return the correct ratio scale", async () => {
            expect(await math.getRatioScale()).to.be.eq(simpleToExactAmount(1, 8))
            expect(await math.getRatioScale()).to.be.eq(ratioScale)
        })
    })

    describe("scaling an integer", async () => {
        it("should scale an integer correctly", async () => {
            expect(await math.scaleInteger("1000")).to.be.eq(simpleToExactAmount(1000, 18))
            expect(await math.scaleInteger("7")).to.be.eq(simpleToExactAmount(7, 18))
            expect(await math.scaleInteger("111231231231")).to.be.eq(simpleToExactAmount(111231231231, 18))
            expect(await math.scaleInteger(simpleToExactAmount(1, 18))).to.be.eq(simpleToExactAmount(1, 36))
            expect(await math.scaleInteger(1)).to.be.eq(simpleToExactAmount(1, 18))
        })

        it("should fail if integer overflow", async () => {
            await expect(math.scaleInteger(simpleToExactAmount(1, 70))).to.be.revertedWith("VM Exception")
        })
    })

    /** *************************************
            PRECISE ARITHMETIC
    *************************************** */

    describe("calling mulTruncate(x, y, scale)", async () => {
        it("should return correct results", async () => {
            let x = simpleToExactAmount(1, 10)
            let y = simpleToExactAmount(9, 9)
            let scale = simpleToExactAmount(1, 12)
            let result = await math.mulTruncateScale(x, y, scale)
            expect(result).to.be.eq(BN.from(x).mul(y).div(scale))
            expect(result).to.be.lt(x)

            x = simpleToExactAmount(250, 22)
            y = simpleToExactAmount(95, 16)
            scale = fullScale
            result = await math.mulTruncateScale(x, y, scale)
            expect(result).to.be.eq(BN.from(x).mul(y).div(scale))
            expect(result).to.be.lt(x)
        })
        it("should truncate fractions", async () => {
            const x = BN.from(11)
            const y = BN.from(3)
            // 33 / 10 == 3.33.. should return 3
            const result = await math.mulTruncateScale(x, y, BN.from(10))
            expect(result).to.be.eq(BN.from(3))
        })
        it("should fail if scale operand is 0", async () => {
            const sampleInput = simpleToExactAmount(1, 18)
            await expect(math.mulTruncateScale(sampleInput, sampleInput, 0)).to.be.revertedWith("VM Exception")
        })
        it("should return 0 if either operand is 0", async () => {
            expect(await math.mulTruncateScale(BN.from(0), simpleToExactAmount(1, 18), fullScale)).to.be.eq(BN.from(0))
            expect(await math.mulTruncateScale(simpleToExactAmount(1, 18), BN.from(0), fullScale)).to.be.eq(BN.from(0))
        })
    })

    describe("calling mulTruncate(x, y)", async () => {
        it("should return correct results", async () => {
            let x = simpleToExactAmount(1, 10)
            let y = simpleToExactAmount(9, 9)
            let result = await math.mulTruncate(x, y)
            expect(result).to.be.eq(BN.from(x).mul(y).div(fullScale))
            expect(result).to.be.lt(x)

            x = simpleToExactAmount(1, 20)
            y = simpleToExactAmount(25, 16)
            result = await math.mulTruncate(x, y)
            expect(result).to.be.eq(simpleToExactAmount(25, 18))
            expect(result).to.be.lt(x)
        })
        it("should truncate fractions", async () => {
            const x = BN.from(1234)
            const y = simpleToExactAmount(75, 16)
            const result = await math.mulTruncate(x, y)
            // 75% of 1234 = 925.5, round to 925
            expect(result).to.be.eq(BN.from(925))
        })
        it("should return 0 if operands multiplied are less than the scale", async () => {
            const x = BN.from(100)
            const y = simpleToExactAmount(1, 15)
            const result = await math.mulTruncate(x, y)
            // (1e2 * 1e15) / 1e18 = 0.1
            expect(result).to.be.eq(BN.from(0))
        })
        it("should return 0 if either operand is 0", async () => {
            expect(await math.mulTruncate(BN.from(0), simpleToExactAmount(1, 18))).to.be.eq(BN.from(0))
            expect(await math.mulTruncate(simpleToExactAmount(1, 18), BN.from(0))).to.be.eq(BN.from(0))
        })
    })

    describe("calling mulTruncateCeil(x, y)", async () => {
        it("should round up any fraction", async () => {
            let x = BN.from(3)
            let y = simpleToExactAmount(11, 17)
            let result = await math.mulTruncateCeil(x, y)
            // (3 * 11e17) / 1e18 == 33e17 / 1e18 == 3.3.
            expect(result).to.be.eq(BN.from(4))

            x = BN.from(1)
            y = simpleToExactAmount(95, 16)
            result = await math.mulTruncateCeil(x, y)
            // (1 * 95e16) / 1e18 == 0.95
            expect(result).to.be.eq(BN.from(1))

            x = BN.from(1234)
            y = simpleToExactAmount(75, 16)
            result = await math.mulTruncateCeil(x, y)
            // 75% of 1234 = 925.5, round to 926
            expect(result).to.be.eq(BN.from(926))
        })
        it("should return 1 if operands multiplied are less than the scale", async () => {
            const x = BN.from(100)
            const y = simpleToExactAmount(1, 15)
            const result = await math.mulTruncateCeil(x, y)
            // (1e2 * 1e15) / 1e18 = 0.1
            expect(result).to.be.eq(BN.from(1))
        })
        it("should not round a 0 fraction", async () => {
            const x = BN.from(30)
            const y = simpleToExactAmount(11, 17)
            const result = await math.mulTruncateCeil(x, y)
            // (30 * 11e17) / 1e18 == 33e18 / 1e18 == 33
            expect(result).to.be.eq(BN.from(33))
        })
        it("should return 0 if either operand is 0", async () => {
            expect(await math.mulTruncateCeil(BN.from(0), simpleToExactAmount(1, 18))).to.be.eq(BN.from(0))
            expect(await math.mulTruncateCeil(simpleToExactAmount(1, 18), BN.from(0))).to.be.eq(BN.from(0))
        })
    })

    describe("calling divPrecisely(x, y)", async () => {
        it("should calculate x as a percentage value of y to scale of 1e18", async () => {
            let x = simpleToExactAmount(1, 18)
            let y = simpleToExactAmount(1, 17)
            let result = await math.divPrecisely(x, y)
            // (1e18 * 1e18) / 1e17 == 1e19
            expect(result).to.be.eq(simpleToExactAmount(1, 19))

            x = simpleToExactAmount(1, 17)
            y = simpleToExactAmount(1, 19)
            result = await math.divPrecisely(x, y)
            // (1e17 * 1e18) / 1e19 == 1e16
            expect(result).to.be.eq(simpleToExactAmount(1, 16))
        })
        it("should ignore remaining fractions", async () => {
            let x = BN.from(100)
            let y = simpleToExactAmount(1234, 16)
            let result = await math.divPrecisely(x, y)
            // (1e2 * 1e18) / 1234e16 == 8.103...
            expect(result).to.be.eq(BN.from(8))

            x = simpleToExactAmount(1, 4)
            y = simpleToExactAmount(1, 24)
            result = await math.divPrecisely(x, y)
            // (1e4 * 1e18) / 1e24 == 0.01
            expect(result).to.be.eq(BN.from(0))
        })
        it("should fail if the divisor is 0", async () => {
            const sampleInput = simpleToExactAmount(1, 18)
            await expect(math.divPrecisely(sampleInput, 0)).to.be.revertedWith("VM Exception")
        })
        it("should fail if the left operand is too large", async () => {
            const sampleInput = simpleToExactAmount(1, 65)
            await expect(math.divPrecisely(sampleInput, simpleToExactAmount(1, 18))).to.be.revertedWith("VM Exception")
        })
    })

    /** *************************************
                RATIO FUNCS
    *************************************** */

    describe("calling mulRatioTruncate(x, ratio)", async () => {
        it("should calculate correct mAsset value from bAsset", async () => {
            let x = simpleToExactAmount(1, 4) // 1e4 base bAsset units
            let y = ratioScale // 1e8 standard ratio
            let result = await math.mulRatioTruncate(x, y)
            expect(result).to.be.eq(simpleToExactAmount(1, 4))

            x = simpleToExactAmount(1, 12) // 1e12 units of bAsset
            y = simpleToExactAmount(1, 14) // bAsset with 12 decimals, 1e8 * 1e(18-12)
            result = await math.mulRatioTruncate(x, y)
            expect(result).to.be.eq(simpleToExactAmount(1, 18))

            x = BN.from(1234) // 1234 units of bAsset
            y = simpleToExactAmount("0.324", 14) // bAsset with 12 decimals and 0.324 mm
            result = await math.mulRatioTruncate(x, y)
            // result == 399.816 units
            expect(result).to.be.eq(BN.from(399816000))
        })
        it("should truncate fractions", async () => {
            const x = BN.from(1234) // 1234 units of bAsset
            const y = simpleToExactAmount("0.324", 8) // bAsset with 18 decimals, but 0.324 mm
            const result = await math.mulRatioTruncate(x, y)
            // result == 399.816 units
            expect(result).to.be.eq(BN.from(399))
        })
        it("should return 0 if operands multiplied are less than the scale", async () => {
            const x = BN.from(100)
            const y = simpleToExactAmount(1, 5)
            const result = await math.mulRatioTruncate(x, y)
            // (1e2 * 1e5) / 1e8 = 0.1
            expect(result).to.be.eq(BN.from(0))
        })
        it("should return 0 if either operand is 0", async () => {
            expect(await math.mulRatioTruncate(BN.from(0), simpleToExactAmount(1, 18))).to.be.eq(BN.from(0))
            expect(await math.mulRatioTruncate(simpleToExactAmount(1, 18), BN.from(0))).to.be.eq(BN.from(0))
        })
    })

    describe("calling mulRatioTruncateCeil(x, ratio)", async () => {
        it("should calculate correct mAsset value from bAsset", async () => {
            let x = simpleToExactAmount(1, 4) // 1e4 base bAsset units
            let y = ratioScale // 1e8 standard ratio
            let result = await math.mulRatioTruncateCeil(x, y)
            expect(result).to.be.eq(simpleToExactAmount(1, 4))

            x = simpleToExactAmount(1, 12) // 1e12 units of bAsset
            y = simpleToExactAmount(1, 14) // bAsset with 12 decimals, 1e8 * 1e(18-12)
            result = await math.mulRatioTruncateCeil(x, y)
            expect(result).to.be.eq(simpleToExactAmount(1, 18))

            x = BN.from(1234) // 1234 units of bAsset
            y = simpleToExactAmount("0.324", 14) // bAsset with 12 decimals and 0.324 mm
            result = await math.mulRatioTruncateCeil(x, y)
            // result == 399.816 units
            expect(result).to.be.eq(BN.from(399816000))
        })
        it("should round up any fractions", async () => {
            let x = BN.from(1234) // 1234 units of bAsset
            let y = simpleToExactAmount("0.324", 8) // bAsset with 18 decimals, but 0.324 mm
            let result = await math.mulRatioTruncateCeil(x, y)
            // result == 399.816 units
            expect(result).to.be.eq(BN.from(400))

            x = simpleToExactAmount(1234, 3) // 1.234e6 units of bAsset
            y = simpleToExactAmount(3243, 4) // ratio = 3.243e7
            result = await math.mulRatioTruncateCeil(x, y)
            // result == 400186.2 units
            expect(result).to.be.eq(BN.from(400187))
        })
        it("should return 1 if operands multiplied are less than the scale", async () => {
            const x = BN.from(100)
            const y = simpleToExactAmount(1, 5)
            const result = await math.mulRatioTruncateCeil(x, y)
            // (1e2 * 1e5) / 1e8 = 0.1
            expect(result).to.be.eq(BN.from(1))
        })
        it("should return 0 if either operand is 0", async () => {
            expect(await math.mulRatioTruncateCeil(BN.from(0), simpleToExactAmount(1, 18))).to.be.eq(BN.from(0))
            expect(await math.mulRatioTruncateCeil(simpleToExactAmount(1, 18), BN.from(0))).to.be.eq(BN.from(0))
        })
    })

    describe("calling divRatioPrecisely(x, ratio)", async () => {
        it("should calculate x as a percentage value of y to scale of 1e8", async () => {
            let x = simpleToExactAmount(1, 18)
            let y = simpleToExactAmount(1, 8)
            let result = await math.divRatioPrecisely(x, y)
            // (1e18 * 1e8) / 1e8 == 1e18
            expect(result).to.be.eq(simpleToExactAmount(1, 18))

            x = simpleToExactAmount(1, 14) // 1e14 base units of mAsset
            y = simpleToExactAmount(1, 12) // bAsset with 14 decimals
            result = await math.divRatioPrecisely(x, y)
            // Should equal mAsset units - 4 decimals, or 1e10
            expect(result).to.be.eq(simpleToExactAmount(1, 10))

            x = simpleToExactAmount("0.235", 18) // 235e15
            y = simpleToExactAmount(1, 12)
            result = await math.divRatioPrecisely(x, y)
            // Should equal mAsset units - 4 decimals, or 235e11
            expect(result).to.be.eq(simpleToExactAmount(235, 11))
        })
        it("should ignore remaining fractions", async () => {
            let x = BN.from(100)
            let y = simpleToExactAmount(1234, 6)
            let result = await math.divRatioPrecisely(x, y)
            // (1e2 * 1e8) / 1234e6 == 8.103...
            expect(result).to.be.eq(BN.from(8))

            x = simpleToExactAmount(1, 4)
            y = simpleToExactAmount(1, 14)
            result = await math.divRatioPrecisely(x, y)
            // (1e4 * 1e8) / 1e14 == 0.01
            expect(result).to.be.eq(BN.from(0))
        })
        it("should fail if the divisor is 0", async () => {
            const sampleInput = simpleToExactAmount(1, 18)
            await expect(math.divRatioPrecisely(sampleInput, 0)).to.be.revertedWith("VM Exception")
        })
        it("should fail if the left operand is too large", async () => {
            const sampleInput = simpleToExactAmount(1, 71)
            await expect(math.divRatioPrecisely(sampleInput, simpleToExactAmount(1, 8))).to.be.revertedWith("VM Exception")
        })
    })

    /** *************************************
                    HELPERS
    *************************************** */

    describe("calling min(x, y)", async () => {
        it("should find the minimum number", async () => {
            let x = BN.from(1)
            let y = BN.from(2)
            expect(await math.min(x, y)).to.be.eq(x)
            expect(await math.min(y, x)).to.be.eq(x)

            x = BN.from(2)
            y = BN.from(1)
            expect(await math.min(x, y)).to.be.eq(y)
            expect(await math.min(y, x)).to.be.eq(y)

            x = BN.from(0)
            y = simpleToExactAmount(2323, 24)
            expect(await math.min(x, y)).to.be.eq(x)
            expect(await math.min(y, x)).to.be.eq(x)

            x = simpleToExactAmount("0.242", 4)
            y = BN.from(0)
            expect(await math.min(x, y)).to.be.eq(y)
            expect(await math.min(y, x)).to.be.eq(y)
        })
    })

    describe("calling max(x, y)", async () => {
        it("should find the maximum number", async () => {
            let x = BN.from(1)
            let y = BN.from(2)
            expect(await math.max(x, y)).to.be.eq(y)
            expect(await math.max(y, x)).to.be.eq(y)

            x = BN.from(2)
            y = BN.from(1)
            expect(await math.max(x, y)).to.be.eq(x)
            expect(await math.max(y, x)).to.be.eq(x)

            x = BN.from(0)
            y = simpleToExactAmount(2323, 24)
            expect(await math.max(x, y)).to.be.eq(y)
            expect(await math.max(y, x)).to.be.eq(y)

            x = simpleToExactAmount("0.242", 4)
            y = BN.from(0)
            expect(await math.max(x, y)).to.be.eq(x)
            expect(await math.max(y, x)).to.be.eq(x)
        })
    })

    describe("calling clamp(x, uepprBound)", async () => {
        it("should clamp to the upper bound", async () => {
            let x = BN.from(1)
            let bound = BN.from(2)
            expect(await math.clamp(x, bound)).to.be.eq(x)

            x = BN.from(2)
            bound = BN.from(1)
            expect(await math.clamp(x, bound)).to.be.eq(bound)

            x = BN.from(0)
            bound = simpleToExactAmount(2323, 24)
            expect(await math.clamp(x, bound)).to.be.eq(x)

            x = simpleToExactAmount("0.242", 4)
            bound = BN.from(0)
            expect(await math.clamp(x, bound)).to.be.eq(bound)
        })
    })
})
