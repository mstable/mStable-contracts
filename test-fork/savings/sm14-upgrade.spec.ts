import { ONE_WEEK, KEY_SAVINGS_MANAGER, KEY_LIQUIDATOR } from "@utils/constants"
import { impersonate, impersonateAccount } from "@utils/fork"
import { BN, simpleToExactAmount } from "@utils/math"
import { increaseTime } from "@utils/time"
import { expect } from "chai"
import { Signer } from "ethers"
import * as hre from "hardhat"
import { SavingsManager, SavingsManager__factory, Nexus__factory, SavingsContract__factory, ERC20__factory } from "types/generated"
import { Account } from "types"
import { Chain } from "tasks/utils/tokens"
import { resolveAddress } from "../../tasks/utils/networkAddressFactory"
import { deployContract } from "../../tasks/utils/deploy-utils"

const musdWhaleAddress = "0x136d841d4bece3fc0e4debb94356d8b6b4b93209"
const governorAddress = resolveAddress("Governor")
const deployerAddress = resolveAddress("OperationsSigner")
const ethWhaleAddress = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"

interface Stream {
    end: BN
    rate: BN
}

interface Data {
    savingsContracts: string[]
    revenueRecipients: string[]
    nexus: string
    lastPeriodStart: BN[]
    lastCollection: BN[]
    periodYield: BN[]
    liqStream: Stream[]
    yieldStream: Stream[]
    lastBatchCollected: BN[]
}

// 1. Deploy && propose SM module upgrade
// 2. Beta testing
//     - collectAndStreamInterest
//     - depositLiquidation
//     - save deposit
//     - distributeUnallocatedInterest
context("StakedToken deployments and vault upgrades", () => {
    let deployer: Account
    let governor: Account
    let ethWhale: Signer
    let musdWhale: Signer
    let savingsManager: SavingsManager
    let musd
    let mbtc

    const { network } = hre

    const snapData = async (_savingsManager: SavingsManager, mAssets: string[]): Promise<Data> => ({
        savingsContracts: await Promise.all(mAssets.map((m) => savingsManager.savingsContracts(m))),
        revenueRecipients: await Promise.all(mAssets.map((m) => savingsManager.revenueRecipients(m))),
        nexus: await savingsManager.nexus(),
        lastPeriodStart: await Promise.all(mAssets.map((m) => savingsManager.lastPeriodStart(m))),
        lastCollection: await Promise.all(mAssets.map((m) => savingsManager.lastCollection(m))),
        periodYield: await Promise.all(mAssets.map((m) => savingsManager.periodYield(m))),
        liqStream: await Promise.all(mAssets.map((m) => savingsManager.liqStream(m))),
        yieldStream: await Promise.all(mAssets.map((m) => savingsManager.yieldStream(m))),
        lastBatchCollected: await Promise.all(mAssets.map((m) => savingsManager.lastBatchCollected(m))),
    })

    before("reset block number", async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 13423210,
                    },
                },
            ],
        })
        deployer = await impersonateAccount(deployerAddress)
        governor = await impersonateAccount(governorAddress)
        ethWhale = await impersonate(ethWhaleAddress)
        musdWhale = await impersonate(musdWhaleAddress)

        // send some Ether to the impersonated multisig contract as it doesn't have Ether
        await ethWhale.sendTransaction({
            to: governorAddress,
            value: simpleToExactAmount(1),
        })
    })
    context("1. Deploying", () => {
        it("deploys the contracts", async () => {
            const nexus = resolveAddress("Nexus", Chain.mainnet)
            const revenueRecipient = resolveAddress("RevenueRecipient", Chain.mainnet)

            musd = resolveAddress("mUSD", Chain.mainnet, "address")
            const musdSave = resolveAddress("mUSD", Chain.mainnet, "savings")
            mbtc = resolveAddress("mBTC", Chain.mainnet, "address")
            const mbtcSave = resolveAddress("mBTC", Chain.mainnet, "savings")

            savingsManager = await deployContract(new SavingsManager__factory(deployer.signer), "SavingsManager", [
                nexus,
                [musd, mbtc],
                [musdSave, mbtcSave],
                [revenueRecipient, revenueRecipient],
                simpleToExactAmount(9, 17),
                ONE_WEEK,
            ])
        })
        it("proposes upgrade", async () => {
            const nexusAddress = resolveAddress("Nexus", Chain.mainnet)
            const nexus = await Nexus__factory.connect(nexusAddress, governor.signer)
            await nexus.proposeModule(KEY_SAVINGS_MANAGER, savingsManager.address)
            await nexus.proposeModule(KEY_LIQUIDATOR, musdWhaleAddress)
        })
        it("checks the config matches up", async () => {
            const oldAddress = resolveAddress("SavingsManager", Chain.mainnet)
            const oldSavingsManager = await SavingsManager__factory.connect(oldAddress, deployer.signer)
            const oldConfig = await snapData(oldSavingsManager, [musd, mbtc])
            const newConfig = await snapData(savingsManager, [musd, mbtc])

            expect(newConfig.lastBatchCollected[0]).eq(0)
            expect(newConfig.lastCollection[0]).eq(0)
            expect(newConfig.lastPeriodStart[0]).eq(0)
            expect(newConfig.nexus).eq(oldConfig.nexus)
            expect(newConfig.revenueRecipients[0]).eq(oldConfig.revenueRecipients[0])
            expect(newConfig.revenueRecipients[1]).eq(oldConfig.revenueRecipients[1])
            expect(newConfig.savingsContracts[0]).eq(oldConfig.savingsContracts[0])
            expect(newConfig.savingsContracts[1]).eq(oldConfig.savingsContracts[1])
        })
        it("accepts upgrade", async () => {
            await increaseTime(ONE_WEEK)
            const nexusAddress = resolveAddress("Nexus", Chain.mainnet)
            const nexus = await Nexus__factory.connect(nexusAddress, governor.signer)
            await nexus.acceptProposedModule(KEY_SAVINGS_MANAGER)
            await nexus.acceptProposedModule(KEY_LIQUIDATOR)
            expect(await nexus.getModule(KEY_SAVINGS_MANAGER)).eq(savingsManager.address)
        })
    })
    context("2. Beta tests", () => {
        it("collects & streams interest from both mAssets", async () => {
            await savingsManager.collectAndStreamInterest(musd)
            await savingsManager.collectAndStreamInterest(mbtc)
        })
        it("deposits liquidation", async () => {
            await ERC20__factory.connect(musd, musdWhale).approve(savingsManager.address, simpleToExactAmount(1000))
            await savingsManager.connect(musdWhale).depositLiquidation(musd, simpleToExactAmount(1000))
        })
        it("allows save deposits", async () => {
            const save = resolveAddress("mUSD", Chain.mainnet, "savings")
            await ERC20__factory.connect(musd, musdWhale).approve(save, simpleToExactAmount(1000))
            await SavingsContract__factory.connect(save, musdWhale)["depositSavings(uint256)"](simpleToExactAmount(1000))
        })
        it("distributed unallocated interest", async () => {
            await savingsManager.distributeUnallocatedInterest(musd)
            await savingsManager.distributeUnallocatedInterest(mbtc)
        })
    })
})
