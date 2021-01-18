/* eslint-disable no-nested-ternary */
/* eslint-disable no-await-in-loop */

import * as t from "types/generated";
import { expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { StandardAccounts, SystemMachine } from "@utils/machines";
import { assertBNClose, assertBNSlightlyGT, assertBNClosePercent } from "@utils/assertions";
import { simpleToExactAmount } from "@utils/math";
import { BN, fromWei } from "@utils/tools";
import { ONE_WEEK, ONE_DAY, FIVE_DAYS, fullScale, ZERO_ADDRESS } from "@utils/constants";
import envSetup from "@utils/env_setup";

const { expect } = envSetup.configure();

const MockERC20 = artifacts.require("MockERC20");
const SavingsVault = artifacts.require("BoostedSavingsVault");
const MockStakingContract = artifacts.require("MockStakingContract");
const MockProxy = artifacts.require("MockProxy");

interface StakingBalance {
    raw: BN;
    balance: BN;
    totalSupply: BN;
}

interface TokenBalance {
    sender: BN;
    contract: BN;
}

interface UserData {
    rewardPerTokenPaid: BN;
    rewards: BN;
    lastAction: BN;
    rewardCount: number;
    userClaim: BN;
}
interface ContractData {
    rewardPerTokenStored: BN;
    rewardRate: BN;
    lastUpdateTime: BN;
    lastTimeRewardApplicable: BN;
    periodFinishTime: BN;
}
interface Reward {
    start: BN;
    finish: BN;
    rate: BN;
}

interface StakingData {
    boostBalance: StakingBalance;
    tokenBalance: TokenBalance;
    vMTABalance: BN;
    userData: UserData;
    userRewards: Reward[];
    contractData: ContractData;
}

contract("SavingsVault", async (accounts) => {
    const recipientCtx: {
        recipient?: t.RewardsDistributionRecipientInstance;
    } = {};
    const moduleCtx: {
        module?: t.ModuleInstance;
    } = {};

    const sa = new StandardAccounts(accounts);
    let systemMachine: SystemMachine;
    const rewardsDistributor = sa.fundManager;

    let rewardToken: t.MockERC20Instance;
    let imUSD: t.MockERC20Instance;
    let savingsVault: t.BoostedSavingsVaultInstance;
    let stakingContract: t.MockStakingContractInstance;

    const minBoost = simpleToExactAmount(5, 17);
    const maxBoost = simpleToExactAmount(15, 17);
    const coeff = 60;
    const lockupPeriod = ONE_WEEK.muln(26);

    const boost = (raw: BN, boostAmt: BN): BN => {
        return raw.mul(boostAmt).div(fullScale);
    };

    const calcBoost = (raw: BN, vMTA: BN): BN => {
        // min(d + c * vMTA^a / imUSD^b, m)
        if (raw.lt(simpleToExactAmount(1, 18))) return minBoost;

        let denom = parseFloat(fromWei(raw.divn(10)));
        denom **= 0.875;
        return BN.min(
            minBoost.add(
                vMTA
                    .muln(coeff)
                    .divn(10)
                    .mul(fullScale)
                    .div(simpleToExactAmount(denom)),
            ),
            maxBoost,
        );
    };

    const unlockedRewards = (total: BN): BN => {
        return total.divn(5);
    };

    const lockedRewards = (total: BN): BN => {
        return total.divn(5).muln(4);
    };

    const redeployRewards = async (
        nexusAddress = systemMachine.nexus.address,
    ): Promise<t.BoostedSavingsVaultInstance> => {
        rewardToken = await MockERC20.new("Reward", "RWD", 18, rewardsDistributor, 10000000);
        imUSD = await MockERC20.new("Interest bearing mUSD", "imUSD", 18, sa.default, 1000000);
        stakingContract = await MockStakingContract.new();

        const proxy = await MockProxy.new();
        const impl = await SavingsVault.new();
        const data: string = impl.contract.methods
            .initialize(
                nexusAddress,
                imUSD.address,
                stakingContract.address,
                rewardToken.address,
                rewardsDistributor,
            )
            .encodeABI();
        await proxy.methods["initialize(address,address,bytes)"](impl.address, sa.dummy4, data);
        return SavingsVault.at(proxy.address);
    };

    const snapshotStakingData = async (
        sender = sa.default,
        beneficiary = sa.default,
    ): Promise<StakingData> => {
        const userData = await savingsVault.userData(beneficiary);
        const userRewards = [];
        for (let i = 0; i < userData[3].toNumber(); i += 1) {
            const e = await savingsVault.userRewards(beneficiary, i);
            userRewards.push({
                start: e[0],
                finish: e[1],
                rate: e[2],
            });
        }
        return {
            boostBalance: {
                raw: await savingsVault.rawBalanceOf(beneficiary),
                balance: await savingsVault.balanceOf(beneficiary),
                totalSupply: await savingsVault.totalSupply(),
            },
            tokenBalance: {
                sender: await imUSD.balanceOf(sender),
                contract: await imUSD.balanceOf(savingsVault.address),
            },
            vMTABalance: await stakingContract.balanceOf(beneficiary),
            userData: {
                rewardPerTokenPaid: userData[0],
                rewards: userData[1],
                lastAction: userData[2],
                rewardCount: userData[3].toNumber(),
                userClaim: await savingsVault.userClaim(beneficiary),
            },
            userRewards,
            contractData: {
                rewardPerTokenStored: await savingsVault.rewardPerTokenStored(),
                rewardRate: await savingsVault.rewardRate(),
                lastUpdateTime: await savingsVault.lastUpdateTime(),
                lastTimeRewardApplicable: await savingsVault.lastTimeRewardApplicable(),
                periodFinishTime: await savingsVault.periodFinish(),
            },
        };
    };

    before(async () => {
        systemMachine = new SystemMachine(sa.all);
        await systemMachine.initialiseMocks(false, false);
        savingsVault = await redeployRewards();
        recipientCtx.recipient = (savingsVault as unknown) as t.RewardsDistributionRecipientInstance;
        moduleCtx.module = savingsVault as t.ModuleInstance;
    });

    describe("constructor & settings", async () => {
        before(async () => {
            savingsVault = await redeployRewards();
        });
        it("should set all initial state", async () => {
            // Set in constructor
            expect(await savingsVault.nexus(), systemMachine.nexus.address);
            expect(await savingsVault.stakingToken(), imUSD.address);
            expect(await savingsVault.stakingContract(), stakingContract.address);
            expect(await savingsVault.rewardsToken(), rewardToken.address);
            expect(await savingsVault.rewardsDistributor(), rewardsDistributor);

            // Basic storage
            expect(await savingsVault.totalSupply()).bignumber.eq(new BN(0));
            expect(await savingsVault.periodFinish()).bignumber.eq(new BN(0));
            expect(await savingsVault.rewardRate()).bignumber.eq(new BN(0));
            expect(await savingsVault.lastUpdateTime()).bignumber.eq(new BN(0));
            expect(await savingsVault.rewardPerTokenStored()).bignumber.eq(new BN(0));
            expect(await savingsVault.lastTimeRewardApplicable()).bignumber.eq(new BN(0));
            expect(await savingsVault.rewardPerToken()).bignumber.eq(new BN(0));
        });
    });

    /**
     * @dev Ensures the reward units are assigned correctly, based on the last update time, etc
     * @param beforeData Snapshot after the tx
     * @param afterData Snapshot after the tx
     * @param isExistingStaker Expect the staker to be existing?
     */
    const assertRewardsAssigned = async (
        beforeData: StakingData,
        afterData: StakingData,
        isExistingStaker: boolean,
        shouldResetRewards = false,
    ): Promise<void> => {
        const timeAfter = await time.latest();
        const periodIsFinished = new BN(timeAfter).gt(beforeData.contractData.periodFinishTime);
        //    LastUpdateTime
        expect(
            periodIsFinished
                ? beforeData.contractData.periodFinishTime
                : beforeData.contractData.rewardPerTokenStored.eqn(0) &&
                  beforeData.boostBalance.totalSupply.eqn(0)
                ? beforeData.contractData.lastUpdateTime
                : timeAfter,
        ).bignumber.eq(afterData.contractData.lastUpdateTime);
        //    RewardRate doesnt change
        expect(beforeData.contractData.rewardRate).bignumber.eq(afterData.contractData.rewardRate);
        //    RewardPerTokenStored goes up
        expect(afterData.contractData.rewardPerTokenStored).bignumber.gte(
            beforeData.contractData.rewardPerTokenStored as any,
        );
        //      Calculate exact expected 'rewardPerToken' increase since last update
        const timeApplicableToRewards = periodIsFinished
            ? beforeData.contractData.periodFinishTime.sub(beforeData.contractData.lastUpdateTime)
            : timeAfter.sub(beforeData.contractData.lastUpdateTime);
        const increaseInRewardPerToken = beforeData.boostBalance.totalSupply.eq(new BN(0))
            ? new BN(0)
            : beforeData.contractData.rewardRate
                  .mul(timeApplicableToRewards)
                  .mul(fullScale)
                  .div(beforeData.boostBalance.totalSupply);
        expect(
            beforeData.contractData.rewardPerTokenStored.add(increaseInRewardPerToken),
        ).bignumber.eq(afterData.contractData.rewardPerTokenStored);
        // Expect updated personal state
        //    userRewardPerTokenPaid(beneficiary) should update
        expect(afterData.userData.rewardPerTokenPaid).bignumber.eq(
            afterData.userData.rewardPerTokenPaid,
        );

        const increaseInUserRewardPerToken = afterData.contractData.rewardPerTokenStored.sub(
            beforeData.userData.rewardPerTokenPaid,
        );
        const assignment = beforeData.boostBalance.balance
            .mul(increaseInUserRewardPerToken)
            .div(fullScale);
        //    If existing staker, then rewards Should increase
        if (shouldResetRewards) {
            expect(afterData.userData.rewards).bignumber.eq(new BN(0));
        } else if (isExistingStaker) {
            // rewards(beneficiary) should update with previously accrued tokens
            expect(beforeData.userData.rewards.add(unlockedRewards(assignment))).bignumber.eq(
                afterData.userData.rewards,
            );
        } else {
            // else `rewards` should stay the same
            expect(beforeData.userData.rewards).bignumber.eq(afterData.userData.rewards);
        }

        // If existing staker, then a new entry should be appended
        const newRewards = afterData.contractData.rewardPerTokenStored.gt(
            beforeData.userData.rewardPerTokenPaid,
        );
        if (isExistingStaker && newRewards) {
            const newLockEntry = afterData.userRewards[afterData.userData.rewardCount - 1];
            expect(newLockEntry.start).bignumber.eq(
                beforeData.userData.lastAction.add(lockupPeriod),
            );
            expect(newLockEntry.finish).bignumber.eq(
                afterData.userData.lastAction.add(lockupPeriod),
            );
            const elapsed = afterData.userData.lastAction.sub(beforeData.userData.lastAction);
            expect(newLockEntry.rate).bignumber.eq(lockedRewards(assignment).div(elapsed));
            expect(afterData.userData.lastAction).bignumber.eq(timeAfter);
        } else {
            expect(beforeData.userRewards.length).eq(afterData.userRewards.length);
            expect(beforeData.userData.rewardCount).eq(afterData.userData.rewardCount);
            expect(afterData.userData.lastAction).bignumber.eq(timeAfter);
            expect(beforeData.userData.userClaim).bignumber.eq(afterData.userData.userClaim);
        }
    };

    /**
     * @dev Ensures a stake is successful, updates the rewards for the beneficiary and
     * collects the stake
     * @param stakeAmount Exact units to stake
     * @param sender Sender of the tx
     * @param beneficiary Beneficiary of the stake
     * @param confirmExistingStaker Expect the staker to be existing?
     */
    const expectSuccessfulStake = async (
        stakeAmount: BN,
        sender = sa.default,
        beneficiary = sa.default,
        confirmExistingStaker = false,
    ): Promise<void> => {
        // 1. Get data from the contract
        const senderIsBeneficiary = sender === beneficiary;
        const beforeData = await snapshotStakingData(sender, beneficiary);

        const isExistingStaker = beforeData.boostBalance.raw.gt(new BN(0));
        if (confirmExistingStaker) {
            expect(isExistingStaker).eq(true);
        }
        // 2. Approve staking token spending and send the TX
        await imUSD.approve(savingsVault.address, stakeAmount, {
            from: sender,
        });
        const tx = await (senderIsBeneficiary
            ? savingsVault.methods["stake(uint256)"](stakeAmount, {
                  from: sender,
              })
            : savingsVault.methods["stake(address,uint256)"](beneficiary, stakeAmount, {
                  from: sender,
              }));
        expectEvent(tx.receipt, "Staked", {
            user: beneficiary,
            amount: stakeAmount,
            payer: sender,
        });

        // 3. Ensure rewards are accrued to the beneficiary
        const afterData = await snapshotStakingData(sender, beneficiary);
        const expectedBoost = boost(
            afterData.boostBalance.raw,
            calcBoost(afterData.boostBalance.raw, afterData.vMTABalance),
        );
        await assertRewardsAssigned(beforeData, afterData, isExistingStaker);

        // 4. Expect token transfer
        //    StakingToken balance of sender
        expect(beforeData.tokenBalance.sender.sub(stakeAmount)).bignumber.eq(
            afterData.tokenBalance.sender,
        );
        //    StakingToken balance of StakingRewards
        expect(beforeData.tokenBalance.contract.add(stakeAmount)).bignumber.eq(
            afterData.tokenBalance.contract,
        );
        //    TotalSupply of StakingRewards
        expect(
            beforeData.boostBalance.totalSupply
                .sub(beforeData.boostBalance.balance)
                .add(expectedBoost),
        ).bignumber.eq(afterData.boostBalance.totalSupply);
    };

    /**
     * @dev Ensures a funding is successful, checking that it updates the rewardRate etc
     * @param rewardUnits Number of units to stake
     */
    const expectSuccesfulFunding = async (rewardUnits: BN): Promise<void> => {
        const beforeData = await snapshotStakingData();
        const tx = await savingsVault.notifyRewardAmount(rewardUnits, {
            from: rewardsDistributor,
        });
        expectEvent(tx.receipt, "RewardAdded", { reward: rewardUnits });

        const cur = new BN(await time.latest());
        const leftOverRewards = beforeData.contractData.rewardRate.mul(
            beforeData.contractData.periodFinishTime.sub(
                beforeData.contractData.lastTimeRewardApplicable,
            ),
        );
        const afterData = await snapshotStakingData();

        // Sets lastTimeRewardApplicable to latest
        expect(cur).bignumber.eq(afterData.contractData.lastTimeRewardApplicable);
        // Sets lastUpdateTime to latest
        expect(cur).bignumber.eq(afterData.contractData.lastUpdateTime);
        // Sets periodFinish to 1 week from now
        expect(cur.add(ONE_WEEK)).bignumber.eq(afterData.contractData.periodFinishTime);
        // Sets rewardRate to rewardUnits / ONE_WEEK
        if (leftOverRewards.gtn(0)) {
            const total = rewardUnits.add(leftOverRewards);
            assertBNClose(
                total.div(ONE_WEEK),
                afterData.contractData.rewardRate,
                beforeData.contractData.rewardRate.div(ONE_WEEK).muln(5), // the effect of 1 second on the future scale
            );
        } else {
            expect(rewardUnits.div(ONE_WEEK)).bignumber.eq(afterData.contractData.rewardRate);
        }
    };

    /**
     * @dev Makes a withdrawal from the contract, and ensures that resulting state is correct
     * and the rewards have been applied
     * @param withdrawAmount Exact amount to withdraw
     * @param sender User to execute the tx
     */
    const expectStakingWithdrawal = async (
        withdrawAmount: BN,
        sender = sa.default,
    ): Promise<void> => {
        // 1. Get data from the contract
        const beforeData = await snapshotStakingData(sender);
        const isExistingStaker = beforeData.boostBalance.raw.gt(new BN(0));
        expect(isExistingStaker).eq(true);
        expect(withdrawAmount).bignumber.gte(beforeData.boostBalance.raw as any);

        // 2. Send withdrawal tx
        const tx = await savingsVault.withdraw(withdrawAmount, {
            from: sender,
        });
        expectEvent(tx.receipt, "Withdrawn", {
            user: sender,
            amount: withdrawAmount,
        });

        // 3. Expect Rewards to accrue to the beneficiary
        //    StakingToken balance of sender
        const afterData = await snapshotStakingData(sender);
        await assertRewardsAssigned(beforeData, afterData, isExistingStaker);

        // 4. Expect token transfer
        //    StakingToken balance of sender
        expect(beforeData.tokenBalance.sender.add(withdrawAmount)).bignumber.eq(
            afterData.tokenBalance.sender,
        );
        //    Withdraws from the actual rewards wrapper token
        expect(beforeData.boostBalance.raw.sub(withdrawAmount)).bignumber.eq(
            afterData.boostBalance.raw,
        );
        //    Updates total supply
        expect(
            beforeData.boostBalance.totalSupply
                .sub(beforeData.boostBalance.balance)
                .add(afterData.boostBalance.balance),
        ).bignumber.eq(afterData.boostBalance.totalSupply);
    };

    context("initialising and staking in a new pool", () => {
        describe("notifying the pool of reward", () => {
            it("should begin a new period through", async () => {
                const rewardUnits = simpleToExactAmount(1, 18);
                await expectSuccesfulFunding(rewardUnits);
            });
        });
        describe("staking in the new period", () => {
            it("should assign rewards to the staker", async () => {
                // Do the stake
                const rewardRate = await savingsVault.rewardRate();
                const stakeAmount = simpleToExactAmount(100, 18);
                const boosted = boost(stakeAmount, minBoost);
                await expectSuccessfulStake(stakeAmount);
                expect(boosted).bignumber.eq(await savingsVault.balanceOf(sa.default));

                await time.increase(ONE_DAY);

                // This is the total reward per staked token, since the last update
                const rewardPerToken = await savingsVault.rewardPerToken();
                const rewardPerSecond = rewardRate.mul(fullScale).div(boosted);
                assertBNClose(
                    rewardPerToken,
                    ONE_DAY.mul(rewardPerSecond),
                    rewardPerSecond.muln(10),
                );

                // Calc estimated unclaimed reward for the user
                // earned == balance * (rewardPerToken-userExistingReward)
                const earned = await savingsVault.earned(sa.default);
                expect(unlockedRewards(boosted.mul(rewardPerToken).div(fullScale))).bignumber.eq(
                    earned,
                );

                await stakingContract.setBalanceOf(sa.default, simpleToExactAmount(1, 21));
                await savingsVault.pokeBoost(sa.default);
            });
            it("should update stakers rewards after consequent stake", async () => {
                const stakeAmount = simpleToExactAmount(100, 18);
                // This checks resulting state after second stake
                await expectSuccessfulStake(stakeAmount, sa.default, sa.default, true);
            });

            it("should fail if stake amount is 0", async () => {
                await expectRevert(
                    savingsVault.methods["stake(uint256)"](0, { from: sa.default }),
                    "Cannot stake 0",
                );
            });
            it("should fail if beneficiary is empty", async () => {
                await expectRevert(
                    savingsVault.methods["stake(address,uint256)"](ZERO_ADDRESS, 1, {
                        from: sa.default,
                    }),
                    "Invalid beneficiary address",
                );
            });

            it("should fail if staker has insufficient balance", async () => {
                await imUSD.approve(savingsVault.address, 1, { from: sa.dummy2 });
                await expectRevert(
                    savingsVault.methods["stake(uint256)"](1, { from: sa.dummy2 }),
                    "SafeERC20: low-level call failed",
                );
            });
        });
    });
    context("funding with too much rewards", () => {
        before(async () => {
            savingsVault = await redeployRewards();
        });
        it("should fail", async () => {
            await expectRevert(
                savingsVault.notifyRewardAmount(simpleToExactAmount(1, 25), {
                    from: sa.fundManager,
                }),
                "Cannot notify with more than a million units",
            );
        });
    });
    context("staking before rewards are added", () => {
        before(async () => {
            savingsVault = await redeployRewards();
        });
        it("should assign no rewards", async () => {
            // Get data before
            const stakeAmount = simpleToExactAmount(100, 18);
            const beforeData = await snapshotStakingData();
            expect(beforeData.contractData.rewardRate).bignumber.eq(new BN(0));
            expect(beforeData.contractData.rewardPerTokenStored).bignumber.eq(new BN(0));
            expect(beforeData.userData.rewards).bignumber.eq(new BN(0));
            expect(beforeData.boostBalance.totalSupply).bignumber.eq(new BN(0));
            expect(beforeData.contractData.lastTimeRewardApplicable).bignumber.eq(new BN(0));

            // Do the stake
            await expectSuccessfulStake(stakeAmount);

            // Wait a day
            await time.increase(ONE_DAY);

            // Do another stake
            await expectSuccessfulStake(stakeAmount);

            // Get end results
            const afterData = await snapshotStakingData();
            expect(afterData.contractData.rewardRate).bignumber.eq(new BN(0));
            expect(afterData.contractData.rewardPerTokenStored).bignumber.eq(new BN(0));
            expect(afterData.userData.rewards).bignumber.eq(new BN(0));
            expect(afterData.boostBalance.totalSupply).bignumber.eq(stakeAmount);
            expect(afterData.contractData.lastTimeRewardApplicable).bignumber.eq(new BN(0));
        });
    });

    context("calculating a users boost", async () => {
        beforeEach(async () => {
            savingsVault = await redeployRewards();
        });
        describe("when saving and with staking balance", () => {
            it("should calculate boost for 10k imUSD stake and 250 vMTA", async () => {
                const deposit = simpleToExactAmount(10000);
                const stake = simpleToExactAmount(250, 18);
                const expectedBoost = simpleToExactAmount(15000);

                await expectSuccessfulStake(deposit);
                await stakingContract.setBalanceOf(sa.default, stake);
                await savingsVault.pokeBoost(sa.default);

                const balance = await savingsVault.balanceOf(sa.default);
                expect(balance).bignumber.eq(expectedBoost);
                expect(boost(deposit, calcBoost(deposit, stake))).bignumber.eq(expectedBoost);

                const ratio = await savingsVault.getBoost(sa.default);
                expect(ratio).bignumber.eq(maxBoost);
            });
            it("should calculate boost for 10k imUSD stake and 50 vMTA", async () => {
                const deposit = simpleToExactAmount(10000, 18);
                const stake = simpleToExactAmount(50, 18);
                const expectedBoost = simpleToExactAmount(12110, 18);

                await expectSuccessfulStake(deposit);
                await stakingContract.setBalanceOf(sa.default, stake);
                await savingsVault.pokeBoost(sa.default);

                const balance = await savingsVault.balanceOf(sa.default);
                assertBNClosePercent(balance, expectedBoost, "1");
                assertBNClosePercent(
                    boost(deposit, calcBoost(deposit, stake)),
                    expectedBoost,
                    "0.1",
                );
                const ratio = await savingsVault.getBoost(sa.default);
                assertBNClosePercent(ratio, simpleToExactAmount(1.211, 18), "0.1");
            });
            it("should calculate boost for 100k imUSD stake and 500 vMTA", async () => {
                const deposit = simpleToExactAmount(100000, 18);
                const stake = simpleToExactAmount(500, 18);
                const expectedBoost = simpleToExactAmount(144900, 18);

                await expectSuccessfulStake(deposit);
                await stakingContract.setBalanceOf(sa.default, stake);
                await savingsVault.pokeBoost(sa.default);

                const balance = await savingsVault.balanceOf(sa.default);
                assertBNClosePercent(balance, expectedBoost, "1");
                assertBNClosePercent(
                    boost(deposit, calcBoost(deposit, stake)),
                    expectedBoost,
                    "0.1",
                );

                const ratio = await savingsVault.getBoost(sa.default);
                assertBNClosePercent(ratio, simpleToExactAmount(1.449, 18), "0.1");
            });
        });
        describe("when saving with low staking balance and high vMTA", () => {
            it("should give no boost due to below min threshold", async () => {
                const deposit = simpleToExactAmount(5, 17);
                const stake = simpleToExactAmount(800, 18);
                const expectedBoost = simpleToExactAmount(25, 16);

                await expectSuccessfulStake(deposit);
                await stakingContract.setBalanceOf(sa.default, stake);
                await savingsVault.pokeBoost(sa.default);

                const balance = await savingsVault.balanceOf(sa.default);
                assertBNClosePercent(balance, expectedBoost, "1");
                assertBNClosePercent(
                    boost(deposit, calcBoost(deposit, stake)),
                    expectedBoost,
                    "0.1",
                );

                const ratio = await savingsVault.getBoost(sa.default);
                assertBNClosePercent(ratio, minBoost, "0.1");
            });
        });
        describe("when saving and with staking balance = 0", () => {
            it("should give no boost", async () => {
                const deposit = simpleToExactAmount(100, 18);
                const expectedBoost = simpleToExactAmount(50, 18);

                await expectSuccessfulStake(deposit);

                const balance = await savingsVault.balanceOf(sa.default);
                assertBNClosePercent(balance, expectedBoost, "1");
                assertBNClosePercent(boost(deposit, minBoost), expectedBoost, "0.1");

                const ratio = await savingsVault.getBoost(sa.default);
                assertBNClosePercent(ratio, minBoost, "0.1");
            });
        });
        describe("when withdrawing and with staking balance", () => {
            it("should set boost to 0 and update total supply", async () => {
                const deposit = simpleToExactAmount(100, 18);
                const stake = simpleToExactAmount(800, 18);

                await expectSuccessfulStake(deposit);
                await stakingContract.setBalanceOf(sa.default, stake);
                await savingsVault.pokeBoost(sa.default);

                await time.increase(ONE_WEEK);
                await savingsVault.methods["exit()"]();

                const balance = await savingsVault.balanceOf(sa.default);
                const raw = await savingsVault.rawBalanceOf(sa.default);
                const supply = await savingsVault.totalSupply();

                expect(balance).bignumber.eq(new BN(0));
                expect(raw).bignumber.eq(new BN(0));
                expect(supply).bignumber.eq(new BN(0));
            });
        });
        describe("when staking and then updating vMTA balance", () => {
            it("should start accruing more rewards", async () => {
                // Alice vs Bob
                // 1. Pools are funded
                // 2. Alice and Bob both deposit 100 and have no MTA
                // 3. wait half a week
                // 4. Alice increases MTA stake to get max boost
                // 5. Both users are poked
                // 6. Wait half a week
                // 7. Both users are poked
                // 8. Alice accrued 3x the rewards in the second entry
                const alice = sa.default;
                const bob = sa.dummy1;
                // 1.
                const hunnit = simpleToExactAmount(100, 18);
                await rewardToken.transfer(savingsVault.address, hunnit, {
                    from: rewardsDistributor,
                });
                await expectSuccesfulFunding(hunnit);

                // 2.
                await expectSuccessfulStake(hunnit);
                await expectSuccessfulStake(hunnit, sa.default, bob);

                // 3.
                await time.increase(ONE_WEEK.divn(2));

                // 4.
                await stakingContract.setBalanceOf(alice, hunnit);

                // 5.
                await savingsVault.pokeBoost(alice);
                await savingsVault.pokeBoost(bob);

                // 6.
                await time.increase(ONE_WEEK.divn(2));

                // 7.
                await savingsVault.pokeBoost(alice);
                await savingsVault.pokeBoost(bob);

                // 8.
                const aliceData = await snapshotStakingData(alice, alice);
                const bobData = await snapshotStakingData(bob, bob);

                assertBNClosePercent(
                    aliceData.userRewards[1].rate,
                    bobData.userRewards[1].rate.muln(3),
                    "0.1",
                );
            });
        });
    });
    context("adding first stake days after funding", () => {
        before(async () => {
            savingsVault = await redeployRewards();
        });
        it("should retrospectively assign rewards to the first staker", async () => {
            await expectSuccesfulFunding(simpleToExactAmount(100, 18));

            // Do the stake
            const rewardRate = await savingsVault.rewardRate();

            await time.increase(FIVE_DAYS);

            const stakeAmount = simpleToExactAmount(100, 18);
            const boosted = boost(stakeAmount, minBoost);
            await expectSuccessfulStake(stakeAmount);
            // await time.increase(ONE_DAY);

            // This is the total reward per staked token, since the last update
            const rewardPerToken = await savingsVault.rewardPerToken();

            // e.g. 1e15 * 1e18 / 50e18 = 2e13
            const rewardPerSecond = rewardRate.mul(fullScale).div(boosted);
            assertBNClosePercent(rewardPerToken, FIVE_DAYS.mul(rewardPerSecond), "0.01");

            // Calc estimated unclaimed reward for the user
            // earned == balance * (rewardPerToken-userExistingReward)
            const earnedAfterConsequentStake = await savingsVault.earned(sa.default);
            expect(unlockedRewards(boosted.mul(rewardPerToken).div(fullScale))).bignumber.eq(
                earnedAfterConsequentStake,
            );

            await stakingContract.setBalanceOf(sa.default, simpleToExactAmount(1, 21));
            await savingsVault.pokeBoost(sa.default);
        });
    });
    context("staking over multiple funded periods", () => {
        context("with a single staker", () => {
            before(async () => {
                savingsVault = await redeployRewards();
            });
            it("should assign all the rewards from the periods", async () => {
                const fundAmount1 = simpleToExactAmount(100, 18);
                const fundAmount2 = simpleToExactAmount(200, 18);
                await expectSuccesfulFunding(fundAmount1);

                const stakeAmount = simpleToExactAmount(1, 18);
                await expectSuccessfulStake(stakeAmount);

                await time.increase(ONE_WEEK.muln(2));

                await expectSuccesfulFunding(fundAmount2);

                await time.increase(ONE_WEEK.muln(2));

                const earned = await savingsVault.earned(sa.default);
                assertBNSlightlyGT(
                    unlockedRewards(fundAmount1.add(fundAmount2)),
                    earned,
                    new BN(1000000),
                    false,
                );

                await stakingContract.setBalanceOf(sa.default, simpleToExactAmount(1, 21));
                await savingsVault.pokeBoost(sa.default);
            });
        });
        context("with multiple stakers coming in and out", () => {
            const fundAmount1 = simpleToExactAmount(100, 21);
            const fundAmount2 = simpleToExactAmount(200, 21);
            const staker2 = sa.dummy1;
            const staker3 = sa.dummy2;
            const staker1Stake1 = simpleToExactAmount(100, 18);
            const staker1Stake2 = simpleToExactAmount(200, 18);
            const staker2Stake = simpleToExactAmount(100, 18);
            const staker3Stake = simpleToExactAmount(100, 18);

            before(async () => {
                savingsVault = await redeployRewards();
                await imUSD.transfer(staker2, staker2Stake);
                await imUSD.transfer(staker3, staker3Stake);
            });
            it("should accrue rewards on a pro rata basis", async () => {
                /*
                 *  0               1               2   <-- Weeks
                 *   [ - - - - - - ] [ - - - - - - ]
                 * 100k            200k                 <-- Funding
                 * +100            +200                 <-- Staker 1
                 *        +100                          <-- Staker 2
                 * +100            -100                 <-- Staker 3
                 *
                 * Staker 1 gets 25k + 16.66k from week 1 + 150k from week 2 = 191.66k
                 * Staker 2 gets 16.66k from week 1 + 50k from week 2 = 66.66k
                 * Staker 3 gets 25k + 16.66k from week 1 + 0 from week 2 = 41.66k
                 */

                // WEEK 0-1 START
                await expectSuccessfulStake(staker1Stake1);
                await expectSuccessfulStake(staker3Stake, staker3, staker3);

                await expectSuccesfulFunding(fundAmount1);

                await time.increase(ONE_WEEK.divn(2).addn(1));

                await expectSuccessfulStake(staker2Stake, staker2, staker2);

                await time.increase(ONE_WEEK.divn(2).addn(1));

                // WEEK 1-2 START
                await expectSuccesfulFunding(fundAmount2);

                await savingsVault.withdraw(staker3Stake, { from: staker3 });
                await expectSuccessfulStake(staker1Stake2, sa.default, sa.default, true);

                await time.increase(ONE_WEEK);

                // WEEK 2 FINISH
                const earned1 = await savingsVault.earned(sa.default);
                assertBNClose(
                    earned1,
                    unlockedRewards(simpleToExactAmount("191.66", 21)),
                    simpleToExactAmount(1, 19),
                );
                const earned2 = await savingsVault.earned(staker2);
                assertBNClose(
                    earned2,
                    unlockedRewards(simpleToExactAmount("66.66", 21)),
                    simpleToExactAmount(1, 19),
                );
                const earned3 = await savingsVault.earned(staker3);
                assertBNClose(
                    earned3,
                    unlockedRewards(simpleToExactAmount("41.66", 21)),
                    simpleToExactAmount(1, 19),
                );
                // Ensure that sum of earned rewards does not exceed funding amount
                expect(fundAmount1.add(fundAmount2)).bignumber.gte(
                    earned1.add(earned2).add(earned3) as any,
                );
            });
        });
    });
    context("staking after period finish", () => {
        const fundAmount1 = simpleToExactAmount(100, 21);

        before(async () => {
            savingsVault = await redeployRewards();
        });
        it("should stop accruing rewards after the period is over", async () => {
            await expectSuccessfulStake(simpleToExactAmount(1, 18));
            await expectSuccesfulFunding(fundAmount1);

            await time.increase(ONE_WEEK.addn(1));

            const earnedAfterWeek = await savingsVault.earned(sa.default);

            await time.increase(ONE_WEEK.addn(1));
            const now = await time.latest();

            const earnedAfterTwoWeeks = await savingsVault.earned(sa.default);

            expect(earnedAfterWeek).bignumber.eq(earnedAfterTwoWeeks);

            const lastTimeRewardApplicable = await savingsVault.lastTimeRewardApplicable();
            assertBNClose(lastTimeRewardApplicable, now.sub(ONE_WEEK).subn(2), new BN(2));
        });
    });
    context("staking on behalf of a beneficiary", () => {
        const fundAmount = simpleToExactAmount(100, 21);
        const beneficiary = sa.dummy1;
        const stakeAmount = simpleToExactAmount(100, 18);

        before(async () => {
            savingsVault = await redeployRewards();
            await expectSuccesfulFunding(fundAmount);
            await expectSuccessfulStake(stakeAmount, sa.default, beneficiary);
            await time.increase(10);
        });
        it("should update the beneficiaries reward details", async () => {
            const earned = await savingsVault.earned(beneficiary);
            expect(earned).bignumber.gt(new BN(0) as any);

            const rawBalance = await savingsVault.rawBalanceOf(beneficiary);
            expect(rawBalance).bignumber.eq(stakeAmount);

            const balance = await savingsVault.balanceOf(beneficiary);
            expect(balance).bignumber.eq(boost(stakeAmount, minBoost));
        });
        it("should not update the senders details", async () => {
            const earned = await savingsVault.earned(sa.default);
            expect(earned).bignumber.eq(new BN(0));

            const balance = await savingsVault.balanceOf(sa.default);
            expect(balance).bignumber.eq(new BN(0));
        });
    });

    context("using staking / reward tokens with diff decimals", () => {
        before(async () => {
            rewardToken = await MockERC20.new("Reward", "RWD", 12, rewardsDistributor, 1000000);
            imUSD = await MockERC20.new("Interest bearing mUSD", "imUSD", 16, sa.default, 1000000);
            stakingContract = await MockStakingContract.new();
            const proxy = await MockProxy.new();
            const impl = await SavingsVault.new();
            const data: string = impl.contract.methods
                .initialize(
                    systemMachine.nexus.address,
                    imUSD.address,
                    stakingContract.address,
                    rewardToken.address,
                    rewardsDistributor,
                )
                .encodeABI();
            await proxy.methods["initialize(address,address,bytes)"](impl.address, sa.dummy4, data);
            savingsVault = await SavingsVault.at(proxy.address);
        });
        it("should not affect the pro rata payouts", async () => {
            // Add 100 reward tokens
            await expectSuccesfulFunding(simpleToExactAmount(100, 12));
            const rewardRate = await savingsVault.rewardRate();

            // Do the stake
            const stakeAmount = simpleToExactAmount(100, 16);
            const boosted = boost(stakeAmount, minBoost);
            await expectSuccessfulStake(stakeAmount);

            await time.increase(ONE_WEEK.addn(1));

            // This is the total reward per staked token, since the last update
            const rewardPerToken = await savingsVault.rewardPerToken();
            assertBNClose(
                rewardPerToken,
                ONE_WEEK.mul(rewardRate)
                    .mul(fullScale)
                    .div(boosted),
                new BN(1)
                    .mul(rewardRate)
                    .mul(fullScale)
                    .div(boosted),
            );

            // Calc estimated unclaimed reward for the user
            // earned == balance * (rewardPerToken-userExistingReward)
            const earnedAfterConsequentStake = await savingsVault.earned(sa.default);
            assertBNSlightlyGT(
                unlockedRewards(simpleToExactAmount(100, 12)),
                earnedAfterConsequentStake,
                simpleToExactAmount(1, 9),
            );
        });
    });

    context("claiming rewards", async () => {
        const fundAmount = simpleToExactAmount(100, 21);
        const stakeAmount = simpleToExactAmount(100, 18);
        const unlocked = unlockedRewards(fundAmount);

        before(async () => {
            savingsVault = await redeployRewards();
            await expectSuccesfulFunding(fundAmount);
            await rewardToken.transfer(savingsVault.address, fundAmount, {
                from: rewardsDistributor,
            });
            await expectSuccessfulStake(stakeAmount, sa.default, sa.dummy2);
            await time.increase(ONE_WEEK.addn(1));
        });
        it("should do nothing for a non-staker", async () => {
            const beforeData = await snapshotStakingData(sa.dummy1, sa.dummy1);
            await savingsVault.claimReward({ from: sa.dummy1 });

            const afterData = await snapshotStakingData(sa.dummy1, sa.dummy1);
            expect(beforeData.userData.rewards).bignumber.eq(new BN(0));
            expect(afterData.userData.rewards).bignumber.eq(new BN(0));
            expect(afterData.tokenBalance.sender).bignumber.eq(new BN(0));
            expect(afterData.userData.rewardPerTokenPaid).bignumber.eq(
                afterData.contractData.rewardPerTokenStored,
            );
        });
        it("should send all UNLOCKED rewards to the rewardee", async () => {
            const beforeData = await snapshotStakingData(sa.dummy2, sa.dummy2);
            const rewardeeBalanceBefore = await rewardToken.balanceOf(sa.dummy2);
            expect(rewardeeBalanceBefore).bignumber.eq(new BN(0));
            const tx = await savingsVault.claimReward({
                from: sa.dummy2,
            });
            expectEvent(tx.receipt, "RewardPaid", {
                user: sa.dummy2,
            });
            const afterData = await snapshotStakingData(sa.dummy2, sa.dummy2);
            await assertRewardsAssigned(beforeData, afterData, true, true);
            // Balance transferred to the rewardee
            const rewardeeBalanceAfter = await rewardToken.balanceOf(sa.dummy2);
            assertBNClose(rewardeeBalanceAfter, unlocked, simpleToExactAmount(1, 16));

            // 'rewards' reset to 0
            expect(afterData.userData.rewards).bignumber.eq(new BN(0));
            // Paid up until the last block
            expect(afterData.userData.rewardPerTokenPaid).bignumber.eq(
                afterData.contractData.rewardPerTokenStored,
            );
            // Token balances dont change
            expect(afterData.tokenBalance.sender).bignumber.eq(beforeData.tokenBalance.sender);
            expect(beforeData.boostBalance.balance).bignumber.eq(afterData.boostBalance.balance);
        });
    });
    context("claiming locked rewards", () => {
        /*
         *  0    1    2    3   .. 26  27   28   29  <-- Weeks
         * 100k 100k 200k 100k                      <-- Funding
         *                        [ 1 ][ 1.5  ][.5]
         *  ^    ^      ^  ^                        <-- Staker
         * stake p1    p2  withdraw
         */

        const hunnit = simpleToExactAmount(100, 21);
        const sum = hunnit.muln(4);
        const unlocked = unlockedRewards(sum);

        beforeEach(async () => {
            savingsVault = await redeployRewards();
            await rewardToken.transfer(savingsVault.address, hunnit.muln(5), {
                from: rewardsDistributor,
            });
            // t0
            await expectSuccesfulFunding(hunnit);
            await expectSuccessfulStake(hunnit);
            await time.increase(ONE_WEEK.addn(1));
            // t1
            await expectSuccesfulFunding(hunnit);
            await savingsVault.pokeBoost(sa.default);
            await time.increase(ONE_WEEK.addn(1));
            // t2
            await expectSuccesfulFunding(hunnit.muln(2));
            await time.increase(ONE_WEEK.divn(2));
            // t2x5
            await savingsVault.pokeBoost(sa.default);
            await time.increase(ONE_WEEK.divn(2));
            // t3
            await expectSuccesfulFunding(hunnit);
        });
        it("should fetch the unclaimed tranche data", async () => {
            await expectStakingWithdrawal(hunnit);
            await time.increase(ONE_WEEK.muln(23));
            // t = 26
            let [amount, first, last] = await savingsVault.unclaimedRewards(sa.default);
            assertBNClosePercent(amount, unlocked, "0.01");
            expect(first).bignumber.eq(new BN(0));
            expect(last).bignumber.eq(new BN(0));

            await time.increase(ONE_WEEK.muln(3).divn(2));

            // t = 27.5
            [amount, first, last] = await savingsVault.unclaimedRewards(sa.default);
            expect(first).bignumber.eq(new BN(0));
            expect(last).bignumber.eq(new BN(1));
            assertBNClosePercent(
                amount,
                unlocked.add(lockedRewards(simpleToExactAmount(166.666, 21))),
                "0.01",
            );

            await time.increase(ONE_WEEK.muln(5).divn(2));

            // t = 30
            [amount, first, last] = await savingsVault.unclaimedRewards(sa.default);
            expect(first).bignumber.eq(new BN(0));
            expect(last).bignumber.eq(new BN(2));
            assertBNClosePercent(
                amount,
                unlocked.add(lockedRewards(simpleToExactAmount(400, 21))),
                "0.01",
            );
        });
        it("should claim all unlocked rewards over the tranches, and any immediate unlocks", async () => {
            await expectStakingWithdrawal(hunnit);
            await time.increase(ONE_WEEK.muln(23));
            await time.increase(ONE_WEEK.muln(3).divn(2));

            // t=27.5
            const expected = lockedRewards(simpleToExactAmount(166.666, 21));
            const allRewards = unlocked.add(expected);
            let [amount, first, last] = await savingsVault.unclaimedRewards(sa.default);
            expect(first).bignumber.eq(new BN(0));
            expect(last).bignumber.eq(new BN(1));
            assertBNClosePercent(amount, allRewards, "0.01");

            // claims all immediate unlocks
            const dataBefore = await snapshotStakingData();
            const t27x5 = await time.latest();
            const tx = await savingsVault.methods["claimRewards(uint256,uint256)"](first, last);
            expectEvent(tx.receipt, "RewardPaid", {
                user: sa.default,
            });

            // Gets now unclaimed rewards (0, since no time has passed)
            [amount, first, last] = await savingsVault.unclaimedRewards(sa.default);
            expect(first).bignumber.eq(new BN(1));
            expect(last).bignumber.eq(new BN(1));
            expect(amount).bignumber.eq(new BN(0));

            const dataAfter = await snapshotStakingData();

            // Checks that data has been updated correctly
            expect(dataAfter.boostBalance.totalSupply).bignumber.eq(new BN(0));
            expect(dataAfter.tokenBalance.sender).bignumber.eq(
                dataBefore.tokenBalance.sender.add(amount),
            );
            expect(dataAfter.userData.lastAction).bignumber.eq(dataAfter.userData.userClaim);
            assertBNClose(t27x5, dataAfter.userData.lastAction, 5);
            expect(dataAfter.userData.rewards).bignumber.eq(new BN(0));

            await expectRevert(
                savingsVault.methods["claimRewards(uint256,uint256)"](0, 0),
                "Invalid epoch",
            );

            await time.increase(100);
            [amount, first, last] = await savingsVault.unclaimedRewards(sa.default);
            expect(first).bignumber.eq(new BN(1));
            expect(last).bignumber.eq(new BN(1));
            assertBNClose(
                amount,
                dataAfter.userRewards[1].rate.muln(100),
                dataAfter.userRewards[1].rate.muln(3),
            );

            await savingsVault.methods["claimRewards(uint256,uint256)"](1, 1);

            await time.increase(ONE_DAY.muln(10));

            await savingsVault.methods["claimRewards(uint256,uint256)"](1, 1);

            const d3 = await snapshotStakingData();
            expect(d3.userData.userClaim).bignumber.eq(d3.userRewards[1].finish);

            await savingsVault.methods["claimRewards(uint256,uint256)"](1, 1);

            const d4 = await snapshotStakingData();
            expect(d4.userData.userClaim).bignumber.eq(d4.userRewards[1].finish);
            expect(d4.tokenBalance.sender).bignumber.eq(d3.tokenBalance.sender);
        });
        it("should claim rewards without being passed the params", async () => {
            await expectStakingWithdrawal(hunnit);
            await time.increase(ONE_WEEK.muln(23));
            await time.increase(ONE_WEEK.muln(3).divn(2));

            // t=27.5
            const expected = lockedRewards(simpleToExactAmount(166.666, 21));
            const allRewards = unlocked.add(expected);
            let [amount, first, last] = await savingsVault.unclaimedRewards(sa.default);
            expect(first).bignumber.eq(new BN(0));
            expect(last).bignumber.eq(new BN(1));
            assertBNClosePercent(amount, allRewards, "0.01");

            // claims all immediate unlocks
            const dataBefore = await snapshotStakingData();
            const t27x5 = await time.latest();
            const tx = await savingsVault.methods["claimRewards()"]();
            expectEvent(tx.receipt, "RewardPaid", {
                user: sa.default,
            });

            // Gets now unclaimed rewards (0, since no time has passed)
            [amount, first, last] = await savingsVault.unclaimedRewards(sa.default);
            expect(first).bignumber.eq(new BN(1));
            expect(last).bignumber.eq(new BN(1));
            expect(amount).bignumber.eq(new BN(0));

            const dataAfter = await snapshotStakingData();

            // Checks that data has been updated correctly
            expect(dataAfter.boostBalance.totalSupply).bignumber.eq(new BN(0));
            expect(dataAfter.tokenBalance.sender).bignumber.eq(
                dataBefore.tokenBalance.sender.add(amount),
            );
            expect(dataAfter.userData.lastAction).bignumber.eq(dataAfter.userData.userClaim);
            assertBNClose(t27x5, dataAfter.userData.lastAction, 5);
            expect(dataAfter.userData.rewards).bignumber.eq(new BN(0));
        });
        it("should unlock all rewards after sufficient time has elapsed", async () => {
            await expectStakingWithdrawal(hunnit);
            await time.increase(ONE_WEEK.muln(27));

            // t=30
            const expected = lockedRewards(simpleToExactAmount(400, 21));
            const allRewards = unlocked.add(expected);
            let [amount, first, last] = await savingsVault.unclaimedRewards(sa.default);
            expect(first).bignumber.eq(new BN(0));
            expect(last).bignumber.eq(new BN(2));
            assertBNClosePercent(amount, allRewards, "0.01");

            // claims all immediate unlocks
            const dataBefore = await snapshotStakingData();
            const t30 = await time.latest();
            const tx = await savingsVault.methods["claimRewards()"]();
            expectEvent(tx.receipt, "RewardPaid", {
                user: sa.default,
            });

            // Gets now unclaimed rewards (0, since no time has passed)
            [amount, first, last] = await savingsVault.unclaimedRewards(sa.default);
            expect(first).bignumber.eq(new BN(2));
            expect(last).bignumber.eq(new BN(2));
            expect(amount).bignumber.eq(new BN(0));

            const dataAfter = await snapshotStakingData();

            // Checks that data has been updated correctly
            expect(dataAfter.boostBalance.totalSupply).bignumber.eq(new BN(0));
            expect(dataAfter.tokenBalance.sender).bignumber.eq(
                dataBefore.tokenBalance.sender.add(amount),
            );
            expect(dataAfter.userData.userClaim).bignumber.eq(dataAfter.userRewards[2].finish);
            assertBNClose(t30, dataAfter.userData.lastAction, 5);
            expect(dataAfter.userData.rewards).bignumber.eq(new BN(0));
        });
        it("should break if we leave rewards unclaimed at the start or end", async () => {
            await expectStakingWithdrawal(hunnit);
            await time.increase(ONE_WEEK.muln(25));

            // t=28
            let [, first, last] = await savingsVault.unclaimedRewards(sa.default);
            expect(first).bignumber.eq(new BN(0));
            expect(last).bignumber.eq(new BN(1));

            await expectRevert(
                savingsVault.methods["claimRewards(uint256,uint256)"](1, 1),
                "Invalid _first arg: Must claim earlier entries",
            );

            await time.increase(ONE_WEEK.muln(3));
            // t=31
            [, first, last] = await savingsVault.unclaimedRewards(sa.default);
            expect(first).bignumber.eq(new BN(0));
            expect(last).bignumber.eq(new BN(2));

            await savingsVault.methods["claimRewards(uint256,uint256)"](0, 1);

            await savingsVault.methods["claimRewards(uint256,uint256)"](1, 2);

            // then try to claim 0-2 again, and it should give nothing
            const unclaimed = await savingsVault.unclaimedRewards(sa.default);
            expect(unclaimed[0]).bignumber.eq(new BN(0));
            expect(unclaimed[1]).bignumber.eq(new BN(2));
            expect(unclaimed[2]).bignumber.eq(new BN(2));

            const dataBefore = await snapshotStakingData();
            await expectRevert(
                savingsVault.methods["claimRewards(uint256,uint256)"](0, 2),
                "Invalid epoch",
            );
            const dataAfter = await snapshotStakingData();

            expect(dataAfter.tokenBalance.sender).bignumber.eq(dataBefore.tokenBalance.sender);
            expect(dataAfter.userData.userClaim).bignumber.eq(dataBefore.userData.userClaim);
        });
        describe("with many array entries", () => {
            it("should allow them all to be searched and claimed", async () => {
                await rewardToken.transfer(savingsVault.address, hunnit.muln(6), {
                    from: rewardsDistributor,
                });
                await time.increase(ONE_WEEK);
                // t4
                await savingsVault.pokeBoost(sa.default);
                await expectSuccesfulFunding(hunnit);
                await time.increase(ONE_WEEK.divn(2));
                // t4.5
                await savingsVault.pokeBoost(sa.default);
                await time.increase(ONE_WEEK.divn(2));
                // t5
                await savingsVault.pokeBoost(sa.default);
                await expectSuccesfulFunding(hunnit);
                await time.increase(ONE_WEEK.divn(2));
                // t5.5
                await savingsVault.pokeBoost(sa.default);
                await time.increase(ONE_WEEK.divn(2));
                // t6
                await savingsVault.pokeBoost(sa.default);
                await expectSuccesfulFunding(hunnit);
                await time.increase(ONE_WEEK.divn(2));
                // t6.5
                await savingsVault.pokeBoost(sa.default);
                await time.increase(ONE_WEEK.divn(2));
                // t7
                await savingsVault.pokeBoost(sa.default);
                await expectSuccesfulFunding(hunnit);
                await time.increase(ONE_WEEK.divn(2));
                // t7.5
                await savingsVault.pokeBoost(sa.default);
                await time.increase(ONE_WEEK.divn(2));
                // t8
                await savingsVault.pokeBoost(sa.default);
                await expectSuccesfulFunding(hunnit);
                await time.increase(ONE_WEEK.divn(2));
                // t8.5
                await savingsVault.pokeBoost(sa.default);
                await time.increase(ONE_WEEK.divn(2));
                // t9
                await savingsVault.pokeBoost(sa.default);
                await expectSuccesfulFunding(hunnit);
                await time.increase(ONE_WEEK.divn(2));
                // t9.5
                await savingsVault.pokeBoost(sa.default);
                await time.increase(ONE_WEEK.divn(2));
                // t10
                await savingsVault.pokeBoost(sa.default);

                // count = 1
                // t=28
                await time.increase(ONE_WEEK.muln(18));
                let [amt, first, last] = await savingsVault.unclaimedRewards(sa.default);
                expect(first).bignumber.eq(new BN(0));
                expect(last).bignumber.eq(new BN(1));

                const data28 = await snapshotStakingData();
                expect(data28.userData.userClaim).bignumber.eq(new BN(0));
                expect(data28.userData.rewardCount).eq(15);

                // t=32
                await time.increase(ONE_WEEK.muln(4).subn(100));
                [amt, first, last] = await savingsVault.unclaimedRewards(sa.default);
                expect(first).bignumber.eq(new BN(0));
                expect(last).bignumber.eq(new BN(6));
                await savingsVault.methods["claimRewards(uint256,uint256)"](0, 6);
                const data32 = await snapshotStakingData();
                expect(data32.userData.userClaim).bignumber.eq(data32.userData.lastAction);

                [amt, first, last] = await savingsVault.unclaimedRewards(sa.default);
                expect(amt).bignumber.eq(new BN(0));
                expect(first).bignumber.eq(new BN(6));
                expect(last).bignumber.eq(new BN(6));

                // t=35
                await time.increase(ONE_WEEK.muln(3));
                [amt, first, last] = await savingsVault.unclaimedRewards(sa.default);
                expect(first).bignumber.eq(new BN(6));
                expect(last).bignumber.eq(new BN(12));

                await savingsVault.methods["claimRewards(uint256,uint256)"](6, 12);
                const data35 = await snapshotStakingData();
                expect(data35.userData.userClaim).bignumber.eq(data35.userData.lastAction);
                [amt, ,] = await savingsVault.unclaimedRewards(sa.default);
                expect(amt).bignumber.eq(new BN(0));

                await expectRevert(
                    savingsVault.methods["claimRewards(uint256,uint256)"](0, 1),
                    "Invalid epoch",
                );
            });
        });
        describe("with a one second entry", () => {
            it("should allow it to be claimed", async () => {
                await rewardToken.transfer(savingsVault.address, hunnit, {
                    from: rewardsDistributor,
                });
                await savingsVault.pokeBoost(sa.default);
                await time.increase(ONE_WEEK);
                // t4
                await expectSuccesfulFunding(hunnit);
                await savingsVault.pokeBoost(sa.default);
                await savingsVault.pokeBoost(sa.default);
                await savingsVault.pokeBoost(sa.default);
                await savingsVault.pokeBoost(sa.default);
                await savingsVault.pokeBoost(sa.default);
                await savingsVault.pokeBoost(sa.default);
                await savingsVault.pokeBoost(sa.default);
                await time.increase(ONE_WEEK.muln(26).subn(10));

                // t30
                const data = await snapshotStakingData();
                expect(data.userData.rewardCount).eq(10);
                const r4 = data.userRewards[4];
                const r5 = data.userRewards[5];
                expect(r4.finish).bignumber.eq(r5.start);
                expect(r5.finish).bignumber.eq(r5.start.addn(1));
                expect(r4.rate).bignumber.eq(r5.rate);
                assertBNClosePercent(r4.rate, lockedRewards(data.contractData.rewardRate), "0.001");

                let [, first, last] = await savingsVault.unclaimedRewards(sa.default);
                expect(first).bignumber.eq(new BN(0));
                expect(last).bignumber.eq(new BN(3));
                await savingsVault.methods["claimRewards(uint256,uint256)"](0, 3);
                await time.increase(20);

                [, first, last] = await savingsVault.unclaimedRewards(sa.default);
                expect(first).bignumber.eq(new BN(3));
                expect(last).bignumber.eq(new BN(10));

                await expectRevert(
                    savingsVault.methods["claimRewards(uint256,uint256)"](0, 8),
                    "Invalid epoch",
                );
                await savingsVault.methods["claimRewards(uint256,uint256)"](3, 8);
                await expectRevert(
                    savingsVault.methods["claimRewards(uint256,uint256)"](6, 9),
                    "Invalid epoch",
                );
                await savingsVault.methods["claimRewards()"];
            });
        });
    });

    context("getting the reward token", () => {
        before(async () => {
            savingsVault = await redeployRewards();
        });
        it("should simply return the rewards Token", async () => {
            const readToken = await savingsVault.getRewardToken();
            expect(readToken).eq(rewardToken.address);
            expect(readToken).eq(await savingsVault.rewardsToken());
        });
    });

    context("calling exit", () => {
        const hunnit = simpleToExactAmount(100, 18);
        beforeEach(async () => {
            savingsVault = await redeployRewards();
            await rewardToken.transfer(savingsVault.address, hunnit, {
                from: rewardsDistributor,
            });
            await expectSuccesfulFunding(hunnit);
            await expectSuccessfulStake(hunnit);
            await time.increase(ONE_WEEK.addn(1));
        });
        context("with no raw balance but rewards unlocked", () => {
            it("errors", async () => {
                await savingsVault.withdraw(hunnit);
                const beforeData = await snapshotStakingData();
                expect(beforeData.boostBalance.totalSupply).bignumber.eq(new BN(0));
                await expectRevert(savingsVault.methods["exit()"](), "Cannot withdraw 0");
            });
        });
        context("with raw balance", async () => {
            it("withdraws everything and claims unlocked rewards", async () => {
                const beforeData = await snapshotStakingData();
                expect(beforeData.boostBalance.totalSupply).bignumber.eq(
                    simpleToExactAmount(50, 18),
                );
                await savingsVault.methods["exit()"]();
                const afterData = await snapshotStakingData();
                expect(afterData.userData.userClaim).bignumber.eq(afterData.userData.lastAction);
                expect(afterData.userData.rewards).bignumber.eq(new BN(0));
                expect(afterData.boostBalance.totalSupply).bignumber.eq(new BN(0));
            });
        });
        context("with unlocked rewards", () => {
            it("claims unlocked epochs", async () => {
                await savingsVault.pokeBoost(sa.default);
                await time.increase(ONE_WEEK.muln(27));

                const [amount, first, last] = await savingsVault.unclaimedRewards(sa.default);
                expect(first).bignumber.eq(new BN(0));
                expect(last).bignumber.eq(new BN(0));
                assertBNClosePercent(amount, hunnit, "0.01");

                // claims all immediate unlocks
                const tx = await savingsVault.methods["exit(uint256,uint256)"](first, last);
                expectEvent(tx.receipt, "RewardPaid", {
                    user: sa.default,
                });
                expectEvent(tx.receipt, "Withdrawn", {
                    user: sa.default,
                    amount: hunnit,
                });
            });
        });
    });

    context("withdrawing stake or rewards", () => {
        context("withdrawing a stake amount", () => {
            const fundAmount = simpleToExactAmount(100, 21);
            const stakeAmount = simpleToExactAmount(100, 18);

            before(async () => {
                savingsVault = await redeployRewards();
                await expectSuccesfulFunding(fundAmount);
                await expectSuccessfulStake(stakeAmount);
                await time.increase(10);
            });
            it("should revert for a non-staker", async () => {
                await expectRevert(
                    savingsVault.withdraw(1, { from: sa.dummy1 }),
                    "SafeMath: subtraction overflow",
                );
            });
            it("should revert if insufficient balance", async () => {
                await expectRevert(
                    savingsVault.withdraw(stakeAmount.addn(1), { from: sa.default }),
                    "SafeMath: subtraction overflow",
                );
            });
            it("should fail if trying to withdraw 0", async () => {
                await expectRevert(
                    savingsVault.withdraw(0, { from: sa.default }),
                    "Cannot withdraw 0",
                );
            });
            it("should withdraw the stake and update the existing reward accrual", async () => {
                // Check that the user has earned something
                const earnedBefore = await savingsVault.earned(sa.default);
                expect(earnedBefore).bignumber.gt(new BN(0) as any);
                const dataBefore = await snapshotStakingData();
                expect(dataBefore.userData.rewards).bignumber.eq(new BN(0));

                // Execute the withdrawal
                await expectStakingWithdrawal(stakeAmount);

                // Ensure that the new awards are added + assigned to user
                const earnedAfter = await savingsVault.earned(sa.default);
                expect(earnedAfter).bignumber.gte(earnedBefore as any);
                const dataAfter = await snapshotStakingData();
                expect(dataAfter.userData.rewards).bignumber.eq(earnedAfter);

                // Zoom forward now
                await time.increase(10);

                // Check that the user does not earn anything else
                const earnedEnd = await savingsVault.earned(sa.default);
                expect(earnedEnd).bignumber.eq(earnedAfter);
                const dataEnd = await snapshotStakingData();
                expect(dataEnd.userData.rewards).bignumber.eq(dataAfter.userData.rewards);

                // Cannot withdraw anything else
                await expectRevert(
                    savingsVault.withdraw(stakeAmount.addn(1), { from: sa.default }),
                    "SafeMath: subtraction overflow",
                );
            });
        });
    });

    context("notifying new reward amount", () => {
        context("from someone other than the distributor", () => {
            before(async () => {
                savingsVault = await redeployRewards();
            });
            it("should fail", async () => {
                await expectRevert(
                    savingsVault.notifyRewardAmount(1, { from: sa.default }),
                    "Caller is not reward distributor",
                );
                await expectRevert(
                    savingsVault.notifyRewardAmount(1, { from: sa.dummy1 }),
                    "Caller is not reward distributor",
                );
                await expectRevert(
                    savingsVault.notifyRewardAmount(1, { from: sa.governor }),
                    "Caller is not reward distributor",
                );
            });
        });
        context("before current period finish", async () => {
            const funding1 = simpleToExactAmount(100, 18);
            const funding2 = simpleToExactAmount(200, 18);
            beforeEach(async () => {
                savingsVault = await redeployRewards();
            });
            it("should factor in unspent units to the new rewardRate", async () => {
                // Do the initial funding
                await expectSuccesfulFunding(funding1);
                const actualRewardRate = await savingsVault.rewardRate();
                const expectedRewardRate = funding1.div(ONE_WEEK);
                expect(expectedRewardRate).bignumber.eq(actualRewardRate);

                // Zoom forward half a week
                await time.increase(ONE_WEEK.divn(2));

                // Do the second funding, and factor in the unspent units
                const expectedLeftoverReward = funding1.divn(2);
                await expectSuccesfulFunding(funding2);
                const actualRewardRateAfter = await savingsVault.rewardRate();
                const totalRewardsForWeek = funding2.add(expectedLeftoverReward);
                const expectedRewardRateAfter = totalRewardsForWeek.div(ONE_WEEK);
                assertBNClose(
                    actualRewardRateAfter,
                    expectedRewardRateAfter,
                    actualRewardRate.div(ONE_WEEK).muln(20),
                );
            });
            it("should factor in unspent units to the new rewardRate if instant", async () => {
                // Do the initial funding
                await expectSuccesfulFunding(funding1);
                const actualRewardRate = await savingsVault.rewardRate();
                const expectedRewardRate = funding1.div(ONE_WEEK);
                expect(expectedRewardRate).bignumber.eq(actualRewardRate);

                // Zoom forward half a week
                await time.increase(1);

                // Do the second funding, and factor in the unspent units
                await expectSuccesfulFunding(funding2);
                const actualRewardRateAfter = await savingsVault.rewardRate();
                const expectedRewardRateAfter = funding1.add(funding2).div(ONE_WEEK);
                assertBNClose(
                    actualRewardRateAfter,
                    expectedRewardRateAfter,
                    actualRewardRate.div(ONE_WEEK).muln(20),
                );
            });
        });

        context("after current period finish", () => {
            const funding1 = simpleToExactAmount(100, 18);
            before(async () => {
                savingsVault = await redeployRewards();
            });
            it("should start a new period with the correct rewardRate", async () => {
                // Do the initial funding
                await expectSuccesfulFunding(funding1);
                const actualRewardRate = await savingsVault.rewardRate();
                const expectedRewardRate = funding1.div(ONE_WEEK);
                expect(expectedRewardRate).bignumber.eq(actualRewardRate);

                // Zoom forward half a week
                await time.increase(ONE_WEEK.addn(1));

                // Do the second funding, and factor in the unspent units
                await expectSuccesfulFunding(funding1.muln(2));
                const actualRewardRateAfter = await savingsVault.rewardRate();
                const expectedRewardRateAfter = expectedRewardRate.muln(2);
                expect(actualRewardRateAfter).bignumber.eq(expectedRewardRateAfter);
            });
        });
    });
});
