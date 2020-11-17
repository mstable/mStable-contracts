import { expectRevert, expectEvent } from "@openzeppelin/test-helpers";

import { StandardAccounts, SystemMachine } from "@utils/machines";
import { simpleToExactAmount } from "@utils/math";
import { BN } from "@utils/tools";

import { ZERO_ADDRESS } from "@utils/constants";
import envSetup from "@utils/env_setup";
import * as t from "types/generated";
import shouldBehaveLikeModule from "../shared/behaviours/Module.behaviour";

const MockERC20 = artifacts.require("MockERC20");
const MockRewardsDistributionRecipient = artifacts.require("MockRewardsDistributionRecipient");
const RewardsDistributor = artifacts.require("RewardsDistributor");

const { expect } = envSetup.configure();

contract("RewardsDistributor", async (accounts) => {
    const ctx: {
        module?: t.ModuleInstance;
    } = {};
    const sa = new StandardAccounts(accounts);
    let systemMachine: SystemMachine;

    let rewardsDistributor: t.RewardsDistributorInstance;

    const redeployRewards = async (
        nexusAddress = systemMachine.nexus.address,
    ): Promise<t.RewardsDistributorInstance> => {
        return RewardsDistributor.new(nexusAddress, [sa.fundManager]);
    };

    before(async () => {
        systemMachine = new SystemMachine(sa.all);
        await systemMachine.initialiseMocks(false, false);
        rewardsDistributor = await redeployRewards();
    });

    describe("verifying Module initialization", async () => {
        before(async () => {
            rewardsDistributor = await redeployRewards();
            ctx.module = rewardsDistributor as t.ModuleInstance;
        });

        shouldBehaveLikeModule(ctx as Required<typeof ctx>, sa);

        it("should properly store valid arguments", async () => {
            expect(await rewardsDistributor.nexus()).eq(systemMachine.nexus.address);
            // check for whitelisted accs
            const whitelisted = await rewardsDistributor.whitelist(sa.fundManager);
            expect(whitelisted).eq(true);
            // check for non whitelisted accs
            const whitelisted2 = await rewardsDistributor.whitelist(sa.default);
            expect(whitelisted2).eq(false);
            const whitelisted3 = await rewardsDistributor.whitelist(sa.governor);
            expect(whitelisted3).eq(false);
        });
    });
    describe("adding FundManagers", async () => {
        beforeEach(async () => {
            rewardsDistributor = await redeployRewards();
        });
        context("governor trying to add FundManager", async () => {
            it("should add the address to whitelisted", async () => {
                let whitelisted = await rewardsDistributor.whitelist(sa.dummy1);
                expect(whitelisted).eq(false);

                const tx = await rewardsDistributor.addFundManager(sa.dummy1, {
                    from: sa.governor,
                });
                expectEvent(tx.receipt, "Whitelisted", {
                    _address: sa.dummy1,
                });

                whitelisted = await rewardsDistributor.whitelist(sa.dummy1);
                expect(whitelisted).eq(true);

                await expectRevert(
                    rewardsDistributor.addFundManager(sa.dummy1, { from: sa.governor }),
                    "Already whitelisted",
                );
            });
            it("should revert if 0 address", async () => {
                const whitelisted = await rewardsDistributor.whitelist(ZERO_ADDRESS);
                expect(whitelisted).eq(false);

                await expectRevert(
                    rewardsDistributor.addFundManager(ZERO_ADDRESS, { from: sa.governor }),
                    "Address is zero",
                );
            });
        });
        context("non-governor trying to add FundManager", async () => {
            it("should always fail", async () => {
                await expectRevert(
                    rewardsDistributor.addFundManager(sa.dummy2, { from: sa.default }),
                    "Only governor can execute",
                );
                await expectRevert(
                    rewardsDistributor.addFundManager(sa.dummy2, { from: sa.dummy1 }),
                    "Only governor can execute",
                );
            });
        });
        context("FundManager trying to add FundManager", async () => {
            it("should always fail", async () => {
                await rewardsDistributor.addFundManager(sa.dummy3, {
                    from: sa.governor,
                });
                const whitelisted = await rewardsDistributor.whitelist(sa.dummy3);
                expect(whitelisted).eq(true);

                await expectRevert(
                    rewardsDistributor.addFundManager(sa.dummy1, { from: sa.dummy3 }),
                    "Only governor can execute",
                );
            });
        });
    });
    describe("removing FundManagers", async () => {
        beforeEach(async () => {
            rewardsDistributor = await redeployRewards();
        });
        context("governor trying to remove FundManager", async () => {
            it("should remove the address from whitelisted", async () => {
                // Set up the state
                await rewardsDistributor.addFundManager(sa.dummy1, {
                    from: sa.governor,
                });
                let whitelisted = await rewardsDistributor.whitelist(sa.dummy1);
                expect(whitelisted).eq(true);

                // Now remove the whitelist
                const tx = await rewardsDistributor.removeFundManager(sa.dummy1, {
                    from: sa.governor,
                });
                expectEvent(tx.receipt, "RemovedFundManager", {
                    _address: sa.dummy1,
                });

                whitelisted = await rewardsDistributor.whitelist(sa.dummy1);
                expect(whitelisted).eq(false);
            });
            it("should revert if address is not whitelisted", async () => {
                await expectRevert(
                    rewardsDistributor.removeFundManager(sa.dummy1, { from: sa.governor }),
                    "Address is not whitelisted",
                );
            });
            it("should revert if 0 address", async () => {
                await expectRevert(
                    rewardsDistributor.removeFundManager(ZERO_ADDRESS, { from: sa.governor }),
                    "Address is zero",
                );
            });
        });
        context("non-governor trying to remove FundManager", async () => {
            it("should always fail", async () => {
                await expectRevert(
                    rewardsDistributor.removeFundManager(sa.dummy2, { from: sa.default }),
                    "Only governor can execute",
                );
                await expectRevert(
                    rewardsDistributor.removeFundManager(sa.dummy2, { from: sa.dummy1 }),
                    "Only governor can execute",
                );
            });
        });
        context("FundManager trying to remove FundManager", async () => {
            it("should always fail", async () => {
                await rewardsDistributor.addFundManager(sa.dummy3, {
                    from: sa.governor,
                });
                await rewardsDistributor.addFundManager(sa.dummy4, {
                    from: sa.governor,
                });
                expect(await rewardsDistributor.whitelist(sa.dummy3)).eq(true);
                expect(await rewardsDistributor.whitelist(sa.dummy4)).eq(true);

                await expectRevert(
                    rewardsDistributor.removeFundManager(sa.dummy3, { from: sa.dummy4 }),
                    "Only governor can execute",
                );

                await expectRevert(
                    rewardsDistributor.removeFundManager(sa.dummy3, { from: sa.dummy3 }),
                    "Only governor can execute",
                );
            });
        });
    });
    describe("distributing rewards", async () => {
        context("when called by a fundManager", async () => {
            context("and passed invalid args", async () => {
                beforeEach(async () => {
                    rewardsDistributor = await redeployRewards();
                });
                it("should fail if arrays are empty", async () => {
                    await expectRevert(
                        rewardsDistributor.distributeRewards([], [], { from: sa.fundManager }),
                        "Must choose recipients",
                    );
                });
                it("should fail if arrays are mismatched", async () => {
                    await expectRevert(
                        rewardsDistributor.distributeRewards([sa.dummy1, sa.dummy2], [1], {
                            from: sa.fundManager,
                        }),
                        "Mismatching inputs",
                    );
                    await expectRevert(
                        rewardsDistributor.distributeRewards([sa.dummy1], [1, 2], {
                            from: sa.fundManager,
                        }),
                        "Mismatching inputs",
                    );
                });
            });
            context("and passed expected args", async () => {
                let rewardToken1: t.MockERC20Instance;
                let rewardToken2: t.MockERC20Instance;
                let rewardRecipient1: t.MockRewardsDistributionRecipientInstance;
                let rewardRecipient2: t.MockRewardsDistributionRecipientInstance;
                let rewardRecipient3: t.MockRewardsDistributionRecipientInstance;
                beforeEach(async () => {
                    rewardToken1 = await MockERC20.new("R1", "R1", 18, sa.fundManager, 1000000);
                    rewardToken2 = await MockERC20.new("R1", "R1", 18, sa.dummy1, 1000000);
                    rewardRecipient1 = await MockRewardsDistributionRecipient.new(
                        rewardToken1.address,
                    );
                    rewardRecipient2 = await MockRewardsDistributionRecipient.new(
                        rewardToken1.address,
                    );
                    rewardRecipient3 = await MockRewardsDistributionRecipient.new(
                        rewardToken2.address,
                    );
                    rewardsDistributor = await redeployRewards();
                });
                it("should still notify if amount is 0", async () => {
                    const tx = await rewardsDistributor.distributeRewards(
                        [rewardRecipient1.address],
                        [0],
                        { from: sa.fundManager },
                    );
                    expectEvent(tx.receipt, "DistributedReward", {
                        funder: sa.fundManager,
                        recipient: rewardRecipient1.address,
                        rewardToken: rewardToken1.address,
                        amount: new BN(0),
                    });
                });
                it("should transfer the rewardToken to all recipients", async () => {
                    const oneToken = simpleToExactAmount(1, 18);
                    const twoToken = simpleToExactAmount(2, 18);
                    await rewardToken1.approve(rewardsDistributor.address, twoToken, {
                        from: sa.fundManager,
                    });
                    const funderBalBefore = await rewardToken1.balanceOf(sa.fundManager);
                    const recipient1BalBefore = await rewardToken1.balanceOf(
                        rewardRecipient1.address,
                    );
                    const recipient2BalBefore = await rewardToken1.balanceOf(
                        rewardRecipient2.address,
                    );
                    const tx = await rewardsDistributor.distributeRewards(
                        [rewardRecipient1.address, rewardRecipient2.address],
                        [oneToken, oneToken],
                        { from: sa.fundManager },
                    );
                    expectEvent(tx.receipt, "DistributedReward", {
                        funder: sa.fundManager,
                        recipient: rewardRecipient1.address,
                        rewardToken: rewardToken1.address,
                        amount: oneToken,
                    });
                    expectEvent(tx.receipt, "DistributedReward", {
                        funder: sa.fundManager,
                        recipient: rewardRecipient2.address,
                        rewardToken: rewardToken1.address,
                        amount: oneToken,
                    });
                    const funderBalAfter = await rewardToken1.balanceOf(sa.fundManager);
                    const recipient1BalAfter = await rewardToken1.balanceOf(
                        rewardRecipient1.address,
                    );
                    const recipient2BalAfter = await rewardToken1.balanceOf(
                        rewardRecipient2.address,
                    );
                    expect(funderBalAfter).bignumber.eq(funderBalBefore.sub(twoToken));
                    expect(recipient1BalAfter).bignumber.eq(recipient1BalBefore.add(oneToken));
                    expect(recipient2BalAfter).bignumber.eq(recipient2BalBefore.add(oneToken));
                });
                it("should fail if funder has insufficient rewardToken balance", async () => {
                    const oneToken = simpleToExactAmount(1, 18);
                    await rewardToken2.approve(rewardsDistributor.address, oneToken, {
                        from: sa.fundManager,
                    });
                    const funderBalBefore = await rewardToken2.balanceOf(sa.fundManager);
                    expect(funderBalBefore).bignumber.eq(new BN(0));
                    await expectRevert(
                        rewardsDistributor.distributeRewards(
                            [rewardRecipient3.address],
                            [oneToken],
                            { from: sa.fundManager },
                        ),
                        "SafeERC20: low-level call failed",
                    );
                });
                it("should fail if sender doesn't give approval", async () => {
                    const oneToken = simpleToExactAmount(1, 18);
                    const funderBalBefore = await rewardToken1.balanceOf(sa.fundManager);
                    expect(funderBalBefore).bignumber.gte(oneToken as any);
                    await expectRevert(
                        rewardsDistributor.distributeRewards(
                            [rewardRecipient1.address, rewardRecipient2.address],
                            [oneToken, oneToken],
                            { from: sa.fundManager },
                        ),
                        "SafeERC20: low-level call failed",
                    );
                });
                it("should fail if recipient doesn't implement IRewardsDistributionRecipient interface", async () => {
                    const oneToken = simpleToExactAmount(1, 18);
                    await rewardToken1.approve(rewardsDistributor.address, oneToken, {
                        from: sa.fundManager,
                    });
                    const funderBalBefore = await rewardToken1.balanceOf(sa.fundManager);
                    expect(funderBalBefore).bignumber.gte(oneToken as any);
                    await expectRevert.unspecified(
                        rewardsDistributor.distributeRewards([sa.dummy1], [oneToken], {
                            from: sa.fundManager,
                        }),
                    );
                });
            });
            context("and passed valid array with duplicate address", async () => {
                let rewardToken1: t.MockERC20Instance;
                let rewardRecipient1: t.MockRewardsDistributionRecipientInstance;
                beforeEach(async () => {
                    rewardToken1 = await MockERC20.new("R1", "R1", 18, sa.fundManager, 1000000);
                    rewardRecipient1 = await MockRewardsDistributionRecipient.new(
                        rewardToken1.address,
                    );
                    rewardsDistributor = await redeployRewards();
                });
                it("should send out reward to duplicate address", async () => {
                    const oneToken = simpleToExactAmount(1, 18);
                    const twoToken = simpleToExactAmount(2, 18);
                    await rewardToken1.approve(rewardsDistributor.address, twoToken, {
                        from: sa.fundManager,
                    });
                    const funderBalBefore = await rewardToken1.balanceOf(sa.fundManager);
                    const recipient1BalBefore = await rewardToken1.balanceOf(
                        rewardRecipient1.address,
                    );
                    const tx = await rewardsDistributor.distributeRewards(
                        [rewardRecipient1.address, rewardRecipient1.address],
                        [oneToken, oneToken],
                        { from: sa.fundManager },
                    );
                    expectEvent(tx.receipt, "DistributedReward", {
                        funder: sa.fundManager,
                        recipient: rewardRecipient1.address,
                        rewardToken: rewardToken1.address,
                        amount: oneToken,
                    });
                    const funderBalAfter = await rewardToken1.balanceOf(sa.fundManager);
                    const recipient1BalAfter = await rewardToken1.balanceOf(
                        rewardRecipient1.address,
                    );
                    expect(funderBalAfter).bignumber.eq(funderBalBefore.sub(twoToken));
                    expect(recipient1BalAfter).bignumber.eq(recipient1BalBefore.add(twoToken));
                });
            });
            context("and passed some null addresses", async () => {
                let rewardToken1: t.MockERC20Instance;
                let rewardRecipient1: t.MockRewardsDistributionRecipientInstance;
                beforeEach(async () => {
                    rewardToken1 = await MockERC20.new("R1", "R1", 18, sa.fundManager, 1000000);
                    rewardRecipient1 = await MockRewardsDistributionRecipient.new(
                        rewardToken1.address,
                    );
                    rewardsDistributor = await redeployRewards();
                });
                it("should fail", async () => {
                    const oneToken = simpleToExactAmount(1, 18);
                    const twoToken = simpleToExactAmount(2, 18);
                    await rewardToken1.approve(rewardsDistributor.address, twoToken, {
                        from: sa.fundManager,
                    });
                    const funderBalBefore = await rewardToken1.balanceOf(sa.fundManager);
                    expect(funderBalBefore).bignumber.gte(simpleToExactAmount(2, 18) as any);
                    await expectRevert.unspecified(
                        rewardsDistributor.distributeRewards(
                            [rewardRecipient1.address, ZERO_ADDRESS],
                            [oneToken, oneToken],
                            { from: sa.fundManager },
                        ),
                    );
                });
            });
        });
        context("when called by other", async () => {
            it("should not allow governor to distribute", async () => {
                await expectRevert(
                    rewardsDistributor.distributeRewards([sa.default], [1], { from: sa.governor }),
                    "Not a whitelisted address",
                );
            });
            it("should not allow old fund managers to distribute", async () => {
                await rewardsDistributor.removeFundManager(sa.fundManager, { from: sa.governor });
                expect(await rewardsDistributor.whitelist(sa.governor)).eq(false);
                await expectRevert(
                    rewardsDistributor.distributeRewards([sa.default], [1], {
                        from: sa.fundManager,
                    }),
                    "Not a whitelisted address",
                );
            });
            it("should not allow others to distribute", async () => {
                await expectRevert(
                    rewardsDistributor.distributeRewards([sa.default], [1], { from: sa.dummy1 }),
                    "Not a whitelisted address",
                );
                await expectRevert(
                    rewardsDistributor.distributeRewards([sa.default], [1], { from: sa.default }),
                    "Not a whitelisted address",
                );
            });
        });
    });
});
