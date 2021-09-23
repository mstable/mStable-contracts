/* eslint-disable no-underscore-dangle */

import { ethers } from "hardhat"
import { expect } from "chai"
import { BN } from "@utils/math"
import { StandardAccounts, MassetMachine } from "@utils/machines"
import { DEAD_ADDRESS } from "@utils/constants"
import {
    MockStakingContract,
    MockStakingContract__factory,
    MockNexus,
    MockNexus__factory,
    MockBoostedVault,
    MockBoostedVault__factory,
    BoostDirectorV2__factory,
    BoostDirectorV2,
} from "types/generated"
import { Account } from "types"
import { Contract } from "@ethersproject/contracts"

const vaultNumbers = [...Array(7).keys()]

context("Govern boost director v2", () => {
    let sa: StandardAccounts
    let mAssetMachine: MassetMachine

    let nexus: MockNexus
    let stakingContract: MockStakingContract
    let boostDirector: BoostDirectorV2

    let vaults: Account[]
    let vaultUnlisted: Account
    let user1NoStake: Account
    let user2Staked: Account
    let user3Staked: Account

    const user2StakedBalance = BN.from(20000).div(12)
    const user3StakedBalance = BN.from(30000).div(12)

    before(async () => {
        const accounts = await ethers.getSigners()
        mAssetMachine = await new MassetMachine().initAccounts(accounts)
        sa = mAssetMachine.sa

        vaults = [sa.dummy1, sa.dummy2, sa.dummy3, sa.dummy4, sa.dummy5, sa.dummy6, sa.dummy7]
        vaultUnlisted = sa.all[11]
        user1NoStake = sa.all[12]
        user2Staked = sa.all[13]
        user3Staked = sa.all[14]

        nexus = await new MockNexus__factory(sa.default.signer).deploy(sa.governor.address, DEAD_ADDRESS, DEAD_ADDRESS)
        stakingContract = await new MockStakingContract__factory(sa.default.signer).deploy()
        await stakingContract.setBalanceOf(user2Staked.address, 20000)
        await stakingContract.setBalanceOf(user3Staked.address, 30000)
    })
    context("Whitelisting boost savings vaults", () => {
        before(async () => {
            boostDirector = await new BoostDirectorV2__factory(sa.default.signer).deploy(nexus.address)
            await boostDirector.connect(sa.governor.signer).addStakedToken(stakingContract.address)
            await boostDirector.initialize([vaults[0].address])
        })
        it("should get first vault", async () => {
            expect(await boostDirector._vaults(vaults[0].address)).to.eq(1)
        })
        it("should fail if not governor", async () => {
            let tx = boostDirector.connect(sa.default.signer).whitelistVaults([vaults[1].address])
            await expect(tx).to.revertedWith("Only governor can execute")
            tx = boostDirector.connect(sa.fundManager.signer).whitelistVaults([vaults[1].address])
            await expect(tx).to.revertedWith("Only governor can execute")
        })
        it("should succeed in whitelisting no boost savings vault", async () => {
            const tx = boostDirector.connect(sa.governor.signer).whitelistVaults([])
            await expect(tx).to.revertedWith("Must be at least one vault")
        })
        it("should succeed in whitelisting one boost savings vault", async () => {
            const tx = boostDirector.connect(sa.governor.signer).whitelistVaults([vaults[1].address])
            await expect(tx).to.emit(boostDirector, "Whitelisted").withArgs(vaults[1].address, 2)
            expect(await boostDirector._vaults(vaults[1].address)).to.eq(2)
        })
        it("should fail if already whitelisted", async () => {
            const tx = boostDirector.connect(sa.governor.signer).whitelistVaults([vaults[1].address])
            await expect(tx).to.revertedWith("Vault already whitelisted")
        })
        it("should succeed in whitelisting two boost savings vault", async () => {
            const tx = boostDirector.connect(sa.governor.signer).whitelistVaults([vaults[2].address, vaults[3].address])
            await expect(tx).to.emit(boostDirector, "Whitelisted").withArgs(vaults[2].address, 3)
            await expect(tx).to.emit(boostDirector, "Whitelisted").withArgs(vaults[3].address, 4)
            expect(await boostDirector._vaults(vaults[2].address)).to.eq(3)
            expect(await boostDirector._vaults(vaults[3].address)).to.eq(4)
        })
    })
    context("get boost balance", () => {
        let boostDirectorVaults: BoostDirectorV2[]
        before(async () => {
            boostDirector = await new BoostDirectorV2__factory(sa.default.signer).deploy(nexus.address)
            await boostDirector.connect(sa.governor.signer).addStakedToken(stakingContract.address)
            const vaultAddresses = vaults.map((vault) => vault.address)
            await boostDirector.initialize(vaultAddresses)
            boostDirectorVaults = vaults.map((vault) => boostDirector.connect(vault.signer))
        })
        context("called from first vault", () => {
            context("for user 1 with nothing staked", () => {
                it("should get zero balance", async () => {
                    const bal = await boostDirectorVaults[0].callStatic.getBalance(user1NoStake.address)
                    expect(bal).to.eq(0)
                })
                it("should add user to boost director", async () => {
                    const tx = boostDirectorVaults[0].getBalance(user1NoStake.address)
                    await expect(tx).to.emit(boostDirector, "Directed").withArgs(user1NoStake.address, vaults[0].address)
                })
                it("should fail to add user to boost director again", async () => {
                    const tx = boostDirectorVaults[0].getBalance(user1NoStake.address)
                    await expect(tx).to.not.emit(boostDirector, "Directed")
                })
                it("should get user zero balance after being added", async () => {
                    const bal = await boostDirectorVaults[0].callStatic.getBalance(user1NoStake.address)
                    expect(bal).to.eq(0)
                })
            })
            context("for user 2 with 20,000 staked", () => {
                it("should get user 2 balance", async () => {
                    const bal = await boostDirectorVaults[0].callStatic.getBalance(user2Staked.address)
                    expect(bal).to.eq(user2StakedBalance)
                })
                it("should add user 2 to boost director", async () => {
                    const tx = boostDirectorVaults[0].getBalance(user2Staked.address)
                    await expect(tx).to.emit(boostDirector, "Directed").withArgs(user2Staked.address, vaults[0].address)
                })
                it("should fail to add user to boost director again", async () => {
                    const tx = boostDirectorVaults[0].getBalance(user2Staked.address)
                    await expect(tx).to.not.emit(boostDirector, "Directed")
                })
                it("should get user 2 balance after being added", async () => {
                    const bal = await boostDirectorVaults[0].callStatic.getBalance(user2Staked.address)
                    expect(bal).to.eq(user2StakedBalance)
                })
            })
        })
        context("user 3 with 30,000 staked added to 6 vaults but not the 7th", () => {
            vaultNumbers.forEach((i) => {
                if (i >= 6) return
                it(`vault ${i + 1} should get user balance before being added to any vaults`, async () => {
                    const bal = await boostDirectorVaults[i].callStatic.getBalance(user3Staked.address)
                    expect(bal).to.eq(user3StakedBalance)
                })
                it(`vault ${i + 1} should add user to boost director`, async () => {
                    const tx = boostDirectorVaults[i].getBalance(user3Staked.address)
                    await expect(tx).to.emit(boostDirector, "Directed").withArgs(user3Staked.address, vaults[i].address)
                })
                it(`vault ${i + 1} should still user balance`, async () => {
                    const bal = await boostDirectorVaults[i].callStatic.getBalance(user3Staked.address)
                    expect(bal).to.eq(user3StakedBalance)
                })
            })
            it("7th vault should fail to add user as its the fourth", async () => {
                const tx = boostDirectorVaults[6].getBalance(user3Staked.address)
                await expect(tx).to.not.emit(boostDirector, "Directed")
            })
            it("7th vault should get zero balance for the user", async () => {
                const bal = await boostDirectorVaults[6].callStatic.getBalance(user3Staked.address)
                expect(bal).to.eq(0)
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
            boostDirector = await new BoostDirectorV2__factory(sa.default.signer).deploy(nexus.address)
            await boostDirector.connect(sa.governor.signer).addStakedToken(stakingContract.address)

            const mockedVaultsPromises = [...Array(8).keys()].map(() =>
                new MockBoostedVault__factory(sa.default.signer).deploy(boostDirector.address),
            )
            mockedVaults = await Promise.all(mockedVaultsPromises)
            const mockedVaultAddresses = mockedVaults.map((vault) => vault.address)
            await boostDirector.initialize(mockedVaultAddresses)

            // For user 1, add the first three vaults to the Boost Director.
            await mockedVaults[0].testGetBalance(user1NoStake.address)
            await mockedVaults[1].testGetBalance(user1NoStake.address)
            await mockedVaults[2].testGetBalance(user1NoStake.address)
            await mockedVaults[3].testGetBalance(user1NoStake.address)
            await mockedVaults[4].testGetBalance(user1NoStake.address)
            await mockedVaults[5].testGetBalance(user1NoStake.address)
            // For user 2, add the first two vaults to the Boost Director.
            await mockedVaults[0].testGetBalance(user2Staked.address)
            await mockedVaults[1].testGetBalance(user2Staked.address)
            await mockedVaults[2].testGetBalance(user2Staked.address)
            await mockedVaults[3].testGetBalance(user2Staked.address)
            await mockedVaults[4].testGetBalance(user2Staked.address)
            await mockedVaults[5].testGetBalance(user2Staked.address)
            // For user 3, just add the first vault
            await mockedVaults[0].testGetBalance(user3Staked.address)
        })
        it("should get initial balancers", async () => {
            expect(await mockedVaults[0].callStatic.testGetBalance(user1NoStake.address)).to.eq(0)
            expect(await mockedVaults[1].callStatic.testGetBalance(user1NoStake.address)).to.eq(0)
            expect(await mockedVaults[2].callStatic.testGetBalance(user1NoStake.address)).to.eq(0)
            expect(await mockedVaults[3].callStatic.testGetBalance(user1NoStake.address)).to.eq(0)
            expect(await mockedVaults[4].callStatic.testGetBalance(user1NoStake.address)).to.eq(0)
            expect(await mockedVaults[5].callStatic.testGetBalance(user1NoStake.address)).to.eq(0)
            expect(await mockedVaults[6].callStatic.testGetBalance(user1NoStake.address)).to.eq(0)
            expect(await mockedVaults[7].callStatic.testGetBalance(user1NoStake.address)).to.eq(0)

            expect(await mockedVaults[0].callStatic.testGetBalance(user2Staked.address)).to.eq(user2StakedBalance)
            expect(await mockedVaults[1].callStatic.testGetBalance(user2Staked.address)).to.eq(user2StakedBalance)
            expect(await mockedVaults[2].callStatic.testGetBalance(user2Staked.address)).to.eq(user2StakedBalance)
            expect(await mockedVaults[3].callStatic.testGetBalance(user2Staked.address)).to.eq(user2StakedBalance)
            expect(await mockedVaults[4].callStatic.testGetBalance(user2Staked.address)).to.eq(user2StakedBalance)
            expect(await mockedVaults[5].callStatic.testGetBalance(user2Staked.address)).to.eq(user2StakedBalance)
            expect(await mockedVaults[6].callStatic.testGetBalance(user2Staked.address)).to.eq(0)
            expect(await mockedVaults[7].callStatic.testGetBalance(user2Staked.address)).to.eq(0)

            // This will always return the staked balance as the changes are not persisted
            expect(await mockedVaults[0].callStatic.testGetBalance(user3Staked.address)).to.eq(user3StakedBalance)
            expect(await mockedVaults[1].callStatic.testGetBalance(user3Staked.address)).to.eq(user3StakedBalance)
            expect(await mockedVaults[2].callStatic.testGetBalance(user3Staked.address)).to.eq(user3StakedBalance)
            expect(await mockedVaults[3].callStatic.testGetBalance(user3Staked.address)).to.eq(user3StakedBalance)
            expect(await mockedVaults[4].callStatic.testGetBalance(user3Staked.address)).to.eq(user3StakedBalance)
            expect(await mockedVaults[5].callStatic.testGetBalance(user3Staked.address)).to.eq(user3StakedBalance)
            expect(await mockedVaults[6].callStatic.testGetBalance(user3Staked.address)).to.eq(user3StakedBalance)
            expect(await mockedVaults[7].callStatic.testGetBalance(user3Staked.address)).to.eq(user3StakedBalance)
        })
        it("should fail as old vault is not whitelisted", async () => {
            const tx = boostDirector.connect(user1NoStake.signer).setDirection(sa.dummy1.address, mockedVaults[3].address, false)
            await expect(tx).to.revertedWith("Vaults not whitelisted")
        })
        it("should fail as user 1 has not been added to the old vault 7", async () => {
            const tx = boostDirector.connect(user1NoStake.signer).setDirection(mockedVaults[6].address, mockedVaults[3].address, false)
            await expect(tx).to.revertedWith("No need to replace old")
        })
        it("should fail as new vault is not whitelisted", async () => {
            const tx = boostDirector.connect(user1NoStake.signer).setDirection(mockedVaults[0].address, sa.dummy1.address, false)
            await expect(tx).to.revertedWith("Vaults not whitelisted")
        })
        it("user 1 should succeed in replacing vault 1 with vault 7 that is not poked", async () => {
            const tx = boostDirector.connect(user1NoStake.signer).setDirection(mockedVaults[0].address, mockedVaults[6].address, false)
            await expect(tx).to.emit(mockedVaults[0], "Poked").withArgs(user1NoStake.address)
            await expect(tx).to.not.emit(mockedVaults[6], "Poked")
            await expect(tx)
                .to.emit(boostDirector, "RedirectedBoost")
                .withArgs(user1NoStake.address, mockedVaults[6].address, mockedVaults[0].address)
        })
        it("user 1 should succeed in replacing vault 2 vault 8 that is poked", async () => {
            const tx = boostDirector.connect(user1NoStake.signer).setDirection(mockedVaults[1].address, mockedVaults[7].address, true)
            await expect(tx).to.emit(mockedVaults[1], "Poked").withArgs(user1NoStake.address)
            await expect(tx).to.emit(mockedVaults[7], "Poked").withArgs(user1NoStake.address)
            await expect(tx)
                .to.emit(boostDirector, "RedirectedBoost")
                .withArgs(user1NoStake.address, mockedVaults[7].address, mockedVaults[1].address)
        })
        it("user 2 should succeed in replacing vault 1 with vault 7 that is not poked", async () => {
            expect(await mockedVaults[0].callStatic.testGetBalance(user2Staked.address)).to.eq(user2StakedBalance)
            expect(await mockedVaults[1].callStatic.testGetBalance(user2Staked.address)).to.eq(user2StakedBalance)
            expect(await mockedVaults[2].callStatic.testGetBalance(user2Staked.address)).to.eq(user2StakedBalance)
            expect(await mockedVaults[3].callStatic.testGetBalance(user2Staked.address)).to.eq(user2StakedBalance)
            expect(await mockedVaults[4].callStatic.testGetBalance(user2Staked.address)).to.eq(user2StakedBalance)
            expect(await mockedVaults[5].callStatic.testGetBalance(user2Staked.address)).to.eq(user2StakedBalance)
            expect(await mockedVaults[6].callStatic.testGetBalance(user2Staked.address)).to.eq(0)
            expect(await mockedVaults[7].callStatic.testGetBalance(user2Staked.address)).to.eq(0)

            const tx = boostDirector.connect(user2Staked.signer).setDirection(mockedVaults[0].address, mockedVaults[6].address, false)
            await expect(tx).to.emit(mockedVaults[0], "Poked").withArgs(user2Staked.address)
            await expect(tx).to.not.emit(mockedVaults[6], "Poked")
            await expect(tx)
                .to.emit(boostDirector, "RedirectedBoost")
                .withArgs(user2Staked.address, mockedVaults[6].address, mockedVaults[0].address)

            expect(await mockedVaults[0].callStatic.testGetBalance(user2Staked.address)).to.eq(0)
            expect(await mockedVaults[1].callStatic.testGetBalance(user2Staked.address)).to.eq(user2StakedBalance)
            expect(await mockedVaults[2].callStatic.testGetBalance(user2Staked.address)).to.eq(user2StakedBalance)
            expect(await mockedVaults[3].callStatic.testGetBalance(user2Staked.address)).to.eq(user2StakedBalance)
            expect(await mockedVaults[4].callStatic.testGetBalance(user2Staked.address)).to.eq(user2StakedBalance)
            expect(await mockedVaults[5].callStatic.testGetBalance(user2Staked.address)).to.eq(user2StakedBalance)
            expect(await mockedVaults[6].callStatic.testGetBalance(user2Staked.address)).to.eq(user2StakedBalance)
            expect(await mockedVaults[7].callStatic.testGetBalance(user2Staked.address)).to.eq(0)
        })
        it("user 2 should succeed in replacing vault 2 vault 8 that is poked", async () => {
            expect(await mockedVaults[0].callStatic.testGetBalance(user2Staked.address)).to.eq(0)
            expect(await mockedVaults[1].callStatic.testGetBalance(user2Staked.address)).to.eq(user2StakedBalance)
            expect(await mockedVaults[2].callStatic.testGetBalance(user2Staked.address)).to.eq(user2StakedBalance)
            expect(await mockedVaults[3].callStatic.testGetBalance(user2Staked.address)).to.eq(user2StakedBalance)
            expect(await mockedVaults[4].callStatic.testGetBalance(user2Staked.address)).to.eq(user2StakedBalance)
            expect(await mockedVaults[5].callStatic.testGetBalance(user2Staked.address)).to.eq(user2StakedBalance)
            expect(await mockedVaults[6].callStatic.testGetBalance(user2Staked.address)).to.eq(user2StakedBalance)
            expect(await mockedVaults[7].callStatic.testGetBalance(user2Staked.address)).to.eq(0)

            const tx = boostDirector.connect(user2Staked.signer).setDirection(mockedVaults[1].address, mockedVaults[7].address, true)
            await expect(tx).to.emit(mockedVaults[1], "Poked").withArgs(user2Staked.address)
            await expect(tx).to.emit(mockedVaults[7], "Poked").withArgs(user2Staked.address)
            await expect(tx)
                .to.emit(boostDirector, "RedirectedBoost")
                .withArgs(user2Staked.address, mockedVaults[7].address, mockedVaults[1].address)

            expect(await mockedVaults[0].callStatic.testGetBalance(user2Staked.address)).to.eq(0)
            expect(await mockedVaults[1].callStatic.testGetBalance(user2Staked.address)).to.eq(0)
            expect(await mockedVaults[2].callStatic.testGetBalance(user2Staked.address)).to.eq(user2StakedBalance)
            expect(await mockedVaults[3].callStatic.testGetBalance(user2Staked.address)).to.eq(user2StakedBalance)
            expect(await mockedVaults[4].callStatic.testGetBalance(user2Staked.address)).to.eq(user2StakedBalance)
            expect(await mockedVaults[5].callStatic.testGetBalance(user2Staked.address)).to.eq(user2StakedBalance)
            expect(await mockedVaults[6].callStatic.testGetBalance(user2Staked.address)).to.eq(user2StakedBalance)
            expect(await mockedVaults[7].callStatic.testGetBalance(user2Staked.address)).to.eq(user2StakedBalance)
        })
        it("user 2 should succeed in replacing vault 8 back to vault 2 that is poked", async () => {
            expect(await mockedVaults[0].callStatic.testGetBalance(user2Staked.address)).to.eq(0)
            expect(await mockedVaults[1].callStatic.testGetBalance(user2Staked.address)).to.eq(0)
            expect(await mockedVaults[2].callStatic.testGetBalance(user2Staked.address)).to.eq(user2StakedBalance)
            expect(await mockedVaults[3].callStatic.testGetBalance(user2Staked.address)).to.eq(user2StakedBalance)
            expect(await mockedVaults[4].callStatic.testGetBalance(user2Staked.address)).to.eq(user2StakedBalance)
            expect(await mockedVaults[5].callStatic.testGetBalance(user2Staked.address)).to.eq(user2StakedBalance)
            expect(await mockedVaults[6].callStatic.testGetBalance(user2Staked.address)).to.eq(user2StakedBalance)
            expect(await mockedVaults[7].callStatic.testGetBalance(user2Staked.address)).to.eq(user2StakedBalance)

            const tx = boostDirector.connect(user2Staked.signer).setDirection(mockedVaults[7].address, mockedVaults[1].address, true)
            await expect(tx).to.emit(mockedVaults[7], "Poked").withArgs(user2Staked.address)
            await expect(tx).to.emit(mockedVaults[1], "Poked").withArgs(user2Staked.address)
            await expect(tx)
                .to.emit(boostDirector, "RedirectedBoost")
                .withArgs(user2Staked.address, mockedVaults[1].address, mockedVaults[7].address)

            expect(await mockedVaults[0].callStatic.testGetBalance(user2Staked.address)).to.eq(0)
            expect(await mockedVaults[1].callStatic.testGetBalance(user2Staked.address)).to.eq(user2StakedBalance)
            expect(await mockedVaults[2].callStatic.testGetBalance(user2Staked.address)).to.eq(user2StakedBalance)
            expect(await mockedVaults[3].callStatic.testGetBalance(user2Staked.address)).to.eq(user2StakedBalance)
            expect(await mockedVaults[4].callStatic.testGetBalance(user2Staked.address)).to.eq(user2StakedBalance)
            expect(await mockedVaults[5].callStatic.testGetBalance(user2Staked.address)).to.eq(user2StakedBalance)
            expect(await mockedVaults[6].callStatic.testGetBalance(user2Staked.address)).to.eq(user2StakedBalance)
            expect(await mockedVaults[7].callStatic.testGetBalance(user2Staked.address)).to.eq(0)
        })
        it("should fail as user 3 only has 1 vault", async () => {
            const tx = boostDirector.connect(user3Staked.signer).setDirection(mockedVaults[0].address, mockedVaults[3].address, false)
            await expect(tx).to.revertedWith("No need to replace old")
        })
    })
    context("set balance divisor", () => {
        let boostDirectorVault1: BoostDirectorV2
        before(async () => {
            boostDirector = await new BoostDirectorV2__factory(sa.default.signer).deploy(nexus.address)
            await boostDirector.connect(sa.governor.signer).addStakedToken(stakingContract.address)
            await boostDirector.initialize([vaults[0].address])

            boostDirectorVault1 = boostDirector.connect(vaults[0].signer)
            await boostDirectorVault1.getBalance(user2Staked.address)
            await boostDirectorVault1.getBalance(user3Staked.address)
        })
        it("should fail to set balance divisor not governor", async () => {
            const tx = boostDirector.connect(sa.default.signer).setBalanceDivisor(6)
            await expect(tx).to.revertedWith("Only governor can execute")
        })
        it("should fail to set balance divisor to same value", async () => {
            const tx = boostDirector.connect(sa.governor.signer).setBalanceDivisor(12)
            await expect(tx).to.revertedWith("No change in divisor")
        })
        it("should fail to set balance divisor to 15", async () => {
            const tx = boostDirector.connect(sa.governor.signer).setBalanceDivisor(15)
            await expect(tx).to.revertedWith("Divisor too large")
        })
        it("should change balance divisor from 12 to 5 by governor", async () => {
            expect(await boostDirectorVault1.callStatic.getBalance(user1NoStake.address), "user1 bal before").to.eq(0)
            expect(await boostDirectorVault1.callStatic.getBalance(user2Staked.address), "user2 bal before").to.eq(BN.from(20000).div(12))
            expect(await boostDirectorVault1.callStatic.getBalance(user3Staked.address), "user3 bal before").to.eq(BN.from(30000).div(12))

            const tx = await boostDirector.connect(sa.governor.signer).setBalanceDivisor(5)
            await expect(tx).to.emit(boostDirector, "BalanceDivisorChanged").withArgs(5)

            expect(await boostDirectorVault1.callStatic.getBalance(user1NoStake.address), "user1 bal after").to.eq(0)
            expect(await boostDirectorVault1.callStatic.getBalance(user2Staked.address), "user2 bal after").to.eq(BN.from(20000).div(5))
            expect(await boostDirectorVault1.callStatic.getBalance(user3Staked.address), "user3 bal after").to.eq(BN.from(30000).div(5))
        })
    })
    context("add staking tokens", () => {
        let boostDirectorVault1: BoostDirectorV2
        let newStakingContract: Contract
        before(async () => {
            boostDirector = await new BoostDirectorV2__factory(sa.default.signer).deploy(nexus.address)
            await boostDirector.connect(sa.governor.signer).addStakedToken(stakingContract.address)
            await boostDirector.initialize([vaults[0].address])

            boostDirectorVault1 = boostDirector.connect(vaults[0].signer)
            await boostDirectorVault1.getBalance(user2Staked.address)
            await boostDirectorVault1.getBalance(user3Staked.address)

            newStakingContract = await new MockStakingContract__factory(sa.default.signer).deploy()
            await newStakingContract.setBalanceOf(user2Staked.address, 50000)
        })
        it("should fail to add staking token when not governor", async () => {
            const tx = boostDirector.connect(sa.default.signer).addStakedToken(newStakingContract.address)
            await expect(tx).to.revertedWith("Only governor can execute")
        })
        it("should add new staking token by governor", async () => {
            const tx = await boostDirector.connect(sa.governor.signer).addStakedToken(newStakingContract.address)
            await expect(tx).to.emit(boostDirector, "StakedTokenAdded").withArgs(newStakingContract.address)

            expect(await boostDirector.stakedTokenContracts(0)).to.eq(stakingContract.address)
            expect(await boostDirector.stakedTokenContracts(1)).to.eq(newStakingContract.address)

            expect(await boostDirectorVault1.callStatic.getBalance(user2Staked.address), "user2 bal after").to.eq(
                BN.from(50000 + 20000).div(12),
            )
        })
        it("should fail to add duplicate staking token", async () => {
            const tx = boostDirector.connect(sa.governor.signer).addStakedToken(newStakingContract.address)
            await expect(tx).to.revertedWith("StakedToken already added")
        })
    })
    context("remove staking tokens", () => {
        let boostDirectorVault1: BoostDirectorV2
        let newStaking1: Contract
        let newStaking2: Contract
        beforeEach(async () => {
            boostDirector = await new BoostDirectorV2__factory(sa.default.signer).deploy(nexus.address)
            await boostDirector.connect(sa.governor.signer).addStakedToken(stakingContract.address)
            await boostDirector.initialize([vaults[0].address])

            boostDirectorVault1 = boostDirector.connect(vaults[0].signer)
            await boostDirectorVault1.getBalance(user2Staked.address)
            await boostDirectorVault1.getBalance(user3Staked.address)

            newStaking1 = await new MockStakingContract__factory(sa.default.signer).deploy()
            await boostDirector.connect(sa.governor.signer).addStakedToken(newStaking1.address)
            await newStaking1.setBalanceOf(user2Staked.address, 50000)

            newStaking2 = await new MockStakingContract__factory(sa.default.signer).deploy()
            await boostDirector.connect(sa.governor.signer).addStakedToken(newStaking2.address)
            await newStaking2.setBalanceOf(user2Staked.address, 120)

            expect(await boostDirector.stakedTokenContracts(0)).to.eq(stakingContract.address)
            expect(await boostDirector.stakedTokenContracts(1)).to.eq(newStaking1.address)
            expect(await boostDirector.stakedTokenContracts(2)).to.eq(newStaking2.address)

            expect(await boostDirectorVault1.callStatic.getBalance(user2Staked.address), "user2 bal before").to.eq(
                BN.from(20000 + 50000 + 120).div(12),
            )
        })
        it("should fail to remove staking token when not governor", async () => {
            const tx = boostDirector.connect(sa.default.signer).removeStakedToken(newStaking1.address)
            await expect(tx).to.revertedWith("Only governor can execute")
        })
        it("should remove first staking token by governor", async () => {
            const tx = await boostDirector.connect(sa.governor.signer).removeStakedToken(stakingContract.address)
            await expect(tx).to.emit(boostDirector, "StakedTokenRemoved").withArgs(stakingContract.address)

            expect(await boostDirector.stakedTokenContracts(0), "first contract").to.eq(newStaking2.address)
            expect(await boostDirector.stakedTokenContracts(1), "second contract").to.eq(newStaking1.address)

            expect(await boostDirectorVault1.callStatic.getBalance(user2Staked.address), "user2 bal after").to.eq(
                BN.from(50000 + 120).div(12),
            )
        })
        it("should remove middle staking token by governor", async () => {
            const tx = await boostDirector.connect(sa.governor.signer).removeStakedToken(newStaking1.address)
            await expect(tx).to.emit(boostDirector, "StakedTokenRemoved").withArgs(newStaking1.address)

            expect(await boostDirector.stakedTokenContracts(0), "first contract").to.eq(stakingContract.address)
            expect(await boostDirector.stakedTokenContracts(1), "second contract").to.eq(newStaking2.address)

            expect(await boostDirectorVault1.callStatic.getBalance(user2Staked.address), "user2 bal after").to.eq(
                BN.from(20000 + 120).div(12),
            )
        })
        it("should remove last staking token by governor", async () => {
            const tx = await boostDirector.connect(sa.governor.signer).removeStakedToken(newStaking2.address)
            await expect(tx).to.emit(boostDirector, "StakedTokenRemoved").withArgs(newStaking2.address)

            expect(await boostDirector.stakedTokenContracts(0), "first contract").to.eq(stakingContract.address)
            expect(await boostDirector.stakedTokenContracts(1), "second contract").to.eq(newStaking1.address)

            expect(await boostDirectorVault1.callStatic.getBalance(user2Staked.address), "user2 bal after").to.eq(
                BN.from(20000 + 50000).div(12),
            )
        })
    })
})
