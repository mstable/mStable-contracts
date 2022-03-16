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
import { DEAD_ADDRESS, ZERO_ADDRESS } from "@utils/constants"
import { BigNumber, Signer } from "ethers"

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

    const protocolFee = simpleToExactAmount(0.5)
    const treasury: Signer = ethers.Wallet.createRandom()

    const minMusd2DaiPrice = simpleToExactAmount(98, 16)
    const minDai2MtaPrice = simpleToExactAmount(79, 16)
    const minMbtc2WbtcPrice = simpleToExactAmount(98, 4)
    // 49,000 BTC/USD * 1e12 as bAsset has 6 decimals and rewards has 18 decimals
    const minMbtc2MtaPrice = simpleToExactAmount(49, 33)

    /*
        Test Data
        mAssets: mUSD and mBTC with 18 decimals
     */
    const setupRevenueBuyBack = async (_protocolFee: BigNumber): Promise<void> => {
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
        await nexus.setKeeper(sa.keeper.address)

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
        await emissionController.initialize(
            [staking1.address, staking2.address],
            [10, 10],
            [true, true],
            [staking1.address, staking2.address],
        )
        await rewardsToken.transfer(emissionController.address, simpleToExactAmount(10000))

        // Deploy and initialize test RevenueBuyBack
        revenueBuyBack = await new RevenueBuyBack__factory(sa.default.signer).deploy(
            nexus.address,
            rewardsToken.address,
            uniswap.address,
            emissionController.address,
            _protocolFee,
        )
        // reverse the order to make sure dial id != staking contract id for testing purposes
        await revenueBuyBack.initialize([1, 0], await treasury.getAddress())

        // Add config to buy rewards from mAssets
        await revenueBuyBack.connect(sa.governor.signer).mapBasset(mUSD.address, bAsset1.address)
        await revenueBuyBack.connect(sa.governor.signer).mapBasset(mBTC.address, bAsset2.address)
    }

    before(async () => {
        const accounts = await ethers.getSigners()
        mAssetMachine = await new MassetMachine().initAccounts(accounts)
        sa = mAssetMachine.sa

        await setupRevenueBuyBack(protocolFee)
    })

    describe("creating new instance", () => {
        before(async () => {
            await setupRevenueBuyBack(protocolFee)
        })
        it("should have immutable variables set", async () => {
            expect(await revenueBuyBack.nexus(), "Nexus").eq(nexus.address)
            expect(await revenueBuyBack.REWARDS_TOKEN(), "Rewards Token").eq(rewardsToken.address)
            expect(await revenueBuyBack.UNISWAP_ROUTER(), "Uniswap Router").eq(uniswap.address)
            expect(await revenueBuyBack.EMISSIONS_CONTROLLER(), "Emissions Controller").eq(emissionController.address)
        })
        it("should have storage variables set", async () => {
            expect(await revenueBuyBack.protocolFee(), "Protocol Fee").eq(protocolFee)
            expect(await revenueBuyBack.stakingDialIds(0), "Staking Contract 1 dial id").eq(1)
            expect(await revenueBuyBack.stakingDialIds(1), "Staking Contract 2 dial id").eq(0)
            expect((await emissionController.dials(0)).recipient, "first dial is first staking contract").to.eq(staking1.address)
            expect((await emissionController.dials(1)).recipient, "second dial is second staking contract").to.eq(staking2.address)
        })
        describe("when setting new protocol fee", async () => {
            it("should update protocol fee", async () => {
                expect(await revenueBuyBack.protocolFee(), "Protocol Fee").eq(protocolFee)
                const newProtocolFee = simpleToExactAmount(0.6)
                const tx = revenueBuyBack.connect(sa.governor.signer).setProtocolFee(newProtocolFee)
                await expect(tx).to.emit(revenueBuyBack, "ProtocolFeeChanged").withArgs(newProtocolFee)
                expect(await revenueBuyBack.protocolFee(), "Protocol Fee").eq(newProtocolFee)
            })
            it("should not update if not governor", async () => {
                const newProtocolFee = simpleToExactAmount(0.6)
                const tx = revenueBuyBack.connect(sa.default.signer).setProtocolFee(newProtocolFee)
                await expect(tx).to.be.revertedWith("Only governor can execute")
            })
            it("should not update if invalid amount", async () => {
                const newProtocolFee = simpleToExactAmount(1.6)
                const tx = revenueBuyBack.connect(sa.governor.signer).setProtocolFee(newProtocolFee)
                await expect(tx).to.be.revertedWith("Invalid protocol fee")
            })
        })
        describe("it should fail if invalid", () => {
            it("nexus", async () => {
                const tx = new RevenueBuyBack__factory(sa.default.signer).deploy(
                    ZERO_ADDRESS,
                    rewardsToken.address,
                    uniswap.address,
                    emissionController.address,
                    protocolFee,
                )
                await expect(tx).to.revertedWith("Nexus address is zero")
            })
            it("rewards token", async () => {
                const tx = new RevenueBuyBack__factory(sa.default.signer).deploy(
                    nexus.address,
                    ZERO_ADDRESS,
                    uniswap.address,
                    emissionController.address,
                    protocolFee,
                )
                await expect(tx).to.revertedWith("Rewards token is zero")
            })
            it("Uniswap router", async () => {
                const tx = new RevenueBuyBack__factory(sa.default.signer).deploy(
                    nexus.address,
                    rewardsToken.address,
                    ZERO_ADDRESS,
                    emissionController.address,
                    protocolFee,
                )
                await expect(tx).to.revertedWith("Uniswap Router is zero")
            })
            it("Invalid protocol fee", async () => {
                const tx = new RevenueBuyBack__factory(sa.default.signer).deploy(
                    nexus.address,
                    rewardsToken.address,
                    uniswap.address,
                    emissionController.address,
                    simpleToExactAmount(1.1),
                )
                await expect(tx).to.revertedWith("Invalid protocol fee")
            })
        })
    })
    describe("notification of revenue", () => {
        before(async () => {
            await setupRevenueBuyBack(protocolFee)
        })
        it("should simply transfer from the sender", async () => {
            const senderBalBefore = await mUSD.balanceOf(sa.default.address)
            const revenueBuyBackBalBefore = await mUSD.balanceOf(revenueBuyBack.address)
            const notificationAmount = simpleToExactAmount(100, 18)
            expect(senderBalBefore.gte(notificationAmount), "sender rewards bal before").to.eq(true)

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
            it("not configured mAsset", async () => {
                await expect(revenueBuyBack.notifyRedistributionAmount(sa.dummy1.address, simpleToExactAmount(1, 18))).to.be.revertedWith(
                    "Invalid mAsset",
                )
            })
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
            await setupRevenueBuyBack(protocolFee)

            // Put some bAssets to the mAssets
            await bAsset1.transfer(mUSD.address, musdRevenue)
            await bAsset2.transfer(mBTC.address, mbtcRevenue.div(1e12))

            // Distribute revenue to RevenueBuyBack
            await mUSD.approve(revenueBuyBack.address, musdRevenue)
            await mBTC.approve(revenueBuyBack.address, mbtcRevenue)
            await revenueBuyBack.notifyRedistributionAmount(mUSD.address, musdRevenue)
            await revenueBuyBack.notifyRedistributionAmount(mBTC.address, mbtcRevenue)
        })
        it("should sell mUSD for MTA and send protocol fee to treasury", async () => {
            expect(await mUSD.balanceOf(revenueBuyBack.address), "revenueBuyBack's mUSD Bal before").to.eq(musdRevenue)
            expect(await bAsset1.balanceOf(mUSD.address), "mAsset's bAsset Bal before").to.eq(musdRevenue)
            expect(await mUSD.balanceOf(await treasury.getAddress()), "treasury's mUSD Bal before").to.eq(0)

            const tx = revenueBuyBack
                .connect(sa.keeper.signer)
                .buyBackRewards([mUSD.address], [minMusd2DaiPrice], [minDai2MtaPrice], [uniswapMusdBasset1Paths.encoded])
            const fee = await revenueBuyBack.protocolFee()

            const bAsset1Amount = musdRevenue.mul(simpleToExactAmount(1).sub(fee)).div(simpleToExactAmount(1)).mul(98).div(100)
            // Exchange rate = 0.80 MTA/USD = 8 / 18
            // Swap fee is 0.3% = 997 / 1000
            const rewardsAmount = bAsset1Amount.mul(8).div(10).mul(997).div(1000)
            const treasuryBal = musdRevenue.mul(fee).div(simpleToExactAmount(1))
            await expect(tx)
                .to.emit(revenueBuyBack, "BuyBackRewards")
                .withArgs(mUSD.address, musdRevenue, treasuryBal, bAsset1Amount, rewardsAmount)

            expect(await mUSD.balanceOf(revenueBuyBack.address), "revenueBuyBack's mUSD Bal after").to.eq(0)
            expect(await mUSD.balanceOf(await treasury.getAddress()), "treasury's mUSD Bal after").to.gt(0)
        })
        it("should sell mBTC for MTA and send protocol fee to treasury", async () => {
            expect(await mBTC.balanceOf(revenueBuyBack.address), "revenueBuyBack's mBTC Bal before").to.eq(mbtcRevenue)
            expect(await bAsset2.balanceOf(mBTC.address), "mAsset's bAsset Bal before").to.eq(mbtcRevenue.div(1e12))
            expect(await mUSD.balanceOf(await treasury.getAddress()), "treasury's mUSD Bal before").to.eq(0)

            const tx = revenueBuyBack
                .connect(sa.keeper.signer)
                .buyBackRewards([mBTC.address], [minMbtc2WbtcPrice], [minMbtc2MtaPrice], [uniswapMbtcBasset2Paths.encoded])
            const fee = await revenueBuyBack.protocolFee()

            const bAsset2Amount = mbtcRevenue.mul(simpleToExactAmount(1).sub(fee)).div(simpleToExactAmount(1)).mul(98).div(100).div(1e12)
            // Exchange rate = 50,000 MTA/BTC
            // Swap fee is 0.3% = 997 / 1000
            const rewardsAmount = bAsset2Amount.mul(50000).mul(997).div(1000).mul(1e12)
            const treasuryBal = mbtcRevenue.mul(fee).div(simpleToExactAmount(1))
            await expect(tx)
                .to.emit(revenueBuyBack, "BuyBackRewards")
                .withArgs(mBTC.address, mbtcRevenue, treasuryBal, bAsset2Amount, rewardsAmount)

            expect(await mBTC.balanceOf(revenueBuyBack.address), "revenueBuyBack's mBTC Bal after").to.eq(0)
            expect(await mBTC.balanceOf(await treasury.getAddress()), "treasury's mUSD Bal after").to.gt(0)
        })
        it("should sell mUSD and mBTC for MTA and send protocol fee to treasury", async () => {
            const tx = revenueBuyBack
                .connect(sa.keeper.signer)
                .buyBackRewards(
                    [mUSD.address, mBTC.address],
                    [minMusd2DaiPrice, minMbtc2WbtcPrice],
                    [minDai2MtaPrice, minMbtc2MtaPrice],
                    [uniswapMusdBasset1Paths.encoded, uniswapMbtcBasset2Paths.encoded],
                )
            const fee = await revenueBuyBack.protocolFee()

            //
            const bAsset1Amount = musdRevenue.mul(simpleToExactAmount(1).sub(fee)).div(simpleToExactAmount(1)).mul(98).div(100)
            // Exchange rate = 0.80 MTA/USD = 8 / 18
            // Swap fee is 0.3% = 997 / 1000
            const musdRewardsAmount = bAsset1Amount.mul(8).div(10).mul(997).div(1000)
            const musdTreasuryBal = musdRevenue.mul(fee).div(simpleToExactAmount(1))
            await expect(tx)
                .to.emit(revenueBuyBack, "BuyBackRewards")
                .withArgs(mUSD.address, musdRevenue, musdTreasuryBal, bAsset1Amount, musdRewardsAmount)

            const bAsset2Amount = mbtcRevenue.mul(simpleToExactAmount(1).sub(fee)).div(simpleToExactAmount(1)).mul(98).div(100).div(1e12)
            // Exchange rate = 50,000 MTA/BTC
            // Swap fee is 0.3% = 997 / 1000
            const mbtcRewardsAmount = bAsset2Amount.mul(50000).mul(997).div(1000).mul(1e12)
            const mbtcTreasuryBal = mbtcRevenue.mul(fee).div(simpleToExactAmount(1))
            await expect(tx)
                .to.emit(revenueBuyBack, "BuyBackRewards")
                .withArgs(mBTC.address, mbtcRevenue, mbtcTreasuryBal, bAsset2Amount, mbtcRewardsAmount)

            expect(await mUSD.balanceOf(revenueBuyBack.address), "revenueBuyBack's mUSD Bal after").to.eq(0)
            expect(await mBTC.balanceOf(revenueBuyBack.address), "revenueBuyBack's mUSD Bal after").to.eq(0)
            expect(await mUSD.balanceOf(await treasury.getAddress()), "treasury's mUSD Bal after").to.gt(0)
            expect(await mBTC.balanceOf(await treasury.getAddress()), "treasury's mBTC Bal after").to.gt(0)
        })
        describe("should fail when", () => {
            it("No mAssets", async () => {
                const tx = revenueBuyBack.connect(sa.keeper.signer).buyBackRewards([], [], [], [])
                await expect(tx).to.revertedWith("Invalid mAssets")
            })
            it("Not a mAsset", async () => {
                const tx = revenueBuyBack
                    .connect(sa.keeper.signer)
                    .buyBackRewards([rewardsToken.address], [minMusd2DaiPrice], [minDai2MtaPrice], [uniswapMusdBasset1Paths.encoded])
                await expect(tx).to.revertedWith("Invalid mAsset")
            })
            it("Not keeper or governor", async () => {
                const tx = revenueBuyBack.buyBackRewards(
                    [mUSD.address],
                    [minMusd2DaiPrice],
                    [minDai2MtaPrice],
                    [uniswapMusdBasset1Paths.encoded],
                )
                await expect(tx).to.revertedWith("Only keeper or governor")
            })
        })
    })
    describe("donate rewards to Emissions Controller", () => {
        const totalRewards = simpleToExactAmount(40000)
        beforeEach(async () => {
            await setupRevenueBuyBack(protocolFee)
        })
        it("should donate rewards", async () => {
            // Put some reward tokens in the RevenueBuyBack contract for donation to the Emissions Controller
            await rewardsToken.transfer(revenueBuyBack.address, totalRewards)
            expect(await rewardsToken.balanceOf(revenueBuyBack.address), "revenue buy back rewards before").to.eq(totalRewards)
            const rewardsECbefore = await rewardsToken.balanceOf(emissionController.address)

            const tx = revenueBuyBack.connect(sa.keeper.signer).donateRewards()

            await expect(tx).to.emit(revenueBuyBack, "DonatedRewards").withArgs(totalRewards)
            await expect(tx).to.emit(emissionController, "DonatedRewards").withArgs(1, totalRewards.div(4))
            await expect(tx).to.emit(emissionController, "DonatedRewards").withArgs(0, totalRewards.mul(3).div(4))

            expect(await rewardsToken.balanceOf(revenueBuyBack.address), "revenue buy back rewards after").to.eq(0)
            expect(await rewardsToken.balanceOf(emissionController.address), "emission controller rewards after").to.eq(
                rewardsECbefore.add(totalRewards),
            )
        })
        describe("should fail when", () => {
            it("no voting power", async () => {
                await staking1.setTotalSupply(0)
                await staking2.setTotalSupply(0)

                const tx = revenueBuyBack.connect(sa.keeper.signer).donateRewards()
                await expect(tx).to.revertedWith("No voting power")
            })
            it("no rewards to donate", async () => {
                expect(await rewardsToken.balanceOf(revenueBuyBack.address), "revenue buy back rewards before").to.eq(0)

                const tx = revenueBuyBack.connect(sa.keeper.signer).donateRewards()
                await expect(tx).to.revertedWith("No rewards to donate")
            })
        })
    })
    describe("setMassetConfig", () => {
        let newMasset: MockMasset
        let newBasset: MockERC20
        before(async () => {
            newMasset = await new MockMasset__factory(sa.default.signer).deploy(
                "EURO",
                "mEUR",
                18,
                sa.default.address,
                simpleToExactAmount(2000000),
            )
            newBasset = await mAssetMachine.loadBassetProxy("EUR bAsset", "bEUR", 18)
        })
        it("should set", async () => {
            const tx = await revenueBuyBack.connect(sa.governor.signer).mapBasset(newMasset.address, newBasset.address)

            await expect(tx).to.emit(revenueBuyBack, "MappedBasset").withArgs(newMasset.address, newBasset.address)

            const bAsset = await revenueBuyBack.bassets(newMasset.address)
            expect(bAsset, "bAsset").to.eq(newBasset.address)
        })
        context("should fail when", () => {
            before(async () => {
                await setupRevenueBuyBack(protocolFee)
            })
            it("not governor", async () => {
                const tx = revenueBuyBack.mapBasset(newMasset.address, newBasset.address)

                await expect(tx).to.revertedWith("Only governor can execute")
            })
            it("mAsset is zero", async () => {
                const tx = revenueBuyBack.connect(sa.governor.signer).mapBasset(ZERO_ADDRESS, newBasset.address)
                await expect(tx).to.revertedWith("mAsset token is zero")
            })
            it("bAsset is zero", async () => {
                const tx = revenueBuyBack.connect(sa.governor.signer).mapBasset(newMasset.address, ZERO_ADDRESS)
                await expect(tx).to.revertedWith("bAsset token is zero")
            })
        })
    })
    describe("addStakingContract", () => {
        before(async () => {
            await setupRevenueBuyBack(protocolFee)
        })
        context("should fail when", () => {
            it("duplicate", async () => {
                const tx = revenueBuyBack.connect(sa.governor.signer).addStakingContract(0)

                await expect(tx).to.revertedWith("Staking dial id already exists")
            })
            it("invalid dial id", async () => {
                const tx = revenueBuyBack.connect(sa.governor.signer).addStakingContract(3)

                await expect(tx).to.revertedWith("reverted with panic code 0x32 (Array accessed at an out-of-bounds or negative index)")
            })
            it("not governor", async () => {
                const tx = revenueBuyBack.addStakingContract(4)

                await expect(tx).to.revertedWith("Only governor can execute")
            })
        })
        it("should add staking contract", async () => {
            const newStakingContract = await new MockStakingContract__factory(sa.default.signer).deploy()
            await emissionController.connect(sa.governor.signer).addDial(newStakingContract.address, 10, true)
            const newDialId = 2
            expect(await emissionController.getDialRecipient(newDialId), "new dial added").to.eq(newStakingContract.address)

            const tx = await revenueBuyBack.connect(sa.governor.signer).addStakingContract(newDialId)

            await expect(tx).to.emit(revenueBuyBack, "AddedStakingContract").withArgs(newDialId)
        })
    })
})
