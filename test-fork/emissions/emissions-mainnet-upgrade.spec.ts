import { network } from "hardhat"
import * as hre from "hardhat"

import { impersonate, impersonateAccount } from "@utils/fork"
import { ContractFactory, Signer } from "ethers"
import { resolveAddress } from "tasks/utils/networkAddressFactory"
import { deployEmissionsController, MCCP24_CONFIG } from "tasks/utils/emissions-utils"
import { expect } from "chai"
import { BN, simpleToExactAmount } from "@utils/math"
import {
    DelayedProxyAdmin,
    DelayedProxyAdmin__factory,
    EmissionsController,
    EmissionsController__factory,
    IERC20__factory,
} from "types/generated"
import { Account } from "types/common"
import { upgradeContract } from "@utils/deploy"

const CURRENT_DIAL_NO = 18
interface DialData {
    disabled: boolean
    notify: boolean
    cap: number
    balance: BN
    recipient: string
    voteHistory: { votes: BN; epoch: number }[]
}
interface ContractData {
    nexus: string
    rewardToken: string
    startEpoch: number
    lastEpoch: number
    stakingContracts: Array<string>
    balance: BN
    snapDials: Array<DialData>
    dialVotes: Array<BN>
    voterPreferences: Array<Array<{ dialId: BN; weight: BN }>>
    votes: Array<BN>
    stakingContractAddTimes: Array<number>
    topLineEmissions: Array<BN>
}
export const snapDial = async (emissionsController: EmissionsController, dialId: number): Promise<DialData> => {
    const dialData = await emissionsController.dials(dialId)
    const voteHistory = await emissionsController.getDialVoteHistory(dialId)
    return {
        ...dialData,
        voteHistory,
    }
}
const snapshotData = async (signer: Signer, emissionsController: EmissionsController, voters: Array<string>): Promise<ContractData> => {
    const stakingContract1 = await emissionsController.stakingContracts(0)
    const stakingContract2 = await emissionsController.stakingContracts(1)
    const stakingContractAddTime1 = await emissionsController.stakingContractAddTime(stakingContract1)
    const stakingContractAddTime2 = await emissionsController.stakingContractAddTime(stakingContract2)

    const voterPreference1 = await emissionsController.getVoterPreferences(voters[0])
    const voterPreference2 = await emissionsController.getVoterPreferences(voters[1])
    const votes1 = await emissionsController.getVotes(voters[0])
    const votes2 = await emissionsController.getVotes(voters[1])
    const rewardTokenAddress = await emissionsController.REWARD_TOKEN()

    const [startEpoch, lastEpoch] = await emissionsController.epochs()

    // Get the information of each dial
    const snapDials: Array<DialData> = []
    for (let i = 0; i <= CURRENT_DIAL_NO; i++) {
        // eslint-disable-next-line no-await-in-loop
        snapDials.push(await snapDial(emissionsController, i))
    }
    const dialVotes = await emissionsController.getDialVotes()
    const rewardToken = await IERC20__factory.connect(rewardTokenAddress, signer)
    const balance = await rewardToken.balanceOf(emissionsController.address)

    // sample some topeLine emissions
    const topLineEmissions: Array<BN> = []

    topLineEmissions.push(await emissionsController.topLineEmission(2711))
    topLineEmissions.push(await emissionsController.topLineEmission(2811))
    topLineEmissions.push(await emissionsController.topLineEmission(2911))
    topLineEmissions.push(await emissionsController.topLineEmission(3022))

    return {
        nexus: await emissionsController.nexus(),
        rewardToken: rewardTokenAddress,
        startEpoch,
        lastEpoch,
        stakingContracts: [stakingContract1, stakingContract2],
        balance,
        snapDials,
        dialVotes,
        voterPreferences: [voterPreference1, voterPreference2],
        votes: [votes1, votes2],
        stakingContractAddTimes: [stakingContractAddTime1, stakingContractAddTime2],
        topLineEmissions,
    }
}

