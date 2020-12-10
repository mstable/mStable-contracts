/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable @typescript-eslint/no-use-before-define */
import { expectRevert, time } from "@openzeppelin/test-helpers";
import { StandardAccounts } from "@utils/machines";
import { BN } from "@utils/tools";
import envSetup from "@utils/env_setup";
import * as t from "types/generated";

const { expect } = envSetup.configure();
const DelayedProxyAdmin = artifacts.require("DelayedProxyAdmin");
const InitializableProxy = artifacts.require(
    // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
    // @ts-ignore
    "@openzeppelin/upgrades/InitializableAdminUpgradeabilityProxy",
) as t.InitializableAdminUpgradeabilityProxyContract;
const c_MockNexus = artifacts.require("MockNexus");
const c_AaveIntegration = artifacts.require("AaveIntegration");
const c_AaveIntegrationV2 = artifacts.require("AaveIntegrationV2");
const c_AaveIntegrationV3 = artifacts.require("AaveIntegrationV3");

const c_MockAToken = artifacts.require("MockAToken");
const c_MockAave = artifacts.require("MockAaveV1");
const c_MockErc20 = artifacts.require("MockERC20");

contract("PlatformIntegrationUpgradability", async (accounts) => {
    let d_Nexus: t.MockNexusInstance;
    const sa = new StandardAccounts(accounts);
    const governanceAddr = sa.governor;
    const managerAddr = sa.dummy1;
    const ONE_DAY = new BN(60 * 60 * 24);
    const ONE_WEEK = ONE_DAY.mul(new BN(7));

    let d_DelayedProxyAdmin: t.DelayedProxyAdminInstance;
    let d_AaveIntegrationProxy: t.InitializableAdminUpgradeabilityProxyInstance;
    let d_AaveIntegrationV1: t.AaveIntegrationInstance;
    let d_AaveIntegrationV2: t.AaveIntegrationV2Instance;
    let d_AaveIntegrationV3: t.AaveIntegrationV3Instance;

    let d_MockAave: t.MockAaveV1Instance;
    let d_mockBasset1: t.MockERC20Instance;
    let d_mockAToken1: t.MockATokenInstance;

    let proxyToImplV2: t.AaveIntegrationV2Instance;
    let proxyToImplV3: t.AaveIntegrationV3Instance;

    before("before all", async () => {
        // create New Nexus
        d_Nexus = await c_MockNexus.new(sa.governor, governanceAddr, managerAddr);

        // 1. Deploy DelayedProxyAdmin
        d_DelayedProxyAdmin = await DelayedProxyAdmin.new(d_Nexus.address);
        await d_Nexus.setProxyAdmin(d_DelayedProxyAdmin.address);

        // 2 Deploy a proxy contract
        d_AaveIntegrationProxy = await InitializableProxy.new();

        // 3. Deploy AaveIntegration version 1.0
        // Any data we pass to this contract, it does not matter, as all the call to this contract
        // will be via Proxy
        d_AaveIntegrationV1 = await c_AaveIntegration.new();

        // Initialize AaveIntegration
        d_mockBasset1 = await c_MockErc20.new("Mock1", "MK1", 12, sa.default, 100000000);

        // Mock Aave instance
        d_MockAave = await c_MockAave.new({ from: sa.default });

        d_mockAToken1 = await c_MockAToken.new(d_MockAave.address, d_mockBasset1.address);

        const initializationData_AaveIntegration: string = d_AaveIntegrationV1.contract.methods
            .initialize(
                d_Nexus.address,
                [sa.dummy3, sa.dummy4],
                d_MockAave.address,
                [d_mockBasset1.address],
                [d_mockAToken1.address],
            )
            .encodeABI();

        await d_AaveIntegrationProxy.methods["initialize(address,address,bytes)"](
            d_AaveIntegrationV1.address,
            d_DelayedProxyAdmin.address,
            initializationData_AaveIntegration,
        );

        // Ensure that setup is correct and AaveIntegration V1 is deployed via Proxy
        // ========================================================================
        const proxyToImplV1 = await c_AaveIntegration.at(d_AaveIntegrationProxy.address);

        const pToken = await proxyToImplV1.bAssetToPToken(d_mockBasset1.address);
        expect(pToken).to.equal(d_mockAToken1.address);
        const platformAddress = await proxyToImplV1.platformAddress();
        expect(d_MockAave.address).to.equal(platformAddress);

        await d_MockAave.addAToken(d_mockAToken1.address, d_mockBasset1.address);

        // Perform some operation to have storage updated
        // ==============================================
        // Ensure that storage updated as expected
        const amount = new BN(100);
        await d_mockBasset1.transfer(proxyToImplV1.address, amount);
        // const referralCode = new BN(9999);
        await proxyToImplV1.deposit(d_mockBasset1.address, amount, false, { from: sa.dummy3 });
        const bal = await d_mockAToken1.balanceOf(proxyToImplV1.address);
        expect(new BN(100)).to.bignumber.equal(bal);

        // Upgrade to new version of AaveIntegration v2 via ProxyAdmin
        // ========================================================
        d_AaveIntegrationV2 = await c_AaveIntegrationV2.new();
        const initializationData_AaveIntegrationV2: string = d_AaveIntegrationV2.contract.methods
            .initializeNewUint()
            .encodeABI();
        await d_DelayedProxyAdmin.proposeUpgrade(
            d_AaveIntegrationProxy.address,
            d_AaveIntegrationV2.address,
            initializationData_AaveIntegrationV2,
            { from: sa.governor },
        );
        await time.increase(ONE_WEEK);
        await d_DelayedProxyAdmin.acceptUpgradeRequest(d_AaveIntegrationProxy.address, {
            from: sa.governor,
        });

        proxyToImplV2 = await c_AaveIntegrationV2.at(d_AaveIntegrationProxy.address);
    });

    describe("Upgraded AaveIntegration", async () => {
        it("should have old storage intact", async () => {
            const pToken = await proxyToImplV2.bAssetToPToken(d_mockBasset1.address);
            expect(pToken).to.equal(d_mockAToken1.address);

            const platformAddress = await proxyToImplV2.platformAddress();
            expect(d_MockAave.address).to.equal(platformAddress);

            const nexusAddr = await proxyToImplV2.nexus();
            expect(d_Nexus.address).to.equal(nexusAddr);

            let whitelisted = await proxyToImplV2.whitelist(sa.dummy3);
            expect(true).to.equals(whitelisted);
            whitelisted = await proxyToImplV2.whitelist(sa.dummy4);
            expect(true).to.equals(whitelisted);

            // let key: string;
            // key = await proxyToImplV2.governance();
            // expect(key).to.equal(web3.utils.keccak256("Governance"));

            // key = await proxyToImplV2.KEY_STAKING();
            // expect(key).to.equal(web3.utils.keccak256("Staking"));

            // key = await proxyToImplV2.KEY_ORACLE_HUB();
            // expect(key).to.equal(web3.utils.keccak256("OracleHub"));

            // key = await proxyToImplV2.KEY_MANAGER();
            // expect(key).to.equal(web3.utils.keccak256("Manager"));

            // key = await proxyToImplV2.KEY_RECOLLATERALISER();
            // expect(key).to.equal(web3.utils.keccak256("Recollateraliser"));

            // key = await proxyToImplV2.KEY_META_TOKEN();
            // expect(key).to.equal(web3.utils.keccak256("MetaToken"));

            // key = await proxyToImplV2.KEY_SAVINGS_MANAGER();
            // expect(key).to.equal(web3.utils.keccak256("SavingsManager"));
        });

        it("should have initialized with new variables", async () => {
            const newUint = await proxyToImplV2.newUint();
            expect(new BN(1)).to.bignumber.equal(newUint);
        });

        it("should have new functions", async () => {
            const result = await proxyToImplV2.newMethod();
            expect(true).to.equal(result);
        });

        it("should have modified functions", async () => {
            await expectRevert(
                proxyToImplV2.setPTokenAddress(sa.dummy1, sa.dummy2, { from: sa.governor }),
                "Not allowed to add more pTokens",
            );
        });

        it("should fail initializeNewUint() when called by Other", async () => {
            d_AaveIntegrationV3 = await c_AaveIntegrationV3.new();
            // This will just revert as Nexus is not available
            await expectRevert.unspecified(
                d_AaveIntegrationV3.initializeNewUint({ from: sa.other }),
            );
        });

        it("should not have removed functions in upgraded contract", async () => {
            // Upgrade to new version of AaveIntegration v3 via ProxyAdmin
            // ========================================================
            d_AaveIntegrationV3 = await c_AaveIntegrationV3.new();
            const initializationData_AaveIntegrationV3: string = d_AaveIntegrationV3.contract.methods
                .initializeNewUint()
                .encodeABI();
            await d_DelayedProxyAdmin.proposeUpgrade(
                d_AaveIntegrationProxy.address,
                d_AaveIntegrationV3.address,
                initializationData_AaveIntegrationV3,
                { from: sa.governor },
            );
            await time.increase(ONE_WEEK);
            await d_DelayedProxyAdmin.acceptUpgradeRequest(d_AaveIntegrationProxy.address, {
                from: sa.governor,
            });

            // We are taking V2's code so that `newMethod()` function can be called
            // However, we know that implementation is on V3
            await expectRevert.unspecified(proxyToImplV2.newMethod());
        });

        it("should allow calling old function", async () => {
            // Upgrade to new version of AaveIntegration v3 via ProxyAdmin
            // ========================================================
            d_AaveIntegrationV3 = await c_AaveIntegrationV3.new();
            const initializationData_AaveIntegrationV3: string = d_AaveIntegrationV3.contract.methods
                .initializeNewUint()
                .encodeABI();
            await d_DelayedProxyAdmin.proposeUpgrade(
                d_AaveIntegrationProxy.address,
                d_AaveIntegrationV3.address,
                initializationData_AaveIntegrationV3,
                { from: sa.governor },
            );
            await time.increase(ONE_WEEK);
            await d_DelayedProxyAdmin.acceptUpgradeRequest(d_AaveIntegrationProxy.address, {
                from: sa.governor,
            });

            proxyToImplV3 = await c_AaveIntegrationV3.at(d_AaveIntegrationProxy.address);
            await expectRevert(
                proxyToImplV3.setPTokenAddress(sa.dummy1, sa.dummy2, { from: sa.governor }),
                "Not allowed to add more pTokens",
            );
        });
        it("should have aToken balance intact", async () => {
            const bal = await proxyToImplV3.checkBalanceView(d_mockBasset1.address);
            expect(new BN(100)).to.bignumber.equal(bal);
        });
    });
});
