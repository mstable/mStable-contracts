import { DEAD_ADDRESS, ZERO_ADDRESS, ONE_WEEK } from "@utils/constants"
import { impersonate, impersonateAccount } from "@utils/fork"
import { simpleToExactAmount } from "@utils/math"
import { increaseTime } from "@utils/time"
import { assertBNClose } from "@utils/assertions"
import { expect } from "chai"
import { Signer } from "ethers"
import * as hre from "hardhat"
import {
    SavingsManager,
    SavingsManager__factory,
    GaugeBriber,
    GaugeBriber__factory,
    ERC20__factory,
    Collector,
    Collector__factory,
} from "types/generated"
import { Account } from "types"
import { Chain } from "tasks/utils/tokens"
import { resolveAddress } from "../../tasks/utils/networkAddressFactory"
import { deployContract } from "../../tasks/utils/deploy-utils"

const musdWhaleAddress = "0x136d841d4bece3fc0e4debb94356d8b6b4b93209"
const governorAddress = resolveAddress("Governor")
const deployerAddress = resolveAddress("OperationsSigner")
const ethWhaleAddress = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"

// 1. Deploy && change Recipient
//     - check config
// 2. Beta testing
//     - collector.distributeInterest
//     - forward
//     - setConfig
//     - collector.distributeInterest
//     - check split
context("Recipient deployment and upgrade", () => {
    let deployer: Account
    let governor: Account
    let ethWhale: Signer
    let musdWhale: Signer
    let savingsManager: SavingsManager
    let musdAddr: string
    let gaugeBriber: GaugeBriber
    let collector: Collector

    const { network } = hre

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

        // send some Ether to the impersonated multisig contract as it doesn't have Ether
        await ethWhale.sendTransaction({
            to: governorAddress,
            value: simpleToExactAmount(1),
        })
    })
    context("1. Deploying", () => {
        it("deploys new contract", async () => {
            const nexus = resolveAddress("Nexus", Chain.mainnet)
            musdAddr = resolveAddress("mUSD", Chain.mainnet, "address")
            const keeper = "0xb81473f20818225302b8fffb905b53d58a793d84"
            const briber = "0xd0f0F590585384AF7AB420bE1CFB3A3F8a82D775"
            const childRecipient = resolveAddress("RevenueRecipient", Chain.mainnet)

            gaugeBriber = await deployContract(new GaugeBriber__factory(deployer.signer), "GaugeBriber", [
                nexus,
                musdAddr,
                keeper,
                briber,
                childRecipient,
            ])
        })
        it("execs upgrade", async () => {
            const savingsManagerAddress = resolveAddress("SavingsManager", Chain.mainnet)
            savingsManager = SavingsManager__factory.connect(savingsManagerAddress, governor.signer)
            await savingsManager.setRevenueRecipient(musdAddr, gaugeBriber.address)

            const collectorAddress = resolveAddress("Collector", Chain.mainnet)
            collector = Collector__factory.connect(collectorAddress, governor.signer)
        })
    })
    // 2. Beta testing
    //     - collector.distributeInterest
    //     - forward
    //     - setConfig
    //     - collector.distributeInterest
    //     - check split
    context("2. Beta tests", () => {
        let bal
        it("collects & distributes to revenueRecipient", async () => {
            await collector.distributeInterest([musdAddr], true)
            bal = await ERC20__factory.connect(musdAddr, deployer.signer).balanceOf(gaugeBriber.address)
            expect(bal).gt(0)
            expect(await gaugeBriber.available(0)).eq(bal)
        })
        it("forwards to briber", async () => {
            await gaugeBriber.forward()
            const briberBal = await ERC20__factory.connect(musdAddr, deployer.signer).balanceOf(
                "0xd0f0F590585384AF7AB420bE1CFB3A3F8a82D775",
            )
            expect(briberBal).eq(bal)
        })
        it("sets config", async () => {
            await gaugeBriber.connect(governor.signer).setConfig(DEAD_ADDRESS, ZERO_ADDRESS, simpleToExactAmount(1, 17))
            expect(await gaugeBriber.briber()).eq(DEAD_ADDRESS)
            expect(await gaugeBriber.childRecipient()).eq(ZERO_ADDRESS)
            expect(await gaugeBriber.feeSplit()).eq(simpleToExactAmount(1, 17))
        })
        it("collects & distributes to revenueRecipient", async () => {
            await increaseTime(ONE_WEEK)
            await collector.distributeInterest([musdAddr], true)
            bal = await ERC20__factory.connect(musdAddr, deployer.signer).balanceOf(gaugeBriber.address)
            expect(bal).gt(0)
            const available0 = await gaugeBriber.available(0)
            const available1 = await gaugeBriber.available(1)
            assertBNClose(bal, available0.add(available1), 1)
        })
    })
})
