/* eslint-disable dot-notation */
/* eslint-disable no-await-in-loop */
/* eslint-disable @typescript-eslint/camelcase */
import { network } from "hardhat";
import { expectRevert, time } from "@openzeppelin/test-helpers";
import { assertBNClose, assertBNClosePercent } from "@utils/assertions";
import { StandardAccounts } from "@utils/machines";
import envSetup from "@utils/env_setup";
import { simpleToExactAmount } from "@utils/math";
import { BN } from "@utils/tools";
import { ONE_WEEK, ONE_HOUR, ONE_DAY, ONE_YEAR } from "@utils/constants";
import * as t from "../../types/generated";

const VotingLockup = artifacts.require("IncentivisedVotingLockup");
const MetaToken = artifacts.require("MetaToken");
const Nexus = artifacts.require("Nexus");
const { expect } = envSetup.configure();

contract("IncentivisedVotingLockup", async (accounts) => {
    const sa = new StandardAccounts(accounts);
    let votingLockup: t.IncentivisedVotingLockupInstance;
    let mta: t.MetaTokenInstance;

    const isCoverage = network.name === "coverage";

    const fundVotingLockup = async (funding = simpleToExactAmount(100, 18)) => {
        await mta.transfer(votingLockup.address, funding, { from: sa.fundManager });
        await votingLockup.notifyRewardAmount(funding, { from: sa.fundManager });
    };

    const calculateStaticBalance = async (lockupLength: BN, amount: BN): Promise<BN> => {
        const slope = amount.div(await votingLockup.MAXTIME());
        const s = slope.muln(10000).muln(Math.sqrt(lockupLength.toNumber()));
        return s;
    };

    const goToNextUnixWeekStart = async () => {
        const unixWeekCount = (await time.latest()).div(ONE_WEEK);
        const nextUnixWeek = unixWeekCount.addn(1).mul(ONE_WEEK);
        await time.increaseTo(nextUnixWeek);
    };

    const oneWeekInAdvance = async (): Promise<BN> => {
        const now = await time.latest();
        return now.add(ONE_WEEK);
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
            it("fails for balanceOfAt", async () => {
                await expectRevert(
                    votingLockup.balanceOfAt(sa.default, (await time.latestBlock()).addn(1)),
                    "Must pass block number in the past",
                );
            });
            it("fails for supply", async () => {
                await expectRevert(
                    votingLockup.totalSupplyAt((await time.latestBlock()).addn(1)),
                    "Must pass block number in the past",
                );
            });
        });
    });

    interface LockedBalance {
        amount: BN;
        end: BN;
    }

    interface Point {
        bias: BN;
        slope: BN;
        ts: BN;
        blk?: BN;
    }

    interface ContractData {
        epoch: BN;
        userEpoch: BN;
        endTime: BN;
        totalStaticWeight: BN;
        userStaticWeight: BN;
        userLocked: LockedBalance;
        userLastPoint: Point;
        lastPoint: Point;
        senderStakingTokenBalance: BN;
        contractStakingTokenBalance: BN;
        userRewardPerTokenPaid: BN;
        beneficiaryRewardsEarned: BN;
        rewardPerTokenStored: BN;
        rewardRate: BN;
        rewardsPaid: BN;
        lastUpdateTime: BN;
        lastTimeRewardApplicable: BN;
        periodFinishTime: BN;
    }

    const snapshotData = async (sender = sa.default): Promise<ContractData> => {
        const locked = await votingLockup.locked(sender);
        const userLastPoint = await votingLockup.getLastUserPoint(sender);
        const epoch = await await votingLockup.globalEpoch();
        const userEpoch = await await votingLockup.userPointEpoch(sender);
        const lastPoint = await votingLockup.pointHistory(epoch);
        return {
            epoch,
            userEpoch,
            endTime: await votingLockup.END(),
            totalStaticWeight: await votingLockup.totalStaticWeight(),
            userStaticWeight: await votingLockup.staticBalanceOf(sender),
            userLocked: {
                amount: locked[0],
                end: locked[1],
            },
            userLastPoint: {
                bias: userLastPoint[0],
                slope: userLastPoint[1],
                ts: userLastPoint[2],
            },
            lastPoint: {
                bias: lastPoint[0],
                slope: lastPoint[1],
                ts: lastPoint[2],
                blk: lastPoint[3],
            },
            userRewardPerTokenPaid: await votingLockup.userRewardPerTokenPaid(sender),
            senderStakingTokenBalance: await mta.balanceOf(sender),
            contractStakingTokenBalance: await mta.balanceOf(votingLockup.address),
            beneficiaryRewardsEarned: await votingLockup.rewards(sender),
            rewardPerTokenStored: await votingLockup.rewardPerTokenStored(),
            rewardRate: await votingLockup.rewardRate(),
            rewardsPaid: await votingLockup.rewardsPaid(sender),
            lastUpdateTime: await votingLockup.lastUpdateTime(),
            lastTimeRewardApplicable: await votingLockup.lastTimeRewardApplicable(),
            periodFinishTime: await votingLockup.periodFinish(),
        };
    };

    // Flow performed with 4 stakers
    // 1 - stakes 10 for a year
    // 2 - stakes 1000 for 6 months
    //   - increases time after 3 to 12m
    // 3 - stakes 10 for 6 months
    //   - increases amount after 3
    //   - gets ejected after 6m
    // 4 - stakes 10 from 3-6 mo & exits
    // 5 - stakes 10 at start for 1 week
    describe("performing full system flow", () => {
        const alice = sa.default;
        const bob = sa.dummy1;
        const charlie = sa.dummy2;
        const david = sa.dummy3;
        const eve = sa.dummy4;
        const stakeAmt1 = simpleToExactAmount(10, 18);
        const stakeAmt2 = simpleToExactAmount(1000, 18);
        let start;
        let maxTime;
        before(async () => {
            await goToNextUnixWeekStart();
            start = await time.latest();
            await deployFresh(simpleToExactAmount(100, 18));
            maxTime = await votingLockup.MAXTIME();
            await mta.transfer(alice, simpleToExactAmount(1, 22), { from: sa.fundManager });
            await mta.transfer(bob, simpleToExactAmount(1, 22), { from: sa.fundManager });
            await mta.transfer(charlie, simpleToExactAmount(1, 22), { from: sa.fundManager });
            await mta.transfer(david, simpleToExactAmount(1, 22), { from: sa.fundManager });
            await mta.transfer(eve, simpleToExactAmount(1, 22), { from: sa.fundManager });
            await mta.approve(votingLockup.address, simpleToExactAmount(100, 21), { from: alice });
            await mta.approve(votingLockup.address, simpleToExactAmount(100, 21), { from: bob });
            await mta.approve(votingLockup.address, simpleToExactAmount(100, 21), {
                from: charlie,
            });
            await mta.approve(votingLockup.address, simpleToExactAmount(100, 21), { from: david });
            await mta.approve(votingLockup.address, simpleToExactAmount(100, 21), { from: eve });
        });
        describe("checking initial settings", () => {
            it("should set END date one year in advance", async () => {
                const endTime = await votingLockup.END();
                assertBNClose(endTime, (await time.latest()).add(ONE_YEAR), 100);
            });
            it("sets & gets duration", async () => {
                const duration = await votingLockup.getDuration();
                expect(duration).bignumber.eq(ONE_WEEK);
            });
            it("sets ERC20 details", async () => {
                const name = await votingLockup.name();
                const symbol = await votingLockup.symbol();
                const decimals = await votingLockup.decimals();
                const supply = await votingLockup.totalSupply();
                expect(name).eq("Voting MTA");
                expect(symbol).eq("vMTA");
                expect(decimals).bignumber.eq(new BN(18));
                expect(supply).bignumber.eq(new BN(0));
            });
        });

        const calcBias = (amount: BN, len: BN): BN => {
            return amount.div(maxTime).mul(len);
        };

        describe("creating a lockup", () => {
            it("allows user to create a lock", async () => {
                await votingLockup.createLock(stakeAmt1, start.add(ONE_YEAR), { from: alice });
                await votingLockup.createLock(stakeAmt2, start.add(ONE_WEEK.muln(26)), {
                    from: bob,
                });
                await votingLockup.createLock(stakeAmt1, start.add(ONE_WEEK.muln(26)), {
                    from: charlie,
                });
                await votingLockup.createLock(stakeAmt1, start.add(ONE_WEEK), {
                    from: eve,
                });

                const aliceData = await snapshotData(alice);
                const bobData = await snapshotData(bob);
                const charlieData = await snapshotData(charlie);
                const eveData = await snapshotData(eve);

                // Bias
                assertBNClosePercent(
                    aliceData.userLastPoint.bias,
                    calcBias(stakeAmt1, ONE_YEAR),
                    "0.4",
                );
                assertBNClosePercent(
                    bobData.userLastPoint.bias,
                    calcBias(stakeAmt2, ONE_WEEK.muln(26)),
                    "0.4",
                );
                assertBNClosePercent(
                    charlieData.userLastPoint.bias,
                    calcBias(stakeAmt1, ONE_WEEK.muln(26)),
                    "0.4",
                );

                // Static Balance
                assertBNClosePercent(
                    aliceData.userStaticWeight,
                    await calculateStaticBalance(ONE_YEAR, stakeAmt1),
                    "0.4",
                );
                assertBNClosePercent(
                    bobData.userStaticWeight,
                    await calculateStaticBalance(ONE_WEEK.muln(26), stakeAmt2),
                    "0.4",
                );
                assertBNClosePercent(
                    charlieData.userStaticWeight,
                    await calculateStaticBalance(ONE_WEEK.muln(26), stakeAmt1),
                    "0.4",
                );
                expect(charlieData.totalStaticWeight).bignumber.eq(
                    aliceData.userStaticWeight
                        .add(bobData.userStaticWeight)
                        .add(charlieData.userStaticWeight)
                        .add(eveData.userStaticWeight),
                );
            });
            it("rejects if the params are wrong", async () => {
                await expectRevert(
                    votingLockup.createLock(new BN(0), start.add(ONE_WEEK), { from: sa.other }),
                    "Must stake non zero amount",
                );
                await expectRevert(
                    votingLockup.createLock(new BN(1), start.add(ONE_WEEK), { from: alice }),
                    "Withdraw old tokens first",
                );
                await expectRevert(
                    votingLockup.createLock(new BN(1), start.sub(ONE_WEEK), { from: sa.other }),
                    "Can only lock until time in the future",
                );
            });
            it("only allows creation up until END date", async () => {
                await expectRevert(
                    votingLockup.createLock(new BN(1), start.add(ONE_YEAR.add(ONE_WEEK)), {
                        from: sa.other,
                    }),
                    "Voting lock can be 1 year max (until recol)",
                );
            });
        });

        describe("extending lock", () => {
            before(async () => {
                await time.increase(ONE_WEEK.muln(12));

                // Eves lock is now expired
            });
            describe("by amount", () => {
                it("fails if conditions are not met", async () => {
                    await expectRevert(
                        votingLockup.increaseLockAmount(new BN(0), { from: alice }),
                        "Must stake non zero amount",
                    );
                    await expectRevert(
                        votingLockup.increaseLockAmount(new BN(1), { from: sa.other }),
                        "No existing lock found",
                    );
                    await expectRevert(
                        votingLockup.increaseLockAmount(new BN(1), { from: eve }),
                        "Cannot add to expired lock. Withdraw",
                    );
                });
                it("allows someone to increase lock amount", async () => {
                    const charlieSnapBefore = await snapshotData(charlie);

                    await votingLockup.increaseLockAmount(stakeAmt2, { from: charlie });

                    const charlieSnapAfter = await snapshotData(charlie);

                    expect(charlieSnapAfter.totalStaticWeight).bignumber.eq(
                        charlieSnapBefore.totalStaticWeight
                            .sub(charlieSnapBefore.userStaticWeight)
                            .add(charlieSnapAfter.userStaticWeight),
                    );
                    assertBNClosePercent(
                        charlieSnapAfter.userStaticWeight,
                        await calculateStaticBalance(ONE_WEEK.muln(14), stakeAmt2.add(stakeAmt1)),
                        "0.4",
                    );
                });
            });

            describe("by length", () => {
                it("fails if conditions are not met", async () => {
                    await expectRevert(
                        votingLockup.increaseLockLength((await time.latest()).add(ONE_WEEK), {
                            from: eve,
                        }),
                        "Lock expired",
                    );
                    await expectRevert(
                        votingLockup.increaseLockLength((await time.latest()).add(ONE_WEEK), {
                            from: david,
                        }),
                        "Nothing is locked",
                    );
                    await expectRevert(
                        votingLockup.increaseLockLength((await time.latest()).add(ONE_DAY), {
                            from: alice,
                        }),
                        "Can only increase lock WEEK",
                    );
                    await expectRevert(
                        votingLockup.increaseLockLength(
                            (await time.latest()).add(ONE_WEEK.muln(42)),
                            {
                                from: bob,
                            },
                        ),
                        "Voting lock can be 1 year max (until recol)",
                    );

                    await expectRevert(
                        votingLockup.createLock(
                            stakeAmt1,
                            (await time.latest()).add(ONE_WEEK.muln(42)),
                            {
                                from: david,
                            },
                        ),
                        "Voting lock can be 1 year max (until recol)",
                    );
                });
                it("allows user to extend lock", async () => {
                    await goToNextUnixWeekStart();
                    const bobSnapBefore = await snapshotData(bob);
                    const len = bobSnapBefore.endTime.sub(await time.latest());
                    await votingLockup.increaseLockLength(start.add(ONE_YEAR), { from: bob });

                    const bobSnapAfter = await snapshotData(bob);

                    expect(bobSnapAfter.totalStaticWeight).bignumber.eq(
                        bobSnapBefore.totalStaticWeight
                            .sub(bobSnapBefore.userStaticWeight)
                            .add(bobSnapAfter.userStaticWeight),
                    );
                    assertBNClosePercent(
                        bobSnapAfter.userStaticWeight,
                        await calculateStaticBalance(len, stakeAmt2),
                        "0.4",
                    );
                });
            });
        });

        describe("trying to withdraw early or with nothing to withdraw", () => {
            it("fails", async () => {
                await expectRevert(
                    votingLockup.withdraw({ from: alice }),
                    "The lock didn't expire",
                );
                await expectRevert(
                    votingLockup.withdraw({ from: david }),
                    "Must have something to withdraw",
                );
            });
        });

        describe("calling public checkpoint", () => {
            // checkpoint updates point history
            it("allows anyone to call checkpoint and update the history", async () => {
                const before = await snapshotData(alice);
                await votingLockup.checkpoint();
                const after = await snapshotData(alice);

                expect(after.epoch).bignumber.eq(before.epoch.addn(1));
                expect(after.totalStaticWeight).bignumber.eq(before.totalStaticWeight);
                expect(after.lastPoint.bias).bignumber.lt(before.lastPoint.bias as any);
                expect(after.lastPoint.slope).bignumber.eq(before.lastPoint.slope);
                expect(after.lastPoint.blk).bignumber.eq(await time.latestBlock());
            });
        });

        describe("calling the getters", () => {
            // returns 0 if 0
            it("allows anyone to get last user point", async () => {
                const userLastPoint = await votingLockup.getLastUserPoint(alice);
                const e = await votingLockup.userPointEpoch(alice);
                const p = await votingLockup.userPointHistory(alice, e);
                expect(userLastPoint[0]).bignumber.eq(p[0]);
                expect(userLastPoint[1]).bignumber.eq(p[1]);
                expect(userLastPoint[2]).bignumber.eq(p[2]);
            });
        });

        describe("exiting the system", () => {
            before(async () => {
                await votingLockup.createLock(
                    stakeAmt1,
                    (await time.latest()).add(ONE_WEEK.muln(13)),
                    {
                        from: david,
                    },
                );
                await time.increase(ONE_WEEK.muln(14));
            });
            it("allows user to withdraw", async () => {
                // david withdraws
                const davidBefore = await snapshotData(david);
                await votingLockup.withdraw({ from: david });
                const davidAfter = await snapshotData(david);

                expect(davidAfter.totalStaticWeight).bignumber.eq(
                    davidBefore.totalStaticWeight.sub(davidBefore.userStaticWeight),
                );
                expect(davidAfter.senderStakingTokenBalance).bignumber.eq(
                    davidBefore.senderStakingTokenBalance.add(davidBefore.userLocked.amount),
                );
                expect(davidAfter.userLastPoint.bias).bignumber.eq(new BN(0));
                expect(davidAfter.userLastPoint.slope).bignumber.eq(new BN(0));
                expect(davidAfter.userLocked.amount).bignumber.eq(new BN(0));
                expect(davidAfter.userLocked.end).bignumber.eq(new BN(0));
            });
            // cant eject a user if they haven't finished lockup yet
            it("kicks a user and withdraws their stake", async () => {
                // charlie is ejected
                const charlieBefore = await snapshotData(charlie);
                await votingLockup.eject(charlie, { from: david });
                const charlieAfter = await snapshotData(charlie);

                expect(charlieAfter.totalStaticWeight).bignumber.eq(
                    charlieBefore.totalStaticWeight.sub(charlieBefore.userStaticWeight),
                );
                expect(charlieAfter.senderStakingTokenBalance).bignumber.eq(
                    charlieBefore.senderStakingTokenBalance.add(charlieBefore.userLocked.amount),
                );
                expect(charlieAfter.userLastPoint.bias).bignumber.eq(new BN(0));
                expect(charlieAfter.userLastPoint.slope).bignumber.eq(new BN(0));
                expect(charlieAfter.userLocked.amount).bignumber.eq(new BN(0));
                expect(charlieAfter.userLocked.end).bignumber.eq(new BN(0));

                await expectRevert(
                    votingLockup.eject(alice, { from: bob }),
                    "Users lock didn't expire",
                );
            });
            it("fully exits the system", async () => {
                // eve exits
                const eveBefore = await snapshotData(eve);
                await votingLockup.exit({ from: eve });
                const eveAfter = await snapshotData(eve);

                expect(eveAfter.totalStaticWeight).bignumber.eq(
                    eveBefore.totalStaticWeight.sub(eveBefore.userStaticWeight),
                );
                expect(eveAfter.senderStakingTokenBalance).bignumber.eq(
                    eveBefore.senderStakingTokenBalance
                        .add(eveBefore.userLocked.amount)
                        .add(eveAfter.rewardsPaid),
                );
                expect(eveAfter.userLastPoint.bias).bignumber.eq(new BN(0));
                expect(eveAfter.userLastPoint.slope).bignumber.eq(new BN(0));
                expect(eveAfter.userLocked.amount).bignumber.eq(new BN(0));
                expect(eveAfter.userLocked.end).bignumber.eq(new BN(0));
            });
        });

        describe("expiring the contract", () => {
            before(async () => {
                await fundVotingLockup(simpleToExactAmount(1, 18));
            });
            // cant stake after expiry
            // cant notify after expiry
            it("must be done after final period finishes", async () => {
                await expectRevert(
                    votingLockup.expireContract({ from: sa.governor }),
                    "Period must be over",
                );
                await time.increase(ONE_WEEK.muln(2));

                await expectRevert(
                    votingLockup.withdraw({ from: alice }),
                    "The lock didn't expire",
                );

                await votingLockup.expireContract({ from: sa.governor });
                expect(await votingLockup.expired()).eq(true);
            });
            it("expires the contract and unlocks all stakes", async () => {
                await expectRevert(
                    votingLockup.createLock(new BN(1), (await time.latest()).add(ONE_WEEK), {
                        from: sa.other,
                    }),
                    "Contract is expired",
                );
                await votingLockup.exit({ from: alice });
                await votingLockup.exit({ from: bob });
                await votingLockup.claimReward({ from: charlie });
                await votingLockup.claimReward({ from: david });

                const aliceAfter = await snapshotData(alice);
                const bobAfter = await snapshotData(bob);
                const charlieAfter = await snapshotData(charlie);
                const davidAfter = await snapshotData(david);
                const eveAfter = await snapshotData(eve);
                expect(aliceAfter.userLocked.amount).bignumber.eq(new BN(0));
                expect(aliceAfter.userLocked.end).bignumber.eq(new BN(0));

                assertBNClosePercent(
                    simpleToExactAmount(101, 18),
                    aliceAfter.rewardsPaid
                        .add(bobAfter.rewardsPaid)
                        .add(charlieAfter.rewardsPaid)
                        .add(davidAfter.rewardsPaid)
                        .add(eveAfter.rewardsPaid),
                    "0.0001",
                );
            });
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

            await goToNextUnixWeekStart();
            await time.increase(ONE_HOUR);
            await fundVotingLockup(amount);

            stages["before_deposits"] = [await time.latestBlock(), await time.latest()];

            await votingLockup.createLock(amount, (await time.latest()).add(ONE_WEEK.addn(1)), {
                from: alice,
            });
            stages["alice_deposit"] = [await time.latestBlock(), await time.latest()];

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

            await goToNextUnixWeekStart();
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
