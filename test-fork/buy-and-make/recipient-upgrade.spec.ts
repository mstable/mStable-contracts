import { expect } from "chai"
import { ONE_DAY, ONE_WEEK } from "@utils/constants"
import { Signer, ContractFactory, Contract } from "ethers"
import { network } from "hardhat"
import { formatEther, keccak256, toUtf8Bytes } from "ethers/lib/utils"
import { increaseTime } from "@utils/time"
import {
    FeederPool__factory,
    MockERC20,
    MockERC20__factory,
    InterestValidator__factory,
    RevenueRecipient,
    INexus__factory,
    INexus,
    RevenueRecipient__factory,
    MockBPool,
    MockBPool__factory,
    Collector,
    Collector__factory,
    InterestValidator,
    ConfigurableRightsPool__factory,
    RevenueRecipientV1__factory,
} from "types/generated"
import { simpleToExactAmount, BN } from "@utils/math"
import { impersonate } from "@utils/fork"
import { abi as SavingsManagerAbi, bytecode as SavingsManagerBytecode } from "./SavingsManager.json"

// Accounts that are impersonated
const ethWhaleAddress = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
const governorAddress = "0xF6FF1F7FCEB2cE6d26687EaaB5988b445d0b94a2"
const mUsdWhaleAddress = "0x6595732468A241312bc307F327bA0D64F02b3c20"
const balWhale = "0x3f5ce5fbfe3e9af3971dd833d26ba9b5c936f0be"
const nullAddr = "0xAf40dA2DcE68Bf82bd4C5eE7dA22B2F7bb7ba265"

interface Config {
    oldRecipient: string
    nexus: string
    proxyAdmin: string
    crp: string
    bal: string
    tokens: string[]
    minOuts: BN[]
    fPools: string[]
}

