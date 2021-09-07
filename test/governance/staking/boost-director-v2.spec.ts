/* eslint-disable no-underscore-dangle */

import { ethers } from "hardhat"
import { expect } from "chai"
import { utils } from "ethers"
import { simpleToExactAmount, BN } from "@utils/math"
import { assertBNClose, assertBNClosePercent, assertBNSlightlyGT } from "@utils/assertions"
import { StandardAccounts, MassetMachine } from "@utils/machines"
import { fullScale, ZERO_ADDRESS, ONE_DAY, FIVE_DAYS, ONE_WEEK, DEAD_ADDRESS } from "@utils/constants"
import { getTimestamp, increaseTime } from "@utils/time"
import {
    MockERC20,
    MockERC20__factory,
    ImmutableModule,
    MockStakingContract,
    MockStakingContract__factory,
    InitializableRewardsDistributionRecipient,
    BoostedVault,
    BoostedVault__factory,
    MockNexus,
    MockNexus__factory,
    AssetProxy__factory,
    BoostDirector__factory,
    BoostDirector,
    MockBoostedVault,
    MockBoostedVault__factory,
} from "types/generated"
import { Account } from "types"

// TODO - convert this to use BoostDirectorV2
//  - change existing tests to support up to 6 vaults
//  - add `removeStakedToken`
//  - add `setBalanceDivisor` & check output
context.skip("Govern boost director v2", () => {
    let sa: StandardAccounts
    let mAssetMachine: MassetMachine
    let rewardsDistributor: Account

    let rewardToken: MockERC20
    let nexus: MockNexus
    let stakingContract: MockStakingContract
    let boostDirector: BoostDirector

    let vaultA: Account
    let vaultB: Account
    let vaultC: Account
    let vaultD: Account
    let vaultUnlisted: Account
    let user1NoStake: Account
    let user2Staked: Account
    let user3Staked: Account

    before(async () => {
        const accounts = await ethers.getSigners()
        mAssetMachine = await new MassetMachine().initAccounts(accounts)
        sa = mAssetMachine.sa
        rewardsDistributor = sa.fundManager

        vaultA = sa.dummy1
        vaultB = sa.dummy2
        vaultC = sa.dummy3
        vaultD = sa.dummy4
        vaultUnlisted = sa.all[10]
        user1NoStake = sa.all[11]
        user2Staked = sa.all[12]
        user3Staked = sa.all[13]

        nexus = await new MockNexus__factory(sa.default.signer).deploy(sa.governor.address, DEAD_ADDRESS, DEAD_ADDRESS)
        rewardToken = await new MockERC20__factory(sa.default.signer).deploy("Reward", "RWD", 18, rewardsDistributor.address, 10000000)
        stakingContract = await new MockStakingContract__factory(sa.default.signer).deploy()
        await stakingContract.setBalanceOf(user2Staked.address, 20000)
        await stakingContract.setBalanceOf(user3Staked.address, 30000)
    })
    context("Whitelisting boost savings vaults", () => {
        before(async () => {
            boostDirector = await new BoostDirector__factory(sa.default.signer).deploy(nexus.address, stakingContract.address)
            await boostDirector.initialize([vaultA.address])
        })
        it("should get first vault A", async () => {
            expect(await boostDirector._vaults(vaultA.address)).to.eq(1)
        })
        it("should fail if not governor", async () => {
            let tx = boostDirector.connect(sa.default.signer).whitelistVaults([vaultB.address])
            await expect(tx).to.revertedWith("Only governor can execute")
            tx = boostDirector.connect(sa.fundManager.signer).whitelistVaults([vaultB.address])
            await expect(tx).to.revertedWith("Only governor can execute")
        })
        it("should succeed in whitelisting no boost savings vault", async () => {
            const tx = boostDirector.connect(sa.governor.signer).whitelistVaults([])
            await expect(tx).to.revertedWith("Must be at least one vault")
        })
        it("should succeed in whitelisting one boost savings vault", async () => {
            const tx = boostDirector.connect(sa.governor.signer).whitelistVaults([vaultB.address])
            await expect(tx).to.emit(boostDirector, "Whitelisted").withArgs(vaultB.address, 2)
            expect(await boostDirector._vaults(vaultB.address)).to.eq(2)
        })
        it("should fail if already whitelisted", async () => {
            const tx = boostDirector.connect(sa.governor.signer).whitelistVaults([vaultB.address])
            await expect(tx).to.revertedWith("Vault already whitelisted")
        })
        it("should succeed in whitelisting two boost savings vault", async () => {
            const tx = boostDirector.connect(sa.governor.signer).whitelistVaults([vaultC.address, vaultD.address])
            await expect(tx).to.emit(boostDirector, "Whitelisted").withArgs(vaultC.address, 3)
            await expect(tx).to.emit(boostDirector, "Whitelisted").withArgs(vaultD.address, 4)
            expect(await boostDirector._vaults(vaultC.address)).to.eq(3)
            expect(await boostDirector._vaults(vaultD.address)).to.eq(4)
        })
    })
    context("get boost balance", () => {
        let boostDirectorVaultA: BoostDirector
        let boostDirectorVaultB: BoostDirector
        let boostDirectorVaultC: BoostDirector
        let boostDirectorVaultD: BoostDirector
        before(async () => {
            boostDirector = await new BoostDirector__factory(sa.default.signer).deploy(nexus.address, stakingContract.address)
            await boostDirector.initialize([vaultA.address, vaultB.address, vaultC.address, vaultD.address])
            boostDirectorVaultA = boostDirector.connect(vaultA.signer)
            boostDirectorVaultB = boostDirector.connect(vaultB.signer)
            boostDirectorVaultC = boostDirector.connect(vaultC.signer)
            boostDirectorVaultD = boostDirector.connect(vaultD.signer)
        })
        context("called from vault A", () => {
            context("for user 1 with nothing staked", () => {
                it("should get zero balance", async () => {
                    const bal = await boostDirectorVaultA.callStatic.getBalance(user1NoStake.address)
                    expect(bal).to.eq(0)
                })
                it("should add user to boost director", async () => {
                    const tx = boostDirectorVaultA.getBalance(user1NoStake.address)
                    await expect(tx).to.emit(boostDirector, "Directed").withArgs(user1NoStake.address, vaultA.address)
                })
                it("should fail to add user to boost director again", async () => {
                    const tx = boostDirectorVaultA.getBalance(user1NoStake.address)
                    await expect(tx).to.not.emit(boostDirector, "Directed")
                })
                it("should get user zero balance after being added", async () => {
                    const bal = await boostDirectorVaultA.callStatic.getBalance(user1NoStake.address)
                    expect(bal).to.eq(0)
                })
            })
            context("for user 2 with 20,000 staked", () => {
                it("should get user 2 balance", async () => {
                    const bal = await boostDirectorVaultA.callStatic.getBalance(user2Staked.address)
                    expect(bal).to.eq(20000)
                })
                it("should add user 2 to boost director", async () => {
                    const tx = boostDirectorVaultA.getBalance(user2Staked.address)
                    await expect(tx).to.emit(boostDirector, "Directed").withArgs(user2Staked.address, vaultA.address)
                })
                it("should fail to add user to boost director again", async () => {
                    const tx = boostDirectorVaultA.getBalance(user2Staked.address)
                    await expect(tx).to.not.emit(boostDirector, "Directed")
                })
                it("should get user 2 balance after being added", async () => {
                    const bal = await boostDirectorVaultA.callStatic.getBalance(user2Staked.address)
                    expect(bal).to.eq(20000)
                })
            })
        })
        context("user 3 with 30,000 staked added to vaults A, B and C but not D", () => {
            const userStakedBalance = 30000
            it("vault A should get user balance before being added to any vaults", async () => {
                const bal = await boostDirectorVaultA.callStatic.getBalance(user3Staked.address)
                expect(bal).to.eq(userStakedBalance)
            })
            it("vault A should add user to boost director", async () => {
                const tx = boostDirectorVaultA.getBalance(user3Staked.address)
                await expect(tx).to.emit(boostDirector, "Directed").withArgs(user3Staked.address, vaultA.address)
            })
            it("vault B should add user to boost director", async () => {
                const tx = boostDirectorVaultB.getBalance(user3Staked.address)
                await expect(tx).to.emit(boostDirector, "Directed").withArgs(user3Staked.address, vaultB.address)
            })
            it("vault C should add user to boost director", async () => {
                const tx = boostDirectorVaultC.getBalance(user3Staked.address)
                await expect(tx).to.emit(boostDirector, "Directed").withArgs(user3Staked.address, vaultC.address)
            })
            it("vault C should get user balance after user added", async () => {
                const bal = await boostDirectorVaultC.callStatic.getBalance(user3Staked.address)
                expect(bal).to.eq(userStakedBalance)
            })
            it("vault D should fail to add user as its the fourth", async () => {
                const tx = boostDirectorVaultD.getBalance(user3Staked.address)
                await expect(tx).to.not.emit(boostDirector, "Directed")
            })
            it("vault D should get zero balance for the user", async () => {
                const bal = await boostDirectorVaultD.callStatic.getBalance(user3Staked.address)
                expect(bal).to.eq(0)
            })
            it("vault A should still user balance", async () => {
                const bal = await boostDirectorVaultA.callStatic.getBalance(user3Staked.address)
                expect(bal).to.eq(userStakedBalance)
            })
            it("vault B should still fer user balance", async () => {
                const bal = await boostDirectorVaultB.callStatic.getBalance(user3Staked.address)
                expect(bal).to.eq(userStakedBalance)
            })
            it("vault C should still user balance", async () => {
                const bal = await boostDirectorVaultC.callStatic.getBalance(user3Staked.address)
                expect(bal).to.eq(userStakedBalance)
            })
        })
        context("adding non whitelisted vaults", () => {
            it("should fail to add user from unlisted vault", async () => {
                const tx = boostDirector.connect(vaultUnlisted.signer).getBalance(user2Staked.address)
                await expect(tx).to.not.emit(boostDirector, "Directed")
            })
            it("should get zero balance for unlisted vault", async () => {
                const bal = await boostDirector.connect(vaultUnlisted.signer).callStatic.getBalance(user3Staked.address)
                expect(bal).to.eq(0)
            })
            it("should fail for user to add themselves as a vault", async () => {
                const tx = boostDirector.connect(user2Staked.signer).getBalance(user2Staked.address)
                await expect(tx).to.not.emit(boostDirector, "Directed")
            })
        })
    })
    context("redirect staked rewards to new boost savings vault", () => {
        let mockedVaults: MockBoostedVault[]
        before(async () => {
            boostDirector = await new BoostDirector__factory(sa.default.signer).deploy(nexus.address, stakingContract.address)

            const mockedVaultsPromises = [1, 2, 3, 4, 5].map(() =>
                new MockBoostedVault__factory(sa.default.signer).deploy(boostDirector.address),
            )
            mockedVaults = await Promise.all(mockedVaultsPromises)
            const mockedVaultAddresses = mockedVaults.map((vault) => vault.address)
            await boostDirector.initialize(mockedVaultAddresses)

            // For user 1, add the first three vaults to the Boost Director.
            await mockedVaults[0].testGetBalance(user1NoStake.address)
            await mockedVaults[1].testGetBalance(user1NoStake.address)
            await mockedVaults[2].testGetBalance(user1NoStake.address)
            // For user 2, add the first two vaults to the Boost Director.
            await mockedVaults[0].testGetBalance(user2Staked.address)
            await mockedVaults[1].testGetBalance(user2Staked.address)
            await mockedVaults[2].testGetBalance(user2Staked.address)
            // For user 3, just add the first vault
            await mockedVaults[0].testGetBalance(user3Staked.address)
        })
        it("should get initial balancers", async () => {
            expect(await mockedVaults[0].callStatic.testGetBalance(user1NoStake.address)).to.eq(0)
            expect(await mockedVaults[1].callStatic.testGetBalance(user1NoStake.address)).to.eq(0)
            expect(await mockedVaults[2].callStatic.testGetBalance(user1NoStake.address)).to.eq(0)
            expect(await mockedVaults[3].callStatic.testGetBalance(user1NoStake.address)).to.eq(0)
            expect(await mockedVaults[4].callStatic.testGetBalance(user1NoStake.address)).to.eq(0)

            expect(await mockedVaults[0].callStatic.testGetBalance(user2Staked.address)).to.eq(20000)
            expect(await mockedVaults[1].callStatic.testGetBalance(user2Staked.address)).to.eq(20000)
            expect(await mockedVaults[2].callStatic.testGetBalance(user2Staked.address)).to.eq(20000)
            expect(await mockedVaults[3].callStatic.testGetBalance(user2Staked.address)).to.eq(0)
            expect(await mockedVaults[4].callStatic.testGetBalance(user2Staked.address)).to.eq(0)

            // This will always return the staked balance as the changes are not persisted
            expect(await mockedVaults[0].callStatic.testGetBalance(user3Staked.address)).to.eq(30000)
            expect(await mockedVaults[1].callStatic.testGetBalance(user3Staked.address)).to.eq(30000)
            expect(await mockedVaults[2].callStatic.testGetBalance(user3Staked.address)).to.eq(30000)
            expect(await mockedVaults[3].callStatic.testGetBalance(user3Staked.address)).to.eq(30000)
            expect(await mockedVaults[4].callStatic.testGetBalance(user3Staked.address)).to.eq(30000)
        })
        it("should fail as old vault is not whitelisted", async () => {
            const tx = boostDirector.connect(user1NoStake.signer).setDirection(sa.dummy1.address, mockedVaults[3].address, false)
            await expect(tx).to.revertedWith("Vaults not whitelisted")
        })
        it("should fail as user 1 has not been added to the old vault 4", async () => {
            const tx = boostDirector.connect(user1NoStake.signer).setDirection(mockedVaults[4].address, mockedVaults[3].address, false)
            await expect(tx).to.revertedWith("No need to replace old")
        })
        it("should fail as new vault is not whitelisted", async () => {
            const tx = boostDirector.connect(user1NoStake.signer).setDirection(mockedVaults[0].address, sa.dummy1.address, false)
            await expect(tx).to.revertedWith("Vaults not whitelisted")
        })
        it("user 1 should succeed in replacing vault 1 with vault 4 that is not poked", async () => {
            const tx = boostDirector.connect(user1NoStake.signer).setDirection(mockedVaults[0].address, mockedVaults[3].address, false)
            await expect(tx).to.emit(mockedVaults[0], "Poked").withArgs(user1NoStake.address)
            await expect(tx).to.not.emit(mockedVaults[3], "Poked")
            await expect(tx)
                .to.emit(boostDirector, "RedirectedBoost")
                .withArgs(user1NoStake.address, mockedVaults[3].address, mockedVaults[0].address)
        })
        it("user 1 should succeed in replacing vault 2 vault 5 that is poked", async () => {
            const tx = boostDirector.connect(user1NoStake.signer).setDirection(mockedVaults[1].address, mockedVaults[4].address, true)
            await expect(tx).to.emit(mockedVaults[1], "Poked").withArgs(user1NoStake.address)
            await expect(tx).to.emit(mockedVaults[4], "Poked").withArgs(user1NoStake.address)
            await expect(tx)
                .to.emit(boostDirector, "RedirectedBoost")
                .withArgs(user1NoStake.address, mockedVaults[4].address, mockedVaults[1].address)
        })
        it("user 2 should succeed in replacing vault 1 with vault 4 that is not poked", async () => {
            expect(await mockedVaults[0].callStatic.testGetBalance(user2Staked.address)).to.eq(20000)
            expect(await mockedVaults[1].callStatic.testGetBalance(user2Staked.address)).to.eq(20000)
            expect(await mockedVaults[2].callStatic.testGetBalance(user2Staked.address)).to.eq(20000)
            expect(await mockedVaults[3].callStatic.testGetBalance(user2Staked.address)).to.eq(0)
            expect(await mockedVaults[4].callStatic.testGetBalance(user2Staked.address)).to.eq(0)

            const tx = boostDirector.connect(user2Staked.signer).setDirection(mockedVaults[0].address, mockedVaults[3].address, false)
            await expect(tx).to.emit(mockedVaults[0], "Poked").withArgs(user2Staked.address)
            await expect(tx).to.not.emit(mockedVaults[3], "Poked")
            await expect(tx)
                .to.emit(boostDirector, "RedirectedBoost")
                .withArgs(user2Staked.address, mockedVaults[3].address, mockedVaults[0].address)

            expect(await mockedVaults[0].callStatic.testGetBalance(user2Staked.address)).to.eq(0)
            expect(await mockedVaults[1].callStatic.testGetBalance(user2Staked.address)).to.eq(20000)
            expect(await mockedVaults[2].callStatic.testGetBalance(user2Staked.address)).to.eq(20000)
            expect(await mockedVaults[3].callStatic.testGetBalance(user2Staked.address)).to.eq(20000)
            expect(await mockedVaults[4].callStatic.testGetBalance(user2Staked.address)).to.eq(0)
        })
        it("user 2 should succeed in replacing vault 2 vault 5 that is poked", async () => {
            expect(await mockedVaults[0].callStatic.testGetBalance(user2Staked.address)).to.eq(0)
            expect(await mockedVaults[1].callStatic.testGetBalance(user2Staked.address)).to.eq(20000)
            expect(await mockedVaults[2].callStatic.testGetBalance(user2Staked.address)).to.eq(20000)
            expect(await mockedVaults[3].callStatic.testGetBalance(user2Staked.address)).to.eq(20000)
            expect(await mockedVaults[4].callStatic.testGetBalance(user2Staked.address)).to.eq(0)

            const tx = boostDirector.connect(user2Staked.signer).setDirection(mockedVaults[1].address, mockedVaults[4].address, true)
            await expect(tx).to.emit(mockedVaults[1], "Poked").withArgs(user2Staked.address)
            await expect(tx).to.emit(mockedVaults[4], "Poked").withArgs(user2Staked.address)
            await expect(tx)
                .to.emit(boostDirector, "RedirectedBoost")
                .withArgs(user2Staked.address, mockedVaults[4].address, mockedVaults[1].address)

            expect(await mockedVaults[0].callStatic.testGetBalance(user2Staked.address)).to.eq(0)
            expect(await mockedVaults[1].callStatic.testGetBalance(user2Staked.address)).to.eq(0)
            expect(await mockedVaults[2].callStatic.testGetBalance(user2Staked.address)).to.eq(20000)
            expect(await mockedVaults[3].callStatic.testGetBalance(user2Staked.address)).to.eq(20000)
            expect(await mockedVaults[4].callStatic.testGetBalance(user2Staked.address)).to.eq(20000)
        })
        it("user 2 should succeed in replacing vault 5 back to vault 2 that is poked", async () => {
            expect(await mockedVaults[0].callStatic.testGetBalance(user2Staked.address)).to.eq(0)
            expect(await mockedVaults[1].callStatic.testGetBalance(user2Staked.address)).to.eq(0)
            expect(await mockedVaults[2].callStatic.testGetBalance(user2Staked.address)).to.eq(20000)
            expect(await mockedVaults[3].callStatic.testGetBalance(user2Staked.address)).to.eq(20000)
            expect(await mockedVaults[4].callStatic.testGetBalance(user2Staked.address)).to.eq(20000)

            const tx = boostDirector.connect(user2Staked.signer).setDirection(mockedVaults[4].address, mockedVaults[1].address, true)
            await expect(tx).to.emit(mockedVaults[4], "Poked").withArgs(user2Staked.address)
            await expect(tx).to.emit(mockedVaults[1], "Poked").withArgs(user2Staked.address)
            await expect(tx)
                .to.emit(boostDirector, "RedirectedBoost")
                .withArgs(user2Staked.address, mockedVaults[1].address, mockedVaults[4].address)

            expect(await mockedVaults[0].callStatic.testGetBalance(user2Staked.address)).to.eq(0)
            expect(await mockedVaults[1].callStatic.testGetBalance(user2Staked.address)).to.eq(20000)
            expect(await mockedVaults[2].callStatic.testGetBalance(user2Staked.address)).to.eq(20000)
            expect(await mockedVaults[3].callStatic.testGetBalance(user2Staked.address)).to.eq(20000)
            expect(await mockedVaults[4].callStatic.testGetBalance(user2Staked.address)).to.eq(0)
        })
        it("should fail as user 3 only has 1 vault", async () => {
            const tx = boostDirector.connect(user3Staked.signer).setDirection(mockedVaults[0].address, mockedVaults[3].address, false)
            await expect(tx).to.revertedWith("No need to replace old")
        })
    })
})
