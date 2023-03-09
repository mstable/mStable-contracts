import { BN, simpleToExactAmount } from "@utils/math"
import { ethers } from "hardhat"
import { ERC20, MetaTokenRedeemer, MetaTokenRedeemer__factory, MockERC20__factory, MockRoot__factory } from "types/generated"
import { expect } from "chai"
import { Signer } from "ethers"
import { ZERO } from "@utils/constants"

describe("MetaTokenRedeemer", () => {
    let redeemer: MetaTokenRedeemer
    let deployer: Signer
    let alice: Signer
    let aliceAddress: string
    let mta: ERC20
    let weth: ERC20
    const rate = BN.from("20000000000000") // 1 MTA  = 0.00002 ETH  (Rate to simplify tests)
    const wethAmount = simpleToExactAmount(20)

    before(async () => {
        const accounts = await ethers.getSigners()
        deployer = accounts[0]
        alice = accounts[1]
        aliceAddress = await alice.getAddress()
        mta = await new MockERC20__factory(deployer).deploy(
            "Meta Token",
            "mta",
            18,
            await deployer.getAddress(),
            simpleToExactAmount(10_000_000),
        )
        weth = await new MockERC20__factory(deployer).deploy(
            "WETH Token",
            "weth",
            18,
            await deployer.getAddress(),
            simpleToExactAmount(1_000_000),
        )
        redeemer = await new MetaTokenRedeemer__factory(deployer).deploy(mta.address, weth.address, rate)
        // send mta to alice
        mta.transfer(aliceAddress, simpleToExactAmount(10_000))
    })
    it("deposits WETH into redeemer", async () => {
        await weth.approve(redeemer.address, wethAmount)
        const tx = await redeemer.fund(wethAmount)
        expect(tx)
            .to.emit(redeemer, "Funded")
            .withArgs(await deployer.getAddress(), wethAmount)
    })
    it("anyone can redeem MTA multiple times", async () => {
        const aliceBalanceBefore = await mta.balanceOf(aliceAddress)
        const aliceWethBalanceBefore = await weth.balanceOf(aliceAddress)
        const redeemerWethBalanceBefore = await weth.balanceOf(redeemer.address)

        const amount = aliceBalanceBefore.div(2)
        const wethAmount = amount.mul(rate).div(simpleToExactAmount(1))

        expect(aliceBalanceBefore, "balance").to.be.gt(ZERO)
        await mta.connect(alice).approve(redeemer.address, ethers.constants.MaxUint256)

        const tx1 = await redeemer.connect(alice).redeem(amount)
        expect(tx1).to.emit(redeemer, "Redeemed").withArgs(aliceAddress, amount, wethAmount)

        const tx2 = await redeemer.connect(alice).redeem(amount)
        expect(tx2).to.emit(redeemer, "Redeemed").withArgs(aliceAddress, amount, wethAmount)

        const aliceBalanceAfter = await mta.balanceOf(aliceAddress)
        const aliceWethBalanceAfter = await weth.balanceOf(aliceAddress)
        const redeemerWethBalanceAfter = await weth.balanceOf(redeemer.address)

        expect(aliceBalanceAfter, "alice mta balance").to.be.eq(ZERO)
        expect(aliceWethBalanceAfter, "alice weth balance").to.be.eq(aliceWethBalanceBefore.add(wethAmount.mul(2)))
        expect(redeemerWethBalanceAfter, "redeemer weth balance").to.be.eq(redeemerWethBalanceBefore.sub(wethAmount.mul(2)))
    })
    it("fails if there is not enough WETH (non realistic example) ", async () => {
        const mtaAmount = await mta.balanceOf(await deployer.getAddress())
        const wethAmount = mtaAmount.mul(rate).div(simpleToExactAmount(1))
        expect(wethAmount).to.be.gt(simpleToExactAmount(20))
        await mta.approve(redeemer.address, mtaAmount)

        await expect(redeemer.redeem(mtaAmount)).to.be.revertedWith("not enough WETH")
    })
})
