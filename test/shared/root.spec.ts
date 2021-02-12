import { BN } from "@utils/math"
import { ethers } from "hardhat"
import { MockRoot, MockRoot__factory } from "types/generated"
import { expect } from "chai"

describe("Root", () => {
    let root: MockRoot
    before(async () => {
        const accounts = await ethers.getSigners()
        root = await (await new MockRoot__factory(accounts[0])).deploy()
    })

    describe("calculating the root", () => {
        it("returns floored root", async () => {
            let amt = BN.from(1000000000)
            let res = await root.sqrt(amt)
            expect(res).to.be.eq(BN.from(31622))
            amt = BN.from(64)
            res = await root.sqrt(amt)
            expect(res).to.be.eq(BN.from(8))
            amt = BN.from("160000000000000000")
            res = await root.sqrt(amt)
            expect(res).to.be.eq(BN.from(400000000))
        })
        it("returns root for seconds in year", async () => {
            const amt = BN.from("31540000")
            const res = await root.sqrt(amt)
            expect(res).to.be.eq(BN.from(5616))
        })
        it("returns root for seconds in 6 months", async () => {
            const amt = BN.from("15724800")
            const res = await root.sqrt(amt)
            expect(res).to.be.eq(BN.from(3965))
        })
        it("returns root for seconds in week", async () => {
            const amt = BN.from("604800")
            const res = await root.sqrt(amt)
            expect(res).to.be.eq(BN.from(777))
        })
    })
})
