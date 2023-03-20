import { simpleToExactAmount } from "@utils/math"
import { ethers } from "hardhat"
import { ERC20, MetaTokenRedeemer, MetaTokenRedeemer__factory, MockERC20__factory } from "types/generated"
import { expect } from "chai"
import { Signer } from "ethers"
import { ONE_DAY, ZERO } from "@utils/constants"
import { getTimestamp, increaseTime } from "@utils/time"

describe("MetaTokenRedeemer", () => {
    let redeemer: MetaTokenRedeemer
    let deployer: Signer
    let alice: Signer
    let bob: Signer
    let aliceAddress: string
    let mta: ERC20
    let weth: ERC20

    before(async () => {
        const accounts = await ethers.getSigners()
        deployer = accounts[0]
        alice = accounts[1]
        bob = accounts[2]
        aliceAddress = await alice.getAddress()
        mta = await new MockERC20__factory(deployer).deploy("Meta Token", "mta", 18, await deployer.getAddress(), 100_000_000)
        weth = await new MockERC20__factory(deployer).deploy("WETH Token", "weth", 18, await deployer.getAddress(), 3_000)
        redeemer = await new MetaTokenRedeemer__factory(deployer).deploy(mta.address, weth.address, ONE_DAY.mul(90))
        // send mta to alice
        mta.transfer(aliceAddress, simpleToExactAmount(20_000_000))
        mta.transfer(await bob.getAddress(), simpleToExactAmount(20_000_000))
    })
    it("constructor parameters are correct", async () => {
        const registerPeriod = await redeemer.registerPeriod()
        expect(await redeemer.MTA(), "MTA").to.be.eq(mta.address)
        expect(await redeemer.WETH(), "WETH").to.be.eq(weth.address)
        expect(await redeemer.PERIOD_DURATION(), "PERIOD_DURATION").to.be.eq(ONE_DAY.mul(90))
        expect(registerPeriod.start, "periodStart").to.be.eq(ZERO)
        expect(registerPeriod.end, "periodEnd").to.be.eq(ZERO)
        expect(await redeemer.totalFunded(), "totalFunded").to.be.eq(ZERO)
        expect(await redeemer.totalRegistered(), "totalRegistered").to.be.eq(ZERO)
        expect(await redeemer.balances(aliceAddress), "balances").to.be.eq(ZERO)
    })
    it("fails to register if period has not started", async () => {
        expect((await redeemer.registerPeriod()).start, "periodStart").to.be.eq(ZERO)

        await expect(redeemer.register(ZERO), "register").to.be.revertedWith("Registration period not started")
    })
    it("funds WETH into redeemer", async () => {
        const wethAmount = await weth.balanceOf(await deployer.getAddress())
        const redeemerWethBalance = await weth.balanceOf(redeemer.address)
        await weth.approve(redeemer.address, wethAmount)
        const now = await getTimestamp()
        const tx = await redeemer.fund(wethAmount.div(2))
        expect(tx)
            .to.emit(redeemer, "Funded")
            .withArgs(await deployer.getAddress(), wethAmount.div(2))
        // Check total funded increases
        expect(await redeemer.totalFunded(), "total funded").to.be.eq(wethAmount.div(2))
        expect(await weth.balanceOf(redeemer.address), "weth balance").to.be.eq(redeemerWethBalance.add(wethAmount.div(2)))
        // Fist time it is invoked , period details are set
        const registerPeriod = await redeemer.registerPeriod()
        expect(registerPeriod.start, "period start").to.be.eq(now.add(1))
        expect(registerPeriod.end, "period end").to.be.eq(now.add(1).add(await redeemer.PERIOD_DURATION()))
    })
    it("funds again WETH into redeemer", async () => {
        const wethAmount = await weth.balanceOf(await deployer.getAddress())
        let registerPeriod = await redeemer.registerPeriod()

        const periodStart = registerPeriod.start
        const periodEnd = registerPeriod.end
        const totalFunded = await redeemer.totalFunded()
        const redeemerWethBalance = await weth.balanceOf(redeemer.address)

        await weth.approve(redeemer.address, wethAmount)
        const tx = await redeemer.fund(wethAmount)
        expect(tx)
            .to.emit(redeemer, "Funded")
            .withArgs(await deployer.getAddress(), wethAmount)
        // Check total funded increases
        expect(await redeemer.totalFunded(), "total funded").to.be.eq(totalFunded.add(wethAmount))
        expect(await weth.balanceOf(redeemer.address), "weth balance").to.be.eq(redeemerWethBalance.add(wethAmount))
        // After first time, period details do not change
        registerPeriod = await redeemer.registerPeriod()
        expect(registerPeriod.start, "period start").to.be.eq(periodStart)
        expect(registerPeriod.end, "period end").to.be.eq(periodEnd)
    })
    const registerTests = [{ user: "alice" }, { user: "bob" }]
    registerTests.forEach((test, i) =>
        it(`${test.user} can register MTA multiple times`, async () => {
            const accounts = await ethers.getSigners()
            const signer = accounts[i + 1]
            const signerAddress = await signer.getAddress()
            const signerBalanceBefore = await mta.balanceOf(signerAddress)
            const redeemerMTABalance = await mta.balanceOf(redeemer.address)

            const amount = signerBalanceBefore.div(2)
            expect(signerBalanceBefore, "balance").to.be.gt(ZERO)
            await mta.connect(signer).approve(redeemer.address, ethers.constants.MaxUint256)

            const tx1 = await redeemer.connect(signer).register(amount)
            expect(tx1).to.emit(redeemer, "Register").withArgs(signerAddress, amount)

            const tx2 = await redeemer.connect(signer).register(amount)
            expect(tx2).to.emit(redeemer, "Register").withArgs(signerAddress, amount)

            const signerBalanceAfter = await mta.balanceOf(signerAddress)
            const redeemerMTABalanceAfter = await mta.balanceOf(redeemer.address)

            expect(signerBalanceAfter, "user mta balance").to.be.eq(ZERO)
            expect(redeemerMTABalanceAfter, "redeemer mta balance").to.be.eq(redeemerMTABalance.add(signerBalanceBefore))
        }),
    )
    it("fails to redeem if Redeem period not started", async () => {
        const now = await getTimestamp()
        const registerPeriod = await redeemer.registerPeriod()
        expect(now, "now < periodEnd").to.be.lt(registerPeriod.end)

        await expect(redeemer.redeem(), "redeem").to.be.revertedWith("Redeem period not started")
    })
    it("fails to fund or register if register period ended", async () => {
        await increaseTime(ONE_DAY.mul(91))
        const registerPeriod = await redeemer.registerPeriod()
        const now = await getTimestamp()

        expect(now, "now > periodEnd").to.be.gt(registerPeriod.end)

        await expect(redeemer.fund(ZERO), "fund").to.be.revertedWith("Funding period ended")
        await expect(redeemer.register(ZERO), "register").to.be.revertedWith("Registration period ended")
    })

    it("anyone can redeem WETH", async () => {
        const aliceWethBalanceBefore = await weth.balanceOf(aliceAddress)
        const redeemerWethBalanceBefore = await weth.balanceOf(redeemer.address)
        const redeemerMTABalanceBefore = await mta.balanceOf(redeemer.address)
        const registeredAmount = await redeemer.balances(aliceAddress)

        const totalRegistered = await redeemer.totalRegistered()
        const totalFunded = await redeemer.totalFunded()

        const expectedWeth = registeredAmount.mul(totalFunded).div(totalRegistered)

        expect(registeredAmount, "registeredAmount").to.be.gt(ZERO)

        const tx = await redeemer.connect(alice).redeem()
        expect(tx).to.emit(redeemer, "Redeemed").withArgs(aliceAddress, registeredAmount, expectedWeth)

        const redeemerMTABalanceAfter = await mta.balanceOf(redeemer.address)
        const aliceWethBalanceAfter = await weth.balanceOf(aliceAddress)
        const redeemerWethBalanceAfter = await weth.balanceOf(redeemer.address)
        const registeredAmountAfter = await redeemer.balances(aliceAddress)

        expect(registeredAmountAfter, "alice register balance").to.be.eq(ZERO)
        expect(aliceWethBalanceAfter, "alice weth balance").to.be.eq(aliceWethBalanceBefore.add(expectedWeth))
        expect(redeemerWethBalanceAfter, "redeemer weth balance").to.be.eq(redeemerWethBalanceBefore.sub(expectedWeth))
        // invariants
        expect(redeemerMTABalanceAfter, "no mta is transferred").to.be.eq(redeemerMTABalanceBefore)
        expect(totalRegistered, "register amount").to.be.eq(await redeemer.totalRegistered())
        expect(totalFunded, "funded amount ").to.be.eq(await redeemer.totalFunded())
    })
    it("fails if sender did not register", async () => {
        const registeredAmount = await redeemer.balances(await deployer.getAddress())
        expect(registeredAmount).to.be.eq(ZERO)
        await expect(redeemer.connect(deployer).redeem()).to.be.revertedWith("No balance")
    })
})
