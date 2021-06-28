"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fork_1 = require("@utils/fork");
const math_1 = require("@utils/math");
const chai_1 = require("chai");
const hardhat_1 = require("hardhat");
const deploy_utils_1 = require("tasks/utils/deploy-utils");
const generated_1 = require("types/generated");
const CompoundIntegration__factory_1 = require("types/generated/factories/CompoundIntegration__factory");
const ICERC20__factory_1 = require("types/generated/factories/ICERC20__factory");
const governorAddress = "0xF6FF1F7FCEB2cE6d26687EaaB5988b445d0b94a2";
const deployerAddress = "0xb81473f20818225302b8fffb905b53d58a793d84";
const ethWhaleAddress = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const mUsdWhaleAddress = "0xd2dbd9ba61ee40519226aee282fec8197a2459ae";
const nexusAddress = "0xafce80b19a8ce13dec0739a1aab7a028d6845eb3";
const mUsdAddress = "0xe2f2a5c287993345a840db3b0845fbc70f5935a5";
const cymUsdAddress = "0xbe86e8918dfc7d3cb10d295fc220f941a1470c5c";
const gusdFpAddress = "0x4fB30C5A3aC8e85bC32785518633303C4590752d";
const busdFpAddress = "0xfE842e95f8911dcc21c943a1dAA4bd641a1381c6";
const creamTokenAddress = "0x2ba592f78db6436527729929aaf6c908497cb200";
const liquidatorAddress = "0xe595D67181D701A5356e010D9a58EB9A341f1DbD";
const gusdIronBankIntegrationAddress = "0xaF007D4ec9a13116035a2131EA1C9bc0B751E3cf";
const busdIronBankIntegrationAddress = "0x2A15794575e754244F9C0A15F504607c201f8AfD";
// Not sure why this is 2**96 - 1 and not 2**256 - 1 for CREAM
const safeInfinity = math_1.BN.from(2).pow(96).sub(1);
context("mUSD Feeder Pool integration to CREAM", () => {
    let governor;
    let deployer;
    let ethWhale;
    let mUsdWhale;
    let gudsFp;
    let budsFp;
    let mUsd;
    let cymUsdToken;
    let creamToken;
    let gusdIntegration;
    let busdIntegration;
    let mUsdInGusdFpBefore;
    let gUsdFpDataBefore;
    before("reset block number", async () => {
        await hardhat_1.network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 12367735,
                    },
                },
            ],
        });
        deployer = await fork_1.impersonate(deployerAddress);
        governor = await fork_1.impersonate(governorAddress);
        ethWhale = await fork_1.impersonate(ethWhaleAddress);
        mUsdWhale = await fork_1.impersonate(mUsdWhaleAddress);
        // send some Ether to the impersonated multisig contract as it doesn't have Ether
        await ethWhale.sendTransaction({
            to: governorAddress,
            value: math_1.simpleToExactAmount(10),
        });
        gudsFp = generated_1.FeederPool__factory.connect(gusdFpAddress, governor);
        budsFp = generated_1.FeederPool__factory.connect(busdFpAddress, governor);
        mUsd = await generated_1.IERC20__factory.connect(mUsdAddress, deployer);
        cymUsdToken = await ICERC20__factory_1.ICERC20__factory.connect(cymUsdAddress, deployer);
        creamToken = await generated_1.IERC20__factory.connect(creamTokenAddress, deployer);
    });
    it("Test connectivity", async () => {
        const currentBlock = await hardhat_1.ethers.provider.getBlockNumber();
        console.log(`Current block ${currentBlock}`);
        const startEther = await deployer.getBalance();
        console.log(`Deployer ${deployerAddress} has ${startEther} Ether`);
    });
    it("deploy and initialize integration contracts", async () => {
        gusdIntegration = await deploy_utils_1.deployContract(new CompoundIntegration__factory_1.CompoundIntegration__factory(deployer), "CREAM Integration for GUSD FP", [nexusAddress, gusdFpAddress, creamTokenAddress]);
        chai_1.expect(gusdIntegration.address).to.length(42);
        await gusdIntegration.initialize([mUsdAddress], [cymUsdAddress]);
        busdIntegration = await deploy_utils_1.deployContract(new CompoundIntegration__factory_1.CompoundIntegration__factory(deployer), "CREAM Integration for BUSD FP", [nexusAddress, busdFpAddress, creamTokenAddress]);
        busdIntegration = await new CompoundIntegration__factory_1.CompoundIntegration__factory(deployer).deploy(nexusAddress, busdFpAddress, creamTokenAddress);
        await busdIntegration.initialize([mUsdAddress], [cymUsdAddress]);
    });
    it("Governor approves Liquidator to spend the reward (CREAM) token", async () => {
        chai_1.expect(await creamToken.allowance(gusdIntegration.address, liquidatorAddress)).to.eq(0);
        chai_1.expect(await creamToken.allowance(busdIntegration.address, liquidatorAddress)).to.eq(0);
        // This will be done via the delayedProxyAdmin on mainnet
        await gusdIntegration.connect(governor).approveRewardToken();
        await busdIntegration.connect(governor).approveRewardToken();
        chai_1.expect(await creamToken.allowance(gusdIntegration.address, liquidatorAddress)).to.eq(safeInfinity);
        chai_1.expect(await creamToken.allowance(busdIntegration.address, liquidatorAddress)).to.eq(safeInfinity);
    });
    it("Migrate mUSD assets", async () => {
        // Before
        chai_1.expect(await mUsd.balanceOf(gusdFpAddress), "Some mUSD in existing GUSD Feeder Pool").to.gt(0);
        chai_1.expect(await mUsd.balanceOf(gusdIntegration.address), "No mUSD in new GUSD FP Integration contract").to.eq(0);
        chai_1.expect(await mUsd.balanceOf(cymUsdAddress), "No mUSD in CREAM, yet").to.eq(0);
        mUsdInGusdFpBefore = await mUsd.balanceOf(gusdFpAddress);
        gUsdFpDataBefore = await gudsFp.getBasset(mUsdAddress);
        // Migrate mUSD in GUSD Feeder Pool to new GUSD FP Integration contract
        const tx = await gudsFp.migrateBassets([mUsdAddress], gusdIntegration.address);
        console.log(`migrateBassets tx data: ${tx.data}`);
        // All mUsd in the GUSD FP should have moved to the GUSD integration contract
        chai_1.expect(await mUsd.balanceOf(gusdIntegration.address), "All mUSD in GUSD FP migrated to GUSD Integration").to.eq(mUsdInGusdFpBefore);
        chai_1.expect(await mUsd.balanceOf(gusdFpAddress), "No more mUSD in GUSD Feeder Pool").to.eq(0);
        const mUsdDataAfter = await gudsFp.getBasset(mUsdAddress);
        chai_1.expect(gUsdFpDataBefore.vaultData.vaultBalance).to.eq(mUsdDataAfter.vaultData.vaultBalance);
        const mUsdInBusdFpBefore = await mUsd.balanceOf(busdFpAddress);
        await budsFp.migrateBassets([mUsdAddress], busdIntegration.address);
        // All mUsd in the BUSD FP should have moved to the BUSD integration contract but not the CREAM mUSD vault
        chai_1.expect(await mUsd.balanceOf(busdFpAddress), "No more mUSD in BUSD Feeder Pool").to.eq(0);
        chai_1.expect(await mUsd.balanceOf(busdIntegration.address), "All mUSD in BUSD FP migrated to BUSD Integration").to.eq(mUsdInBusdFpBefore);
        chai_1.expect(await mUsd.balanceOf(cymUsdAddress), "No mUSD in CREAM, yet").to.eq(0);
    });
    it("Mint some mUSD in the GUSD Feeder Pool", async () => {
        chai_1.expect(await mUsd.balanceOf(gusdFpAddress)).to.eq(0);
        const mintAmount = math_1.simpleToExactAmount(10000);
        await mUsd.connect(mUsdWhale).approve(gusdFpAddress, mintAmount);
        chai_1.expect(await mUsd.allowance(mUsdWhaleAddress, gusdFpAddress)).to.eq(mintAmount);
        await gudsFp.connect(mUsdWhale).mint(mUsdAddress, mintAmount, 0, mUsdWhaleAddress);
        const mUsdDataAfter = await gudsFp.getBasset(mUsdAddress);
        chai_1.expect(mUsdDataAfter.vaultData.vaultBalance, "Vault balances").to.eq(gUsdFpDataBefore.vaultData.vaultBalance.add(mintAmount));
        const mUsdInGusdIntegration = await mUsd.balanceOf(gusdIntegration.address);
        const mUsdInCream = await mUsd.balanceOf(cymUsdAddress);
        chai_1.expect(mUsdInGusdIntegration, "Some mUSD in GUSD Integration").to.gt(0);
        chai_1.expect(mUsdInCream, "Some mUSD in CREAM").to.gt(0);
        console.log(`Total mUSD ${mUsdDataAfter.vaultData.vaultBalance}, integration ${mUsdInGusdIntegration}, CREAM vault ${mUsdInCream}`);
        chai_1.expect(mUsdDataAfter.vaultData.vaultBalance, "mUSD in GUSD FP split across Integration and CREAM").to.eq(mUsdInGusdIntegration.add(mUsdInCream));
        const rateExchange = await cymUsdToken.exchangeRateStored();
        chai_1.expect(await cymUsdToken.balanceOf(gusdIntegration.address), "cymUSD tokens in GUSD Integration").to.eq(
        // cymUSD = mUSD *  1e18 / exchange rate
        mUsdInCream.mul(math_1.BN.from(10).pow(18)).div(rateExchange));
    });
    it("Redeem mUSD from feed", async () => {
        const redeemAmount = math_1.simpleToExactAmount(9970);
        await gudsFp.connect(mUsdWhale).redeem(mUsdAddress, redeemAmount, 0, mUsdWhaleAddress);
        const mUsdDataAfter = await gudsFp.getBasset(mUsdAddress);
        const mUsdInGusdIntegration = await mUsd.balanceOf(gusdIntegration.address);
        const mUsdInCream = await mUsd.balanceOf(cymUsdAddress);
        chai_1.expect(mUsdInGusdIntegration, "Some mUSD in GUSD Integration").to.gt(0);
        chai_1.expect(mUsdInCream, "Some mUSD in CREAM").to.gt(0);
        console.log(`Total mUSD ${mUsdDataAfter.vaultData.vaultBalance}, integration ${mUsdInGusdIntegration}, CREAM vault ${mUsdInCream}`);
        chai_1.expect(mUsdDataAfter.vaultData.vaultBalance, "mUSD in GUSD FP split across Integration and CREAM").to.eq(mUsdInGusdIntegration.add(mUsdInCream));
    });
    context("approveRewardToken", () => {
        it("using governor", async () => {
            await gusdIntegration.connect(governor).approveRewardToken();
        });
        it("not using governor", async () => {
            const tx = gusdIntegration.connect(deployer).approveRewardToken();
            await chai_1.expect(tx).to.revertedWith("Only governor can execute");
        });
    });
    context("reApproveAllTokens", () => {
        it("using governor", async () => {
            await gusdIntegration.connect(governor).reApproveAllTokens();
        });
        it("not using governor", async () => {
            const tx = gusdIntegration.connect(deployer).reApproveAllTokens();
            await chai_1.expect(tx).to.revertedWith("Only governor can execute");
        });
    });
    context("Post deployment of Iron Bank integration contracts to mainnet", () => {
        before("reset block number", async () => {
            await hardhat_1.network.provider.request({
                method: "hardhat_reset",
                params: [
                    {
                        forking: {
                            jsonRpcUrl: process.env.NODE_URL,
                            blockNumber: 12540080,
                        },
                    },
                ],
            });
            deployer = await fork_1.impersonate(deployerAddress);
            governor = await fork_1.impersonate(governorAddress);
            ethWhale = await fork_1.impersonate(ethWhaleAddress);
            mUsdWhale = await fork_1.impersonate(mUsdWhaleAddress);
            // send some Ether to the impersonated multisig contract as it doesn't have Ether
            await ethWhale.sendTransaction({
                to: governorAddress,
                value: math_1.simpleToExactAmount(10),
            });
            gudsFp = generated_1.FeederPool__factory.connect(gusdFpAddress, governor);
            budsFp = generated_1.FeederPool__factory.connect(busdFpAddress, governor);
            mUsd = await generated_1.IERC20__factory.connect(mUsdAddress, deployer);
            cymUsdToken = await ICERC20__factory_1.ICERC20__factory.connect(cymUsdAddress, deployer);
            creamToken = await generated_1.IERC20__factory.connect(creamTokenAddress, deployer);
            gusdIntegration = CompoundIntegration__factory_1.CompoundIntegration__factory.connect(gusdIronBankIntegrationAddress, governor);
            busdIntegration = CompoundIntegration__factory_1.CompoundIntegration__factory.connect(busdIronBankIntegrationAddress, governor);
        });
        it("migrateBassets in GUSD", async () => {
            // Before
            chai_1.expect(await mUsd.balanceOf(gusdFpAddress), "Some mUSD in existing GUSD Feeder Pool").to.gt(0);
            chai_1.expect(await mUsd.balanceOf(gusdIntegration.address), "No mUSD in new GUSD FP Integration contract").to.eq(0);
            const mUsdInIronBankBefore = await mUsd.balanceOf(cymUsdAddress);
            mUsdInGusdFpBefore = await mUsd.balanceOf(gusdFpAddress);
            gUsdFpDataBefore = await gudsFp.getBasset(mUsdAddress);
            // Migrate mUSD in GUSD Feeder Pool to new GUSD FP Integration contract for Iron Bank
            const tx = await gudsFp.migrateBassets([mUsdAddress], gusdIntegration.address);
            console.log(`migrateBassets tx data for GUSD Feeder Pool: ${tx.data}`);
            // All mUsd in the GUSD FP should have moved to the GUSD integration contract
            chai_1.expect(await mUsd.balanceOf(gusdIntegration.address), "All mUSD in GUSD FP migrated to GUSD Integration").to.eq(mUsdInGusdFpBefore);
            chai_1.expect(await mUsd.balanceOf(gusdFpAddress), "No more mUSD in GUSD Feeder Pool").to.eq(0);
            const mUsdDataAfter = await gudsFp.getBasset(mUsdAddress);
            chai_1.expect(gUsdFpDataBefore.vaultData.vaultBalance).to.eq(mUsdDataAfter.vaultData.vaultBalance);
            chai_1.expect(await mUsd.balanceOf(cymUsdAddress), "Feeder Pool mUSD not in CREAM, yet").to.eq(mUsdInIronBankBefore);
        });
        it("migrateBassets in BUSD", async () => {
            // Before
            chai_1.expect(await mUsd.balanceOf(busdFpAddress), "Some mUSD in existing BUSD Feeder Pool").to.gt(0);
            chai_1.expect(await mUsd.balanceOf(busdIntegration.address), "No mUSD in new BUSD FP Integration contract").to.eq(0);
            const mUsdInIronBankBefore = await mUsd.balanceOf(cymUsdAddress);
            const mUsdInBusdFpBefore = await mUsd.balanceOf(busdFpAddress);
            // Migrate mUSD in BUSD Feeder Pool to new BUSD FP Integration contract for Iron Bank
            const tx = await budsFp.migrateBassets([mUsdAddress], busdIntegration.address);
            console.log(`migrateBassets tx data for BUSD Feeder Pool: ${tx.data}`);
            // All mUsd in the BUSD FP should have moved to the BUSD integration contract but not the CREAM mUSD vault
            chai_1.expect(await mUsd.balanceOf(busdFpAddress), "No more mUSD in BUSD Feeder Pool").to.eq(0);
            chai_1.expect(await mUsd.balanceOf(busdIntegration.address), "All mUSD in BUSD FP migrated to BUSD Integration").to.eq(mUsdInBusdFpBefore);
            chai_1.expect(await mUsd.balanceOf(cymUsdAddress), "Feeder Pool mUSD not in CREAM, yet").to.eq(mUsdInIronBankBefore);
        });
        it("Governor approves Liquidator to spend the reward (CREAM) tokens", async () => {
            chai_1.expect(await creamToken.allowance(gusdIntegration.address, liquidatorAddress)).to.eq(0);
            chai_1.expect(await creamToken.allowance(busdIntegration.address, liquidatorAddress)).to.eq(0);
            // This will be done via the delayedProxyAdmin on mainnet
            await gusdIntegration.connect(governor).approveRewardToken();
            await busdIntegration.connect(governor).approveRewardToken();
            chai_1.expect(await creamToken.allowance(gusdIntegration.address, liquidatorAddress)).to.eq(safeInfinity);
            chai_1.expect(await creamToken.allowance(busdIntegration.address, liquidatorAddress)).to.eq(safeInfinity);
        });
    });
});
//# sourceMappingURL=feeders-musd-cream.spec.js.map