describe("Upgrade test Emissions Controller on mainnet", async () => {
    let ops: Signer
    let governor: Signer
    let voter1: Account
    let voter2: Account
    let proxyAdmin: DelayedProxyAdmin
    let emissionsController: EmissionsController
    let emissionsControllerAddress: string
    let dataBefore: ContractData
    let dataAfter: ContractData
    let startEpoch

    const setup = async (blockNumber?: number) => {
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
        ops = await impersonate(resolveAddress("OperationsSigner"))
        governor = await impersonate(resolveAddress("Governor"))
        // 43,700 stkMTA, boosted to 44,461.750008245826445414 voting power
        voter1 = await impersonateAccount("0x8d0f5678557192e23d1da1c689e40f25c063eaa5")
        // 27,527.5 stkMTA not boosted
        voter2 = await impersonateAccount("0xa22fe318725a3858cf5ea4349802537798f0081a")

        emissionsControllerAddress = resolveAddress("EmissionsController")
        proxyAdmin = DelayedProxyAdmin__factory.connect(resolveAddress("DelayedProxyAdmin"), governor)
        emissionsController = EmissionsController__factory.connect(emissionsControllerAddress, ops)
    }

    const expectDialData = (dialDataBefore: DialData, dialDataAfter: DialData): void => {
        expect(dialDataBefore.recipient, "dial recipient").to.eq(dialDataAfter.recipient)
        expect(dialDataBefore.notify, "dial notify").to.eq(dialDataAfter.notify)
        expect(dialDataBefore.cap, "dial cap").to.eq(dialDataAfter.cap)
        expect(dialDataBefore.balance, "dial balance").to.eq(dialDataAfter.balance)
        expect(dialDataBefore.disabled, "dial disabled").to.eq(dialDataAfter.disabled)
        expect(dialDataBefore.voteHistory.length, "dial vote len").to.eq(dialDataAfter.voteHistory.length)
        expect(dialDataBefore.voteHistory[0].votes, "dial votes").to.eq(dialDataAfter.voteHistory[0].votes)
        expect(dialDataBefore.voteHistory[0].epoch, "dial votes epoch").to.eq(dialDataAfter.voteHistory[0].epoch)
    }
    before("setup", async () => {
        await setup(15346574)
        dataBefore = await snapshotData(governor, emissionsController, [voter1.address, voter2.address])
    })

    context("Stage 1 (upgrade)", () => {
        describe("1.0 EmissionsController contract", async () => {
            it("Deploys and upgrade the emissionsController contract", async () => {
                const deployProxy = true
                const emissionsControllerImpl = await deployEmissionsController(ops, hre, !deployProxy, MCCP24_CONFIG)

                const emissionsControllerProxy = await upgradeContract<EmissionsController>(
                    EmissionsController__factory as unknown as ContractFactory,
                    emissionsControllerImpl,
                    emissionsControllerAddress,
                    governor,
                    proxyAdmin,
                )

                expect(await proxyAdmin.getProxyImplementation(emissionsControllerAddress), "implementation address changed").eq(
                    emissionsControllerImpl.address,
                )
                expect(emissionsControllerProxy.address, "proxy address does not change").eq(emissionsControllerAddress)
                // assign new
                emissionsController = emissionsControllerProxy
            })
            it("Verifies emissionsController works after upgrade", async () => {
                // Test the emissions controller new line emission last epoch, it should not fail
                ;[startEpoch] = await emissionsController.epochs()
                expect(await emissionsController.topLineEmission(startEpoch + MCCP24_CONFIG.EPOCHS), "last epoch").gt(0)
            })
        })
    })
    context("Stage 2 (regression)", () => {
        before("snapshot", async () => {
            dataAfter = await snapshotData(governor, emissionsController, [voter1.address, voter2.address])
        })

        describe("Emissions controller state", () => {
            it("keeps state data", async () => {
                expect(dataBefore.nexus, "nexus").to.eq(dataAfter.nexus)
                expect(dataBefore.rewardToken, "rewardToken").to.eq(dataAfter.rewardToken)
                expect(dataBefore.startEpoch, "startEpoch").to.eq(dataAfter.startEpoch)
                expect(dataBefore.lastEpoch, "lastEpoch").to.eq(dataAfter.lastEpoch)
                expect(dataBefore.balance, "balance").to.eq(dataAfter.balance)
                expect(dataBefore.stakingContracts[0], "stakingContracts ").to.eq(dataAfter.stakingContracts[0])
                expect(dataBefore.stakingContracts[1], "stakingContracts ").to.eq(dataAfter.stakingContracts[1])
                expect(dataBefore.stakingContractAddTimes[0], "stakingContractAddTimes ").to.eq(dataAfter.stakingContractAddTimes[0])
                expect(dataBefore.stakingContractAddTimes[1], "stakingContractAddTimes ").to.eq(dataAfter.stakingContractAddTimes[1])
                expect(dataBefore.dialVotes.length, "dialVotes").to.eq(dataAfter.dialVotes.length)
                expect(dataBefore.lastEpoch, "lastEpoch").to.eq(dataAfter.lastEpoch)
            })
            it("keeps dials data", async () => {
                for (let i = 0; i <= CURRENT_DIAL_NO; i++) {
                    expectDialData(dataBefore.snapDials[i], dataAfter.snapDials[i])
                }
            })
            it("samples some votes", async () => {
                expect(dataBefore.voterPreferences[0].length, "voterPreferences").to.eq(dataAfter.voterPreferences[0].length)
                expect(dataBefore.voterPreferences[1].length, "voterPreferences").to.eq(dataAfter.voterPreferences[1].length)
                expect(dataBefore.votes[0], "votes").to.eq(dataAfter.votes[0])
                expect(dataBefore.votes[1], "votes").to.eq(dataAfter.votes[1])
            })
        })
        describe("top line emissions", () => {
            it("samples some emissions", async () => {
                expect(dataBefore.topLineEmissions[0], "topLineEmissions 2711").to.not.eq(dataAfter.topLineEmissions[0])
                expect(dataBefore.topLineEmissions[1], "topLineEmissions 2811").to.not.eq(dataAfter.topLineEmissions[1])
                expect(dataAfter.topLineEmissions[2], "topLineEmissions 2911").to.eq(simpleToExactAmount(59703093696197860, 6))
                expect(dataAfter.topLineEmissions[3], "topLineEmissions 3022").to.eq(simpleToExactAmount(44036324428401820, 6))
            })
            it("must calculate new epochs", async () => {
                ;[startEpoch] = await emissionsController.epochs()
                expect(await emissionsController.topLineEmission(startEpoch + MCCP24_CONFIG.EPOCHS), "topLineEmissions last").to.eq(
                    BN.from(2140000000),
                ) // =0.00000000214
            })
        })
    })
})
