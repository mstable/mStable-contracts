import { ONE_WEEK, KEY_SAVINGS_MANAGER, ONE_DAY } from "@utils/constants"
import { impersonate, impersonateAccount } from "@utils/fork"
import { BN, simpleToExactAmount } from "@utils/math"
import { increaseTime } from "@utils/time"
import { expect } from "chai"
import { Signer } from "ethers"
import * as hre from "hardhat"
import {
    SavingsManager,
    SavingsManager__factory,
    Nexus__factory,
    SavingsContract__factory,
    ERC20__factory,
    Liquidator__factory,
    Liquidator,
    DelayedProxyAdmin__factory,
} from "types/generated"
import { Account } from "types"
import { Chain, COMP, USDC, USDT, WBTC } from "tasks/utils/tokens"
import { resolveAddress } from "../../tasks/utils/networkAddressFactory"

const musdWhaleAddress = "0x136d841d4bece3fc0e4debb94356d8b6b4b93209"
const governorAddress = resolveAddress("Governor")
const deployerAddress = resolveAddress("OperationsSigner")
const ethWhaleAddress = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
const compWhaleAddress = "0x28c6c06298d514db089934071355e5743bf21d60"

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
    let compWhale: Signer
    let savingsManager: SavingsManager
    let liquidator: Liquidator
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
                        blockNumber: 13467671,
                    },
                },
            ],
        })
        deployer = await impersonateAccount(deployerAddress)
        governor = await impersonateAccount(governorAddress)
        ethWhale = await impersonate(ethWhaleAddress)
        musdWhale = await impersonate(musdWhaleAddress)
        compWhale = await impersonate(compWhaleAddress)

        // send some Ether to the impersonated multisig contract as it doesn't have Ether
        await ethWhale.sendTransaction({
            to: governorAddress,
            value: simpleToExactAmount(1),
        })
    })
    context("1. Deploying", () => {
        let liquidatorImpl: Liquidator
        it("deploys new contract", async () => {
            musd = resolveAddress("mUSD", Chain.mainnet, "address")
            mbtc = resolveAddress("mBTC", Chain.mainnet, "address")

            const newSavingsManagerAddress = "0xBC3B550E0349D74bF5148D86114A48C3B4Aa856F"
            savingsManager = await SavingsManager__factory.connect(newSavingsManagerAddress, deployer.signer)
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
            expect(await nexus.getModule(KEY_SAVINGS_MANAGER)).eq(savingsManager.address)
        })

        it("deploys new Liquidator contract", async () => {
            const nexusAddress = resolveAddress("Nexus")
            const stkAaveAddress = resolveAddress("stkAAVE")
            const aaveAddress = resolveAddress("AAVE")
            const uniswapRouterAddress = resolveAddress("UniswapRouterV3")
            const uniswapQuoterAddress = resolveAddress("UniswapQuoterV3")
            const compAddress = resolveAddress("COMP")
            const alcxAddress = resolveAddress("ALCX")

            liquidatorImpl = Liquidator__factory.connect("0xd6669e5778174f03Ac4B68Fe83493f6C54A10024", deployer.signer)
            expect(await liquidatorImpl.nexus()).eq(nexusAddress)
            expect(await liquidatorImpl.stkAave()).eq(stkAaveAddress)
            expect(await liquidatorImpl.aaveToken()).eq(aaveAddress)
            expect(await liquidatorImpl.uniswapRouter()).eq(uniswapRouterAddress)
            expect(await liquidatorImpl.uniswapQuoter()).eq(uniswapQuoterAddress)
            expect(await liquidatorImpl.compToken()).eq(compAddress)
            expect(await liquidatorImpl.alchemixToken()).eq(alcxAddress)
        })
        it("Upgrade the Liquidator proxy", async () => {
            // Update the Liquidator proxy to point to the new implementation using the delayed proxy admin
            const delayedProxyAdminAddress = resolveAddress("DelayedProxyAdmin")
            const delayedProxyAdmin = DelayedProxyAdmin__factory.connect(delayedProxyAdminAddress, governor.signer)
            const liquidatorAddress = resolveAddress("Liquidator")
            await delayedProxyAdmin.acceptUpgradeRequest(liquidatorAddress)

            // Connect to the proxy with the Liquidator ABI
            liquidator = Liquidator__factory.connect(liquidatorAddress, deployer.signer)
        })
        it("Reapprove mAssets to SavingsManager", async () => {
            await liquidator.reApproveLiquidation(USDC.integrator) // COMP for mUSD
            await liquidator.reApproveLiquidation(USDT.integrator) // AAVE for mUSD
            await liquidator.reApproveLiquidation(WBTC.integrator) // AAVE for mBTC
        })
    })
    context("2. Beta tests", () => {
        it("collects & streams interest from both mAssets", async () => {
            await savingsManager.collectAndStreamInterest(musd)
            await savingsManager.collectAndStreamInterest(mbtc)
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
        it("Liquidate COMP", async () => {
            // transfer some COMP into the integration contract to test the liquidation
            const compToken = ERC20__factory.connect(COMP.address, compWhale)
            await compToken.transfer(USDC.integrator, simpleToExactAmount(10, COMP.decimals))

            await liquidator.triggerLiquidation(USDC.integrator)
        })
        it("Claim Aave and liquidate", async () => {
            await increaseTime(ONE_DAY.mul(10))
            await liquidator.claimStakedAave()

            await increaseTime(ONE_DAY.mul(11))
            await liquidator.triggerLiquidationAave()
        })
    })
})
