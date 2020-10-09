/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable consistent-return */

import { expectRevert, time } from "@openzeppelin/test-helpers";
import { network } from "@nomiclabs/buidler";
import { BN } from "@utils/tools";
import { assertBNSlightlyGTPercent, assertBNClosePercent } from "@utils/assertions";
import { StandardAccounts, SystemMachine, MassetMachine } from "@utils/machines";
import { ZERO_ADDRESS, ONE_WEEK } from "@utils/constants";
import { simpleToExactAmount } from "@utils/math";

import envSetup from "@utils/env_setup";
import * as t from "../../../types/generated";
import { BassetIntegrationDetails } from "../../../types";

const { expect } = envSetup.configure();

const c_MockAaveAToken = artifacts.require("MockAToken");
const c_Nexus = artifacts.require("Nexus");

const c_ERC20 = artifacts.require("ERC20Detailed");
const c_AaveAToken = artifacts.require("IAaveAToken");
const c_DelayedProxyAdmin = artifacts.require("DelayedProxyAdmin");

// Proxy
const c_InitializableProxy = artifacts.require(
    // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
    // @ts-ignore
    "@openzeppelin/upgrades/InitializableAdminUpgradeabilityProxy",
) as t.InitializableAdminUpgradeabilityProxyContract;

// Implementation contract
const c_AaveIntegrationV1 = artifacts.require("MockAaveIntegrationV1");
const c_AaveIntegrationV2 = artifacts.require("MockAaveIntegration");

// Official Aave platform
const c_MockAaveV1 = artifacts.require("MockAaveV1");
const c_MockAaveV2 = artifacts.require("MockAave");

