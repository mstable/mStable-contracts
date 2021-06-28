"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const constants_1 = require("@utils/constants");
const ethers_1 = require("ethers");
const hardhat_1 = require("hardhat");
const utils_1 = require("ethers/lib/utils");
const time_1 = require("@utils/time");
const generated_1 = require("types/generated");
const math_1 = require("@utils/math");
const SavingsManager_json_1 = require("./SavingsManager.json");
const fork_1 = require("@utils/fork");
// Accounts that are impersonated
const ethWhaleAddress = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const governorAddress = "0xF6FF1F7FCEB2cE6d26687EaaB5988b445d0b94a2";
const mUsdWhaleAddress = "0x6595732468A241312bc307F327bA0D64F02b3c20";
const balWhale = "0x3f5ce5fbfe3e9af3971dd833d26ba9b5c936f0be";
const nullAddr = "0xAf40dA2DcE68Bf82bd4C5eE7dA22B2F7bb7ba265";
const config = {
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
    minOuts: [math_1.simpleToExactAmount(3, 17), math_1.simpleToExactAmount(20000), math_1.simpleToExactAmount(1000)],
    fPools: ["0x4fb30c5a3ac8e85bc32785518633303c4590752d", "0xfe842e95f8911dcc21c943a1daa4bd641a1381c6"],
};
context("upgrading buy & make and collecting yield", () => {
    let recipientv2;
    let nexus;
    let savingsManager;
    let governor;
    let pool;
    let collector;
    let interestValidator;
    let balToken;
    before("reset block number", async () => {
        await hardhat_1.network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 12193385,
                    },
                },
            ],
        });
        const ethWhale = await fork_1.impersonate(ethWhaleAddress);
        await ethWhale.sendTransaction({
            to: governorAddress,
            value: math_1.simpleToExactAmount(10),
        });
        await ethWhale.sendTransaction({
            to: "0x7fFAF4ceD81E7c4E71b3531BD7948d7FA8f20329",
            value: math_1.simpleToExactAmount(10),
        });
        governor = await fork_1.impersonate(governorAddress);
        nexus = generated_1.INexus__factory.connect(config.nexus, governor);
        const savingsManagerFactory = new ethers_1.ContractFactory(SavingsManager_json_1.abi, SavingsManager_json_1.bytecode, governor);
        savingsManager = savingsManagerFactory.attach("0x9781C4E9B9cc6Ac18405891DF20Ad3566FB6B301");
        pool = generated_1.MockBPool__factory.connect(config.crp, governor);
    });
    // Deploy recipient
    // Upgrade both mUSD and mBTC in governance
    it("deploys and upgrades recipientv2", async () => {
        recipientv2 = generated_1.RevenueRecipient__factory.connect("0xA7824292efDee1177a1C1BED0649cfdD6114fed5", governor);
        await savingsManager.setRevenueRecipient(config.tokens[0], recipientv2.address);
        await savingsManager.setRevenueRecipient(config.tokens[1], recipientv2.address);
        const proxy = await fork_1.impersonate("0x7fFAF4ceD81E7c4E71b3531BD7948d7FA8f20329");
        const crp = await generated_1.ConfigurableRightsPool__factory.connect(config.crp, proxy);
        await crp.whitelistLiquidityProvider(recipientv2.address);
        governor = await fork_1.impersonate(governorAddress);
    });
    // Called by governance to migrate from v1 to v2
    it("migrates BPT from v1 to v2", async () => {
        const v1BalBefore = await pool.balanceOf(config.oldRecipient);
        const v2BalBefore = await pool.balanceOf(recipientv2.address);
        chai_1.expect(v2BalBefore).eq(0);
        const recipientv1 = generated_1.RevenueRecipientV1__factory.connect(config.oldRecipient, governor);
        await recipientv1.migrateBPT(recipientv2.address);
        const v1BalAfter = await pool.balanceOf(config.oldRecipient);
        const v2BalAfter = await pool.balanceOf(recipientv2.address);
        chai_1.expect(v1BalAfter).eq(0);
        chai_1.expect(v2BalAfter).eq(v1BalBefore);
    });
    // Add Collector
    // Cancel InterestValidator old
    // Add InterestValidator new
    it("proposes the Collector and Interest Validator as modules in Nexus", async () => {
        collector = generated_1.Collector__factory.connect("0x3F63e5bbB53e46F8B21F67C25Bf2dd78BC6C0e43", governor);
        interestValidator = generated_1.InterestValidator__factory.connect("0xf1049aeD858C4eAd6df1de4dbE63EF607CfF3262", governor);
        await nexus.proposeModule(utils_1.keccak256(utils_1.toUtf8Bytes("Governance")), collector.address);
        await nexus.cancelProposedModule(utils_1.keccak256(utils_1.toUtf8Bytes("InterestValidator")));
        await nexus.proposeModule(utils_1.keccak256(utils_1.toUtf8Bytes("InterestValidator")), interestValidator.address);
    });
    // Wait 1 week
    // Accept both modules
    it("upgrades the modules after a week delay", async () => {
        await time_1.increaseTime(constants_1.ONE_WEEK);
        await nexus.acceptProposedModules([utils_1.keccak256(utils_1.toUtf8Bytes("InterestValidator")), utils_1.keccak256(utils_1.toUtf8Bytes("Governance"))]);
    });
    // Call both mUSD and mBTC collections via the collector
    it("collects from both assets using the collector", async () => {
        await collector.distributeInterest([config.tokens[0], config.tokens[1]], true);
    });
    // Call 100%
    it("fails to deposit all to the pool", async () => {
        await chai_1.expect(recipientv2.depositToPool([config.tokens[0], config.tokens[1]], [math_1.simpleToExactAmount(1), math_1.simpleToExactAmount(1)])).to.be.revertedWith("ERR_MAX_IN_RATIO");
    });
    // Call 20%
    it("deposits a % to pool", async () => {
        await recipientv2.depositToPool([config.tokens[0], config.tokens[1]], [math_1.simpleToExactAmount(2, 17), math_1.simpleToExactAmount(2, 17)]);
    });
    // Call multiple more 20%'s
    it("deposits all to pool", async () => {
        await recipientv2.depositToPool([config.tokens[0], config.tokens[1]], [math_1.simpleToExactAmount(2, 17), math_1.simpleToExactAmount(2, 17)]);
        await recipientv2.depositToPool([config.tokens[0], config.tokens[1]], [math_1.simpleToExactAmount(4, 17), math_1.simpleToExactAmount(4, 17)]);
        await recipientv2.depositToPool([config.tokens[0], config.tokens[1]], [math_1.simpleToExactAmount(1), math_1.simpleToExactAmount(1)]);
    });
    // Deposit BAL to the contract
    // Call reinvest via the BAL/WETH pool
    it("reinvests all BAL back into the pool via WETH", async () => {
        const balWhaleS = await fork_1.impersonate(balWhale);
        balToken = generated_1.MockERC20__factory.connect(config.bal, balWhaleS);
        await balToken.transfer(recipientv2.address, math_1.simpleToExactAmount(10, 18));
        const balBefore = await pool.balanceOf(recipientv2.address);
        await recipientv2.reinvestBAL("0x59a19d8c652fa0284f44113d0ff9aba70bd46fb4", "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", math_1.simpleToExactAmount(1, 17), math_1.simpleToExactAmount(600), math_1.simpleToExactAmount(5, 17));
        await recipientv2.reinvestBAL("0x59a19d8c652fa0284f44113d0ff9aba70bd46fb4", "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", math_1.simpleToExactAmount(1, 17), math_1.simpleToExactAmount(600), math_1.simpleToExactAmount(1));
        const balAfter = await pool.balanceOf(recipientv2.address);
        chai_1.expect(balAfter).gt(balBefore.add(200));
    });
    // Set govFee to 50%
    // Do some swaps & increase time
    // Collect platform interest
    it("accrues gov fees in feeder pools", async () => {
        let fPool1 = generated_1.FeederPool__factory.connect(config.fPools[0], governor);
        let fPool2 = generated_1.FeederPool__factory.connect(config.fPools[1], governor);
        await fPool1.setFees(math_1.simpleToExactAmount(1, 16), math_1.simpleToExactAmount(1, 16), math_1.simpleToExactAmount(5, 17));
        await fPool2.setFees(math_1.simpleToExactAmount(1, 16), math_1.simpleToExactAmount(1, 16), math_1.simpleToExactAmount(5, 17));
        const mUSDWhale = await fork_1.impersonate(mUsdWhaleAddress);
        fPool1 = generated_1.FeederPool__factory.connect(config.fPools[0], mUSDWhale);
        fPool2 = generated_1.FeederPool__factory.connect(config.fPools[1], mUSDWhale);
        const mUSD = generated_1.MockERC20__factory.connect(config.tokens[0], mUSDWhale);
        await mUSD.approve(fPool1.address, math_1.simpleToExactAmount(1000));
        await fPool1.swap(mUSD.address, "0x056fd409e1d7a124bd7017459dfea2f387b6d5cd", math_1.simpleToExactAmount(1000), 1, mUsdWhaleAddress);
        await mUSD.approve(fPool2.address, math_1.simpleToExactAmount(1000));
        await fPool2.swap(mUSD.address, "0x4fabb145d64652a948d72533023f6e7a623c7c53", math_1.simpleToExactAmount(1000), 1, mUsdWhaleAddress);
        await time_1.increaseTime(constants_1.ONE_DAY);
        await interestValidator.collectAndValidateInterest([fPool1.address]);
    });
    // Collect all, and check the balance in the SavingsManager
    it("collects gov fees from the feeder pools", async () => {
        const mUSDWhale = await fork_1.impersonate(mUsdWhaleAddress);
        const mUSD = generated_1.MockERC20__factory.connect(config.tokens[0], mUSDWhale);
        const balBefore = await mUSD.balanceOf(savingsManager.address);
        await interestValidator.collectGovFees(config.fPools);
        const balAfter = await mUSD.balanceOf(savingsManager.address);
        chai_1.expect(balAfter).gt(balBefore);
        console.log("bals: ", utils_1.formatEther(balAfter.sub(balBefore)));
        await collector.distributeInterest([config.tokens[0]], false);
        const balEnd = await mUSD.balanceOf(savingsManager.address);
        chai_1.expect(balEnd).eq(0);
    });
    // Simply accrue more BAL and transfer elsewhere
    it("migrates BAL & BPT later", async () => {
        const v1BalBefore = await pool.balanceOf(recipientv2.address);
        const v1BalBeforeB = await balToken.balanceOf(recipientv2.address);
        const v2BalBefore = await pool.balanceOf(nullAddr);
        const v2BalBeforeB = await balToken.balanceOf(nullAddr);
        chai_1.expect(v2BalBefore).eq(0);
        chai_1.expect(v2BalBeforeB).eq(0);
        await recipientv2.migrate(nullAddr);
        const v1BalAfter = await pool.balanceOf(recipientv2.address);
        const v1BalAfterB = await balToken.balanceOf(recipientv2.address);
        const v2BalAfter = await pool.balanceOf(nullAddr);
        const v2BalAfterB = await balToken.balanceOf(nullAddr);
        chai_1.expect(v1BalAfter).eq(0);
        chai_1.expect(v2BalAfter).eq(v1BalBefore);
        chai_1.expect(v1BalAfterB).eq(0);
        chai_1.expect(v2BalAfterB).eq(v1BalBeforeB);
    });
});
module.exports = {};
//# sourceMappingURL=recipient-upgrade.spec.js.map