/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable spaced-comment */
/* eslint-disable @typescript-eslint/triple-slash-reference,spaced-comment */
/// <reference path="../../types/generated/index.d.ts" />
/// <reference path="../../types/generated/types.d.ts" />

import { simpleToExactAmount } from "@utils/math";

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

    const c_IncentivisedVotingLockup = artifacts.require("IncentivisedVotingLockup");

    const c_RewardsDistributor = artifacts.require("RewardsDistributor");
    const c_MetaToken = artifacts.require("MetaToken");
    const c_Nexus = artifacts.require("Nexus");

    /***************************************
  1. IncentivisedVotingLockup
  Dependencies: []
  ****************************************/
    const d_Nexus = await c_Nexus.deployed();
    const d_MetaToken = await c_MetaToken.deployed();
    const d_RewardsDistributor = await c_RewardsDistributor.deployed();
    await deployer.deploy(
        c_IncentivisedVotingLockup,
        d_MetaToken.address,
        "Voting MTA",
        "vMTA",
        d_Nexus.address,
        d_RewardsDistributor.address,
        {
            from: default_,
        },
    );
    const d_IncentivisedVotingLockup = await c_IncentivisedVotingLockup.deployed();

    if (deployer.network !== "mainnet") {
        await d_MetaToken.approve(d_RewardsDistributor.address, simpleToExactAmount(10000, 18), {
            from: default_,
        });
        await d_RewardsDistributor.distributeRewards(
            [d_IncentivisedVotingLockup.address],
            [simpleToExactAmount(10000, 18)],
            { from: default_ },
        );
    }
    console.log(`[IncentivisedVotingLockup]: '${d_IncentivisedVotingLockup.address}'`);
};
