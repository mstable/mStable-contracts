/* eslint-disable @typescript-eslint/no-loop-func */
/* eslint-disable no-restricted-syntax */
/* eslint-disable @typescript-eslint/no-unused-expressions */
import { ethers } from "hardhat"
import { expect } from "chai"

import { simpleToExactAmount, BN, applyRatio } from "@utils/math"
import { MassetDetails, MassetMachine, StandardAccounts } from "@utils/machines"

import { DEAD_ADDRESS, MAX_UINT256, ONE_DAY, ONE_HOUR, ONE_WEEK, TEN_MINS, ZERO_ADDRESS } from "@utils/constants"
import {
    Masset,
    MockNexus,
    MockPlatformIntegration,
    MaliciousAaveIntegration,
    MaliciousAaveIntegration__factory,
    MockERC20,
    MockPlatformIntegration__factory,
} from "types/generated"
import { assertBNSlightlyGTPercent } from "@utils/assertions"
import { keccak256, toUtf8Bytes } from "ethers/lib/utils"
import { BassetStatus } from "@utils/mstable-objects"
import { getTimestamp, increaseTime } from "@utils/time"

describe("Masset Admin", () => {
    let sa: StandardAccounts
    let mAssetMachine: MassetMachine
    let details: MassetDetails

    /**
     * @dev (Re)Sets the local variables for this test file
     * @param seedBasket mints 25 tokens for each bAsset
     * @param useTransferFees enables transfer fees on bAssets [2,3]
     */
    const runSetup = async (
        seedBasket = true,
        useTransferFees = false,
        useLendingMarkets = false,
        useMockValidator = true,
        weights: number[] = [25, 25, 25, 25],
    ): Promise<void> => {
        details = await mAssetMachine.deployMasset(useMockValidator, useLendingMarkets, useTransferFees)
        if (seedBasket) {
            await mAssetMachine.seedWithWeightings(details, weights)
        }
    }

    before("Init contract", async () => {
        const accounts = await ethers.getSigners()
        mAssetMachine = await new MassetMachine().initAccounts(accounts)
        sa = mAssetMachine.sa

        await runSetup()
    })

    describe("using basic setters", async () => {
        const newSize = simpleToExactAmount(1, 16) // 1%
        let mAsset: Masset
        before("set up", async () => {
            await runSetup(true)
            mAsset = await details.mAsset.connect(sa.governor.signer)
        })
        describe("should allow changing of the cache size to ", () => {
            it("zero", async () => {
                const tx = mAsset.setCacheSize(0)
                await expect(tx).to.emit(mAsset, "CacheSizeChanged").withArgs(0)
                expect(await mAsset.cacheSize()).eq(0)
            })
            it("1%", async () => {
                const oldSize = await mAsset.cacheSize()
                expect(oldSize).not.eq(newSize)
                const tx = mAsset.setCacheSize(newSize)
                await expect(tx).to.emit(mAsset, "CacheSizeChanged").withArgs(newSize)
                expect(await mAsset.cacheSize()).eq(newSize)
            })
            it("20% (cap limit)", async () => {
                const capLimit = simpleToExactAmount(20, 16) // 20%
                const tx = mAsset.setCacheSize(capLimit)
                await expect(tx).to.emit(mAsset, "CacheSizeChanged").withArgs(capLimit)
                expect(await mAsset.cacheSize()).eq(capLimit)
            })
        })
        describe("should fail changing the cache size if", () => {
            it("not governor", async () => {
                await expect(details.mAsset.connect(sa.default.signer).setCacheSize(newSize)).to.be.revertedWith(
                    "Only governor can execute",
                )
                await expect(details.mAsset.connect(sa.dummy1.signer).setCacheSize(newSize)).to.be.revertedWith("Only governor can execute")
            })
            it("just over cap", async () => {
                const feeExceedingCap = BN.from("200000000000000001")
                await expect(mAsset.setCacheSize(feeExceedingCap)).to.be.revertedWith("Must be <= 20%")
            })
            it("exceed cap by 1%", async () => {
                const feeExceedingCap = simpleToExactAmount(21, 16) // 21%
                await expect(mAsset.setCacheSize(feeExceedingCap)).to.be.revertedWith("Must be <= 20%")
            })
            it("exceeding cap with max number", async () => {
                await expect(mAsset.setCacheSize(MAX_UINT256)).to.be.revertedWith("Must be <= 20%")
            })
        })
        it("should allow upgrade of the ForgeValidator by governor", async () => {
            const otherAddress = sa.other.address
            const tx = mAsset.upgradeForgeValidator(otherAddress)
            await expect(tx).to.emit(mAsset, "ForgeValidatorChanged").withArgs(otherAddress)
            expect(await mAsset.forgeValidator()).eq(otherAddress)
        })
        describe("should fail to upgrade the ForgeValidator if", () => {
            it("not governor", async () => {
                await expect(details.mAsset.upgradeForgeValidator(sa.dummy2.address)).to.be.revertedWith("Only governor can execute")
            })
            it("zero contract address", async () => {
                await expect(mAsset.upgradeForgeValidator(ZERO_ADDRESS)).to.be.revertedWith("Null address")
            })
        })
        describe("should change swap and redemption fees to", () => {
            it("0.5% and 0.25%", async () => {
                const oldSwapFee = await mAsset.swapFee()
                const oldRedemptionFee = await mAsset.redemptionFee()
                const newSwapFee = simpleToExactAmount(0.5, 16)
                const newRedemptionFee = simpleToExactAmount(0.25, 16)
                expect(oldSwapFee).not.eq(newSwapFee)
                expect(oldRedemptionFee).not.eq(newRedemptionFee)
                const tx = mAsset.setFees(newSwapFee, newRedemptionFee)
                await expect(tx).to.emit(mAsset, "FeesChanged").withArgs(newSwapFee, newRedemptionFee)
                expect(await mAsset.swapFee()).eq(newSwapFee)
                expect(await mAsset.redemptionFee()).eq(newRedemptionFee)
            })
            it("2% (limit)", async () => {
                const newFee = simpleToExactAmount(2, 16)
                await mAsset.setFees(newFee, newFee)
                const tx = mAsset.setFees(newFee, newFee)
                await expect(tx).to.emit(mAsset, "FeesChanged").withArgs(newFee, newFee)
                expect(await mAsset.swapFee()).eq(newFee)
                expect(await mAsset.redemptionFee()).eq(newFee)
            })
        })
        describe("should fail to change swap fee rate when", () => {
            it("not governor", async () => {
                const fee = simpleToExactAmount(2, 16)
                await expect(details.mAsset.setFees(fee, fee)).to.be.revertedWith("Only governor can execute")
            })
            it("Swap rate just exceeds 2% cap", async () => {
                await expect(mAsset.setFees("20000000000000001", "20000000000000000")).to.be.revertedWith("Swap rate oob")
            })
            it("Redemption rate just exceeds 2% cap", async () => {
                await expect(mAsset.setFees("20000000000000000", "20000000000000001")).to.be.revertedWith("Redemption rate oob")
            })
            it("3% rate exceeds 2% cap", async () => {
                const fee = simpleToExactAmount(3, 16) // 3%
                await expect(mAsset.setFees(fee, fee)).to.be.revertedWith("Swap rate oob")
            })
            it("max rate", async () => {
                const fee = MAX_UINT256
                await expect(mAsset.setFees(fee, fee)).to.be.revertedWith("Swap rate oob")
            })
        })
        describe("should set transfer fee flag", async () => {
            it("when no integration balance", async () => {
                let personalData = await mAsset.bAssetPersonal(3)
                expect(personalData.hasTxFee).to.be.false

                const tx = mAsset.connect(sa.governor.signer).setTransferFeesFlag(personalData.addr, true)
                await expect(tx).to.emit(details.managerLib, "TransferFeeEnabled").withArgs(personalData.addr, true)
                personalData = await mAsset.bAssetPersonal(3)
                expect(personalData.hasTxFee).to.be.true

                // restore the flag back to false
                const tx2 = mAsset.connect(sa.governor.signer).setTransferFeesFlag(personalData.addr, false)
                await expect(tx2).to.emit(details.managerLib, "TransferFeeEnabled").withArgs(personalData.addr, false)
                await tx2
                personalData = await mAsset.bAssetPersonal(3)
                expect(personalData.hasTxFee).to.be.false
            })
            it("when an integration balance", async () => {
                await runSetup(true, false, true)

                const personalData = await details.mAsset.bAssetPersonal(2)
                expect(personalData.hasTxFee).to.be.false

                const tx = details.mAsset.connect(sa.governor.signer).setTransferFeesFlag(personalData.addr, true)
                await expect(tx).to.emit(details.managerLib, "TransferFeeEnabled").withArgs(personalData.addr, true)
                const personalDataAfter = await details.mAsset.bAssetPersonal(2)
                expect(personalDataAfter.hasTxFee).to.be.true

                // restore the flag back to false
                const tx2 = details.mAsset.connect(sa.governor.signer).setTransferFeesFlag(personalData.addr, false)
                await expect(tx2).to.emit(details.managerLib, "TransferFeeEnabled").withArgs(personalData.addr, false)
                const personalDataAfterRestore = await details.mAsset.bAssetPersonal(2)
                expect(personalDataAfterRestore.hasTxFee).to.be.false
            })
        })
        it("should set max weight", async () => {
            const beforeWeightLimits = await mAsset.weightLimits()
            const newMinWeight = simpleToExactAmount(1, 16)
            const newMaxWeight = simpleToExactAmount(334, 15)
            const tx = mAsset.setWeightLimits(newMinWeight, newMaxWeight)
            await expect(tx, "WeightLimitsChanged event").to.emit(mAsset, "WeightLimitsChanged").withArgs(newMinWeight, newMaxWeight)
            await tx
            const afterWeightLimits = await mAsset.weightLimits()
            expect(afterWeightLimits.min, "before and after min weight not equal").not.to.eq(beforeWeightLimits.min)
            expect(afterWeightLimits.max, "before and after max weight not equal").not.to.eq(beforeWeightLimits.max)
            expect(afterWeightLimits.min, "min weight set").to.eq(newMinWeight)
            expect(afterWeightLimits.max, "max weight set").to.eq(newMaxWeight)
        })
        describe("failed set max weight", () => {
            const newMinWeight = simpleToExactAmount(1, 16)
            const newMaxWeight = simpleToExactAmount(620, 15)
            it("should fail setWeightLimits with default signer", async () => {
                await expect(mAsset.connect(sa.default.signer).setWeightLimits(newMinWeight, newMaxWeight)).to.revertedWith(
                    "Only governor can execute",
                )
            })
            it("should fail setWeightLimits with dummy signer", async () => {
                await expect(mAsset.connect(sa.dummy1.signer).setWeightLimits(newMinWeight, newMaxWeight)).to.revertedWith(
                    "Only governor can execute",
                )
            })
            it("should fail setWeightLimits with max weight too small", async () => {
                await expect(mAsset.setWeightLimits(newMinWeight, simpleToExactAmount(332, 15))).to.revertedWith("Max weight oob")
            })
            it("should fail setWeightLimits with min weight too large", async () => {
                await expect(mAsset.setWeightLimits(simpleToExactAmount(14, 16), newMaxWeight)).to.revertedWith("Min weight oob")
            })
        })
    })
    context("getters without setters", () => {
        before("init basset", async () => {
            await runSetup()
        })
        it("get config", async () => {
            const { mAsset } = details
            const config = await mAsset.getConfig()
            expect(config.limits.min, "minWeight").to.eq(simpleToExactAmount(5, 16))
            expect(config.limits.max, "maxWeight").to.eq(simpleToExactAmount(55, 16))
            expect(config.a, "a value").to.eq(10000)
        })
        it("should get bAsset", async () => {
            const { mAsset, bAssets } = details
            const bAsset = await mAsset.getBasset(bAssets[0].address)
            expect(bAsset.personal.addr).to.eq(bAsset[0].addr)
            expect(bAsset.personal.hasTxFee).to.false
            expect(bAsset.personal.integrator).to.eq(bAsset[0].integrator)
            expect(bAsset.personal.status).to.eq(BassetStatus.Normal)
        })
        it("should fail to get bAsset with address 0x0", async () => {
            await expect(details.mAsset.getBasset(ZERO_ADDRESS)).to.revertedWith("Invalid asset")
        })
        it("should fail to get bAsset not in basket", async () => {
            await expect(details.mAsset.getBasset(sa.dummy1.address)).to.revertedWith("Invalid asset")
        })
    })
    context("collecting interest", async () => {
        const unbalancedWeights = [0, 1, 200, 300]
        beforeEach("init basset with vaults", async () => {
            await runSetup(true, false, true, true, unbalancedWeights)
            // 1.0 Simulate some activity on the lending markets
            // Fast forward a bit so platform interest can be collected
            await increaseTime(TEN_MINS.toNumber())
        })
        it("Collect interest before any fees have been generated", async () => {
            const { mAsset } = details

            // 1.0 Get all balances and data before
            expect(await mAsset.surplus()).to.eq(0)
            const totalSupplyBefore = await mAsset.totalSupply()

            // 2.0 Static call collectInterest to validate the return values
            const { mintAmount, newSupply } = await mAsset.connect(sa.mockSavingsManager.signer).callStatic.collectInterest()
            expect(mintAmount, "mintAmount").to.eq(0)
            expect(newSupply, "totalSupply").to.eq(totalSupplyBefore)

            // 3.0 Collect the interest
            const tx = mAsset.connect(sa.mockSavingsManager.signer).collectInterest()
            await expect(tx).to.not.emit(mAsset, "MintedMulti")

            // 4.0 Check outputs
            expect(await mAsset.surplus()).to.eq(0)
        })
        it("should collect interest after fees generated from swap", async () => {
            const { bAssets, mAsset } = details

            // 1.0 Do the necessary approvals before swap
            await mAssetMachine.approveMasset(bAssets[3], mAsset, 20)
            // Do a swap to generate some fees
            await mAsset.swap(bAssets[3].address, bAssets[2].address, simpleToExactAmount(20, 18), 0, sa.dummy1.address)

            // 2.0 Get all balances and data before
            const surplus = await mAsset.surplus()
            const mAssetBalBefore = await mAsset.balanceOf(sa.mockSavingsManager.address)
            const totalSupplyBefore = await mAsset.totalSupply()

            // 3.0 Check the SavingsManager in the mock Nexus contract
            const nexus = (await ethers.getContractAt("MockNexus", await mAsset.nexus())) as MockNexus
            const savingsManagerInNexus = await nexus.getModule(keccak256(toUtf8Bytes("SavingsManager")))
            expect(savingsManagerInNexus, "savingsManagerInNexus").to.eq(sa.mockSavingsManager.address)

            //  4.0 Static call collectInterest to validate the return values
            const { mintAmount, newSupply } = await mAsset.connect(sa.mockSavingsManager.signer).callStatic.collectInterest()
            expect(mintAmount, "mintAmount").to.eq(surplus.sub(1))
            expect(newSupply, "totalSupply").to.eq(totalSupplyBefore.add(surplus).sub(1))

            // 5.0 Collect the interest
            const tx = mAsset.connect(sa.mockSavingsManager.signer).collectInterest()

            // 6.0 Event emits correct unit
            await expect(tx, "MintedMulti event").to.emit(mAsset, "MintedMulti")
            // .withArgs(mAsset.address, sa.mockSavingsManager.address, surplus.sub(1), [], [])
            await tx

            // 7.0 Check outputs
            expect(await mAsset.surplus(), "after surplus").to.eq(1)
            expect(await mAsset.balanceOf(sa.mockSavingsManager.address), "after Saving Manager balance").eq(
                mAssetBalBefore.add(surplus).sub(1),
            )
            expect(await mAsset.totalSupply(), "after totalSupply").to.eq(totalSupplyBefore.add(surplus).sub(1))
        })
        it("should collect platform interest", async () => {
            // 1.0 Another Mint to generate platform interest to collect
            await mAssetMachine.seedWithWeightings(details, unbalancedWeights)

            // 2.0 Get all balances and data before
            const mAssetBalBefore = await details.mAsset.balanceOf(sa.mockSavingsManager.address)
            const bassetsBefore = await mAssetMachine.getBassetsInMasset(details)
            const sumOfVaultsBefore = bassetsBefore.reduce((p, c) => p.add(applyRatio(c.vaultBalance, c.ratio)), BN.from(0))
            const totalSupplyBefore = await details.mAsset.totalSupply()

            // 3.0 Check the SavingsManager in the mock Nexus contract
            const nexus = (await ethers.getContractAt("MockNexus", await details.mAsset.nexus())) as MockNexus
            const savingsManagerInNexus = await nexus.getModule(keccak256(toUtf8Bytes("SavingsManager")))
            expect(savingsManagerInNexus, "savingsManagerInNexus").eq(sa.mockSavingsManager.address)

            // 4.0 Static call of collectPlatformInterest
            const mAsset = details.mAsset.connect(sa.mockSavingsManager.signer)
            const { mintAmount, newSupply } = await mAsset.callStatic.collectPlatformInterest()

            // 5.0 Collect platform interest
            const collectPlatformInterestTx = mAsset.collectPlatformInterest()

            // 6.0 Event emits correct unit
            await expect(collectPlatformInterestTx, "MintedMulti event on mAsset")
                .to.emit(mAsset, "MintedMulti")
                .withArgs(
                    mAsset.address,
                    sa.mockSavingsManager.address,
                    mintAmount,
                    [],
                    [0, 0, simpleToExactAmount(4, 9), simpleToExactAmount(6, 15)],
                )
            await expect(collectPlatformInterestTx, "Transfer event on mAsset")
                .to.emit(mAsset, "Transfer")
                .withArgs(ZERO_ADDRESS, sa.mockSavingsManager.address, mintAmount)

            // 7.0 Check outputs
            const mAssetBalAfter = await details.mAsset.balanceOf(sa.mockSavingsManager.address)
            const bassetsAfter = await mAssetMachine.getBassetsInMasset(details)
            bassetsAfter.forEach((b, i) => {
                if (i > 1) {
                    expect(b.vaultBalance, `balance of bAsset[${i}] not increased`).gt(bassetsBefore[i].vaultBalance)
                }
            })
            const sumOfVaultsAfter = bassetsAfter.reduce((p, c) => p.add(applyRatio(c.vaultBalance, c.ratio)), BN.from(0))
            const totalSupplyAfter = await details.mAsset.totalSupply()
            expect(newSupply).to.eq(totalSupplyAfter)

            // 6.1 totalSupply should only increase by <= 0.0005%
            // assertBNSlightlyGTPercent(totalSupplyAfter, totalSupplyBefore, systemMachine.isGanacheFork ? "0.001" : "0.01", true)
            assertBNSlightlyGTPercent(totalSupplyAfter, totalSupplyBefore, "0.01", true)
            // 6.2 check that increase in vault balance is equivalent to total balance
            const increasedTotalSupply = totalSupplyAfter.sub(totalSupplyBefore)
            expect(increasedTotalSupply, "increasedTotalSupply").eq(sumOfVaultsAfter.sub(sumOfVaultsBefore))
            expect(mintAmount).to.eq(increasedTotalSupply)
            // 6.3 Ensure that the SavingsManager received the mAsset
            expect(mAssetBalAfter, "mAssetBalAfter").eq(mAssetBalBefore.add(increasedTotalSupply))
        })
        it("should fail to collect platform interest after no activity", async () => {
            const mAsset = details.mAsset.connect(sa.mockSavingsManager.signer)
            await expect(mAsset.callStatic.collectPlatformInterest()).to.revertedWith("Must collect something")
        })
        context("only allow the SavingsManager to collect interest", () => {
            it("should fail governor", async () => {
                const { signer } = sa.governor
                await expect(details.mAsset.connect(signer).collectInterest()).to.be.revertedWith("Must be savings manager")
                await expect(details.mAsset.connect(signer).collectPlatformInterest()).to.be.revertedWith("Must be savings manager")
            })
            it("should fail the default signer that deployed the contracts", async () => {
                const { signer } = sa.default
                await expect(details.mAsset.connect(signer).collectInterest()).to.be.revertedWith("Must be savings manager")
                await expect(details.mAsset.connect(signer).collectPlatformInterest()).to.be.revertedWith("Must be savings manager")
            })
        })
    })

    describe("migrating bAssets between platforms", () => {
        let newMigration: MockPlatformIntegration
        let maliciousIntegration: MaliciousAaveIntegration
        let transferringAsset: MockERC20
        beforeEach(async () => {
            await runSetup(false, false, true, true)
            ;[, , , transferringAsset] = details.bAssets
            newMigration = await (await new MockPlatformIntegration__factory(sa.default.signer)).deploy(
                DEAD_ADDRESS,
                details.aavePlatformAddress,
                details.bAssets.map((b) => b.address),
                details.pTokens,
            )
            await newMigration.addWhitelist([details.mAsset.address])
            maliciousIntegration = await (await new MaliciousAaveIntegration__factory(sa.default.signer)).deploy(
                DEAD_ADDRESS,
                details.aavePlatformAddress,
                details.bAssets.map((b) => b.address),
                details.pTokens,
            )
            await maliciousIntegration.addWhitelist([details.mAsset.address])
        })
        it("should fail if passed 0 bAssets", async () => {
            await expect(details.mAsset.connect(sa.governor.signer).migrateBassets([], newMigration.address)).to.be.revertedWith(
                "Must migrate some bAssets",
            )
        })
        it("should fail if bAsset does not exist", async () => {
            await expect(
                details.mAsset.connect(sa.governor.signer).migrateBassets([DEAD_ADDRESS], newMigration.address),
            ).to.be.revertedWith("Invalid asset")
        })
        it("should fail if integrator address is the same", async () => {
            await expect(
                details.mAsset.connect(sa.governor.signer).migrateBassets([transferringAsset.address], details.platform.address),
            ).to.be.revertedWith("Must transfer to new integrator")
        })
        it("should fail if new address is a dud", async () => {
            await expect(details.mAsset.connect(sa.governor.signer).migrateBassets([transferringAsset.address], DEAD_ADDRESS)).to.be
                .reverted
        })
        it("should fail if the full amount is not transferred and deposited", async () => {
            await transferringAsset.transfer(details.platform.address, 10000)
            await details.platform.addWhitelist([sa.governor.address])
            await details.platform.connect(sa.governor.signer).deposit(transferringAsset.address, 9000, false)
            await expect(
                details.mAsset.connect(sa.governor.signer).migrateBassets([transferringAsset.address], maliciousIntegration.address),
            ).to.be.revertedWith("Must transfer full amount")
        })
        it("should move all bAssets from a to b", async () => {
            await transferringAsset.transfer(details.platform.address, 10000)
            await details.platform.addWhitelist([sa.governor.address])
            await details.platform.connect(sa.governor.signer).deposit(transferringAsset.address, 9000, false)
            // get balances before
            const bal = await details.platform.callStatic.checkBalance(transferringAsset.address)
            expect(bal).eq(9000)
            const rawBal = await transferringAsset.balanceOf(details.platform.address)
            expect(rawBal).eq(1000)
            const integratorAddress = (await details.mAsset.getBasset(transferringAsset.address))[0][1]
            expect(integratorAddress).eq(details.platform.address)
            // call migrate
            const tx = details.mAsset.connect(sa.governor.signer).migrateBassets([transferringAsset.address], newMigration.address)
            // emits BassetsMigrated
            await expect(tx).to.emit(details.managerLib, "BassetsMigrated").withArgs([transferringAsset.address], newMigration.address)
            // moves all bAssets from old to new
            const migratedBal = await newMigration.callStatic.checkBalance(transferringAsset.address)
            expect(migratedBal).eq(bal)
            const migratedRawBal = await transferringAsset.balanceOf(newMigration.address)
            expect(migratedRawBal).eq(rawBal)
            // old balances should be empty
            const newRawBal = await transferringAsset.balanceOf(details.platform.address)
            expect(newRawBal).eq(0)
            // updates the integrator address
            const [[, newIntegratorAddress]] = await details.mAsset.getBasset(transferringAsset.address)
            expect(newIntegratorAddress).eq(newMigration.address)
        })
        it("should pass if either rawBalance or balance are 0", async () => {
            await transferringAsset.transfer(details.platform.address, 10000)
            await details.platform.addWhitelist([sa.governor.address])
            await details.platform.connect(sa.governor.signer).deposit(transferringAsset.address, 10000, false)
            // get balances before
            const bal = await details.platform.callStatic.checkBalance(transferringAsset.address)
            expect(bal).eq(10000)
            const rawBal = await transferringAsset.balanceOf(details.platform.address)
            expect(rawBal).eq(0)
            const integratorAddress = (await details.mAsset.getBasset(transferringAsset.address))[0][1]
            expect(integratorAddress).eq(details.platform.address)
            // call migrate
            const tx = details.mAsset.connect(sa.governor.signer).migrateBassets([transferringAsset.address], newMigration.address)
            // emits BassetsMigrated
            await expect(tx).to.emit(details.managerLib, "BassetsMigrated").withArgs([transferringAsset.address], newMigration.address)
            // moves all bAssets from old to new
            const migratedBal = await newMigration.callStatic.checkBalance(transferringAsset.address)
            expect(migratedBal).eq(bal)
            const migratedRawBal = await transferringAsset.balanceOf(newMigration.address)
            expect(migratedRawBal).eq(rawBal)
            // updates the integrator address
            const [[, newIntegratorAddress]] = await details.mAsset.getBasset(transferringAsset.address)
            expect(newIntegratorAddress).eq(newMigration.address)
        })
    })
    describe("when going from no platform to a platform", () => {
        let newMigration: MockPlatformIntegration
        let transferringAsset: MockERC20
        before(async () => {
            await runSetup(true, false, false, true)
            ;[, , , transferringAsset] = details.bAssets
            newMigration = await (await new MockPlatformIntegration__factory(sa.default.signer)).deploy(
                DEAD_ADDRESS,
                details.aavePlatformAddress,
                details.bAssets.map((b) => b.address),
                details.pTokens,
            )
            await newMigration.addWhitelist([details.mAsset.address])
        })
        it("should migrate everything correctly", async () => {
            // get balances before
            const rawBalBefore = await (await details.mAsset.getBasset(transferringAsset.address))[1][1]
            const integratorAddress = (await details.mAsset.getBasset(transferringAsset.address))[0][1]
            expect(integratorAddress).eq(ZERO_ADDRESS)
            // call migrate
            const tx = details.mAsset.connect(sa.governor.signer).migrateBassets([transferringAsset.address], newMigration.address)
            // emits BassetsMigrated
            await expect(tx).to.emit(details.managerLib, "BassetsMigrated").withArgs([transferringAsset.address], newMigration.address)
            // moves all bAssets from old to new
            const migratedBal = await newMigration.callStatic.checkBalance(transferringAsset.address)
            expect(migratedBal).eq(0)
            const migratedRawBal = await transferringAsset.balanceOf(newMigration.address)
            expect(migratedRawBal).eq(rawBalBefore)
            // old balances should be empty
            const newRawBal = await transferringAsset.balanceOf(details.mAsset.address)
            expect(newRawBal).eq(0)
            // updates the integrator address
            const [[, newIntegratorAddress]] = await details.mAsset.getBasset(transferringAsset.address)
            expect(newIntegratorAddress).eq(newMigration.address)
        })
    })

    describe("negateIsolation()", async () => {
        before("init basset with vaults", async () => {
            await runSetup(true, false, true)
        })
        it("should skip when Normal (by governor)", async () => {
            const { bAssets, mAsset, managerLib } = details
            const basketBefore = await mAsset.getBasket()
            expect(basketBefore[0]).to.false
            const tx = mAsset.connect(sa.governor.signer).negateIsolation(bAssets[0].address)
            await expect(tx).to.emit(managerLib, "BassetStatusChanged").withArgs(bAssets[0].address, BassetStatus.Normal)
            const afterBefore = await mAsset.getBasket()
            expect(afterBefore[0]).to.false
        })
        it("should fail when called by default", async () => {
            const { bAssets, mAsset } = details
            await expect(mAsset.connect(sa.default.signer).negateIsolation(bAssets[0].address)).to.revertedWith("Only governor can execute")
        })
        it("should fail when not called by governor", async () => {
            const { bAssets, mAsset } = details
            await expect(mAsset.connect(sa.other.signer).negateIsolation(bAssets[0].address)).to.revertedWith("Only governor can execute")
        })
        it("should fail when wrong bAsset address passed", async () => {
            const { mAsset } = details
            await expect(mAsset.connect(sa.governor.signer).negateIsolation(sa.other.address)).to.be.revertedWith("Invalid asset")
        })
        it("should succeed when status is 'BrokenAbovePeg' (by governor)", async () => {
            const { bAssets, mAsset, managerLib } = details
            const bAsset = bAssets[1]

            const basketBefore = await mAsset.getBasket()
            expect(basketBefore[0], "before undergoingRecol").to.false
            const bAssetStateBefore = await mAsset.getBasset(bAsset.address)
            expect(bAssetStateBefore.personal.status).to.eq(BassetStatus.Normal)

            await mAsset.connect(sa.governor.signer).handlePegLoss(bAsset.address, false)

            const basketAfterPegLoss = await mAsset.getBasket()
            expect(basketAfterPegLoss[0], "after handlePegLoss undergoingRecol").to.true
            const bAssetStateAfterPegLoss = await mAsset.getBasset(bAsset.address)
            expect(bAssetStateAfterPegLoss.personal.status, "after handlePegLoss personal.status").to.eq(BassetStatus.BrokenAbovePeg)

            const tx = mAsset.connect(sa.governor.signer).negateIsolation(bAsset.address)

            await expect(tx).to.emit(managerLib, "BassetStatusChanged").withArgs(bAsset.address, BassetStatus.Normal)
            await tx
            const basketAfterNegateIsolation = await mAsset.getBasket()
            expect(basketAfterNegateIsolation[0], "after negateIsolation undergoingRecol").to.false
            const bAssetStateAfterNegateIsolation = await mAsset.getBasset(bAsset.address)
            expect(bAssetStateAfterNegateIsolation.personal.status, "after negateIsolation personal.status").to.eq(BassetStatus.Normal)
        })
        it("should succeed when two bAssets have BrokenBelowPeg", async () => {
            const { bAssets, mAsset, managerLib } = details

            const basketBefore = await mAsset.getBasket()
            expect(basketBefore[0], "before undergoingRecol").to.false

            await mAsset.connect(sa.governor.signer).handlePegLoss(bAssets[2].address, true)
            await mAsset.connect(sa.governor.signer).handlePegLoss(bAssets[3].address, true)

            const basketAfterPegLoss = await mAsset.getBasket()
            expect(basketAfterPegLoss[0], "after handlePegLoss undergoingRecol").to.true
            const bAsset2StateAfterPegLoss = await mAsset.getBasset(bAssets[2].address)
            expect(bAsset2StateAfterPegLoss.personal.status, "after handlePegLoss personal.status 2").to.eq(BassetStatus.BrokenBelowPeg)
            const bAsset3StateAfterPegLoss = await mAsset.getBasset(bAssets[3].address)
            expect(bAsset3StateAfterPegLoss.personal.status, "after handlePegLoss personal.status 3").to.eq(BassetStatus.BrokenBelowPeg)

            const tx = mAsset.connect(sa.governor.signer).negateIsolation(bAssets[3].address)

            await expect(tx).to.emit(managerLib, "BassetStatusChanged").withArgs(bAssets[3].address, BassetStatus.Normal)
            await tx
            const basketAfterNegateIsolation = await mAsset.getBasket()
            expect(basketAfterNegateIsolation[0], "after negateIsolation undergoingRecol").to.true
            const bAsset2AfterNegateIsolation = await mAsset.getBasset(bAssets[2].address)
            expect(bAsset2AfterNegateIsolation.personal.status, "after negateIsolation personal.status 2").to.eq(
                BassetStatus.BrokenBelowPeg,
            )
            const bAsset3AfterNegateIsolation = await mAsset.getBasset(bAssets[3].address)
            expect(bAsset3AfterNegateIsolation.personal.status, "after negateIsolation personal.status 3").to.eq(BassetStatus.Normal)
        })
    })
    describe("Amplification coefficient", () => {
        before(async () => {
            await runSetup()
        })
        it("should succeed in starting increase over 2 weeks", async () => {
            const mAsset = details.mAsset.connect(sa.governor.signer)
            const ampDataBefore = await mAsset.ampData()

            // default values
            expect(ampDataBefore.initialA, "before initialA").to.eq(10000)
            expect(ampDataBefore.targetA, "before targetA").to.eq(10000)
            expect(ampDataBefore.rampStartTime, "before rampStartTime").to.eq(0)
            expect(ampDataBefore.rampEndTime, "before rampEndTime").to.eq(0)

            const startTime = await getTimestamp()
            const endTime = startTime.add(ONE_WEEK.mul(2))
            const tx = mAsset.startRampA(120, endTime)
            await expect(tx).to.emit(details.managerLib, "StartRampA").withArgs(10000, 12000, startTime.add(1), endTime)

            // after values
            const ampDataAfter = await mAsset.ampData()
            expect(ampDataAfter.initialA, "after initialA").to.eq(10000)
            expect(ampDataAfter.targetA, "after targetA").to.eq(12000)
            expect(ampDataAfter.rampStartTime, "after rampStartTime").to.eq(startTime.add(1))
            expect(ampDataAfter.rampEndTime, "after rampEndTime").to.eq(endTime)
        })
        context("increasing A by 20 over 10 day period", () => {
            let startTime: BN
            let endTime: BN
            let mAsset: Masset
            before(async () => {
                await runSetup()
                mAsset = details.mAsset.connect(sa.governor.signer)
                startTime = await getTimestamp()
                endTime = startTime.add(ONE_DAY.mul(10))
                await mAsset.startRampA(120, endTime)
            })
            it("should succeed getting A just after start", async () => {
                expect(await mAsset.getA()).to.eq(10000)
            })
            const testsData = [
                {
                    // 60 * 60 * 24 * 10 / 2000 = 432
                    desc: "just under before increment",
                    elapsedSeconds: 431,
                    expectedValaue: 10000,
                },
                {
                    desc: "just under after increment",
                    elapsedSeconds: 434,
                    expectedValaue: 10001,
                },
                {
                    desc: "after 1 day",
                    elapsedSeconds: ONE_DAY.add(1),
                    expectedValaue: 10200,
                },
                {
                    desc: "after 9 days",
                    elapsedSeconds: ONE_DAY.mul(9).add(1),
                    expectedValaue: 11800,
                },
                {
                    desc: "just under 10 days",
                    elapsedSeconds: ONE_DAY.mul(10).sub(2),
                    expectedValaue: 11999,
                },
                {
                    desc: "after 10 days",
                    elapsedSeconds: ONE_DAY.mul(10),
                    expectedValaue: 12000,
                },
                {
                    desc: "after 11 days",
                    elapsedSeconds: ONE_DAY.mul(11),
                    expectedValaue: 12000,
                },
            ]
            for (const testData of testsData) {
                it(`should succeed getting A ${testData.desc}`, async () => {
                    const currentTime = await getTimestamp()
                    const incrementSeconds = startTime.add(testData.elapsedSeconds).sub(currentTime)
                    await increaseTime(incrementSeconds)
                    expect(await mAsset.getA()).to.eq(testData.expectedValaue)
                })
            }
        })
        context("A target changes just in range", () => {
            let currentA: BN
            let startTime: BN
            let endTime: BN
            beforeEach(async () => {
                await runSetup()
                currentA = await details.mAsset.getA()
                startTime = await getTimestamp()
                endTime = startTime.add(ONE_DAY.mul(7))
            })
            it("should increase target A 10x", async () => {
                // target = current * 10 / 100
                // the 100 is the precision
                const targetA = currentA.div(10)
                details.mAsset.connect(sa.governor.signer).startRampA(targetA, endTime)

                const ampDataAfter = await details.mAsset.ampData()
                expect(ampDataAfter.targetA, "after targetA").to.eq(targetA.mul(100))
            })
            it("should decrease target A 10x", async () => {
                // target = current / 100 / 10
                // the 100 is the precision
                const targetA = currentA.div(1000)
                details.mAsset.connect(sa.governor.signer).startRampA(targetA, endTime)

                const ampDataAfter = await details.mAsset.ampData()
                expect(ampDataAfter.targetA, "after targetA").to.eq(targetA.mul(100))
            })
        })
        context("decreasing A by 50 over 5 days", () => {
            let startTime: BN
            let endTime: BN
            let mAsset: Masset
            before(async () => {
                await runSetup()
                mAsset = details.mAsset.connect(sa.governor.signer)
                startTime = await getTimestamp()
                endTime = startTime.add(ONE_DAY.mul(5))
                await mAsset.startRampA(50, endTime)
            })
            it("should succeed getting A just after start", async () => {
                expect(await mAsset.getA()).to.eq(10000)
            })
            const testsData = [
                {
                    // 60 * 60 * 24 * 5 / 5000 = 86
                    desc: "just under before increment",
                    elapsedSeconds: 84,
                    expectedValaue: 10000,
                },
                {
                    desc: "just under after increment",
                    elapsedSeconds: 88,
                    expectedValaue: 9999,
                },
                {
                    desc: "after 1 day",
                    elapsedSeconds: ONE_DAY.add(1),
                    expectedValaue: 9000,
                },
                {
                    desc: "after 4 days",
                    elapsedSeconds: ONE_DAY.mul(4).add(1),
                    expectedValaue: 6000,
                },
                {
                    desc: "just under 5 days",
                    elapsedSeconds: ONE_DAY.mul(5).sub(2),
                    expectedValaue: 5001,
                },
                {
                    desc: "after 5 days",
                    elapsedSeconds: ONE_DAY.mul(5),
                    expectedValaue: 5000,
                },
                {
                    desc: "after 6 days",
                    elapsedSeconds: ONE_DAY.mul(6),
                    expectedValaue: 5000,
                },
            ]
            for (const testData of testsData) {
                it(`should succeed getting A ${testData.desc}`, async () => {
                    const currentTime = await getTimestamp()
                    const incrementSeconds = startTime.add(testData.elapsedSeconds).sub(currentTime)
                    await increaseTime(incrementSeconds)
                    expect(await mAsset.getA()).to.eq(testData.expectedValaue)
                })
            }
        })
        describe("should fail to start ramp A", () => {
            before(async () => {
                await runSetup()
            })
            it("when ramp up time only 1 hour", async () => {
                await expect(details.mAsset.connect(sa.governor.signer).startRampA(12000, ONE_HOUR)).to.revertedWith("Ramp time too short")
            })
            it("when ramp up time just less than 1 day", async () => {
                await expect(details.mAsset.connect(sa.governor.signer).startRampA(12000, ONE_DAY.sub(1))).to.revertedWith(
                    "Ramp time too short",
                )
            })
            it("when A target too big", async () => {
                const startTime = await getTimestamp()
                const endTime = startTime.add(ONE_DAY.mul(7))
                await expect(details.mAsset.connect(sa.governor.signer).startRampA(1000000, endTime)).to.revertedWith(
                    "A target out of bounds",
                )
            })
            it("when A target increase greater than 10x", async () => {
                const currentA = await details.mAsset.getA()
                // target = current * 10 / 100
                // the 100 is the precision
                const targetA = currentA.div(10).add(1)
                const startTime = await getTimestamp()
                const endTime = startTime.add(ONE_DAY.mul(7))
                await expect(details.mAsset.connect(sa.governor.signer).startRampA(targetA, endTime)).to.revertedWith(
                    "A target increase too big",
                )
            })
            it("when A target decrease greater than 10x", async () => {
                const currentA = await details.mAsset.getA()
                // target = current / 100 / 10
                // the 100 is the precision
                const targetA = currentA.div(1000).sub(1)
                const startTime = await getTimestamp()
                const endTime = startTime.add(ONE_DAY.mul(7))
                await expect(details.mAsset.connect(sa.governor.signer).startRampA(targetA, endTime)).to.revertedWith(
                    "A target decrease too big",
                )
            })
            it("when A target is zero", async () => {
                const startTime = await getTimestamp()
                const endTime = startTime.add(ONE_DAY.mul(7))
                await expect(details.mAsset.connect(sa.governor.signer).startRampA(0, endTime)).to.revertedWith("A target out of bounds")
            })
            it("when starting just less than a day after the last finished", async () => {
                const mAsset = details.mAsset.connect(sa.governor.signer)
                const startTime = await getTimestamp()
                const endTime = startTime.add(ONE_DAY.mul(2))
                await mAsset.startRampA(130, endTime)

                // increment 1 day
                await increaseTime(ONE_HOUR.mul(20))

                const secondStartTime = await getTimestamp()
                const secondEndTime = secondStartTime.add(ONE_DAY.mul(7))
                await expect(mAsset.startRampA(150, secondEndTime)).to.revertedWith("Sufficient period of previous ramp has not elapsed")
            })
        })
        context("stop ramp A", () => {
            let startTime: BN
            let endTime: BN
            let mAsset: Masset
            before(async () => {
                await runSetup()
                mAsset = details.mAsset.connect(sa.governor.signer)
                startTime = await getTimestamp()
                endTime = startTime.add(ONE_DAY.mul(5))
                await mAsset.startRampA(50, endTime)
            })
            it("should stop decreasing A after a day", async () => {
                // increment 1 day
                await increaseTime(ONE_DAY)

                const currentA = await mAsset.getA()
                const currentTime = await getTimestamp()
                const tx = mAsset.stopRampA()
                await expect(tx).to.emit(details.managerLib, "StopRampA").withArgs(currentA, currentTime.add(1))
                expect(await mAsset.getA()).to.eq(currentA)

                const ampDataAfter = await mAsset.ampData()
                expect(ampDataAfter.initialA, "after initialA").to.eq(currentA)
                expect(ampDataAfter.targetA, "after targetA").to.eq(currentA)
                expect(ampDataAfter.rampStartTime.toNumber(), "after rampStartTime").to.within(
                    currentTime.toNumber(),
                    currentTime.add(2).toNumber(),
                )
                expect(ampDataAfter.rampEndTime.toNumber(), "after rampEndTime").to.within(
                    currentTime.toNumber(),
                    currentTime.add(2).toNumber(),
                )

                // increment another 2 days
                await increaseTime(ONE_DAY.mul(2))
                expect(await mAsset.getA()).to.eq(currentA)
            })
        })
        describe("should fail to stop ramp A", () => {
            before(async () => {
                await runSetup()
                const mAsset = details.mAsset.connect(sa.governor.signer)
                const startTime = await getTimestamp()
                const endTime = startTime.add(ONE_DAY.mul(2))
                await mAsset.startRampA(50, endTime)
            })
            it("After ramp has complete", async () => {
                // increment 2 days
                await increaseTime(ONE_DAY.mul(2).add(1))
                await expect(details.mAsset.connect(sa.governor.signer).stopRampA()).to.revertedWith("Amplification not changing")
            })
        })
    })
})
