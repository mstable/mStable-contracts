/* eslint-disable dot-notation */
/* eslint-disable no-await-in-loop */
/* eslint-disable @typescript-eslint/camelcase */
import { network } from "@nomiclabs/buidler";
import { expectEvent, time } from "@openzeppelin/test-helpers";
import { assertBNClose, assertBNClosePercent } from "@utils/assertions";
import { StandardAccounts } from "@utils/machines";
import envSetup from "@utils/env_setup";
import { simpleToExactAmount } from "@utils/math";
import { BN } from "@utils/tools";
import { ONE_WEEK, ONE_HOUR, ONE_DAY, fullScale } from "@utils/constants";
import * as t from "types/generated";

const VotingLockup = artifacts.require("IncentivisedVotingLockup");
const MetaToken = artifacts.require("MetaToken");
const Nexus = artifacts.require("Nexus");
const { expect } = envSetup.configure();

contract("IncentivisedVotingLockup", async (accounts) => {
    const sa = new StandardAccounts(accounts);
    let votingLockup: t.IncentivisedVotingLockupInstance;
    let mta: t.MetaTokenInstance;

    const isCoverage = network.name === "coverage";

    const unlockTime = Math.round(new Date(Date.UTC(2021, 0)).getTime() / 1000);

    const fundVotingLockup = async (funding = simpleToExactAmount(100, 18)) => {
        await mta.transfer(votingLockup.address, funding, { from: sa.fundManager });
        await votingLockup.notifyRewardAmount(funding, { from: sa.fundManager });
    };

    const deployFresh = async (initialRewardFunding = new BN(0)) => {
        const nexus = await Nexus.new(sa.governor);
        mta = await MetaToken.new(nexus.address, sa.fundManager);
        await mta.transfer(sa.default, simpleToExactAmount(1000, 18), { from: sa.fundManager });
        await mta.transfer(sa.other, simpleToExactAmount(1000, 18), { from: sa.fundManager });
        votingLockup = await VotingLockup.new(
            mta.address,
            "Voting MTA",
            "vMTA",
            nexus.address,
            sa.fundManager,
        );
        await mta.approve(votingLockup.address, simpleToExactAmount(100, 18));
        await mta.approve(votingLockup.address, simpleToExactAmount(100, 18), { from: sa.other });
        await mta.approve(votingLockup.address, simpleToExactAmount(10000, 18), {
            from: sa.fundManager,
        });
        if (initialRewardFunding.gtn(0)) {
            fundVotingLockup(initialRewardFunding);
        }
    };

    describe("checking balances & total supply", () => {
        before(async () => {
            await deployFresh();
        });
        describe("before any stakes are made", () => {
            it("returns balances", async () => {
                expect(await votingLockup.staticBalanceOf(sa.default)).bignumber.eq(new BN(0));
                expect(await votingLockup.balanceOf(sa.default)).bignumber.eq(new BN(0));
                expect(await votingLockup.balanceOfAt(sa.default, 1)).bignumber.eq(new BN(0));
            });
            it("returns balance at latest block", async () => {
                expect(
                    await votingLockup.balanceOfAt(sa.default, await time.latestBlock()),
                ).bignumber.eq(new BN(0));
            });
            it("returns totalSupply", async () => {
                expect(await votingLockup.totalSupply()).bignumber.eq(new BN(0));
                expect(await votingLockup.totalSupplyAt(1)).bignumber.eq(new BN(0));
            });
            it("returns totalSupply at latest block", async () => {
                expect(await votingLockup.totalSupplyAt(await time.latestBlock())).bignumber.eq(
                    new BN(0),
                );
            });
        });
        describe("fetching for current block", () => {
            it("fails for balanceOfAt");
            it("fails for supply");
        });
    });

    interface LockedBalance {
        amount: BN;
        end: BN;
    }

    interface StakingData {
        totalStaticWeight: BN;
        userStaticWeight: BN;
        userLocked: LockedBalance;
        senderStakingTokenBalance: BN;
        contractStakingTokenBalance: BN;
        userRewardPerTokenPaid: BN;
        beneficiaryRewardsEarned: BN;
        rewardPerTokenStored: BN;
        rewardRate: BN;
        lastUpdateTime: BN;
        lastTimeRewardApplicable: BN;
        periodFinishTime: BN;
    }

    const snapshotStakingData = async (sender = sa.default): Promise<StakingData> => {
        const locked = await votingLockup.locked(sender);
        return {
            totalStaticWeight: await votingLockup.totalStaticWeight(),
            userStaticWeight: await votingLockup.staticBalanceOf(sender),
            userLocked: {
                amount: locked[0],
                end: locked[1],
            },
            userRewardPerTokenPaid: await votingLockup.userRewardPerTokenPaid(sender),
            senderStakingTokenBalance: await mta.balanceOf(sender),
            contractStakingTokenBalance: await mta.balanceOf(votingLockup.address),
            beneficiaryRewardsEarned: await votingLockup.rewards(sender),
            rewardPerTokenStored: await votingLockup.rewardPerTokenStored(),
            rewardRate: await votingLockup.rewardRate(),
            lastUpdateTime: await votingLockup.lastUpdateTime(),
            lastTimeRewardApplicable: await votingLockup.lastTimeRewardApplicable(),
            periodFinishTime: await votingLockup.periodFinish(),
        };
    };

    // Flow performed with 4 stakers
    // 1 -
    // 2 -
    // 3 -
    // 4 -
    describe("performing full system flow", () => {
        before(async () => {
            await deployFresh(simpleToExactAmount(100, 18));
        });
        describe("checking initial settings", () => {
            it("should set END date");
            it("sets & gets duration");
        });
        describe("creating a lockup", () => {
            // TODO - verify balances
            it("allows user to create a lock", async () => {
                await votingLockup.createLock(simpleToExactAmount(1, 18), unlockTime);
                await votingLockup.createLock(simpleToExactAmount(1, 18), unlockTime, {
                    from: sa.other,
                });
                await votingLockup.balanceOf(sa.default);
                await votingLockup.balanceOfAt(sa.default, 1);
                await votingLockup.balanceOfAt(sa.default, (await time.latestBlock()) - 1);
                await votingLockup.totalSupply();
                await votingLockup.totalSupplyAt(1);
                await votingLockup.totalSupplyAt((await time.latestBlock()) - 1);

                // require(_value > 0, "Must stake non zero amount");
                // require(locked_.amount == 0, "Withdraw old tokens first");

                // require(unlock_time > block.timestamp, "Can only lock until time in the future");
                // // require(unlock_time <= END, "Voting lock can be 1 year max (until recol)");
                // require(unlock_time <= (block.timestamp.add(MAXTIME)), "Voting lock can be 1 year max (until recol)");
            });
            it("only allows creation up until END date");
        });

        describe("extending lock", () => {
            // require(_value > 0, "Must stake non zero amount");
            // require(locked_.amount > 0, "No existing lock found");
            // require(locked_.end > block.timestamp, "Cannot add to expired lock. Withdraw");

            it("allows anyone to increase lock amount");

            // require(locked_.end > block.timestamp, "Lock expired");
            // require(locked_.amount > 0, "Nothing is locked");
            // require(unlock_time > locked_.end, "Can only increase lock WEEK");
            // // require(unlock_time <= END, "Voting lock can be 1 year max (until recol)");
            // require(unlock_time <= block.timestamp.add(MAXTIME), "Voting lock can be 1 year max (until recol)");
            it("allows user to extend lock");
        });

        describe("trying to withdraw early", () => {
            // require(block.timestamp >= oldLock.end || expired, "The lock didn't expire");
            it("fails");
        });

        describe("calling public checkpoint", () => {
            // checkpoint updates point history
            it("allows anyone to call checkpoint");
        });

        describe("calling the getters", () => {
            // returns 0 if 0
            it("allows anyone to get last user point");
        });

        describe("claiming rewards", () => {
            // TODO - verify balances
            it("allows user to claim", async () => {
                await time.increase(ONE_WEEK);

                await votingLockup.claimReward();

                await votingLockup.staticBalanceOf(sa.default);
                await votingLockup.balanceOf(sa.default);
                await votingLockup.balanceOfAt(sa.default, 1);
                await votingLockup.balanceOfAt(sa.default, (await time.latestBlock()) - 1);
                await votingLockup.totalSupply();
                await votingLockup.totalSupplyAt(1);
                await votingLockup.totalSupplyAt((await time.latestBlock()) - 1);
            });
        });
        describe("exiting the system", () => {
            // TODO - verify balances
            it("allows user to withdraw", async () => {
                await time.increase(ONE_WEEK.muln(26));

                await votingLockup.withdraw();
                await votingLockup.withdraw({ from: sa.other });

                await votingLockup.staticBalanceOf(sa.default);
                await votingLockup.balanceOf(sa.default);
                await votingLockup.balanceOfAt(sa.default, 1);
                await votingLockup.balanceOfAt(sa.default, (await time.latestBlock()) - 1);
                await votingLockup.totalSupply();
                await votingLockup.totalSupplyAt(1);
                await votingLockup.totalSupplyAt((await time.latestBlock()) - 1);
            });
            // cant eject a user if they haven't finished lockup yet
            it("kicks a user and withdraws their stake");
            it("fully exists the system");
        });

        describe("expiring the contract", () => {
            // cant stake after expiry
            // cant notify after expiry
            it("must be done after final period finishes");
            it("only gov");
            it("expires the contract and unlocks all stakes");
        });
    });

    // Integration test ported from
    // https://github.com/curvefi/curve-dao-contracts/blob/master/tests/integration/VotingEscrow/test_votingLockup.py
    // Added reward claiming & static balance analysis
    describe("testing voting powers changing", () => {
        before(async () => {
            await deployFresh();
        });

        /**
         *
         * Test voting power in the following scenario.
         * Alice:
         * ~~~~~~~
         * ^
         * | *       *
         * | | \     |  \
         * | |  \    |    \
         * +-+---+---+------+---> t
         *
         * Bob:
         * ~~~~~~~
         * ^
         * |         *
         * |         | \
         * |         |  \
         * +-+---+---+---+--+---> t
         *
         * Alice has 100% of voting power in the first period.
         * She has 2/3 power at the start of 2nd period, with Bob having 1/2 power
         * (due to smaller locktime).
         * Alice's power grows to 100% by Bob's unlock.
         *
         * Checking that totalSupply is appropriate.
         *
         * After the test is done, check all over again with balanceOfAt / totalSupplyAt
         *
         * Rewards for Week 1 = 1000 (Alice = 100%)
         * Rewards for Week 2 = 1000 (Alice = 66%, Bob = 33%)
         * Rewards = [1666.666, 333.333]
         */
        const nextUnixWeekStart = async () => {
            const unixWeekCount = (await time.latest()).div(ONE_WEEK);
            const nextUnixWeek = unixWeekCount.addn(1).mul(ONE_WEEK);
            return nextUnixWeek;
        };

        const calculateStaticBalance = async (lockupLength: BN, amount: BN): Promise<BN> => {
            const slope = amount.div(await votingLockup.MAXTIME());
            const s = slope.muln(10000).muln(Math.sqrt(lockupLength.toNumber()));
            return s;
        };

        it("calculates voting weights on a rolling basis", async () => {
            /**
             * SETUP
             */
            const MAXTIME = await votingLockup.MAXTIME();
            const tolerance = "0.03"; // 0.03% | 0.00003 | 3e14
            const alice = sa.dummy1;
            const bob = sa.dummy2;
            const amount = simpleToExactAmount(1000, 18);
            await mta.transfer(alice, amount.muln(5), { from: sa.fundManager });
            await mta.transfer(bob, amount.muln(5), { from: sa.fundManager });
            const stages = {};

            await mta.approve(votingLockup.address, amount.muln(5), { from: alice });
            await mta.approve(votingLockup.address, amount.muln(5), { from: bob });

            expect(await votingLockup.totalSupply()).bignumber.eq(new BN(0));
            expect(await votingLockup.balanceOf(alice)).bignumber.eq(new BN(0));
            expect(await votingLockup.balanceOf(bob)).bignumber.eq(new BN(0));
            expect(await votingLockup.staticBalanceOf(bob)).bignumber.eq(new BN(0));
            expect(await votingLockup.totalStaticWeight()).bignumber.eq(new BN(0));

            /**
             * BEGIN PERIOD 1
             * Move to timing which is good for testing - beginning of a UTC week
             * Fund the pool
             */

            console.log("a00");
            let nextUnixWeek = await nextUnixWeekStart();
            await time.increaseTo(nextUnixWeek);
            await time.increase(ONE_HOUR);
            await fundVotingLockup(amount);
            console.log("a0");

            stages["before_deposits"] = [await time.latestBlock(), await time.latest()];

            await votingLockup.createLock(amount, (await time.latest()).add(ONE_WEEK.addn(1)), {
                from: alice,
            });
            stages["alice_deposit"] = [await time.latestBlock(), await time.latest()];
            console.log("a1");

            assertBNClosePercent(
                await votingLockup.staticBalanceOf(alice),
                await calculateStaticBalance(ONE_WEEK.sub(ONE_HOUR), amount),
                "0.1",
            );
            expect(await votingLockup.totalStaticWeight()).bignumber.eq(
                await votingLockup.staticBalanceOf(alice),
                "Total static weight should consist of only alice",
            );
            await time.increase(ONE_HOUR);
            await time.advanceBlock();
            console.log("a2");
            assertBNClosePercent(
                await votingLockup.balanceOf(alice),
                amount.div(MAXTIME).mul(ONE_WEEK.sub(ONE_HOUR.muln(2))),
                tolerance,
            );
            assertBNClosePercent(
                await votingLockup.totalSupply(),
                amount.div(MAXTIME).mul(ONE_WEEK.sub(ONE_HOUR.muln(2))),
                tolerance,
            );
            expect(await votingLockup.balanceOf(bob)).bignumber.eq(new BN(0));
            let t0 = await time.latest();
            let dt = new BN(0);

            stages["alice_in_0"] = [];
            stages["alice_in_0"].push([await time.latestBlock(), await time.latest()]);
            console.log("a3");
            /**
             * Measure Alice's decay over whole week
             */
            for (let i = 0; i < 7; i += 1) {
                for (let j = 0; j < 24; j += 1) {
                    await time.increase(ONE_HOUR);
                    await time.advanceBlock();
                }
                dt = (await time.latest()).sub(t0);
                assertBNClosePercent(
                    await votingLockup.totalSupply(),
                    amount
                        .div(MAXTIME)
                        .mul(BN.max(ONE_WEEK.sub(ONE_HOUR.muln(2)).sub(dt), new BN(0))),
                    tolerance,
                );
                assertBNClosePercent(
                    await votingLockup.balanceOf(alice),
                    amount
                        .div(MAXTIME)
                        .mul(BN.max(ONE_WEEK.sub(ONE_HOUR.muln(2)).sub(dt), new BN(0))),
                    tolerance,
                );
                expect(await votingLockup.balanceOf(bob)).bignumber.eq(new BN(0));
                stages["alice_in_0"].push([await time.latestBlock(), await time.latest()]);
            }
            console.log("a4");
            await time.increase(ONE_HOUR);

            expect(await votingLockup.balanceOf(alice)).bignumber.eq(new BN(0));
            assertBNClosePercent(
                await votingLockup.staticBalanceOf(alice),
                await calculateStaticBalance(ONE_WEEK.sub(ONE_HOUR), amount),
                "0.1",
            );
            expect(await votingLockup.totalStaticWeight()).bignumber.eq(
                await votingLockup.staticBalanceOf(alice),
                "Total static weight should consist of only alice",
            );
            await votingLockup.exit({ from: alice });

            stages["alice_withdraw"] = [await time.latestBlock(), await time.latest()];
            expect(await votingLockup.totalSupply()).bignumber.eq(new BN(0));
            expect(await votingLockup.balanceOf(alice)).bignumber.eq(new BN(0));
            expect(await votingLockup.balanceOf(bob)).bignumber.eq(new BN(0));
            expect(await votingLockup.staticBalanceOf(alice)).bignumber.eq(new BN(0));
            expect(await votingLockup.totalStaticWeight()).bignumber.eq(new BN(0));

            await time.increase(ONE_HOUR);
            await time.advanceBlock();

            /**
             * BEGIN PERIOD 2
             * Next week (for round counting)
             */

            nextUnixWeek = await nextUnixWeekStart();
            await time.increaseTo(nextUnixWeek);
            await fundVotingLockup(amount);

            await votingLockup.createLock(amount, (await time.latest()).add(ONE_WEEK.muln(2)), {
                from: alice,
            });
            stages["alice_deposit_2"] = [await time.latestBlock(), await time.latest()];

            assertBNClosePercent(
                await votingLockup.totalSupply(),
                amount
                    .div(MAXTIME)
                    .muln(2)
                    .mul(ONE_WEEK),
                tolerance,
            );
            assertBNClosePercent(
                await votingLockup.balanceOf(alice),
                amount
                    .div(MAXTIME)
                    .muln(2)
                    .mul(ONE_WEEK),
                tolerance,
            );
            expect(await votingLockup.balanceOf(bob)).bignumber.eq(new BN(0));

            await votingLockup.createLock(amount, (await time.latest()).add(ONE_WEEK.addn(1)), {
                from: bob,
            });
            stages["bob_deposit_2"] = [await time.latestBlock(), await time.latest()];

            assertBNClosePercent(
                await votingLockup.totalSupply(),
                amount
                    .div(MAXTIME)
                    .muln(3)
                    .mul(ONE_WEEK),
                tolerance,
            );
            assertBNClosePercent(
                await votingLockup.balanceOf(alice),
                amount
                    .div(MAXTIME)
                    .muln(2)
                    .mul(ONE_WEEK),
                tolerance,
            );
            assertBNClosePercent(
                await votingLockup.balanceOf(bob),
                amount.div(MAXTIME).mul(ONE_WEEK),
                tolerance,
            );
            let aliceStatic = await votingLockup.staticBalanceOf(alice);
            let bobStatic = await votingLockup.staticBalanceOf(bob);
            let totalStatic = await votingLockup.totalStaticWeight();

            assertBNClosePercent(
                aliceStatic,
                await calculateStaticBalance(ONE_WEEK.muln(2), amount),
                "0.1",
            );
            assertBNClosePercent(bobStatic, await calculateStaticBalance(ONE_WEEK, amount), "0.1");
            expect(totalStatic).bignumber.eq(aliceStatic.add(bobStatic));

            t0 = await time.latest();
            await time.increase(ONE_HOUR);
            await time.advanceBlock();

            let w_alice = new BN(0);
            let w_total = new BN(0);
            let w_bob = new BN(0);

            stages["alice_bob_in_2"] = [];
            // Beginning of week: weight 3
            // End of week: weight 1
            for (let i = 0; i < 7; i += 1) {
                for (let j = 0; j < 24; j += 1) {
                    await time.increase(ONE_HOUR);
                    await time.advanceBlock();
                }
                dt = (await time.latest()).sub(t0);
                const b = await time.latestBlock();
                w_total = await votingLockup.totalSupplyAt(b);
                w_alice = await votingLockup.balanceOfAt(alice, b);
                w_bob = await votingLockup.balanceOfAt(bob, b);
                expect(w_total).bignumber.eq(w_alice.add(w_bob));
                assertBNClosePercent(
                    w_alice,
                    amount.div(MAXTIME).mul(BN.max(ONE_WEEK.muln(2).sub(dt), new BN(0))),
                    tolerance,
                );
                assertBNClosePercent(
                    w_bob,
                    amount.div(MAXTIME).mul(BN.max(ONE_WEEK.sub(dt), new BN(0))),
                    tolerance,
                );
                stages["alice_bob_in_2"].push([await time.latestBlock(), await time.latest()]);
            }

            await time.increase(ONE_HOUR);
            await time.advanceBlock();

            await votingLockup.withdraw({ from: bob });
            t0 = await time.latest();
            stages["bob_withdraw_1"] = [await time.latestBlock(), await time.latest()];
            w_total = await votingLockup.totalSupply();
            w_alice = await votingLockup.balanceOf(alice);
            expect(w_alice).bignumber.eq(w_total);

            assertBNClosePercent(
                w_total,
                amount.div(MAXTIME).mul(ONE_WEEK.sub(ONE_HOUR.muln(2))),
                tolerance,
            );
            expect(await votingLockup.balanceOf(bob)).bignumber.eq(new BN(0));

            aliceStatic = await votingLockup.staticBalanceOf(alice);
            bobStatic = await votingLockup.staticBalanceOf(bob);
            totalStatic = await votingLockup.totalStaticWeight();

            assertBNClosePercent(
                aliceStatic,
                await calculateStaticBalance(ONE_WEEK.muln(2), amount),
                "0.1",
            );
            expect(bobStatic).bignumber.eq(new BN(0));
            expect(totalStatic).bignumber.eq(aliceStatic);

            await time.increase(ONE_HOUR);
            await time.advanceBlock();

            stages["alice_in_2"] = [];
            for (let i = 0; i < 7; i += 1) {
                for (let j = 0; j < 24; j += 1) {
                    await time.increase(ONE_HOUR);
                    await time.advanceBlock();
                }
                dt = (await time.latest()).sub(t0);
                w_total = await votingLockup.totalSupply();
                w_alice = await votingLockup.balanceOf(alice);
                expect(w_total).bignumber.eq(w_alice);
                assertBNClosePercent(
                    w_total,
                    amount
                        .div(MAXTIME)
                        .mul(BN.max(ONE_WEEK.sub(dt).sub(ONE_HOUR.muln(37).divn(18)), new BN(0))),
                    isCoverage ? "1" : "0.04",
                );
                expect(await votingLockup.balanceOf(bob)).bignumber.eq(new BN(0));
                stages["alice_in_2"].push([await time.latestBlock(), await time.latest()]);
            }

            await votingLockup.withdraw({ from: alice });
            stages["alice_withdraw_2"] = [await time.latestBlock(), await time.latest()];

            aliceStatic = await votingLockup.staticBalanceOf(alice);
            bobStatic = await votingLockup.staticBalanceOf(bob);
            totalStatic = await votingLockup.totalStaticWeight();

            expect(aliceStatic).bignumber.eq(new BN(0));
            expect(bobStatic).bignumber.eq(new BN(0));
            expect(totalStatic).bignumber.eq(new BN(0));

            await time.increase(ONE_HOUR);
            await time.advanceBlock();

            // votingLockup.withdraw({ from: bob });
            stages["bob_withdraw_2"] = [await time.latestBlock(), await time.latest()];

            expect(await votingLockup.totalSupply()).bignumber.eq(new BN(0));
            expect(await votingLockup.balanceOf(alice)).bignumber.eq(new BN(0));
            expect(await votingLockup.balanceOf(bob)).bignumber.eq(new BN(0));

            const aliceRewardsEarned1 = await votingLockup.rewardsPaid(alice);
            const aliceBalBefore = await mta.balanceOf(alice);
            const bobBalBefore = await mta.balanceOf(bob);
            await votingLockup.claimReward({ from: alice });
            await votingLockup.claimReward({ from: bob });
            const aliceRewardsEarned2 = await votingLockup.rewardsPaid(alice);
            const bobRewardsEarned = await votingLockup.rewardsPaid(bob);

            assertBNClosePercent(aliceRewardsEarned1, simpleToExactAmount("1000", 18), "0.01");
            assertBNClosePercent(aliceRewardsEarned2, simpleToExactAmount("1585.788", 18), "0.01");
            assertBNClosePercent(bobRewardsEarned, simpleToExactAmount("414.212", 18), "0.01");
            assertBNClosePercent(
                aliceRewardsEarned2.add(bobRewardsEarned),
                amount.muln(2),
                "0.0001",
            );
            console.log(
                (await mta.balanceOf(alice)).toString(),
                aliceBalBefore.toString(),
                aliceRewardsEarned2.toString(),
            );
            expect(await mta.balanceOf(alice)).bignumber.eq(
                aliceBalBefore.add(aliceRewardsEarned2.sub(aliceRewardsEarned1)),
            );
            expect(await mta.balanceOf(bob)).bignumber.eq(bobBalBefore.add(bobRewardsEarned));

            /**
             * END OF INTERACTION
             * BEGIN HISTORICAL ANALYSIS USING BALANCEOFAT
             */

            expect(
                await votingLockup.balanceOfAt(alice, stages["before_deposits"][0]),
            ).bignumber.eq(new BN(0));
            expect(await votingLockup.balanceOfAt(bob, stages["before_deposits"][0])).bignumber.eq(
                new BN(0),
            );
            expect(await votingLockup.totalSupplyAt(stages["before_deposits"][0])).bignumber.eq(
                new BN(0),
            );

            w_alice = await votingLockup.balanceOfAt(alice, stages["alice_deposit"][0]);
            assertBNClosePercent(
                w_alice,
                amount.div(MAXTIME).mul(ONE_WEEK.sub(ONE_HOUR)),
                tolerance,
            );
            expect(await votingLockup.balanceOfAt(bob, stages["alice_deposit"][0])).bignumber.eq(
                new BN(0),
            );
            w_total = await votingLockup.totalSupplyAt(stages["alice_deposit"][0]);
            expect(w_alice).bignumber.eq(w_total);

            for (let i = 0; i < stages["alice_in_0"].length; i += 1) {
                const [block] = stages["alice_in_0"][i];
                w_alice = await votingLockup.balanceOfAt(alice, block);
                w_bob = await votingLockup.balanceOfAt(bob, block);
                w_total = await votingLockup.totalSupplyAt(block);
                expect(w_bob).bignumber.eq(new BN(0));
                expect(w_alice).bignumber.eq(w_total);
                // TODO - Verify below has been ported correctly
                const time_left = ONE_WEEK.muln(7 - i)
                    .divn(7)
                    .sub(ONE_HOUR.muln(2));
                const error_1h = (ONE_HOUR.toNumber() * 100) / time_left.toNumber(); // Rounding error of 1 block is possible, and we have 1h blocks
                assertBNClosePercent(
                    w_alice,
                    amount.div(MAXTIME).mul(time_left),
                    error_1h.toString(),
                );
            }

            w_total = await votingLockup.totalSupplyAt(stages["alice_withdraw"][0]);
            w_alice = await votingLockup.balanceOfAt(alice, stages["alice_withdraw"][0]);
            w_bob = await votingLockup.balanceOfAt(bob, stages["alice_withdraw"][0]);
            expect(w_total).bignumber.eq(new BN(0));
            expect(w_alice).bignumber.eq(new BN(0));
            expect(w_bob).bignumber.eq(new BN(0));

            w_total = await votingLockup.totalSupplyAt(stages["alice_deposit_2"][0]);
            w_alice = await votingLockup.balanceOfAt(alice, stages["alice_deposit_2"][0]);
            w_bob = await votingLockup.balanceOfAt(bob, stages["alice_deposit_2"][0]);
            assertBNClosePercent(
                w_total,
                amount
                    .div(MAXTIME)
                    .muln(2)
                    .mul(ONE_WEEK),
                tolerance,
            );
            expect(w_total).bignumber.eq(w_alice);
            expect(w_bob).bignumber.eq(new BN(0));

            w_total = await votingLockup.totalSupplyAt(stages["bob_deposit_2"][0]);
            w_alice = await votingLockup.balanceOfAt(alice, stages["bob_deposit_2"][0]);
            w_bob = await votingLockup.balanceOfAt(bob, stages["bob_deposit_2"][0]);
            expect(w_total).bignumber.eq(w_alice.add(w_bob));
            assertBNClosePercent(
                w_total,
                amount
                    .div(MAXTIME)
                    .muln(3)
                    .mul(ONE_WEEK),
                tolerance,
            );
            assertBNClosePercent(
                w_alice,
                amount
                    .div(MAXTIME)
                    .muln(2)
                    .mul(ONE_WEEK),
                tolerance,
            );

            let error_1h = 0;
            [, t0] = stages["bob_deposit_2"];
            for (let i = 0; i < stages["alice_bob_in_2"].length; i += 1) {
                const [block, ts] = stages["alice_bob_in_2"][i];
                w_alice = await votingLockup.balanceOfAt(alice, block);
                w_bob = await votingLockup.balanceOfAt(bob, block);
                w_total = await votingLockup.totalSupplyAt(block);
                expect(w_total).bignumber.eq(w_alice.add(w_bob));
                dt = ts.sub(t0);
                error_1h =
                    (ONE_HOUR.toNumber() * 100) /
                    (2 * ONE_WEEK.toNumber() - i - ONE_DAY.toNumber());
                assertBNClosePercent(
                    w_alice,
                    amount.div(MAXTIME).mul(BN.max(ONE_WEEK.muln(2).sub(dt), new BN(0))),
                    error_1h.toString(),
                );
                assertBNClosePercent(
                    w_bob,
                    amount.div(MAXTIME).mul(BN.max(ONE_WEEK.sub(dt), new BN(0))),
                    error_1h.toString(),
                );
            }
            w_total = await votingLockup.totalSupplyAt(stages["bob_withdraw_1"][0]);
            w_alice = await votingLockup.balanceOfAt(alice, stages["bob_withdraw_1"][0]);
            w_bob = await votingLockup.balanceOfAt(bob, stages["bob_withdraw_1"][0]);
            expect(w_total).bignumber.eq(w_alice);
            assertBNClosePercent(
                w_total,
                amount.div(MAXTIME).mul(ONE_WEEK.sub(ONE_HOUR.muln(2))),
                tolerance,
            );
            expect(w_bob).bignumber.eq(new BN(0));

            [, t0] = stages["bob_withdraw_1"];
            for (let i = 0; i < stages["alice_in_2"].length; i += 1) {
                const [block, ts] = stages["alice_in_2"][i];
                w_alice = await votingLockup.balanceOfAt(alice, block);
                w_bob = await votingLockup.balanceOfAt(bob, block);
                w_total = await votingLockup.totalSupplyAt(block);
                expect(w_total).bignumber.eq(w_alice);
                expect(w_bob).bignumber.eq(new BN(0));
                dt = ts.sub(t0);
                error_1h =
                    (ONE_HOUR.toNumber() * 100) /
                    (ONE_WEEK.toNumber() - i * ONE_DAY.toNumber() + ONE_DAY.toNumber());
                assertBNClosePercent(
                    w_total,
                    amount
                        .div(MAXTIME)
                        .mul(BN.max(ONE_WEEK.sub(dt).sub(ONE_HOUR.muln(2)), new BN(0))),
                    error_1h.toString(),
                );
            }
            w_total = await votingLockup.totalSupplyAt(stages["bob_withdraw_2"][0]);
            w_alice = await votingLockup.balanceOfAt(alice, stages["bob_withdraw_2"][0]);
            w_bob = await votingLockup.balanceOfAt(bob, stages["bob_withdraw_2"][0]);
            expect(w_total).bignumber.eq(new BN(0));
            expect(w_alice).bignumber.eq(new BN(0));
            expect(w_bob).bignumber.eq(new BN(0));
        });
    });
});
