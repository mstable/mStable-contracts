/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as t from "types/generated";
import { shouldFail, expectEvent } from "openzeppelin-test-helpers";
import { latest, increase } from "openzeppelin-test-helpers/src/time";
import { StandardAccounts } from "@utils/machines";
import { ZERO_ADDRESS } from "@utils/constants";
import { BN } from "@utils/tools";
import envSetup from "@utils/env_setup";

const { expect } = envSetup.configure();
const DelayedProxyAdmin: t.DelayedProxyAdminContract = artifacts.require("DelayedProxyAdmin");
const InitializableProxy: t.InitializableAdminUpgradeabilityProxyContract = artifacts.require(
    "@openzeppelin/upgrades/InitializableAdminUpgradeabilityProxy",
);
const MockImplementationV1: t.MockImplementationV1Contract = artifacts.require(
    "MockImplementationV1",
);
const MockImplementationV2: t.MockImplementationV2Contract = artifacts.require(
    "MockImplementationV2",
);
const c_MockNexus: t.MockNexusContract = artifacts.require("MockNexus");
const c_AaveIntegration: t.AaveIntegrationContract = artifacts.require("AaveIntegration");
const c_AaveIntegrationV2: t.AaveIntegrationV2Contract = artifacts.require("AaveIntegrationV2");
const c_AaveIntegrationV3: t.AaveIntegrationV3Contract = artifacts.require("AaveIntegrationV3");

const c_MockAToken: t.MockATokenContract = artifacts.require("MockAToken");
const c_MockAave: t.MockAaveContract = artifacts.require("MockAave");
const c_ERC20Mock: t.ERC20MockContract = artifacts.require("ERC20Mock");

contract("UpgradedAaveIntegration", async (accounts) => {
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

    let d_MockAave: t.MockAaveInstance;
    let d_mockBasset1: t.ERC20MockInstance;
    let d_mockAToken1: t.MockATokenInstance;

    let proxyToImplV2: t.AaveIntegrationV2Instance;
    let proxyToImplV3: t.AaveIntegrationV3Instance;

    before("before all", async () => {
        // create New Nexus
        d_Nexus = await c_MockNexus.new(sa.governor, governanceAddr, managerAddr);
    });

    beforeEach("before each", async () => {
        // 1. Deploy DelayedProxyAdmin
        d_DelayedProxyAdmin = await DelayedProxyAdmin.new(d_Nexus.address);

        // 2 Deploy a proxy contract
        d_AaveIntegrationProxy = await InitializableProxy.new();

        // 3. Deploy AaveIntegration version 1.0
        // Any data we pass to this contract, it does not matter, as all the call to this contract
        // will be via Proxy
        d_AaveIntegrationV1 = await c_AaveIntegration.new(
            d_Nexus.address,
            [sa.dummy3, sa.dummy4],
            sa.dummy1,
            [],
            [],
        );

        // Initialize AaveIntegration
        d_mockBasset1 = await c_ERC20Mock.new("Mock1", "MK1", 12, sa.default, 100000000);

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

        await d_AaveIntegrationProxy.initialize(
            d_AaveIntegrationV1.address,
            d_DelayedProxyAdmin.address,
            initializationData_AaveIntegration,
        );

        // Ensure that setup is correct and AaveIntegration V1 is deployed via Proxy
        // ========================================================================
        const proxyToImplV1 = await c_AaveIntegration.at(d_AaveIntegrationProxy.address);

        const pToken = await proxyToImplV1.bAssetToPToken(d_mockBasset1.address);
        expect(pToken).to.equal(d_mockAToken1.address);
        const version = await proxyToImplV1.version();
        expect("1.0").to.equal(version);
        const platformAddress = await proxyToImplV1.platformAddress();
        expect(d_MockAave.address).to.equal(platformAddress);

        // Perform some operation to have storage updated
        // ==============================================
        // TODO Integration with Mainnet or deposit some Tokens to Aave
        // Ensure that storage updated as expected

        // Upgrade to new version of AaveIntegration v2 via ProxyAdmin
        // ========================================================
        d_AaveIntegrationV2 = await c_AaveIntegrationV2.new(
            d_Nexus.address,
            [sa.dummy3, sa.dummy4],
            sa.dummy1,
            [],
            [],
        );
        const initializationData_AaveIntegrationV2: string = d_AaveIntegrationV2.contract.methods
            .initializeNewUint()
            .encodeABI();
        await d_DelayedProxyAdmin.proposeUpgrade(
            d_AaveIntegrationProxy.address,
            d_AaveIntegrationV2.address,
            initializationData_AaveIntegrationV2,
            { from: sa.governor },
        );
        await increase(ONE_WEEK);
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

            let key: string;
            key = await proxyToImplV2.Key_Governance();
            expect(key).to.equal(web3.utils.keccak256("Governance"));

            key = await proxyToImplV2.Key_Staking();
            expect(key).to.equal(web3.utils.keccak256("Staking"));

            key = await proxyToImplV2.Key_OracleHub();
            expect(key).to.equal(web3.utils.keccak256("OracleHub"));

            key = await proxyToImplV2.Key_Manager();
            expect(key).to.equal(web3.utils.keccak256("Manager"));

            key = await proxyToImplV2.Key_Recollateraliser();
            expect(key).to.equal(web3.utils.keccak256("Recollateraliser"));

            key = await proxyToImplV2.Key_MetaToken();
            expect(key).to.equal(web3.utils.keccak256("MetaToken"));

            key = await proxyToImplV2.Key_SavingsManager();
            expect(key).to.equal(web3.utils.keccak256("SavingsManager"));
        });

        it("should have initialized with new version", async () => {
            const version = await proxyToImplV2.version();
            expect("2.0").to.equal(version);
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
            await shouldFail.reverting.withMessage(
                proxyToImplV2.setPTokenAddress(sa.dummy1, sa.dummy2, { from: sa.governor }),
                "Not allowed to add more pTokens",
            );
        });

        it("should not have removed functions in upgraded contract", async () => {
            // Upgrade to new version of AaveIntegration v3 via ProxyAdmin
            // ========================================================
            d_AaveIntegrationV3 = await c_AaveIntegrationV3.new(
                d_Nexus.address,
                [sa.dummy3, sa.dummy4],
                sa.dummy1,
                [],
                [],
            );
            const initializationData_AaveIntegrationV3: string = d_AaveIntegrationV3.contract.methods
                .initializeNewUint()
                .encodeABI();
            await d_DelayedProxyAdmin.proposeUpgrade(
                d_AaveIntegrationProxy.address,
                d_AaveIntegrationV3.address,
                initializationData_AaveIntegrationV3,
                { from: sa.governor },
            );
            await increase(ONE_WEEK);
            await d_DelayedProxyAdmin.acceptUpgradeRequest(d_AaveIntegrationProxy.address, {
                from: sa.governor,
            });

            // We are taking V2's code so that `newMethod()` function can be called
            // However, we know that implementation is on V3
            await shouldFail.reverting.withMessage(proxyToImplV2.newMethod(), "");
        });
    });
});
