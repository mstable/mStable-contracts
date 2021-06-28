"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fork_1 = require("@utils/fork");
const hardhat_1 = require("hardhat");
const deploy_utils_1 = require("tasks/utils/deploy-utils");
const tokens_1 = require("tasks/utils/tokens");
const generated_1 = require("types/generated");
const AaveStakedTokenV2__factory_1 = require("types/generated/factories/AaveStakedTokenV2__factory");
const chai_1 = require("chai");
const math_1 = require("@utils/math");
const utils_1 = require("ethers/lib/utils");
const time_1 = require("@utils/time");
const constants_1 = require("@utils/constants");
const uniswap_1 = require("@utils/peripheral/uniswap");
// Addresses for signers
const opsAddress = "0xb81473f20818225302b8fffb905b53d58a793d84";
const governorAddress = "0xF6FF1F7FCEB2cE6d26687EaaB5988b445d0b94a2";
const delayedAdminAddress = "0x5c8eb57b44c1c6391fc7a8a0cf44d26896f92386";
const ethWhaleAddress = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const stkAaveWhaleAddress = "0xdb5AA12AD695Ef2a28C6CdB69f2BB04BEd20a48e";
const musdWhaleAddress = "0x9b0c19000a8631c1f555bb365bDE308384E4f2Ff";
const liquidatorAddress = "0xe595D67181D701A5356e010D9a58EB9A341f1DbD";
const aaveMusdIntegrationAddress = "0xA2a3CAe63476891AB2d640d9a5A800755Ee79d6E";
const aaveMbtcIntegrationAddress = "0xC9451a4483d1752a3E9A3f5D6b1C7A6c34621fC6";
const compoundIntegrationAddress = "0xD55684f4369040C12262949Ff78299f2BC9dB735";
const nexusAddress = "0xAFcE80b19A8cE13DEc0739a1aaB7A028d6845Eb3";
const uniswapRouterV3Address = "0xE592427A0AEce92De3Edee1F18E0157C05861564";
const uniswapQuoterV3Address = "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6";
const uniswapEthToken = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const aaveIncentivesControllerAddress = "0xd784927Ff2f95ba542BfC824c8a8a98F3495f6b5";
const gusdIronBankIntegrationAddress = "0xaF007D4ec9a13116035a2131EA1C9bc0B751E3cf";
const busdIronBankIntegrationAddress = "0x2A15794575e754244F9C0A15F504607c201f8AfD";
const aTokens = [tokens_1.USDT.liquidityProvider, tokens_1.DAI.liquidityProvider];
const uniswapCompUsdcPaths = uniswap_1.encodeUniswapPath([tokens_1.COMP.address, uniswapEthToken, tokens_1.USDC.address], [3000, 3000]);
const uniswapAaveUsdcPath = uniswap_1.encodeUniswapPath([tokens_1.AAVE.address, uniswapEthToken, tokens_1.USDC.address], [3000, 3000]);
const uniswapAaveWbtcPath = uniswap_1.encodeUniswapPath([tokens_1.AAVE.address, uniswapEthToken, tokens_1.WBTC.address], [3000, 3000]);
const uniswapAaveGusdPath = uniswap_1.encodeUniswapPath([tokens_1.AAVE.address, uniswapEthToken, tokens_1.GUSD.address], [3000, 3000]);
context("Liquidator forked network tests", () => {
    let ops;
    let governor;
    let stkAaveWhale;
    let ethWhale;
    let musdWhale;
    let delayedProxyAdmin;
    let aaveIncentivesController;
    let aaveToken;
    let aaveStakedToken;
    let compToken;
    let creamToken;
    let musdToken;
    let uniswapQuoter;
    async function runSetup(blockNumber) {
        await hardhat_1.network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber,
                    },
                },
            ],
        });
        ops = await fork_1.impersonateAccount(opsAddress);
        stkAaveWhale = await fork_1.impersonateAccount(stkAaveWhaleAddress);
        governor = await fork_1.impersonateAccount(governorAddress);
        ethWhale = await fork_1.impersonateAccount(ethWhaleAddress);
        musdWhale = await fork_1.impersonateAccount(musdWhaleAddress);
        // send some Ether to the impersonated multisig contract as it doesn't have Ether
        await ethWhale.signer.sendTransaction({
            to: governorAddress,
            value: math_1.simpleToExactAmount(10),
        });
        delayedProxyAdmin = generated_1.DelayedProxyAdmin__factory.connect(delayedAdminAddress, governor.signer);
        aaveIncentivesController = generated_1.IAaveIncentivesController__factory.connect(aaveIncentivesControllerAddress, ops.signer);
        uniswapQuoter = generated_1.IUniswapV3Quoter__factory.connect(uniswapQuoterV3Address, ops.signer);
        aaveToken = generated_1.ERC20__factory.connect(tokens_1.AAVE.address, ops.signer);
        aaveStakedToken = AaveStakedTokenV2__factory_1.AaveStakedTokenV2__factory.connect(tokens_1.stkAAVE.address, stkAaveWhale.signer);
        compToken = generated_1.ERC20__factory.connect(tokens_1.COMP.address, ops.signer);
        creamToken = generated_1.ERC20__factory.connect(tokens_1.CREAM.address, ops.signer);
        musdToken = generated_1.ERC20__factory.connect(tokens_1.mUSD.address, ops.signer);
    }
    it("Test connectivity", async () => {
        const currentBlock = await hardhat_1.ethers.provider.getBlockNumber();
        console.log(`Current block ${currentBlock}`);
    });
    context.skip("Staked Aave rewards", () => {
        before("reset block number", async () => {
            await runSetup(12493000);
        });
        context("claim Aave rewards from stkAave", () => {
            before(async () => {
                const coolDownStartTimestamp = await aaveStakedToken.stakersCooldowns(stkAaveWhaleAddress);
                const coolDownStart = new Date(coolDownStartTimestamp.mul(1000).toNumber());
                console.log(`stkAave whale cool down start timestamp ${coolDownStartTimestamp}, ${coolDownStart}`);
                const currentBlock = await ops.signer.provider.getBlock("latest");
                const currentBlockDate = new Date(currentBlock.timestamp * 1000);
                console.log(`Current block ${currentBlock.number}, timestamp ${currentBlock.timestamp}, ${currentBlockDate}`);
            });
            after(async () => {
                const coolDownStartTimestamp = await aaveStakedToken.stakersCooldowns(stkAaveWhaleAddress);
                const coolDownStart = new Date(coolDownStartTimestamp.mul(1000).toNumber());
                console.log(`stkAave whale cool down start timestamp ${coolDownStartTimestamp}, ${coolDownStart}`);
                const currentBlock = await ops.signer.provider.getBlock("latest");
                const currentBlockDate = new Date(currentBlock.timestamp * 1000);
                console.log(`Current block ${currentBlock.number}, timestamp ${currentBlock.timestamp}, ${currentBlockDate}`);
            });
            it("Fail to claim more Aave than total rewards", async () => {
                const unclaimedRewards = await aaveStakedToken.stakerRewardsToClaim(stkAaveWhaleAddress);
                const totalRewards = await aaveStakedToken.getTotalRewardsBalance(stkAaveWhaleAddress);
                console.log(`Rewards unclaimed ${utils_1.formatUnits(unclaimedRewards)}, total ${utils_1.formatUnits(totalRewards)}`);
                chai_1.expect(unclaimedRewards, "unclaimed rewards <= total rewards").to.lte(totalRewards);
                const tx = aaveStakedToken.claimRewards(stkAaveWhaleAddress, totalRewards.add(math_1.simpleToExactAmount(1)));
                await chai_1.expect(tx).to.revertedWith("INVALID_AMOUNT");
                chai_1.expect(await aaveStakedToken.getTotalRewardsBalance(stkAaveWhaleAddress)).to.eq(totalRewards);
            });
            it("Succeed to claim > claimable rewards < total rewards", async () => {
                const aaveBalanceBefore = await aaveToken.balanceOf(stkAaveWhaleAddress);
                const unclaimedRewards = await aaveStakedToken.stakerRewardsToClaim(stkAaveWhaleAddress);
                const totalRewards = await aaveStakedToken.getTotalRewardsBalance(stkAaveWhaleAddress);
                const newUnclaimedAmount = math_1.simpleToExactAmount(100);
                const claimAmount = totalRewards.sub(newUnclaimedAmount);
                console.log(`Rewards unclaimed ${utils_1.formatUnits(unclaimedRewards)}, total ${utils_1.formatUnits(totalRewards)}, claim amount ${utils_1.formatUnits(claimAmount)}, new unclaimed amount ${utils_1.formatUnits(newUnclaimedAmount)}`);
                chai_1.expect(claimAmount, "claim amount > rewards unclaimed").to.gt(unclaimedRewards);
                chai_1.expect(claimAmount, "claim amount < rewards total").to.lt(totalRewards);
                chai_1.expect(await aaveStakedToken.stakersCooldowns(stkAaveWhaleAddress), "cool down not activated").to.eq(0);
                const tx = await aaveStakedToken.claimRewards(stkAaveWhaleAddress, claimAmount);
                const receipt = await tx.wait();
                chai_1.expect(await aaveToken.balanceOf(stkAaveWhaleAddress), "aave tokens = before balance + claim amount").to.eq(aaveBalanceBefore.add(claimAmount));
                chai_1.expect(await aaveStakedToken.stakerRewardsToClaim(stkAaveWhaleAddress), "new unclaimed rewards").to.eq(newUnclaimedAmount);
                const totalRewardsAfter = await aaveStakedToken.getTotalRewardsBalance(stkAaveWhaleAddress);
                chai_1.expect(totalRewardsAfter, "total rewards = total before - claim amount").to.eq(totalRewards.sub(claimAmount));
                chai_1.expect(totalRewardsAfter, "total rewards = new unclaimed amount").to.eq(newUnclaimedAmount);
                chai_1.expect(await aaveStakedToken.stakersCooldowns(stkAaveWhaleAddress), "cool down not activated").to.eq(0);
            });
            it("Succeed to claim all total rewards", async () => {
                const aaveBalanceBefore = await aaveToken.balanceOf(stkAaveWhaleAddress);
                const unclaimedRewards = await aaveStakedToken.stakerRewardsToClaim(stkAaveWhaleAddress);
                const totalRewards = await aaveStakedToken.getTotalRewardsBalance(stkAaveWhaleAddress);
                console.log(`Rewards unclaimed ${utils_1.formatUnits(unclaimedRewards)}, total ${utils_1.formatUnits(totalRewards)}`);
                chai_1.expect(unclaimedRewards).to.eq(totalRewards);
                await aaveStakedToken.claimRewards(stkAaveWhaleAddress, totalRewards);
                chai_1.expect(await aaveToken.balanceOf(stkAaveWhaleAddress), "aave tokens = before balance + claim amount").to.eq(aaveBalanceBefore.add(totalRewards));
                chai_1.expect(await aaveStakedToken.stakerRewardsToClaim(stkAaveWhaleAddress), "no more unclaimed rewards").to.eq(0);
                chai_1.expect(await aaveStakedToken.getTotalRewardsBalance(stkAaveWhaleAddress), "no more total rewards").to.eq(0);
                chai_1.expect(await aaveStakedToken.stakersCooldowns(stkAaveWhaleAddress), "cool down not activated").to.eq(0);
            });
            // TODO why is no Aave accrued?
            it("Waiting a week does not accrue more Aave rewards", async () => {
                chai_1.expect(await aaveStakedToken.balanceOf(stkAaveWhaleAddress), ">90k stkAave").to.gt(math_1.simpleToExactAmount(90000));
                await time_1.increaseTime(constants_1.ONE_WEEK);
                chai_1.expect(await aaveStakedToken.stakerRewardsToClaim(stkAaveWhaleAddress), "no unclaimed rewards").to.eq(0);
                chai_1.expect(await aaveStakedToken.getTotalRewardsBalance(stkAaveWhaleAddress), "no total rewards").to.eq(0);
                chai_1.expect(await aaveStakedToken.stakersCooldowns(stkAaveWhaleAddress), "cool down not activated").to.eq(0);
            });
            context.skip("redeem stkAave", () => {
                let stkAaveAmount;
                const remainingStakeAmount = math_1.simpleToExactAmount(10);
                const remainingStakeAmount2 = math_1.simpleToExactAmount(2);
                before(async () => {
                    stkAaveAmount = await aaveStakedToken.balanceOf(stkAaveWhaleAddress);
                });
                it("Fail to redeem remaining stkAave before cool down", async () => {
                    chai_1.expect(stkAaveAmount, "some stkAave before").to.gt(0);
                    chai_1.expect(await aaveStakedToken.stakerRewardsToClaim(stkAaveWhaleAddress), "no unclaimed rewards").to.eq(0);
                    chai_1.expect(await aaveStakedToken.getTotalRewardsBalance(stkAaveWhaleAddress), "no total rewards").to.eq(0);
                    chai_1.expect(await aaveStakedToken.stakersCooldowns(stkAaveWhaleAddress), "cool down not activated").to.eq(0);
                    const tx = aaveStakedToken.redeem(tokens_1.stkAAVE.address, stkAaveAmount);
                    await chai_1.expect(tx).to.revertedWith("UNSTAKE_WINDOW_FINISHED");
                });
                it("Activate cool down", async () => {
                    const tx = await aaveStakedToken.cooldown();
                    const receipt = await tx.wait();
                    const coolDownBlock = await ops.signer.provider.getBlock(receipt.blockNumber);
                    chai_1.expect(await aaveStakedToken.stakersCooldowns(stkAaveWhaleAddress), "cool down activated").to.eq(coolDownBlock.timestamp);
                    chai_1.expect(await aaveStakedToken.COOLDOWN_SECONDS(), "Cool down is 10 days in seconds").to.eq(10 * 24 * 60 * 60);
                    chai_1.expect(await aaveStakedToken.stakerRewardsToClaim(stkAaveWhaleAddress), "no unclaimed rewards").to.eq(0);
                    chai_1.expect(await aaveStakedToken.getTotalRewardsBalance(stkAaveWhaleAddress), "no total rewards").to.eq(0);
                });
                it("Fail to redeem staked Aave after 9 day from cool down", async () => {
                    // increment 9 days
                    const nineDays = constants_1.ONE_DAY.mul(9);
                    await time_1.increaseTime(nineDays);
                    chai_1.expect(await aaveStakedToken.stakerRewardsToClaim(stkAaveWhaleAddress), "no unclaimed rewards").to.eq(0);
                    chai_1.expect(await aaveStakedToken.getTotalRewardsBalance(stkAaveWhaleAddress), "no total rewards").to.eq(0);
                    const currentBlock = await ops.signer.provider.getBlock("latest");
                    const coolDownStartTimestamp = await aaveStakedToken.stakersCooldowns(stkAaveWhaleAddress);
                    const coolDownSeconds = await aaveStakedToken.COOLDOWN_SECONDS();
                    chai_1.expect(currentBlock.timestamp, "block time < cool down start + cool down seconds").to.lt(coolDownStartTimestamp.add(coolDownSeconds));
                    chai_1.expect(currentBlock.timestamp, "Current timestamp is 9 days since cool down start").to.eq(coolDownStartTimestamp.add(nineDays));
                    const tx = aaveStakedToken.redeem(stkAaveWhaleAddress, stkAaveAmount);
                    await chai_1.expect(tx).to.revertedWith("INSUFFICIENT_COOLDOWN");
                });
                it("Can redeem staked Aave after 11 days from cool down", async () => {
                    // previously moved 9 days ahead so need to move 1 day to get to 10 days
                    await time_1.increaseTime(constants_1.ONE_DAY);
                    const aaveBalanceBefore = await aaveToken.balanceOf(stkAaveWhaleAddress);
                    chai_1.expect(await aaveStakedToken.stakerRewardsToClaim(stkAaveWhaleAddress), "no unclaimed rewards").to.eq(0);
                    chai_1.expect(await aaveStakedToken.getTotalRewardsBalance(stkAaveWhaleAddress), "no total rewards").to.eq(0);
                    const redeemAmount = stkAaveAmount.sub(remainingStakeAmount);
                    await aaveStakedToken.redeem(stkAaveWhaleAddress, redeemAmount);
                    chai_1.expect(await aaveStakedToken.balanceOf(stkAaveWhaleAddress), "stkAave after = remaining amount").to.eq(remainingStakeAmount);
                    chai_1.expect(await aaveToken.balanceOf(stkAaveWhaleAddress), "Aave after = before + redeem amount").to.eq(aaveBalanceBefore.add(redeemAmount));
                });
                it("Can redeem more Aave in 2 day unstaked window", async () => {
                    await time_1.increaseTime(constants_1.ONE_DAY);
                    chai_1.expect(await aaveStakedToken.stakerRewardsToClaim(stkAaveWhaleAddress), "no unclaimed rewards").to.eq(0);
                    chai_1.expect(await aaveStakedToken.getTotalRewardsBalance(stkAaveWhaleAddress), "no total rewards").to.eq(0);
                    const redeemAmount = remainingStakeAmount.sub(remainingStakeAmount2);
                    await aaveStakedToken.redeem(stkAaveWhaleAddress, redeemAmount);
                    chai_1.expect(await aaveStakedToken.balanceOf(stkAaveWhaleAddress)).to.eq(remainingStakeAmount2);
                });
                it("Failed to redeem remaining stkAave after 2 day unstake window", async () => {
                    // unstake window is 2 days
                    await time_1.increaseTime(constants_1.ONE_DAY.mul(2));
                    const tx = aaveStakedToken.redeem(tokens_1.stkAAVE.address, remainingStakeAmount2);
                    await chai_1.expect(tx).to.revertedWith("UNSTAKE_WINDOW_FINISHED");
                    chai_1.expect(await aaveStakedToken.balanceOf(stkAaveWhaleAddress)).to.eq(remainingStakeAmount2);
                });
            });
            context.skip("stake Aave", () => {
                const stakeAmount = math_1.simpleToExactAmount(95000);
                it("stake some Aave", async () => {
                    const aaveBalanceBefore = await aaveToken.balanceOf(stkAaveWhaleAddress);
                    const stkAaveBalanceBefore = await aaveStakedToken.balanceOf(stkAaveWhaleAddress);
                    console.log(`Before stake: ${utils_1.formatUnits(aaveBalanceBefore)} Aave, ${utils_1.formatUnits(stkAaveBalanceBefore)} stkAave`);
                    await aaveToken.connect(stkAaveWhale.signer).approve(tokens_1.stkAAVE.address, stakeAmount);
                    await aaveStakedToken.stake(stkAaveWhaleAddress, stakeAmount);
                    chai_1.expect(await aaveToken.balanceOf(stkAaveWhaleAddress), "aave balance after = before - staked Aave amount").to.eq(aaveBalanceBefore.sub(stakeAmount));
                    chai_1.expect(await aaveStakedToken.balanceOf(stkAaveWhaleAddress), "stkAave balance = before balance + staked Aave amount").to.eq(stkAaveBalanceBefore.add(stakeAmount));
                    chai_1.expect(await aaveStakedToken.stakerRewardsToClaim(stkAaveWhaleAddress), "no unclaimed rewards").to.eq(0);
                    chai_1.expect(await aaveStakedToken.getTotalRewardsBalance(stkAaveWhaleAddress), "no total rewards").to.eq(0);
                    chai_1.expect(await aaveStakedToken.stakersCooldowns(stkAaveWhaleAddress), "cool down not activated").to.eq(0);
                });
                it("Waiting 10 weeks does to accrue Aave rewards", async () => {
                    chai_1.expect(await aaveStakedToken.balanceOf(stkAaveWhaleAddress), ">90k stkAave").to.gte(stakeAmount);
                    // increment 2 weeks
                    await time_1.increaseTime(constants_1.ONE_WEEK.mul(10));
                    // TODO what aren't Aave rewards accrued for staking? Maybe an Aave accrual tx needs to be run.
                    chai_1.expect(await aaveStakedToken.stakerRewardsToClaim(stkAaveWhaleAddress), "no unclaimed rewards").to.eq(0);
                    chai_1.expect(await aaveStakedToken.getTotalRewardsBalance(stkAaveWhaleAddress), "no total rewards").to.eq(0);
                    chai_1.expect(await aaveStakedToken.stakersCooldowns(stkAaveWhaleAddress), "cool down not activated").to.eq(0);
                });
                it("Activate cool down", async () => {
                    const tx = await aaveStakedToken.cooldown();
                    const receipt = await tx.wait();
                    chai_1.expect(await aaveStakedToken.stakerRewardsToClaim(stkAaveWhaleAddress), "no unclaimed rewards").to.eq(0);
                    chai_1.expect(await aaveStakedToken.getTotalRewardsBalance(stkAaveWhaleAddress), "no total rewards").to.eq(0);
                    const coolDownBlock = await ops.signer.provider.getBlock(receipt.blockNumber);
                    chai_1.expect(await aaveStakedToken.stakersCooldowns(stkAaveWhaleAddress), "cool down activated").to.eq(coolDownBlock.timestamp);
                    chai_1.expect(await aaveStakedToken.COOLDOWN_SECONDS(), "Cool down is 10 days in seconds").to.eq(10 * 24 * 60 * 60);
                });
                it("Can not redeem staked Aave after 1 day from cool down", async () => {
                    // increment 1 day
                    await time_1.increaseTime(constants_1.ONE_DAY);
                    chai_1.expect(await aaveStakedToken.stakerRewardsToClaim(stkAaveWhaleAddress), "no unclaimed rewards").to.eq(0);
                    chai_1.expect(await aaveStakedToken.getTotalRewardsBalance(stkAaveWhaleAddress), "no total rewards").to.eq(0);
                    const currentBlock = await ops.signer.provider.getBlock("latest");
                    const coolDownStartTimestamp = await aaveStakedToken.stakersCooldowns(stkAaveWhaleAddress);
                    const coolDownSeconds = await aaveStakedToken.COOLDOWN_SECONDS();
                    chai_1.expect(currentBlock.timestamp, "block time < cool down start + cool down seconds").to.lt(coolDownStartTimestamp.add(coolDownSeconds));
                    chai_1.expect(currentBlock.timestamp, "Current timestamp is 1 day since cool down start").to.eq(coolDownStartTimestamp.add(constants_1.ONE_DAY));
                    const tx = aaveStakedToken.redeem(stkAaveWhaleAddress, stakeAmount);
                    await chai_1.expect(tx).to.revertedWith("INSUFFICIENT_COOLDOWN");
                });
                it("Can over redeem staked Aave after 11 days from cool down", async () => {
                    // previously moved 1 day ahead so need to move 10 days to get to 11 days
                    await time_1.increaseTime(constants_1.ONE_DAY.mul(10));
                    chai_1.expect(await aaveStakedToken.stakerRewardsToClaim(stkAaveWhaleAddress), "no unclaimed rewards").to.eq(0);
                    chai_1.expect(await aaveStakedToken.getTotalRewardsBalance(stkAaveWhaleAddress), "no total rewards").to.eq(0);
                    // Redeem 10 times the balance of the stkAave
                    await aaveStakedToken.redeem(stkAaveWhaleAddress, stakeAmount.mul(10));
                });
            });
            context.skip("Claim more rewards from Aave incentives", () => {
                const firstClaimAmount = math_1.simpleToExactAmount(2);
                const secondClaimAmount = math_1.simpleToExactAmount(4);
                let firstCoolDownAmount;
                it("Claim incentives rewards", async () => {
                    const stkAaveBalanceBefore = await aaveStakedToken.balanceOf(stkAaveWhaleAddress);
                    const unclaimedRewardsBefore = await aaveIncentivesController.getUserUnclaimedRewards(stkAaveWhaleAddress);
                    const rewardsBalanceBefore = await aaveIncentivesController.getRewardsBalance(aTokens, stkAaveWhaleAddress);
                    chai_1.expect(unclaimedRewardsBefore, "unclaimed rewards = total rewards").to.eq(rewardsBalanceBefore);
                    console.log(`aaveIncentivesController.unclaimedRewardsBefore ${utils_1.formatUnits(unclaimedRewardsBefore)}`);
                    console.log(`aaveIncentivesController.rewardsBalanceBefore ${utils_1.formatUnits(rewardsBalanceBefore)}`);
                    await aaveIncentivesController.connect(stkAaveWhale.signer).claimRewards(aTokens, firstClaimAmount, stkAaveWhaleAddress);
                    firstCoolDownAmount = stkAaveBalanceBefore.add(firstClaimAmount);
                    chai_1.expect(await aaveStakedToken.balanceOf(stkAaveWhaleAddress), "stkAave after = before + claim amount").to.eq(firstCoolDownAmount);
                    chai_1.expect(await aaveIncentivesController.getUserUnclaimedRewards(stkAaveWhaleAddress), "unclaimed after = total rewards before - claim amount").to.eq(rewardsBalanceBefore.sub(firstClaimAmount));
                    chai_1.expect(await aaveIncentivesController.getRewardsBalance(aTokens, stkAaveWhaleAddress), "total rewards after = total rewards before - claim amount").to.eq(rewardsBalanceBefore.sub(firstClaimAmount));
                    // No Aave rewards have been accrued yet for the stkAave
                    chai_1.expect(await aaveStakedToken.stakerRewardsToClaim(stkAaveWhaleAddress), "stkAave unclaimed rewards").to.eq(0);
                    chai_1.expect(await aaveStakedToken.getTotalRewardsBalance(stkAaveWhaleAddress), "stkAave total rewards").to.eq(0);
                });
                it("Waiting 1 week does to accrue Aave rewards", async () => {
                    // increment 2 weeks
                    await time_1.increaseTime(constants_1.ONE_WEEK);
                    // TODO what aren't Aave rewards accrued for staking? Maybe an Aave accrual tx needs to be run.
                    chai_1.expect(await aaveStakedToken.stakerRewardsToClaim(stkAaveWhaleAddress), "no unclaimed rewards").to.eq(0);
                    chai_1.expect(await aaveStakedToken.getTotalRewardsBalance(stkAaveWhaleAddress), "no total rewards").to.eq(0);
                });
                it("Activate cool down", async () => {
                    const tx = await aaveStakedToken.cooldown();
                    const receipt = await tx.wait();
                    const coolDownBlock = await ops.signer.provider.getBlock(receipt.blockNumber);
                    chai_1.expect(await aaveStakedToken.stakersCooldowns(stkAaveWhaleAddress), "cool down activated").to.eq(coolDownBlock.timestamp);
                    chai_1.expect(await aaveStakedToken.COOLDOWN_SECONDS(), "Cool down is 10 days in seconds").to.eq(10 * 24 * 60 * 60);
                });
                it("Claim more stkAave from incentives controller", async () => {
                    const stkAaveBalanceBefore = await aaveStakedToken.balanceOf(stkAaveWhaleAddress);
                    // increment 8 days
                    await time_1.increaseTime(constants_1.ONE_DAY.mul(8));
                    const tx = await aaveIncentivesController
                        .connect(stkAaveWhale.signer)
                        .claimRewards(aTokens, secondClaimAmount, stkAaveWhaleAddress);
                    chai_1.expect(await aaveStakedToken.balanceOf(stkAaveWhaleAddress), "stkAave after = before + second claim amount").to.eq(stkAaveBalanceBefore.add(secondClaimAmount));
                    const receipt = await tx.wait();
                    const coolDownBlock = await ops.signer.provider.getBlock(receipt.blockNumber);
                    // stkAave already cooled = first cool down amount * seconds passed / cool down seconds
                    const stkAaveAlreadyCooled = firstCoolDownAmount.mul(8).div(10);
                    // seconds already cooled of new amount = stkAave already cooled / (first cool down amount + second claim amount) * cool down seconds
                    const secondsAlreadyCooled = stkAaveAlreadyCooled
                        .mul(10 * 24 * 60 * 60)
                        .div(firstCoolDownAmount.add(secondClaimAmount))
                        .add(1);
                    // new cool down start = now - seconds already cooled off
                    chai_1.expect(await aaveStakedToken.stakersCooldowns(stkAaveWhaleAddress), "new weight average cool down timestamp").to.eq(math_1.BN.from(coolDownBlock.timestamp).sub(secondsAlreadyCooled));
                });
                it("Fail to redeem staked Aave after 11 days from first cool down", async () => {
                    await time_1.increaseTime(constants_1.ONE_DAY.mul(3));
                    const tx = aaveStakedToken.redeem(stkAaveWhaleAddress, firstClaimAmount.add(secondClaimAmount));
                    await chai_1.expect(tx).to.revertedWith("INSUFFICIENT_COOLDOWN");
                });
                it("Successfully redeem Aave after 5 more days", async () => {
                    await time_1.increaseTime(constants_1.ONE_DAY.mul(5));
                    await aaveStakedToken.redeem(stkAaveWhaleAddress, firstClaimAmount.add(secondClaimAmount));
                    chai_1.expect(await aaveStakedToken.stakersCooldowns(stkAaveWhaleAddress), "cool down timestamp reset").to.eq(0);
                });
                it("Successfully claim more incentives after unstake window", async () => {
                    await time_1.increaseTime(constants_1.ONE_DAY.mul(3));
                    await aaveIncentivesController.connect(stkAaveWhale.signer).claimRewards(aTokens, firstClaimAmount, stkAaveWhaleAddress);
                    chai_1.expect(await aaveStakedToken.balanceOf(stkAaveWhaleAddress), "some stkAave exists").to.gt(0);
                    chai_1.expect(await aaveStakedToken.stakersCooldowns(stkAaveWhaleAddress)).to.eq(0);
                });
            });
        });
    });
    context("Aave liquidation", () => {
        let liquidator;
        before("reset block number", async () => {
            await runSetup(12510100);
        });
        it("Deploy and upgrade new liquidator contract", async () => {
            // Deploy the new implementation
            const liquidatorImpl = await deploy_utils_1.deployContract(new generated_1.Liquidator__factory(ops.signer), "Liquidator", [
                nexusAddress,
                tokens_1.stkAAVE.address,
                tokens_1.AAVE.address,
                uniswapRouterV3Address,
                uniswapQuoterV3Address,
                tokens_1.COMP.address,
            ]);
            // Update the Liquidator proxy to point to the new implementation using the delayed proxy admin
            const data = liquidatorImpl.interface.encodeFunctionData("upgrade");
            await delayedProxyAdmin.proposeUpgrade(liquidatorAddress, liquidatorImpl.address, data);
            await time_1.increaseTime(constants_1.ONE_WEEK.add(60));
            await delayedProxyAdmin.acceptUpgradeRequest(liquidatorAddress);
            // Connect to the proxy with the Liquidator ABI
            liquidator = generated_1.Liquidator__factory.connect(liquidatorAddress, ops.signer);
            chai_1.expect(await liquidator.nexus(), "nexus address").to.eq(nexusAddress);
            chai_1.expect(await liquidator.uniswapRouter(), "Uniswap address").to.eq(uniswapRouterV3Address);
            chai_1.expect(await liquidator.uniswapQuoter(), "Uniswap address").to.eq(uniswapQuoterV3Address);
            chai_1.expect(await liquidator.aaveToken(), "Aave address").to.eq(tokens_1.AAVE.address);
            chai_1.expect(await liquidator.stkAave(), "Staked Aave address").to.eq(tokens_1.stkAAVE.address);
            chai_1.expect(await liquidator.compToken(), "COMP address").to.eq(tokens_1.COMP.address);
        });
        it("Added liquidation for mUSD Aave integration", async () => {
            await liquidator
                .connect(governor.signer)
                .createLiquidation(aaveMusdIntegrationAddress, tokens_1.AAVE.address, tokens_1.USDC.address, uniswapAaveUsdcPath.encoded, uniswapAaveUsdcPath.encodedReversed, 0, math_1.simpleToExactAmount(50, tokens_1.USDC.decimals), tokens_1.mUSD.address, true);
        });
        it("Added liquidation for mBTC Aave integration", async () => {
            await liquidator
                .connect(governor.signer)
                .createLiquidation(aaveMbtcIntegrationAddress, tokens_1.AAVE.address, tokens_1.WBTC.address, uniswapAaveWbtcPath.encoded, uniswapAaveWbtcPath.encodedReversed, 0, math_1.simpleToExactAmount(2, tokens_1.WBTC.decimals - 3), tokens_1.mBTC.address, true);
        });
        it.skip("Added liquidation for GUSD Feeder Pool Aave integration", async () => {
            await liquidator
                .connect(governor.signer)
                .createLiquidation(tokens_1.GUSD.integrator, tokens_1.AAVE.address, tokens_1.GUSD.address, uniswapAaveGusdPath.encoded, uniswapAaveGusdPath.encodedReversed, 0, math_1.simpleToExactAmount(50, tokens_1.GUSD.decimals), constants_1.ZERO_ADDRESS, true);
        });
        it("Claim stkAave from each integration contract", async () => {
            const aaveBalanceBefore = await aaveStakedToken.balanceOf(liquidatorAddress);
            await liquidator.claimStakedAave();
            chai_1.expect(await aaveStakedToken.balanceOf(liquidatorAddress), "Liquidator's stkAave increased").gt(aaveBalanceBefore);
        });
        it("Fail to claim stkAave again before liquidation", async () => {
            const tx = liquidator.claimStakedAave();
            await chai_1.expect(tx).revertedWith("Last claim cooldown not ended");
        });
        it("trigger liquidation of Aave after 11 days", async () => {
            await time_1.increaseTime(constants_1.ONE_DAY.mul(11));
            chai_1.expect(await aaveStakedToken.balanceOf(liquidatorAddress), "Liquidator has some stkAave before").gt(0);
            chai_1.expect(await aaveToken.balanceOf(liquidatorAddress), "Liquidator has no Aave before").eq(0);
            await liquidator.triggerLiquidationAave();
            chai_1.expect(await aaveStakedToken.balanceOf(liquidatorAddress), "Liquidator has no stkAave after").eq(0);
            chai_1.expect(await aaveToken.balanceOf(liquidatorAddress), "Liquidator has no Aave after").eq(0);
        });
        it("Fail to trigger liquidation of Aave again", async () => {
            const tx = liquidator.triggerLiquidationAave();
            await chai_1.expect(tx).revertedWith("Must claim before liquidation");
        });
    });
    context("Aave liquidation", () => {
        let liquidator;
        before("reset block number", async () => {
            await runSetup(12510100);
        });
        it("Deploy and upgrade new liquidator contract", async () => {
            // Deploy the new implementation
            const liquidatorImpl = await deploy_utils_1.deployContract(new generated_1.Liquidator__factory(ops.signer), "Liquidator", [
                nexusAddress,
                tokens_1.stkAAVE.address,
                tokens_1.AAVE.address,
                uniswapRouterV3Address,
                uniswapQuoterV3Address,
                tokens_1.COMP.address,
            ]);
            // Update the Liquidator proxy to point to the new implementation using the delayed proxy admin
            const data = liquidatorImpl.interface.encodeFunctionData("upgrade");
            await delayedProxyAdmin.proposeUpgrade(liquidatorAddress, liquidatorImpl.address, data);
            await time_1.increaseTime(constants_1.ONE_WEEK.add(60));
            await delayedProxyAdmin.acceptUpgradeRequest(liquidatorAddress);
            // Connect to the proxy with the Liquidator ABI
            liquidator = generated_1.Liquidator__factory.connect(liquidatorAddress, ops.signer);
        });
        it("Added liquidation for mUSD Aave integration", async () => {
            await liquidator
                .connect(governor.signer)
                .createLiquidation(aaveMusdIntegrationAddress, tokens_1.AAVE.address, tokens_1.USDC.address, uniswapAaveUsdcPath.encoded, uniswapAaveUsdcPath.encodedReversed, 0, math_1.simpleToExactAmount(50, tokens_1.USDC.decimals), tokens_1.mUSD.address, true);
        });
        it("Claim stkAave from each integration contract", async () => {
            const totalAaveClaimedBefore = await liquidator.totalAaveBalance();
            chai_1.expect(totalAaveClaimedBefore, "totalAaveBalance before").to.eq(0);
            const aaveBalanceBefore = await aaveStakedToken.balanceOf(liquidatorAddress);
            await liquidator.claimStakedAave();
            const liquidatorStkAaveBalance = await aaveStakedToken.balanceOf(liquidatorAddress);
            chai_1.expect(liquidatorStkAaveBalance, "Liquidator's stkAave increased").gt(aaveBalanceBefore);
            chai_1.expect(await liquidator.totalAaveBalance(), "totalAaveBalance after").to.eq(liquidatorStkAaveBalance);
        });
        it("Fail to claim stkAave during cool down period", async () => {
            const tx = liquidator.claimStakedAave();
            await chai_1.expect(tx).revertedWith("Last claim cooldown not ended");
        });
        it("Fail to claim stkAave during unstake period", async () => {
            // Move time past the 10 day cooldown period
            await time_1.increaseTime(constants_1.ONE_DAY.mul(10).add(60));
            const tx = liquidator.claimStakedAave();
            await chai_1.expect(tx).revertedWith("Must liquidate last claim");
        });
        it("Fail to trigger liquidation of Aave after cooldown and unstake periods", async () => {
            // Move time past the 2 day unstake period
            await time_1.increaseTime(constants_1.ONE_DAY.mul(3));
            const tx = liquidator.triggerLiquidationAave();
            await chai_1.expect(tx).revertedWith("UNSTAKE_WINDOW_FINISHED");
        });
        it("Claim stkAave again after unstake period", async () => {
            const aaveBalanceBefore = await aaveStakedToken.balanceOf(liquidatorAddress);
            await liquidator.claimStakedAave();
            chai_1.expect(await aaveStakedToken.balanceOf(liquidatorAddress), "Liquidator's stkAave has increased").gt(aaveBalanceBefore);
        });
        it("trigger liquidation of Aave after 11 days", async () => {
            await time_1.increaseTime(constants_1.ONE_DAY.mul(11));
            chai_1.expect(await aaveStakedToken.balanceOf(liquidatorAddress), "Liquidator has some stkAave before").gt(0);
            chai_1.expect(await aaveToken.balanceOf(liquidatorAddress), "Liquidator has no Aave before").eq(0);
            await liquidator.triggerLiquidationAave();
            chai_1.expect(await aaveStakedToken.balanceOf(liquidatorAddress), "Liquidator has no stkAave after").eq(0);
            chai_1.expect(await aaveToken.balanceOf(liquidatorAddress), "Liquidator has no Aave after").eq(0);
        });
        it("Claim stkAave after liquidation", async () => {
            const aaveBalanceBefore = await aaveStakedToken.balanceOf(liquidatorAddress);
            await liquidator.claimStakedAave();
            chai_1.expect(await aaveStakedToken.balanceOf(liquidatorAddress), "Liquidator's stkAave increased").gt(aaveBalanceBefore);
        });
    });
    context("Compound liquidation", () => {
        let liquidator;
        before("reset block number", async () => {
            await runSetup(12545500);
            liquidator = generated_1.Liquidator__factory.connect(liquidatorAddress, ops.signer);
        });
        it("Read functions before upgrade", async () => {
            chai_1.expect(await liquidator.nexus(), "nexus address").to.eq(nexusAddress);
        });
        it("Liquidate COMP before upgrade", async () => {
            await time_1.increaseTime(constants_1.ONE_WEEK);
            const compBalanceBefore = await compToken.balanceOf(liquidatorAddress);
            await liquidator.triggerLiquidation(compoundIntegrationAddress);
            chai_1.expect(await compToken.balanceOf(liquidatorAddress), "Less COMP").lt(compBalanceBefore);
        });
        it("Deploy and upgrade new liquidator contract", async () => {
            // Deploy the new implementation
            const liquidatorImpl = await deploy_utils_1.deployContract(new generated_1.Liquidator__factory(ops.signer), "Liquidator", [
                nexusAddress,
                tokens_1.stkAAVE.address,
                tokens_1.AAVE.address,
                uniswapRouterV3Address,
                uniswapQuoterV3Address,
                tokens_1.COMP.address,
            ]);
            // Update the Liquidator proxy to point to the new implementation using the delayed proxy admin
            const data = liquidatorImpl.interface.encodeFunctionData("upgrade");
            await delayedProxyAdmin.proposeUpgrade(liquidatorAddress, liquidatorImpl.address, data);
            await time_1.increaseTime(constants_1.ONE_WEEK.add(60));
            await delayedProxyAdmin.acceptUpgradeRequest(liquidatorAddress);
            // Connect to the proxy with the Liquidator ABI
            liquidator = generated_1.Liquidator__factory.connect(liquidatorAddress, ops.signer);
            // Public immutable values
            chai_1.expect(await liquidator.nexus(), "nexus address").to.eq(nexusAddress);
            chai_1.expect(await liquidator.uniswapRouter(), "Uniswap address").to.eq(uniswapRouterV3Address);
            chai_1.expect(await liquidator.uniswapQuoter(), "Uniswap address").to.eq(uniswapQuoterV3Address);
            chai_1.expect(await liquidator.aaveToken(), "Aave address").to.eq(tokens_1.AAVE.address);
            chai_1.expect(await liquidator.stkAave(), "Staked Aave address").to.eq(tokens_1.stkAAVE.address);
            chai_1.expect(await liquidator.compToken(), "COMP address").to.eq(tokens_1.COMP.address);
        });
        it("Added liquidation for mUSD Compound integration", async () => {
            const data = liquidator.interface.encodeFunctionData("createLiquidation", [
                compoundIntegrationAddress,
                tokens_1.COMP.address,
                tokens_1.USDC.address,
                uniswapCompUsdcPaths.encoded,
                uniswapCompUsdcPaths.encodedReversed,
                math_1.simpleToExactAmount(20000, tokens_1.USDC.decimals),
                math_1.simpleToExactAmount(100, tokens_1.USDC.decimals),
                tokens_1.mUSD.address,
                false,
            ]);
            console.log(`createLiquidation data for COMP: ${data}`);
            await liquidator
                .connect(governor.signer)
                .createLiquidation(compoundIntegrationAddress, tokens_1.COMP.address, tokens_1.USDC.address, uniswapCompUsdcPaths.encoded, uniswapCompUsdcPaths.encodedReversed, math_1.simpleToExactAmount(20000, tokens_1.USDC.decimals), math_1.simpleToExactAmount(100, tokens_1.USDC.decimals), tokens_1.mUSD.address, false);
        });
        it("Uniswap quoteExactOutputSingle for COMP to ETH", async () => {
            const expectedSwapInput = await uniswapQuoter.callStatic.quoteExactOutputSingle(tokens_1.COMP.address, uniswapEthToken, 3000, math_1.simpleToExactAmount(8), 0);
            chai_1.expect(expectedSwapInput).to.gt(math_1.simpleToExactAmount(40));
            chai_1.expect(expectedSwapInput).to.lt(math_1.simpleToExactAmount(60));
        });
        it("Uniswap quoteExactOutputSingle for ETH to USDC", async () => {
            const expectedSwapInput = await uniswapQuoter.callStatic.quoteExactOutputSingle(uniswapEthToken, tokens_1.USDC.address, 3000, math_1.simpleToExactAmount(20000, tokens_1.USDC.decimals), 0);
            chai_1.expect(expectedSwapInput).to.gt(math_1.simpleToExactAmount(7));
            chai_1.expect(expectedSwapInput).to.lt(math_1.simpleToExactAmount(8));
        });
        it("Uniswap quoteExactInput for COMP to ETH", async () => {
            const expectedSwapInput = await uniswapQuoter.callStatic.quoteExactInput(uniswap_1.encodeUniswapPath([tokens_1.COMP.address, uniswapEthToken], [3000]).encoded, math_1.simpleToExactAmount(50));
            console.log(`50 COMP input to swap for ${utils_1.formatUnits(expectedSwapInput)} ETH`);
            chai_1.expect(expectedSwapInput).to.gt(math_1.simpleToExactAmount(7));
            chai_1.expect(expectedSwapInput).to.lt(math_1.simpleToExactAmount(9));
        });
        it("Uniswap quoteExactInput for ETH to USDC", async () => {
            const expectedSwapInput = await uniswapQuoter.callStatic.quoteExactInput(uniswap_1.encodeUniswapPath([uniswapEthToken, tokens_1.USDC.address], [3000]).encoded, math_1.simpleToExactAmount(8));
            console.log(`8 WETH input to swap for ${utils_1.formatUnits(expectedSwapInput)} USDC`);
            chai_1.expect(expectedSwapInput, "output > 19k USDC").to.gt(math_1.simpleToExactAmount(19000, tokens_1.USDC.decimals));
            chai_1.expect(expectedSwapInput, "output < 22k USDC").to.lt(math_1.simpleToExactAmount(22000, tokens_1.USDC.decimals));
        });
        it("Uniswap quoteExactOutput for COMP to ETH", async () => {
            const expectedSwapInput = await uniswapQuoter.callStatic.quoteExactOutput(uniswap_1.encodeUniswapPath([uniswapEthToken, tokens_1.COMP.address], [3000]).encoded, math_1.simpleToExactAmount(8));
            console.log(`${(utils_1.formatUnits(expectedSwapInput), tokens_1.COMP.decimals)} COMP input to swap for 8 ETH`);
            chai_1.expect(expectedSwapInput, "input > 40 COMP").to.gt(math_1.simpleToExactAmount(40));
            chai_1.expect(expectedSwapInput, "input < 60 COMP").to.lt(math_1.simpleToExactAmount(60));
        });
        it("Uniswap quoteExactOutput for ETH to USDC", async () => {
            const expectedSwapInput = await uniswapQuoter.callStatic.quoteExactOutput(uniswap_1.encodeUniswapPath([tokens_1.USDC.address, uniswapEthToken], [3000]).encoded, math_1.simpleToExactAmount(20000, tokens_1.USDC.decimals));
            chai_1.expect(expectedSwapInput, "input > 7 WETH").to.gt(math_1.simpleToExactAmount(7));
            chai_1.expect(expectedSwapInput, "input < 8 WETH").to.lt(math_1.simpleToExactAmount(8));
        });
        it("Uniswap quoteExactOutput for COMP to USDC", async () => {
            const expectedSwapInput = await uniswapQuoter.callStatic.quoteExactOutput(uniswap_1.encodeUniswapPath([tokens_1.USDC.address, uniswapEthToken, tokens_1.COMP.address], [3000, 3000]).encoded, math_1.simpleToExactAmount(20000, tokens_1.USDC.decimals));
            chai_1.expect(expectedSwapInput, "input > 40 COMP").to.gt(math_1.simpleToExactAmount(40));
            chai_1.expect(expectedSwapInput, "input < 60 COMP").to.lt(math_1.simpleToExactAmount(60));
        });
        it("Liquidate COMP after upgrade", async () => {
            await time_1.increaseTime(constants_1.ONE_WEEK);
            const compBalanceBefore = await compToken.balanceOf(liquidatorAddress);
            await liquidator.triggerLiquidation(compoundIntegrationAddress);
            chai_1.expect(await compToken.balanceOf(liquidatorAddress), "Less COMP").lt(compBalanceBefore);
        });
    });
    context("Iron Bank CREAM liquidation", () => {
        let liquidator;
        let gusdFp;
        let busdFp;
        before("reset block number", async () => {
            await runSetup(12540000);
            liquidator = generated_1.Liquidator__factory.connect(liquidatorAddress, ops.signer);
            gusdFp = generated_1.FeederPool__factory.connect(tokens_1.GUSD.feederPool, governor.signer);
            busdFp = generated_1.FeederPool__factory.connect(tokens_1.BUSD.feederPool, governor.signer);
        });
        it("migrate mUSD to Iron Bank for the GUSD Feeder Pool", async () => {
            // Before migrate checks
            const musdInGusdBefore = await musdToken.balanceOf(tokens_1.GUSD.feederPool);
            chai_1.expect(musdInGusdBefore, "Some mUSD in GUSD FP before").to.gt(0);
            chai_1.expect(await musdToken.balanceOf(gusdIronBankIntegrationAddress), "no mUSD in Iron Bank integration before").to.eq(0);
            const musdInIronBankBefore = await musdToken.balanceOf(tokens_1.cyMUSD.address);
            console.log(`mUSD in Iron Bank ${utils_1.formatUnits(musdInIronBankBefore)} and GUSD Feeder Pool ${utils_1.formatUnits(musdInGusdBefore)} before`);
            await gusdFp.migrateBassets([tokens_1.mUSD.address], gusdIronBankIntegrationAddress);
            // After migrate checks
            const musdInIronBankIntegrationAfter = await musdToken.balanceOf(gusdIronBankIntegrationAddress);
            console.log(`mUSD in Iron Bank ${utils_1.formatUnits(musdInIronBankIntegrationAfter)} after`);
            chai_1.expect(await musdToken.balanceOf(tokens_1.GUSD.feederPool), "no mUSD in GUSD FP after").to.eq(0);
            chai_1.expect(await musdToken.balanceOf(tokens_1.cyMUSD.address), "no more mUSD in Iron Bank after").to.eq(musdInIronBankBefore);
            chai_1.expect(await musdToken.balanceOf(gusdIronBankIntegrationAddress), "mUSD moved to Iron Bank integration after").to.eq(musdInGusdBefore);
        });
        it("Swap mUSD for GUSD", async () => {
            const musdInIronBankBefore = await musdToken.balanceOf(tokens_1.cyMUSD.address);
            const musdInIntegrationBefore = await musdToken.balanceOf(gusdIronBankIntegrationAddress);
            const swapInput = math_1.simpleToExactAmount(1000);
            await musdToken.connect(musdWhale.signer).approve(gusdFp.address, swapInput);
            await gusdFp.connect(musdWhale.signer).swap(tokens_1.mUSD.address, tokens_1.GUSD.address, swapInput, 0, ops.address);
            chai_1.expect(await musdToken.balanceOf(tokens_1.cyMUSD.address), "more mUSD in Iron Bank after").to.gt(musdInIronBankBefore);
            chai_1.expect(await musdToken.balanceOf(gusdIronBankIntegrationAddress), "less mUSD in Integration after").to.lt(musdInIntegrationBefore);
        });
        it("migrate mUSD to Iron Bank for the BUSD Feeder Pool", async () => {
            const musdBalanceBefore = await musdToken.balanceOf(tokens_1.BUSD.feederPool);
            chai_1.expect(musdBalanceBefore).to.gt(0);
            await busdFp.migrateBassets([tokens_1.mUSD.address], busdIronBankIntegrationAddress);
            chai_1.expect(await musdToken.balanceOf(tokens_1.BUSD.feederPool)).to.eq(0);
        });
        it("Governor approves the liquidator to transfer CREAM from integration contracts", async () => {
            const gusdIronBankIntegration = generated_1.CompoundIntegration__factory.connect(gusdIronBankIntegrationAddress, governor.signer);
            await gusdIronBankIntegration.approveRewardToken();
            const busdIronBankIntegration = generated_1.CompoundIntegration__factory.connect(busdIronBankIntegrationAddress, governor.signer);
            await busdIronBankIntegration.approveRewardToken();
        });
        it("Deploy and upgrade new liquidator contract", async () => {
            // Deploy the new implementation
            const liquidatorImpl = await deploy_utils_1.deployContract(new generated_1.Liquidator__factory(ops.signer), "Liquidator", [
                nexusAddress,
                tokens_1.stkAAVE.address,
                tokens_1.AAVE.address,
                uniswapRouterV3Address,
                uniswapQuoterV3Address,
                tokens_1.COMP.address,
            ]);
            // Update the Liquidator proxy to point to the new implementation using the delayed proxy admin
            const data = liquidatorImpl.interface.encodeFunctionData("upgrade");
            await delayedProxyAdmin.proposeUpgrade(liquidatorAddress, liquidatorImpl.address, data);
            await time_1.increaseTime(constants_1.ONE_WEEK.add(60));
            await delayedProxyAdmin.acceptUpgradeRequest(liquidatorAddress);
            // Connect to the proxy with the Liquidator ABI
            liquidator = generated_1.Liquidator__factory.connect(liquidatorAddress, ops.signer);
            // Public immutable values
            chai_1.expect(await liquidator.nexus(), "nexus address").to.eq(nexusAddress);
            chai_1.expect(await liquidator.uniswapRouter(), "Uniswap address").to.eq(uniswapRouterV3Address);
            chai_1.expect(await liquidator.uniswapQuoter(), "Uniswap address").to.eq(uniswapQuoterV3Address);
            chai_1.expect(await liquidator.aaveToken(), "AAVE address").to.eq(tokens_1.AAVE.address);
            chai_1.expect(await liquidator.stkAave(), "Staked Aave address").to.eq(tokens_1.stkAAVE.address);
            chai_1.expect(await liquidator.compToken(), "COMP address").to.eq(tokens_1.COMP.address);
        });
        it("Added liquidation of CREAM from GUSD and BUSD Feeder Pool integrations to Iron Bank", async () => {
            let uniswapPathCreamGusd = uniswap_1.encodeUniswapPath([tokens_1.CREAM.address, uniswapEthToken, tokens_1.GUSD.address], [3000, 3000]);
            await liquidator
                .connect(governor.signer)
                .createLiquidation(gusdIronBankIntegrationAddress, tokens_1.CREAM.address, tokens_1.GUSD.address, uniswapPathCreamGusd.encoded, uniswapPathCreamGusd.encodedReversed, 0, math_1.simpleToExactAmount(50, tokens_1.GUSD.decimals), constants_1.ZERO_ADDRESS, false);
            uniswapPathCreamGusd = uniswap_1.encodeUniswapPath([tokens_1.CREAM.address, uniswapEthToken, tokens_1.BUSD.address], [3000, 3000]);
            await liquidator
                .connect(governor.signer)
                .createLiquidation(busdIronBankIntegrationAddress, tokens_1.CREAM.address, tokens_1.BUSD.address, uniswapPathCreamGusd.encoded, uniswapPathCreamGusd.encodedReversed, 0, math_1.simpleToExactAmount(50, tokens_1.BUSD.decimals), constants_1.ZERO_ADDRESS, false);
        });
        it.skip("Liquidate CREAM after upgrade for GUSD", async () => {
            await time_1.increaseTime(constants_1.ONE_WEEK);
            const creamBalanceBefore = await creamToken.balanceOf(liquidatorAddress);
            await liquidator.triggerLiquidation(gusdIronBankIntegrationAddress);
            chai_1.expect(await creamToken.balanceOf(liquidatorAddress), "Less CREAM").lt(creamBalanceBefore);
        });
        it.skip("Liquidate CREAM after upgrade for BUSD", async () => {
            const creamBalanceBefore = await creamToken.balanceOf(liquidatorAddress);
            await liquidator.triggerLiquidation(busdIronBankIntegrationAddress);
            chai_1.expect(await creamToken.balanceOf(liquidatorAddress), "Less CREAM").lt(creamBalanceBefore);
        });
    });
    context("Negative tests", () => {
        let liquidator;
        before("reset block number", async () => {
            await runSetup(12500000);
            liquidator = generated_1.Liquidator__factory.connect(liquidatorAddress, ops.signer);
            // Deploy the new implementation
            const liquidatorImpl = await deploy_utils_1.deployContract(new generated_1.Liquidator__factory(ops.signer), "Liquidator", [
                nexusAddress,
                tokens_1.stkAAVE.address,
                tokens_1.AAVE.address,
                uniswapRouterV3Address,
                uniswapQuoterV3Address,
                tokens_1.COMP.address,
            ]);
            // Update the Liquidator proxy to point to the new implementation using the delayed proxy admin
            const data = liquidatorImpl.interface.encodeFunctionData("upgrade");
            await delayedProxyAdmin.proposeUpgrade(liquidatorAddress, liquidatorImpl.address, data);
            await time_1.increaseTime(constants_1.ONE_WEEK.add(60));
            await delayedProxyAdmin.acceptUpgradeRequest(liquidatorAddress);
            // Connect to the proxy with the Liquidator ABI
            liquidator = generated_1.Liquidator__factory.connect(liquidatorAddress, ops.signer);
        });
        it("Fail to call upgrade again", async () => {
            const tx = liquidator.upgrade();
            await chai_1.expect(tx).revertedWith("SafeERC20: approve from non-zero to non-zero allowance");
        });
        it("short Uniswap path", async () => {
            const path = uniswap_1.encodeUniswapPath([tokens_1.AAVE.address], []);
            const tx = liquidator
                .connect(governor.signer)
                .createLiquidation(aaveMusdIntegrationAddress, tokens_1.AAVE.address, tokens_1.USDC.address, path.encoded, path.encodedReversed, 0, math_1.simpleToExactAmount(50, tokens_1.USDC.decimals), tokens_1.mUSD.address, true);
            await chai_1.expect(tx).revertedWith("Uniswap path too short");
        });
        it("reversed Uniswap path", async () => {
            const tx = liquidator
                .connect(governor.signer)
                .createLiquidation(aaveMusdIntegrationAddress, tokens_1.AAVE.address, tokens_1.USDC.address, uniswapAaveUsdcPath.encodedReversed, uniswapAaveUsdcPath.encoded, 0, math_1.simpleToExactAmount(50, tokens_1.USDC.decimals), tokens_1.mUSD.address, true);
            await chai_1.expect(tx).revertedWith("Invalid uniswap path");
        });
        it("Added liquidation for mUSD Aave integration", async () => {
            await liquidator
                .connect(governor.signer)
                .createLiquidation(aaveMusdIntegrationAddress, tokens_1.AAVE.address, tokens_1.USDC.address, uniswapAaveUsdcPath.encoded, uniswapAaveUsdcPath.encodedReversed, 0, math_1.simpleToExactAmount(50, tokens_1.USDC.decimals), tokens_1.mUSD.address, true);
        });
        it("Fail to add duplicate liquidation", async () => {
            const tx = liquidator
                .connect(governor.signer)
                .createLiquidation(aaveMusdIntegrationAddress, tokens_1.AAVE.address, tokens_1.USDC.address, uniswapAaveUsdcPath.encoded, uniswapAaveUsdcPath.encodedReversed, 0, math_1.simpleToExactAmount(50, tokens_1.USDC.decimals), tokens_1.mUSD.address, true);
            await chai_1.expect(tx).revertedWith("Liquidation already exists");
        });
    });
});
//# sourceMappingURL=liquidator.spec.js.map