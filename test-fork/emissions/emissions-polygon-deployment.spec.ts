import { ethers, network } from "hardhat"

import { impersonate } from "@utils/fork"
import { Signer } from "ethers"
import { resolveAddress } from "tasks/utils/networkAddressFactory"
import { Chain, MTA, PBAL, PFRAX, PMTA, PmUSD } from "tasks/utils/tokens"
import {
    BalRewardsForwarder,
    BalRewardsForwarder__factory,
    IERC20,
    IERC20__factory,
    InitializableRewardsDistributionRecipient,
    InitializableRewardsDistributionRecipient__factory,
    IStateReceiver,
    IStateReceiver__factory,
    L2EmissionsController,
    L2EmissionsController__factory,
} from "types/generated"
import { keccak256 } from "@ethersproject/keccak256"
import { toUtf8Bytes } from "ethers/lib/utils"
import { BN, simpleToExactAmount } from "index"
import { expect } from "chai"

const keeperKey = keccak256(toUtf8Bytes("Keeper"))
console.log(`Keeper ${keeperKey}`)

const chain = Chain.polygon
const abiCoder = ethers.utils.defaultAbiCoder

context("Fork test Emissions Controller on polygon", () => {
    let ops: Signer
    let governor: Signer
    let stateSyncer: Signer
    let emissionsController: L2EmissionsController
    let mta: IERC20
    let childChainManager: IStateReceiver
    let musdVault: InitializableRewardsDistributionRecipient
    let balRewardsForwarder: BalRewardsForwarder

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
        ops = await impersonate(resolveAddress("OperationsSigner", chain))
        governor = await impersonate(resolveAddress("Governor", chain))
        stateSyncer = await impersonate("0x0000000000000000000000000000000000001001")

        emissionsController = L2EmissionsController__factory.connect(resolveAddress("EmissionsController", chain), ops)
        mta = IERC20__factory.connect(PMTA.address, ops)
        musdVault = InitializableRewardsDistributionRecipient__factory.connect(PmUSD.vault, governor)

        childChainManager = IStateReceiver__factory.connect(resolveAddress("PolygonChildChainManager", chain), stateSyncer)
    }

    const deposit = async (bridgeRecipient: string, amount: BN) => {
        const amountData = abiCoder.encode(["uint256"], [amount])
        const syncData = abiCoder.encode(["address", "address", "bytes"], [bridgeRecipient, MTA.address, amountData])
        const data = abiCoder.encode(["bytes32", "bytes"], [keccak256(toUtf8Bytes("DEPOSIT")), syncData])
        await childChainManager.onStateReceive(1, data)
    }

    before(async () => {
        // Fork from the latest block
        await setup()
    })

    describe("mUSD Vault", () => {
        const depositAmount = simpleToExactAmount(20000)
        before(async () => {
            await musdVault.setRewardsDistribution(emissionsController.address)
        })
        it("Deposit 20k to mUSD bridge recipient", async () => {
            expect(await mta.balanceOf(PmUSD.bridgeRecipient), "bridge recipient bal before").to.eq(0)

            await deposit(PmUSD.bridgeRecipient, depositAmount)

            expect(await mta.balanceOf(PmUSD.bridgeRecipient), "bridge recipient bal after").to.eq(depositAmount)
        })
        it("Distribute rewards", async () => {
            const mtaBalBefore = await mta.balanceOf(PmUSD.vault)
            expect(mtaBalBefore, "vault bal before").to.gt(0)

            await emissionsController.distributeRewards([PmUSD.vault])

            const mtaBalAfter = await mta.balanceOf(PmUSD.vault)
            expect(mtaBalAfter.sub(mtaBalBefore), "vault bal change").to.eq(depositAmount)
        })
    })
    describe("FRAX Farm", () => {
        const depositAmount = simpleToExactAmount(10000)

        it("Deposit 10k to FRAX Farm", async () => {
            const mtaBalBefore = await mta.balanceOf(PFRAX.bridgeRecipient)
            expect(mtaBalBefore, "FRAX Farm bal before").to.gt(0)

            await deposit(PFRAX.bridgeRecipient, depositAmount)

            const mtaBalAfter = await mta.balanceOf(PFRAX.bridgeRecipient)
            expect(mtaBalAfter.sub(mtaBalBefore), "FRAX Farm bal change").to.eq(depositAmount)
        })
    })
    describe("Balancer Pool", () => {
        const depositAmount = simpleToExactAmount(15000)

        it("Deposit 15k to Stream Forwarder", async () => {
            expect(await mta.balanceOf(PBAL.bridgeRecipient), "Stream bal before").to.eq(0)

            await deposit(PBAL.bridgeRecipient, depositAmount)

            expect(await mta.balanceOf(PBAL.bridgeRecipient), "Stream bal after").to.eq(depositAmount)
        })
        it("Stream all 15k MTA", async () => {
            balRewardsForwarder = BalRewardsForwarder__factory.connect(resolveAddress("BP-MTA-RewardsForwarder", chain), ops)
            const tx = await balRewardsForwarder.notifyRewardAmount(simpleToExactAmount(15000))
            await expect(tx).to.emit(balRewardsForwarder, "RewardsReceived").withArgs(simpleToExactAmount(15000))
        })
    })
})
