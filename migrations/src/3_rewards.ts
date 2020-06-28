/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable spaced-comment */
/* eslint-disable @typescript-eslint/triple-slash-reference,spaced-comment */
/// <reference path="../../types/generated/index.d.ts" />
/// <reference path="../../types/generated/types.d.ts" />

export default async (
    { artifacts }: { artifacts: Truffle.Artifacts },
    deployer,
    network,
    accounts,
): Promise<void> => {
    if (deployer.network === "fork") {
        // Don't bother running these migrations -- speed up the testing
        return;
    }

    const [default_] = accounts;

    /***************************************
    0. IMPORTS
    ****************************************/

    const c_MetaToken = artifacts.require("MetaToken");
    // Rewards contracts
    const c_RewardsDistributor = artifacts.require("RewardsDistributor");
    const c_RewardsVault = artifacts.require("RewardsVault");
    const c_StakingRewards = artifacts.require("StakingRewards");
    const c_StakingRewardsWithPlatformToken = artifacts.require("StakingRewardsWithPlatformToken");
    // Mock ERC20
    const c_MockERC20 = artifacts.require("MockERC20");
    const c_Nexus = artifacts.require("Nexus");

    /***************************************
    1. Meta
    Dependencies: []
    ****************************************/
    const d_Nexus = await c_Nexus.deployed();
    await deployer.deploy(c_MetaToken, d_Nexus.address, default_, { from: default_ });
    const d_MetaToken = await c_MetaToken.deployed();

    /***************************************
    2. StakingRewards
    ****************************************/

    const rewardsDistributor = await c_RewardsDistributor.new(d_Nexus.address, [default_]);
    const rewardsVault = await c_RewardsVault.new(d_Nexus.address, d_MetaToken.address);

    if (network === "development") {
        const stakingToken1 = await c_MockERC20.new("STAKE", "ST8", 18, default_, 1000000);
        const stakingRewards = await c_StakingRewards.new(
            d_Nexus.address,
            stakingToken1.address,
            d_MetaToken.address,
            rewardsVault.address,
            rewardsDistributor.address,
        );

        const stakingToken2 = await c_MockERC20.new("STAKE2", "ST82", 18, default_, 1000000);
        const platformToken = await c_MockERC20.new("PLATFRM", "PLAT", 14, default_, 1000000);
        const stakingRewardsWithPlatformToken = await c_StakingRewardsWithPlatformToken.new(
            d_Nexus.address,
            stakingToken2.address,
            d_MetaToken.address,
            platformToken.address,
            rewardsVault.address,
            rewardsDistributor.address,
        );

        console.log(`[StakingRewards]: '${stakingRewards.address}'`);
        console.log(`[StakingToken1]: '${stakingToken1.address}'`);
        console.log(
            `[StakingRewardsWithPlatformToken]: '${stakingRewardsWithPlatformToken.address}'`,
        );
        console.log(`[StakingToken2]: '${stakingToken2.address}'`);
        console.log(`[PlatformToken]: '${platformToken.address}'`);
    }

    console.log(`[Meta]: '${d_MetaToken.address}'`);
    console.log(`[RewardsVault]: '${rewardsVault.address}'`);
    console.log(`[RewardsDistributor]: '${rewardsDistributor.address}'`);
};