const config: Config = {
    oldRecipient: "0xffe2cdce7babb1422d5976c2fc27448f226b6bec",
    nexus: "0xafce80b19a8ce13dec0739a1aab7a028d6845eb3",
    proxyAdmin: "0x5c8eb57b44c1c6391fc7a8a0cf44d26896f92386",
    crp: "0xc079e4321ecdc2fd3447bf7db629e0c294fb7a10",
    bal: "0xba100000625a3754423978a60c9317c58a424e3d",
    tokens: [
        "0xe2f2a5C287993345a840Db3B0845fbC70f5935a5",
        "0x945Facb997494CC2570096c74b5F66A3507330a1",
        "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    ],
    minOuts: [simpleToExactAmount(3, 17), simpleToExactAmount(20000), simpleToExactAmount(1000)],
    fPools: ["0x4fb30c5a3ac8e85bc32785518633303c4590752d", "0xfe842e95f8911dcc21c943a1daa4bd641a1381c6"],
}

context("upgrading buy & make and collecting yield", () => {
    let recipientv2: RevenueRecipient
    let nexus: INexus
    let savingsManager: Contract
    let governor: Signer
    let pool: MockBPool
    let collector: Collector
    let interestValidator: InterestValidator
    let balToken: MockERC20
    before("reset block number", async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 12193385,
                    },
                },
            ],
        })
        const ethWhale = await impersonate(ethWhaleAddress)
        await ethWhale.sendTransaction({
            to: governorAddress,
            value: simpleToExactAmount(10),
        })
        await ethWhale.sendTransaction({
            to: "0x7fFAF4ceD81E7c4E71b3531BD7948d7FA8f20329",
            value: simpleToExactAmount(10),
        })
        governor = await impersonate(governorAddress)
        nexus = INexus__factory.connect(config.nexus, governor)
        const savingsManagerFactory = new ContractFactory(SavingsManagerAbi, SavingsManagerBytecode, governor)
        savingsManager = savingsManagerFactory.attach("0x9781C4E9B9cc6Ac18405891DF20Ad3566FB6B301")
        pool = MockBPool__factory.connect(config.crp, governor)
    })
    // Deploy recipient
    // Upgrade both mUSD and mBTC in governance
    it("deploys and upgrades recipientv2", async () => {
        recipientv2 = RevenueRecipient__factory.connect("0xA7824292efDee1177a1C1BED0649cfdD6114fed5", governor)
        await savingsManager.setRevenueRecipient(config.tokens[0], recipientv2.address)
        await savingsManager.setRevenueRecipient(config.tokens[1], recipientv2.address)

        const proxy = await impersonate("0x7fFAF4ceD81E7c4E71b3531BD7948d7FA8f20329")

        const crp = await ConfigurableRightsPool__factory.connect(config.crp, proxy)
        await crp.whitelistLiquidityProvider(recipientv2.address)
        governor = await impersonate(governorAddress)
    })
    // Called by governance to migrate from v1 to v2
    it("migrates BPT from v1 to v2", async () => {
        const v1BalBefore = await pool.balanceOf(config.oldRecipient)
        const v2BalBefore = await pool.balanceOf(recipientv2.address)
        expect(v2BalBefore).eq(0)

        const recipientv1 = RevenueRecipientV1__factory.connect(config.oldRecipient, governor)
        await recipientv1.migrateBPT(recipientv2.address)

        const v1BalAfter = await pool.balanceOf(config.oldRecipient)
        const v2BalAfter = await pool.balanceOf(recipientv2.address)
        expect(v1BalAfter).eq(0)
        expect(v2BalAfter).eq(v1BalBefore)
    })
    // Add Collector
    // Cancel InterestValidator old
    // Add InterestValidator new
    it("proposes the Collector and Interest Validator as modules in Nexus", async () => {
        collector = Collector__factory.connect("0x3F63e5bbB53e46F8B21F67C25Bf2dd78BC6C0e43", governor)
        interestValidator = InterestValidator__factory.connect("0xf1049aeD858C4eAd6df1de4dbE63EF607CfF3262", governor)

        await nexus.proposeModule(keccak256(toUtf8Bytes("Governance")), collector.address)
        await nexus.cancelProposedModule(keccak256(toUtf8Bytes("InterestValidator")))
        await nexus.proposeModule(keccak256(toUtf8Bytes("InterestValidator")), interestValidator.address)
    })
    // Wait 1 week
    // Accept both modules
    it("upgrades the modules after a week delay", async () => {
        await increaseTime(ONE_WEEK)

        await nexus.acceptProposedModules([keccak256(toUtf8Bytes("InterestValidator")), keccak256(toUtf8Bytes("Governance"))])
    })
    // Call both mUSD and mBTC collections via the collector
    it("collects from both assets using the collector", async () => {
        await collector.distributeInterest([config.tokens[0], config.tokens[1]], true)
    })
    // Call 100%
    it("fails to deposit all to the pool", async () => {
        await expect(
            recipientv2.depositToPool([config.tokens[0], config.tokens[1]], [simpleToExactAmount(1), simpleToExactAmount(1)]),
        ).to.be.revertedWith("ERR_MAX_IN_RATIO")
    })
    // Call 20%
    it("deposits a % to pool", async () => {
        await recipientv2.depositToPool([config.tokens[0], config.tokens[1]], [simpleToExactAmount(2, 17), simpleToExactAmount(2, 17)])
    })
    // Call multiple more 20%'s
    it("deposits all to pool", async () => {
        await recipientv2.depositToPool([config.tokens[0], config.tokens[1]], [simpleToExactAmount(2, 17), simpleToExactAmount(2, 17)])

        await recipientv2.depositToPool([config.tokens[0], config.tokens[1]], [simpleToExactAmount(4, 17), simpleToExactAmount(4, 17)])

        await recipientv2.depositToPool([config.tokens[0], config.tokens[1]], [simpleToExactAmount(1), simpleToExactAmount(1)])
    })
    // Deposit BAL to the contract
    // Call reinvest via the BAL/WETH pool
    it("reinvests all BAL back into the pool via WETH", async () => {
        const balWhaleS = await impersonate(balWhale)
        balToken = MockERC20__factory.connect(config.bal, balWhaleS)
        await balToken.transfer(recipientv2.address, simpleToExactAmount(10, 18))

        const balBefore = await pool.balanceOf(recipientv2.address)

        await recipientv2.reinvestBAL(
            "0x59a19d8c652fa0284f44113d0ff9aba70bd46fb4",
            "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
            simpleToExactAmount(1, 17),
            simpleToExactAmount(600),
            simpleToExactAmount(5, 17),
        )
        await recipientv2.reinvestBAL(
            "0x59a19d8c652fa0284f44113d0ff9aba70bd46fb4",
            "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
            simpleToExactAmount(1, 17),
            simpleToExactAmount(600),
            simpleToExactAmount(1),
        )
        const balAfter = await pool.balanceOf(recipientv2.address)
        expect(balAfter).gt(balBefore.add(200))
    })
    // Set govFee to 50%
    // Do some swaps & increase time
    // Collect platform interest
    it("accrues gov fees in feeder pools", async () => {
        let fPool1 = FeederPool__factory.connect(config.fPools[0], governor)
        let fPool2 = FeederPool__factory.connect(config.fPools[1], governor)
        await fPool1.setFees(simpleToExactAmount(1, 16), simpleToExactAmount(1, 16), simpleToExactAmount(5, 17))
        await fPool2.setFees(simpleToExactAmount(1, 16), simpleToExactAmount(1, 16), simpleToExactAmount(5, 17))

        const mUSDWhale = await impersonate(mUsdWhaleAddress)
        fPool1 = FeederPool__factory.connect(config.fPools[0], mUSDWhale)
        fPool2 = FeederPool__factory.connect(config.fPools[1], mUSDWhale)
        const mUSD = MockERC20__factory.connect(config.tokens[0], mUSDWhale)
        await mUSD.approve(fPool1.address, simpleToExactAmount(1000))
        await fPool1.swap(mUSD.address, "0x056fd409e1d7a124bd7017459dfea2f387b6d5cd", simpleToExactAmount(1000), 1, mUsdWhaleAddress)
        await mUSD.approve(fPool2.address, simpleToExactAmount(1000))
        await fPool2.swap(mUSD.address, "0x4fabb145d64652a948d72533023f6e7a623c7c53", simpleToExactAmount(1000), 1, mUsdWhaleAddress)

        await increaseTime(ONE_DAY)

        await interestValidator.collectAndValidateInterest([fPool1.address])
    })
    // Collect all, and check the balance in the SavingsManager
    it("collects gov fees from the feeder pools", async () => {
        const mUSDWhale = await impersonate(mUsdWhaleAddress)
        const mUSD = MockERC20__factory.connect(config.tokens[0], mUSDWhale)

        const balBefore = await mUSD.balanceOf(savingsManager.address)
        await interestValidator.collectGovFees(config.fPools)
        const balAfter = await mUSD.balanceOf(savingsManager.address)
        expect(balAfter).gt(balBefore)
        console.log("bals: ", formatEther(balAfter.sub(balBefore)))

        await collector.distributeInterest([config.tokens[0]], false)
        const balEnd = await mUSD.balanceOf(savingsManager.address)
        expect(balEnd).eq(0)
    })
    // Simply accrue more BAL and transfer elsewhere
    it("migrates BAL & BPT later", async () => {
        const v1BalBefore = await pool.balanceOf(recipientv2.address)
        const v1BalBeforeB = await balToken.balanceOf(recipientv2.address)
        const v2BalBefore = await pool.balanceOf(nullAddr)
        const v2BalBeforeB = await balToken.balanceOf(nullAddr)
        expect(v2BalBefore).eq(0)
        expect(v2BalBeforeB).eq(0)

        await recipientv2.migrate(nullAddr)

        const v1BalAfter = await pool.balanceOf(recipientv2.address)
        const v1BalAfterB = await balToken.balanceOf(recipientv2.address)
        const v2BalAfter = await pool.balanceOf(nullAddr)
        const v2BalAfterB = await balToken.balanceOf(nullAddr)
        expect(v1BalAfter).eq(0)
        expect(v2BalAfter).eq(v1BalBefore)
        expect(v1BalAfterB).eq(0)
        expect(v2BalAfterB).eq(v1BalBeforeB)
    })
})

module.exports = {}
