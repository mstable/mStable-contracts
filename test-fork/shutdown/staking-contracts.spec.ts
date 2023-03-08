import { assertBNClose } from "@utils/assertions"
import { ONE_DAY, ONE_WEEK, ZERO_ADDRESS } from "@utils/constants"
import { impersonateAccount } from "@utils/fork"
import { simpleToExactAmount } from "@utils/math"
import { increaseTime } from "@utils/time"
import { expect } from "chai"
import { formatUnits } from "ethers/lib/utils"
import { network } from "hardhat"
import { resolveAddress } from "tasks/utils/networkAddressFactory"
import { mBPT, MTA } from "tasks/utils/tokens"
import {
    Account,
    IERC20,
    IERC20__factory,
    Nexus,
    Nexus__factory,
    StakedTokenBPT,
    StakedTokenBPT__factory,
    StakedTokenMTA,
    StakedTokenMTA__factory,
} from "types"

const RecollateraliserKey = "0x39e3ed1fc335ce346a8cbe3e64dd525cf22b37f1e2104a755e761c3c1eb4734f" as const

const mtaWhaleAddress = "0xf7749B41db006860cEc0650D18b8013d69C44Eeb"
const mbptWhaleAddress = "0x085909388fc0cE9E5761ac8608aF8f2F52cb8B89"
const stkmtaWhaleAddress = "0xf7749B41db006860cEc0650D18b8013d69C44Eeb"
const stkmbptWhaleAddress = "0x0bf5eE128D559eEF716172A2E535A700129d278f"