contract("AaveIntegration", async (accounts) => {
    const isCoverage = network.name === "coverage";
    const sa = new StandardAccounts(accounts);

    let systemMachine: SystemMachine;
    let nexus: t.NexusInstance;
    let massetMachine: MassetMachine;

    let integrationDetails: BassetIntegrationDetails;
    let d_DelayedProxyAdmin: t.DelayedProxyAdminInstance;
    let d_AaveIntegrationProxy: t.InitializableAdminUpgradeabilityProxyInstance;

    let d_AaveIntegrationV1: t.MockAaveIntegrationV1Instance;
    let d_AaveIntegrationV2: t.MockAaveIntegrationInstance;

    before("base init", async () => {
        systemMachine = new SystemMachine(sa.all);
        massetMachine = systemMachine.massetMachine;

        await runSetup(false, false);
    });

    const runSetup = async (enableUSDTFee = false, simulateMint = false) => {
        // SETUP
        // ======
        nexus = await c_Nexus.new(sa.governor);
        // Init proxyAdmin
        d_DelayedProxyAdmin = await c_DelayedProxyAdmin.new(nexus.address);
        // Initialize the proxy
        d_AaveIntegrationProxy = await c_InitializableProxy.new();
        d_AaveIntegrationV1 = await c_AaveIntegrationV1.at(d_AaveIntegrationProxy.address);

        // Load network specific integration data
        integrationDetails = await massetMachine.loadBassets(enableUSDTFee, true);

        // Initialize the proxy storage
        const aaveImplementation = await c_AaveIntegrationV1.new();

        const initializationData_AaveIntegration: string = aaveImplementation.contract.methods
            .initialize(
                nexus.address,
                [sa.default],
                integrationDetails.aavePlatformAddress,
                integrationDetails.aTokens.map((a) => a.bAsset),
                integrationDetails.aTokens.map((a) => a.aToken),
            )
            .encodeABI();
        await d_AaveIntegrationProxy.methods["initialize(address,address,bytes)"](
            aaveImplementation.address,
            d_DelayedProxyAdmin.address,
            initializationData_AaveIntegration,
        );

        await nexus.initialize(
            [web3.utils.keccak256("ProxyAdmin")],
            [d_DelayedProxyAdmin.address],
            [true],
            sa.governor,
            { from: sa.governor },
        );

        if (simulateMint) {
            await Promise.all(
                integrationDetails.aTokens.map(async ({ bAsset, aToken }) => {
                    // Step 0. Choose tokens
                    const d_bAsset = await c_ERC20.at(bAsset);
                    const bAsset_decimals = await d_bAsset.decimals();
                    const amount = new BN(enableUSDTFee ? 101 : 100).mul(
                        new BN(10).pow(bAsset_decimals.sub(new BN(1))),
                    );
                    const amount_dep = new BN(100).mul(
                        new BN(10).pow(bAsset_decimals.sub(new BN(1))),
                    );
                    // Step 1. xfer tokens to integration
                    await d_bAsset.transfer(d_AaveIntegrationV1.address, amount.toString());
                    // Step 2. call deposit
                    return d_AaveIntegrationV1.deposit(bAsset, amount_dep.toString(), true);
                }),
            );
        }
    };

    interface Data {
        balance0: BN;
        balance1: BN;
    }

    describe("handling the migration", async () => {
        let bAsset0: t.Erc20DetailedInstance;
        let bAsset1: t.Erc20DetailedInstance;
        let aToken0: t.IAaveATokenInstance;
        let aToken1: t.IAaveATokenInstance;

        let mockAaveV1: t.MockAaveV1Instance;
        let mockAaveV2: t.MockAaveInstance;
        let newAToken0: t.MockATokenInstance;
        let newAToken1: t.MockATokenInstance;

        let beforeData: Data;
        // The migration happens >
        before("Aave performs the migration on their end", async () => {
            await runSetup(false, true);
            bAsset0 = await c_ERC20.at(integrationDetails.aTokens[0].bAsset);
            bAsset1 = await c_ERC20.at(integrationDetails.aTokens[1].bAsset);
            aToken0 = await c_AaveAToken.at(integrationDetails.aTokens[0].aToken);
            aToken1 = await c_AaveAToken.at(integrationDetails.aTokens[1].aToken);

            const balance0 = await aToken0.balanceOf(d_AaveIntegrationProxy.address);
            const balance1 = await aToken1.balanceOf(d_AaveIntegrationProxy.address);
            beforeData = { balance0, balance1 };

            // Create a new mock Aave instance for V2
            // Assumes the same interface is used
            mockAaveV1 = await c_MockAaveV1.at(integrationDetails.aavePlatformAddress);
            mockAaveV2 = await c_MockAaveV2.new({ from: sa.default });

            // Create a new mock AToken instance for V2
            newAToken0 = await c_MockAaveAToken.new(mockAaveV2.address, bAsset0.address);
            await mockAaveV2.addAToken(newAToken0.address, bAsset0.address);
            newAToken1 = await c_MockAaveAToken.new(mockAaveV2.address, bAsset1.address);
            await mockAaveV2.addAToken(newAToken1.address, bAsset1.address);

            // Upgrade the aave lending pool and lending pool core to be new addresses
            await mockAaveV1.migrateLendingPools(mockAaveV2.address);
        });
        context("operating without upgrading", async () => {
            it("should break depositing", async () => {
                if (isCoverage) return;
                const amount = simpleToExactAmount(1, 10);
                await bAsset0.transfer(d_AaveIntegrationV1.address, amount.toString());
                await expectRevert(
                    d_AaveIntegrationV1.deposit(bAsset0.address, amount.toString(), false),
                    "function selector was not recognized",
                );
            });
            it("should still allow redemption", async () => {
                const bAsset_decimals = await bAsset0.decimals();
                const amount = simpleToExactAmount(1, bAsset_decimals);
                const bal0 = await d_AaveIntegrationV1.checkBalance.call(bAsset0.address);
                const bal0r = await aToken0.balanceOf(d_AaveIntegrationV1.address);
                expect(bal0).bignumber.eq(bal0r);
                await d_AaveIntegrationV1.withdraw(
                    sa.default,
                    bAsset0.address,
                    amount.toString(),
                    false,
                );
                const bal1 = await d_AaveIntegrationV1.checkBalance.call(bAsset0.address);
                expect(bal1).bignumber.lt(bal0 as any);
            });
        });
        context("operating after upgrading and migrating", async () => {
            before("upgrade the actual contract", async () => {
                const balance0 = await aToken0.balanceOf(d_AaveIntegrationProxy.address);
                const balance1 = await aToken1.balanceOf(d_AaveIntegrationProxy.address);
                beforeData = { balance0, balance1 };

                const v2Contract = await c_AaveIntegrationV2.new();
                await d_DelayedProxyAdmin.proposeUpgrade(
                    d_AaveIntegrationProxy.address,
                    v2Contract.address,
                    "0x",
                    { from: sa.governor },
                );
                await time.increase(ONE_WEEK.addn(10));
                await d_DelayedProxyAdmin.acceptUpgradeRequest(d_AaveIntegrationProxy.address, {
                    from: sa.governor,
                });

                d_AaveIntegrationV2 = await c_AaveIntegrationV2.at(d_AaveIntegrationProxy.address);
                await d_AaveIntegrationV2.migrate(
                    [bAsset0.address, bAsset1.address],
                    [newAToken0.address, newAToken1.address],
                    { from: sa.governor },
                );
            });

            it("should only be callable by the Governor", async () => {
                await expectRevert(
                    d_AaveIntegrationV2.migrate([ZERO_ADDRESS], [ZERO_ADDRESS], {
                        from: sa.dummy1,
                    }),
                    "Only governor can execute",
                );
            });

            it("should revert if passed incorrect args", async () => {
                await expectRevert(
                    d_AaveIntegrationV2.migrate([ZERO_ADDRESS, sa.dummy1], [ZERO_ADDRESS], {
                        from: sa.governor,
                    }),
                    "_bAssets and _newATokens arrays must be the same length",
                );
                await expectRevert(
                    d_AaveIntegrationV2.migrate([ZERO_ADDRESS], [ZERO_ADDRESS, sa.dummy1], {
                        from: sa.governor,
                    }),
                    "_bAssets and _newATokens arrays must be the same length",
                );
                await expectRevert(
                    d_AaveIntegrationV2.migrate(
                        [sa.dummy1], // invalid _bAsset address
                        [sa.dummy2],
                        { from: sa.governor },
                    ),
                    "aToken does not exist",
                );
                await expectRevert(
                    d_AaveIntegrationV2.migrate([bAsset0.address], [ZERO_ADDRESS], {
                        from: sa.governor,
                    }),
                    "Invalid AToken address",
                );
            });

            it("should migrate funds to v2", async () => {
                const oldAToken0Bal = await aToken0.balanceOf(d_AaveIntegrationProxy.address);
                const oldAToken1Bal = await aToken1.balanceOf(d_AaveIntegrationProxy.address);
                const newAToken0Bal = await newAToken0.balanceOf(d_AaveIntegrationProxy.address);
                const newAToken1Bal = await newAToken1.balanceOf(d_AaveIntegrationProxy.address);
                const bAsset0Bal = await d_AaveIntegrationV2.checkBalance.call(bAsset0.address);
                const bAsset1Bal = await d_AaveIntegrationV2.checkBalance.call(bAsset1.address);
                // 1. Withdraw all from v1
                //    aToken balance should be 0
                expect(oldAToken0Bal).bignumber.eq(new BN(0));
                expect(oldAToken1Bal).bignumber.eq(new BN(0));
                // 2. Update aToken address
                // 3. Deposit all in v2
                expect(newAToken0Bal).bignumber.gt(new BN(0));
                expect(newAToken1Bal).bignumber.gt(new BN(0));
                //    newAToken balance should be +
                expect(newAToken0Bal).bignumber.eq(
                    bAsset0Bal,
                    "New A token balance must == checkBalance",
                );
                expect(newAToken1Bal).bignumber.eq(
                    bAsset1Bal,
                    "New A token balance must == checkBalance",
                );
                //    checkBalance should be within 0.0001% of before
                assertBNClosePercent(newAToken0Bal, beforeData.balance0, "0.0001");
                assertBNClosePercent(newAToken1Bal, beforeData.balance1, "0.0001");
            });
            it("depositing should work", async () => {
                // Deposit should go through
                const balance0b = await newAToken0.balanceOf(d_AaveIntegrationProxy.address);
                const decimals = await bAsset0.decimals();
                await bAsset0.transfer(
                    d_AaveIntegrationV2.address,
                    simpleToExactAmount(1, decimals),
                );
                await d_AaveIntegrationV2.deposit(
                    bAsset0.address,
                    simpleToExactAmount(1, decimals),
                    false,
                );

                // balance of new aToken should increase + checkBalance
                const balance0a = await newAToken0.balanceOf(d_AaveIntegrationProxy.address);
                const balance0ac = await d_AaveIntegrationV2.checkBalance.call(bAsset0.address);

                assertBNSlightlyGTPercent(
                    balance0a,
                    balance0b.add(simpleToExactAmount(1, decimals)),
                    "0.002",
                    false,
                );
                expect(balance0a).bignumber.eq(balance0ac);
            });
            it("redeeming should work", async () => {
                // Redeem should go through
                const balance0b = await newAToken0.balanceOf(d_AaveIntegrationProxy.address);
                const decimals = await bAsset0.decimals();

                await d_AaveIntegrationV2.withdraw(
                    sa.default,
                    bAsset0.address,
                    simpleToExactAmount(1, decimals),
                    false,
                );

                // balance of new aToken should decrease + checkBalance
                const balance0a = await newAToken0.balanceOf(d_AaveIntegrationProxy.address);
                const balance0ac = await d_AaveIntegrationV2.checkBalance.call(bAsset0.address);

                assertBNSlightlyGTPercent(
                    balance0a,
                    balance0b.sub(simpleToExactAmount(1, decimals)),
                    "0.002",
                    false,
                );
                expect(balance0a).bignumber.eq(balance0ac);
            });
        });
    });
});
