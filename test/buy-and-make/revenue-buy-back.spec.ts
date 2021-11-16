import { ethers } from "hardhat"
import { expect } from "chai"

import { simpleToExactAmount } from "@utils/math"
import { MassetMachine, StandardAccounts } from "@utils/machines"

import {
    MockERC20,
    MockNexus__factory,
    MockNexus,
    RevenueBuyBack__factory,
    RevenueBuyBack,
    MockUniswapV3,
    MockUniswapV3__factory,
    EmissionsController,
    MockStakingContract,
    MockStakingContract__factory,
    MockMasset__factory,
    MockMasset,
    EmissionsController__factory,
} from "types/generated"
import { EncodedPaths, encodeUniswapPath } from "@utils/peripheral/uniswap"
import { DEAD_ADDRESS } from "@utils/constants"

describe("RevenueBuyBack", () => {
    let sa: StandardAccounts
    let mAssetMachine: MassetMachine
    let nexus: MockNexus
    let revenueBuyBack: RevenueBuyBack
    let mUSD: MockMasset
    let mBTC: MockMasset
    let bAsset1: MockERC20
    let bAsset2: MockERC20
    let rewardsToken: MockERC20
    let staking1: MockStakingContract
    let staking2: MockStakingContract
    let emissionController: EmissionsController
    let uniswap: MockUniswapV3
    let uniswapMusdBasset1Paths: EncodedPaths
    let uniswapMbtcBasset2Paths: EncodedPaths

    /*
        Test Data
        mAssets: mUSD and mBTC with 18 decimals
     */
    const setupRevenueBuyBack = async (): Promise<void> => {
        mUSD = await new MockMasset__factory(sa.default.signer).deploy(
            "meta USD",
            "mUSD",
            18,
            sa.default.address,
            simpleToExactAmount(1000000),
        )
        bAsset1 = await mAssetMachine.loadBassetProxy("USD bAsset", "bUSD", 18)

        mBTC = await new MockMasset__factory(sa.default.signer).deploy("meta BTC", "mBTC", 18, sa.default.address, simpleToExactAmount(100))
        bAsset2 = await mAssetMachine.loadBassetProxy("USD bAsset", "bUSD", 6)

        rewardsToken = await mAssetMachine.loadBassetProxy("Rewards Token", "RWD", 18)

        // staking contracts
        staking1 = await new MockStakingContract__factory(sa.default.signer).deploy()
        staking2 = await new MockStakingContract__factory(sa.default.signer).deploy()
        await staking1.setTotalSupply(simpleToExactAmount(3000000))
        await staking2.setTotalSupply(simpleToExactAmount(1000000))

        // Deploy mock Nexus
        nexus = await new MockNexus__factory(sa.default.signer).deploy(
            sa.governor.address,
            sa.mockSavingsManager.address,
            sa.mockInterestValidator.address,
        )

        // Mocked Uniswap V3
        uniswap = await new MockUniswapV3__factory(sa.default.signer).deploy()
        // Add rewards to Uniswap
        await rewardsToken.transfer(uniswap.address, simpleToExactAmount(500000))
        // Add bAsset to rewards exchange rates
        await uniswap.setRate(bAsset1.address, rewardsToken.address, simpleToExactAmount(80, 16)) // 0.8 MTA/USD
        await uniswap.setRate(bAsset2.address, rewardsToken.address, simpleToExactAmount(50, 33)) // 50,000 MTA/BTC
        // Uniswap paths
        uniswapMusdBasset1Paths = encodeUniswapPath([bAsset1.address, DEAD_ADDRESS, rewardsToken.address], [3000, 3000])
        uniswapMbtcBasset2Paths = encodeUniswapPath([bAsset2.address, DEAD_ADDRESS, rewardsToken.address], [3000, 3000])

        // Deploy Emissions Controller
        const defaultConfig = {
            A: -166000,
            B: 180000,
            C: -180000,
            D: 166000,
            EPOCHS: 312,
        }
        emissionController = await new EmissionsController__factory(sa.default.signer).deploy(
            nexus.address,
            rewardsToken.address,
            defaultConfig,
        )
        await rewardsToken.approve(emissionController.address, simpleToExactAmount(10000))
        await emissionController.initialize(
            [staking1.address, staking2.address],
            [10, 10],
            [true, true],
            [staking1.address, staking2.address],
            simpleToExactAmount(10000),
        )

        // Deploy and initialize test RevenueBuyBack
        revenueBuyBack = await new RevenueBuyBack__factory(sa.default.signer).deploy(
            nexus.address,
            rewardsToken.address,
            uniswap.address,
            emissionController.address,
        )
        // reverse the order to make sure dial id != staking contract id for testing purposes
        await revenueBuyBack.initialize(sa.fundManager.address, [1, 0])

        // Add config to buy rewards from mAssets
        await revenueBuyBack
            .connect(sa.governor.signer)
            .setMassetConfig(
                mUSD.address,
                bAsset1.address,
                simpleToExactAmount(98, 16),
                simpleToExactAmount(79, 16),
                uniswapMusdBasset1Paths.encoded,
            )
        await revenueBuyBack.connect(sa.governor.signer).setMassetConfig(
            mBTC.address,
            bAsset2.address,
            simpleToExactAmount(98, 4),
            // 49,000 BTC/USD * 1e12 as bAsset has 6 decimals and rewards has 18 decimals
            simpleToExactAmount(49, 33),
            uniswapMbtcBasset2Paths.encoded,
        )
    }

    before(async () => {
        const accounts = await ethers.getSigners()
        mAssetMachine = await new MassetMachine().initAccounts(accounts)
        sa = mAssetMachine.sa

        await setupRevenueBuyBack()
    })

    describe("creating new instance", () => {
        before(async () => {
            await setupRevenueBuyBack()
        })
        it("should have immutable variables set", async () => {
            expect(await revenueBuyBack.nexus(), "Nexus").eq(nexus.address)
            expect(await revenueBuyBack.REWARDS_TOKEN(), "Rewards Token").eq(rewardsToken.address)
            expect(await revenueBuyBack.UNISWAP_ROUTER(), "Uniswap Router").eq(uniswap.address)
            expect(await revenueBuyBack.EMISSIONS_CONTROLLER(), "Emissions Controller").eq(emissionController.address)
        })
        it("should have storage variables set", async () => {
            expect(await revenueBuyBack.keeper(), "Keeper").eq(sa.fundManager.address)
            expect(await revenueBuyBack.stakingDialIds(0), "Staking Contract 1 dial id").eq(1)
            expect(await revenueBuyBack.stakingDialIds(1), "Staking Contract 2 dial id").eq(0)
            expect((await emissionController.dials(0)).recipient, "first dial is first staking contract").to.eq(staking1.address)
            expect((await emissionController.dials(1)).recipient, "second dial is second staking contract").to.eq(staking2.address)
        })
    })
    describe("notification of revenue", () => {
        before(async () => {
            await setupRevenueBuyBack()
        })
        it("should simply transfer from the sender", async () => {
            const senderBalBefore = await mUSD.balanceOf(sa.default.address)
            const revenueBuyBackBalBefore = await mUSD.balanceOf(revenueBuyBack.address)
            const notificationAmount = simpleToExactAmount(100, 18)
            expect(senderBalBefore.gte(notificationAmount), "sender rewards bal before").to.be.true

            // approve
            await mUSD.approve(revenueBuyBack.address, notificationAmount)
            // call
            const tx = revenueBuyBack.notifyRedistributionAmount(mUSD.address, notificationAmount)
            await expect(tx).to.emit(revenueBuyBack, "RevenueReceived").withArgs(mUSD.address, notificationAmount)

            // check output balances: mAsset sender/recipient
            expect(await mUSD.balanceOf(sa.default.address), "mUSD sender bal after").eq(senderBalBefore.sub(notificationAmount))
            expect(await mUSD.balanceOf(revenueBuyBack.address), "mUSD RevenueBuyBack bal after").eq(
                revenueBuyBackBalBefore.add(notificationAmount),
            )
        })
        describe("it should fail if", () => {
            it("approval is not given from sender", async () => {
                await expect(revenueBuyBack.notifyRedistributionAmount(mUSD.address, simpleToExactAmount(100, 18))).to.be.revertedWith(
                    "ERC20: transfer amount exceeds allowance",
                )
            })
            it("sender has insufficient balance", async () => {
                await mUSD.transfer(sa.dummy1.address, simpleToExactAmount(1, 18))
                await mUSD.connect(sa.dummy1.signer).approve(revenueBuyBack.address, simpleToExactAmount(100))
                await expect(
                    revenueBuyBack.connect(sa.dummy1.signer).notifyRedistributionAmount(mUSD.address, simpleToExactAmount(2, 18)),
                ).to.be.revertedWith("ERC20: transfer amount exceeds balance")
            })
        })
    })
    describe("buy back MTA rewards", () => {
        const musdRevenue = simpleToExactAmount(20000)
        const mbtcRevenue = simpleToExactAmount(2)
        beforeEach(async () => {
            await setupRevenueBuyBack()

            // Put some bAssets to the mAssets
            await bAsset1.transfer(mUSD.address, musdRevenue)
            await bAsset2.transfer(mBTC.address, mbtcRevenue.div(1e12))

            // Distribute revenue to RevenueBuyBack
            await mUSD.approve(revenueBuyBack.address, musdRevenue)
            await mBTC.approve(revenueBuyBack.address, mbtcRevenue)
            await revenueBuyBack.notifyRedistributionAmount(mUSD.address, musdRevenue)
            await revenueBuyBack.notifyRedistributionAmount(mBTC.address, mbtcRevenue)
        })
        it("should sell mUSD for MTA", async () => {
            expect(await mUSD.balanceOf(revenueBuyBack.address), "revenueBuyBack's mUSD Bal before").to.eq(musdRevenue)
            expect(await bAsset1.balanceOf(mUSD.address), "mAsset's bAsset Bal before").to.eq(musdRevenue)

            const tx = revenueBuyBack.connect(sa.fundManager.signer).buyBackRewards([mUSD.address])

            const bAsset1Amount = musdRevenue.mul(98).div(100)
            // Exchange rate = 0.80 MTA/USD = 8 / 18
            // Swap fee is 0.3% = 997 / 1000
            const rewardsAmount = bAsset1Amount.mul(8).div(10).mul(997).div(1000)
            await expect(tx).to.emit(revenueBuyBack, "BuyBackRewards").withArgs(mUSD.address, musdRevenue, bAsset1Amount, rewardsAmount)

            expect(await mUSD.balanceOf(revenueBuyBack.address), "revenueBuyBack's mUSD Bal after").to.eq(0)
        })
        it("should sell mBTC for MTA", async () => {
            expect(await mBTC.balanceOf(revenueBuyBack.address), "revenueBuyBack's mBTC Bal before").to.eq(mbtcRevenue)
            expect(await bAsset2.balanceOf(mBTC.address), "mAsset's bAsset Bal before").to.eq(mbtcRevenue.div(1e12))

            const tx = revenueBuyBack.connect(sa.fundManager.signer).buyBackRewards([mBTC.address])

            const bAsset2Amount = mbtcRevenue.mul(98).div(100).div(1e12)
            // Exchange rate = 50,000 MTA/BTC
            // Swap fee is 0.3% = 997 / 1000
            const rewardsAmount = bAsset2Amount.mul(50000).mul(997).div(1000).mul(1e12)
            await expect(tx).to.emit(revenueBuyBack, "BuyBackRewards").withArgs(mBTC.address, mbtcRevenue, bAsset2Amount, rewardsAmount)

            expect(await mBTC.balanceOf(revenueBuyBack.address), "revenueBuyBack's mBTC Bal after").to.eq(0)
        })
        it("should sell mUSD and mBTC for MTA", async () => {
            const tx = revenueBuyBack.connect(sa.fundManager.signer).buyBackRewards([mUSD.address, mBTC.address])

            //
            const bAsset1Amount = musdRevenue.mul(98).div(100)
            // Exchange rate = 0.80 MTA/USD = 8 / 18
            // Swap fee is 0.3% = 997 / 1000
            const musdRewardsAmount = bAsset1Amount.mul(8).div(10).mul(997).div(1000)
            await expect(tx).to.emit(revenueBuyBack, "BuyBackRewards").withArgs(mUSD.address, musdRevenue, bAsset1Amount, musdRewardsAmount)

            const bAsset2Amount = mbtcRevenue.mul(98).div(100).div(1e12)
            // Exchange rate = 50,000 MTA/BTC
            // Swap fee is 0.3% = 997 / 1000
            const mbtcRewardsAmount = bAsset2Amount.mul(50000).mul(997).div(1000).mul(1e12)
            await expect(tx).to.emit(revenueBuyBack, "BuyBackRewards").withArgs(mBTC.address, mbtcRevenue, bAsset2Amount, mbtcRewardsAmount)

            expect(await mUSD.balanceOf(revenueBuyBack.address), "revenueBuyBack's mUSD Bal after").to.eq(0)
            expect(await mBTC.balanceOf(revenueBuyBack.address), "revenueBuyBack's mUSD Bal after").to.eq(0)
        })
    })
    describe.only("donate rewards to Emissions Controller", () => {
        const totalRewards = simpleToExactAmount(40000)
        beforeEach(async () => {
            await setupRevenueBuyBack()
        })
        it("should donate rewards", async () => {
            // Put some reward tokens in the RevenueBuyBack contract for donation to the Emissions Controller
            await rewardsToken.transfer(revenueBuyBack.address, totalRewards)
            expect(await rewardsToken.balanceOf(revenueBuyBack.address), "revenue buy back rewards before").to.eq(totalRewards)
            const rewardsECbefore = await rewardsToken.balanceOf(emissionController.address)

            const tx = revenueBuyBack.connect(sa.fundManager.signer).donateRewards()

            await expect(tx).to.emit(revenueBuyBack, "DonatedRewards").withArgs(totalRewards)
            await expect(tx).to.emit(emissionController, "DonatedRewards").withArgs(1, totalRewards.div(4))
            await expect(tx).to.emit(emissionController, "DonatedRewards").withArgs(0, totalRewards.mul(3).div(4))

            expect(await rewardsToken.balanceOf(revenueBuyBack.address), "revenue buy back rewards after").to.eq(0)
            expect(await rewardsToken.balanceOf(emissionController.address), "emission controller rewards after").to.eq(
                rewardsECbefore.add(totalRewards),
            )
        })
        it("fail to donate no rewards", async () => {
            expect(await rewardsToken.balanceOf(revenueBuyBack.address), "revenue buy back rewards before").to.eq(0)

            const tx = revenueBuyBack.connect(sa.fundManager.signer).donateRewards()
            await expect(tx).to.revertedWith("No rewards to donate")
        })
    })
})