context("MTA and mBPT Staking shutdown", async () => {
    let ops: Account
    let governor: Account
    let mtaWhale: Account
    let mbptWhale: Account
    let stkmtaWhale: Account
    let stkmbptWhale: Account
    let nexus: Nexus
    let stkMTA: StakedTokenMTA
    let stkmBPT: StakedTokenBPT
    let mta: IERC20
    let mbpt: IERC20

    const runSetup = async (blockNumber: number) => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber,
                    },
                },
            ],
        })
        ops = await impersonateAccount(resolveAddress("OperationsSigner"))
        governor = await impersonateAccount(resolveAddress("Governor"))
        mtaWhale = await impersonateAccount(mtaWhaleAddress)
        mbptWhale = await impersonateAccount(mbptWhaleAddress)
        stkmtaWhale = await impersonateAccount(stkmtaWhaleAddress)
        stkmbptWhale = await impersonateAccount(stkmbptWhaleAddress)

        nexus = Nexus__factory.connect(resolveAddress("Nexus"), governor.signer)

        mta = IERC20__factory.connect(MTA.address, ops.signer)
        mbpt = IERC20__factory.connect(mBPT.address, ops.signer)
        stkMTA = StakedTokenMTA__factory.connect(resolveAddress("StakedTokenMTA"), ops.signer)
        stkmBPT = StakedTokenBPT__factory.connect(resolveAddress("StakedTokenBPT"), ops.signer)
    }

    describe("Before shutdown", () => {
        before("reset block number", async () => {
            await runSetup(16780000)
        })
        describe("MTA Staking", () => {
            it("should be able to claim rewards", async () => {
                const mtaBalanceBefore = await mta.balanceOf(stkmtaWhale.address)

                await stkMTA.connect(stkmtaWhale.signer)["claimReward()"]()

                expect(await mta.balanceOf(stkmtaWhale.address), "stkMTA whale MTA bal after").to.be.gt(mtaBalanceBefore)
            })
            it("should be able to stake", async () => {
                const mtaBalanceBefore = await mta.balanceOf(mtaWhale.address)

                await stkMTA.connect(mtaWhale.signer)["stake(uint256)"](simpleToExactAmount(1000))

                expect(await mta.balanceOf(mtaWhale.address), "MTA whale MTA bal after").to.be.lt(mtaBalanceBefore)
            })
            it("should not be able to withdraw before cooldown", async () => {
                const balanceDataBefore = await stkMTA.balanceData(stkmtaWhale.address)
                expect(balanceDataBefore.cooldownUnits, "stkMTA cooldown units before").to.eq(0)
                expect(balanceDataBefore.cooldownTimestamp, "stkMTA cooldown timestamp before").to.eq(0)

                const tx = stkMTA.connect(stkmtaWhale.signer).withdraw(balanceDataBefore.raw, stkmtaWhale.address, true, true)
                await expect(tx).to.revertedWith("UNSTAKE_WINDOW_FINISHED")
            })
            it("should be able to withdraw after 3 week cooldown", async () => {
                const balanceDataBefore = await stkMTA.balanceData(stkmtaWhale.address)

                await stkMTA.connect(stkmtaWhale.signer).startCooldown(balanceDataBefore.raw)
                const balanceDataAfter = await stkMTA.balanceData(stkmtaWhale.address)
                expect(balanceDataAfter.cooldownUnits, "stkMTA cooldown units after").to.gt(0)
                expect(balanceDataAfter.cooldownTimestamp, "stkMTA cooldown timestamp after").to.gt(0)

                // Can withdraw after 3 weeks but not after 5 weeks
                await increaseTime(ONE_DAY.mul(22))

                await stkMTA.connect(stkmtaWhale.signer).withdraw(balanceDataBefore.raw, stkmtaWhale.address, true, false)
            })
        })
        describe("mBPT Staking", () => {
            it("should be able to claim rewards", async () => {
                const mtaBalanceBefore = await mta.balanceOf(stkmbptWhale.address)

                await stkmBPT.connect(stkmbptWhale.signer)["claimReward()"]()

                expect(await mta.balanceOf(stkmbptWhale.address), "stkMTA whale MTA bal after").to.be.gt(mtaBalanceBefore)
            })
            it("should be able to stake mBPT", async () => {
                const mbptBalanceBefore = await mbpt.balanceOf(mbptWhale.address)
                const stakeAmount = simpleToExactAmount(50)
                expect(stakeAmount, "mBPT balance before").to.lte(mbptBalanceBefore)

                await mbpt.connect(mbptWhale.signer).approve(stkmBPT.address, stakeAmount)
                await stkmBPT.connect(mbptWhale.signer)["stake(uint256)"](stakeAmount)

                expect(await mbpt.balanceOf(mbptWhale.address), "mBPT whale mBPT bal after").to.be.eq(mbptBalanceBefore.sub(stakeAmount))
            })
            it("should not be able to withdraw before cooldown", async () => {
                const balanceDataBefore = await stkmBPT.balanceData(stkmbptWhale.address)

                const tx = stkmBPT.connect(stkmbptWhale.signer).withdraw(balanceDataBefore.raw, stkmbptWhale.address, true, true)
                await expect(tx).to.revertedWith("UNSTAKE_WINDOW_FINISHED")
            })
            it("should be able to withdraw after 3 week cooldown", async () => {
                const balanceDataBefore = await stkmBPT.balanceData(stkmbptWhale.address)

                await stkmBPT.connect(stkmbptWhale.signer).startCooldown(balanceDataBefore.raw)
                const balanceDataAfter = await stkmBPT.balanceData(stkmbptWhale.address)
                expect(balanceDataAfter.cooldownUnits, "stkmBPT cooldown units after").to.gt(0)
                expect(balanceDataAfter.cooldownTimestamp, "stkmBPT cooldown timestamp after").to.gt(0)

                // Can withdraw after 3 weeks but not after 5 weeks
                await increaseTime(ONE_DAY.mul(22))

                await stkmBPT.connect(stkmbptWhale.signer).withdraw(balanceDataBefore.raw, stkmbptWhale.address, true, false)
            })
        })
    })
    describe("After shutdown", () => {
        before("reset block number", async () => {
            await runSetup(16780000)
        })
        it("Governor add recollateraliser module to Nexus", async () => {
            expect(await nexus.getModule(RecollateraliserKey)).to.eq(ZERO_ADDRESS)

            await nexus.connect(governor.signer).proposeModule(RecollateraliserKey, governor.address)

            expect(await nexus.getModule(RecollateraliserKey)).to.eq(ZERO_ADDRESS)

            await increaseTime(ONE_WEEK)

            await nexus.connect(governor.signer).acceptProposedModule(RecollateraliserKey)

            expect(await nexus.getModule(RecollateraliserKey)).to.eq(governor.address)
        })
        describe("MTA Staking", () => {
            it("governor slashes MTA stakers by tiny amount", async () => {
                await stkMTA.connect(governor.signer).changeSlashingPercentage(1)

                await stkMTA.connect(governor.signer).emergencyRecollateralisation()
            })
            it("should be able to claim rewards", async () => {
                const mtaBalanceBefore = await mta.balanceOf(stkmtaWhale.address)

                await stkMTA.connect(stkmtaWhale.signer)["claimReward()"]()

                expect(await mta.balanceOf(stkmtaWhale.address), "stkMTA whale MTA bal after").to.be.gt(mtaBalanceBefore)
            })
            it("should not be able to stake", async () => {
                const tx = stkMTA.connect(mtaWhale.signer)["stake(uint256)"](simpleToExactAmount(1000))
                await expect(tx).to.be.revertedWith("Only while fully collateralised")
            })
            it("should be able to withdraw all without cooldown", async () => {
                const mtaBalBefore = await mta.balanceOf(stkmtaWhale.address)
                const balanceDataBefore = await stkMTA.balanceData(stkmtaWhale.address)
                expect(balanceDataBefore.raw, "stkMTA bal before").to.gt(0)

                await stkMTA.connect(stkmtaWhale.signer).withdraw(balanceDataBefore.raw, stkmtaWhale.address, true, true)

                expect(await stkMTA.balanceOf(stkmtaWhale.address), "stkMTA bal after").to.eq(0)
                // expect(await mta.balanceOf(stkmtaWhale.address), "MTA bal after").to.eq(mtaBalBefore.add(balanceDataBefore.raw))
                const mtaBalAfter = await mta.balanceOf(stkmtaWhale.address)
                const fullMtaAfter = mtaBalBefore.add(balanceDataBefore.raw)
                assertBNClose(mtaBalAfter, fullMtaAfter, 200000)
                const diff = fullMtaAfter.sub(mtaBalAfter)
                const diffPerc = diff.mul(simpleToExactAmount(1, 20)).div(fullMtaAfter)
                console.log(`${formatUnits(diff)} diff ${formatUnits(diffPerc)}%`)
            })
        })
        describe("mBPT Staking", () => {
            it("governor slashes mBPT stakers by tiny amount", async () => {
                await stkmBPT.connect(governor.signer).changeSlashingPercentage(1)

                await stkmBPT.connect(governor.signer).emergencyRecollateralisation()
            })
            it("should be able to claim rewards", async () => {
                const mtaBalanceBefore = await mta.balanceOf(stkmbptWhale.address)

                await stkmBPT.connect(stkmbptWhale.signer)["claimReward()"]()

                expect(await mta.balanceOf(stkmbptWhale.address), "stkMTA whale MTA bal after").to.be.gt(mtaBalanceBefore)
            })
            it("should not be able to stake", async () => {
                const stakeAmount = simpleToExactAmount(40)
                await mbpt.connect(mbptWhale.signer).approve(stkmBPT.address, stakeAmount)
                const tx = stkmBPT.connect(mbptWhale.signer)["stake(uint256)"](stakeAmount)
                await expect(tx).to.be.revertedWith("Only while collateralised")
            })
            it("should be able to withdraw all without cooldown", async () => {
                const mbptBalBefore = await mbpt.balanceOf(stkmbptWhale.address)
                const balanceDataBefore = await stkmBPT.balanceData(stkmbptWhale.address)
                expect(balanceDataBefore.raw, "staked mBPT bal before").to.gt(0)

                await stkmBPT.connect(stkmbptWhale.signer).withdraw(balanceDataBefore.raw, stkmbptWhale.address, true, true)

                expect(await stkmBPT.balanceOf(stkmbptWhale.address), "stkMTA bal after").to.eq(0)
                // expect(await mta.balanceOf(stkmbptWhale.address), "MTA bal after").to.eq(mtaBalBefore.add(balanceDataBefore.raw))
                const mbptBalAfter = await mbpt.balanceOf(stkmbptWhale.address)
                const fullMbptAfter = mbptBalBefore.add(balanceDataBefore.raw)
                assertBNClose(mbptBalAfter, fullMbptAfter, 400000)
                const diff = fullMbptAfter.sub(mbptBalAfter)
                const diffPerc = diff.mul(simpleToExactAmount(1, 20)).div(fullMbptAfter)
                console.log(`${formatUnits(diff)} diff ${formatUnits(diffPerc)}%`)
            })
        })
    })
})
