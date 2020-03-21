/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable @typescript-eslint/no-use-before-define */
import * as t from "types/generated";
import { latest } from 'openzeppelin-test-helpers/src/time';
import { shouldFail, expectEvent } from 'openzeppelin-test-helpers';
import { StandardAccounts } from "@utils/machines";
import { ZERO_ADDRESS, ZERO } from "@utils/constants";
import { BN } from "@utils/tools";

import envSetup from "@utils/env_setup";
import shouldBehaveLikeModule from "../shared/behaviours/Module.behaviour";

const { expect } = envSetup.configure();
const DelayedProxyAdmin: t.DelayedProxyAdminContract = artifacts.require("DelayedProxyAdmin");
const InitializableProxy: t.InitializableAdminUpgradeabilityProxyContract = artifacts.require(
    "@openzeppelin/upgrades/InitializableAdminUpgradeabilityProxy",
);
const MockImplementationV1: t.MockImplementationV1Contract = artifacts.require("MockImplementationV1");
const MockImplementationV2: t.MockImplementationV2Contract = artifacts.require("MockImplementationV2");
const MockNexus: t.MockNexusContract = artifacts.require("MockNexus");

contract("DelayedProxyAdmin", async (accounts) => {
    let nexus: t.MockNexusInstance;
    const ctx: { module?: t.ModuleInstance } = {};
    const sa = new StandardAccounts(accounts);
    const governanceAddr = sa.governor;
    const managerAddr = sa.dummy1;
    let delayedProxyAdmin: t.DelayedProxyAdminInstance;
    let proxy: t.InitializableAdminUpgradeabilityProxyInstance;
    let mockImplV1: t.MockImplementationV1Instance;
    let mockImplV2: t.MockImplementationV2Instance;

    before("before all", async () => {
        // create New Nexus
        nexus = await MockNexus.new(sa.governor, governanceAddr, managerAddr);
    });

    beforeEach("before each", async () => {
        // 1. Deploy DelayedProxyAdmin
        delayedProxyAdmin = await DelayedProxyAdmin.new(nexus.address);

        // 2. Deploy MockImplementation
        mockImplV1 = await MockImplementationV1.new();
        let uintVal = await mockImplV1.uintVal();
        expect(new BN(1)).to.bignumber.equal(uintVal);
        // 2.1 Deploy a proxy contract
        proxy = await InitializableProxy.new();
        // 2.2 Initialize Proxy contract of MockImplementation
        const data = mockImplV1.contract.methods.initialize().encodeABI();
        await proxy.initialize(mockImplV1.address, delayedProxyAdmin.address, data);

        // Validate Setup
        // ===============
        const proxyToImpl: t.MockImplementationV1Instance = await MockImplementationV1.at(proxy.address);
        uintVal = await proxyToImpl.uintVal();
        expect(new BN(2)).to.bignumber.equal(uintVal);
        const version = await proxyToImpl.version();
        expect("V1").to.equal(version);

        // Deploy new implementation
        mockImplV2 = await MockImplementationV2.new();
    });

    describe("behaviours", async () => {
        beforeEach("before each", async () => {
            ctx.module = await DelayedProxyAdmin.new(nexus.address);
        });
        
        shouldBehaveLikeModule(ctx as Required<typeof ctx>, sa);
    });
    

    describe("constructor", async () => {
        context("should succeed", async () => {
            it("when valid Nexus address is given", async () => {
                const instance = await DelayedProxyAdmin.new(nexus.address);
                const nexusAddr = await instance.nexus();
                expect(nexus.address).to.equal(nexusAddr);
            });            
        });

        context("should fail", async () => {
            it("when zero Nexus address", async () => {
                await shouldFail.reverting.withMessage(
                    DelayedProxyAdmin.new(ZERO_ADDRESS),
                    "Nexus is zero address",
                );
            });
        });
    });

    describe("proposeUpgrade()", async () => {
        context("should succeed", async () => {
            it("when valid upgrade proposed and function called by the Governor", async () => {
                const tx = await delayedProxyAdmin.proposeUpgrade(
                    proxy.address, 
                    mockImplV2.address, 
                    "0x",
                    {from: sa.governor}
                );
                const timestamp = await latest();
                await expectInRequest(
                    delayedProxyAdmin, 
                    proxy.address, 
                    mockImplV2.address, 
                    null, 
                    timestamp
                );

                expectEvent.inLogs(
                    tx.logs, 
                    "UpgradeProposed",
                    {proxy: proxy.address, implementation: mockImplV2.address, data: null}
                );
                await expectDataInMockImpl(proxy, "V1", new BN(2));
                
            });

            it("when valid upgrade with data", async () => {
                const encodeData = mockImplV2.contract.methods.initializeV2().encodeABI();
                const tx = await delayedProxyAdmin.proposeUpgrade(
                    proxy.address, 
                    mockImplV2.address, 
                    encodeData,
                    {from: sa.governor}
                );
                const timestamp = await latest();
                await expectInRequest(
                    delayedProxyAdmin, 
                    proxy.address, 
                    mockImplV2.address, 
                    encodeData, 
                    timestamp
                );

                expectEvent.inLogs(
                    tx.logs, 
                    "UpgradeProposed",
                    {proxy: proxy.address, implementation: mockImplV2.address, data: encodeData}
                );
                await expectDataInMockImpl(proxy, "V1", new BN(2));
            });
        });

        context("should fail", async () => {
            it("when valid upgrade proposed and function called by the Other", async () => {
                await shouldFail.reverting.withMessage(
                    delayedProxyAdmin.proposeUpgrade(
                        proxy.address, 
                        mockImplV2.address, 
                        "0x",
                        {from: sa.other}
                    ),
                    "Only governor can execute",
                );
                await expectInRequest(
                    delayedProxyAdmin, 
                    proxy.address, 
                    ZERO_ADDRESS, 
                    null, 
                    new BN(0)
                );
            });

            it("when proxy address is zero", async () => {
                await shouldFail.reverting.withMessage(
                    delayedProxyAdmin.proposeUpgrade(
                        ZERO_ADDRESS, 
                        mockImplV2.address, 
                        "0x", 
                        {from: sa.governor}
                    ),
                    "Proxy address is zero",
                );
            });

            it("when implementation address is zero", async () => {
                await shouldFail.reverting.withMessage(
                    delayedProxyAdmin.proposeUpgrade(
                        proxy.address, 
                        ZERO_ADDRESS, 
                        "0x", 
                        {from: sa.governor}
                    ),
                    "Implementation address is zero",
                );
            });

            it("when proxy return zero implementation address", async () => {
                // Proxy without implementation
                const newProxy = await InitializableProxy.new();
                await shouldFail.reverting.withMessage(
                    delayedProxyAdmin.proposeUpgrade(
                        newProxy.address, 
                        mockImplV2.address, 
                        "0x", 
                        {from: sa.governor}
                    ),
                    "",
                );
            });
            
            it("when proxy admin not control the given proxy", async () => {
                // Deploy a Proxy with implementation
                const initProxy: t.InitializableAdminUpgradeabilityProxyInstance 
                    = await  InitializableProxy.new();
                const mockImpl = await MockImplementationV2.new();
                await initProxy.initialize(mockImpl.address, sa.other, "0x");

                await shouldFail.reverting.withMessage(
                    delayedProxyAdmin.proposeUpgrade(
                        initProxy.address, 
                        mockImpl.address, 
                        "0x", 
                        {from: sa.governor}
                    ),
                    "Call failed",
                );
            });
            
            it("when upgrade already proposed for same proxy", async () => {
                const tx = await delayedProxyAdmin.proposeUpgrade(
                    proxy.address, 
                    mockImplV2.address, 
                    "0x",
                    {from: sa.governor}
                );
                const timestamp = await latest();
                await expectInRequest(
                    delayedProxyAdmin, 
                    proxy.address, 
                    mockImplV2.address, 
                    null, 
                    timestamp
                );
                expectEvent.inLogs(
                    tx.logs, 
                    "UpgradeProposed",
                    {proxy: proxy.address, implementation: mockImplV2.address, data: null}
                );
                await shouldFail.reverting.withMessage(delayedProxyAdmin.proposeUpgrade(
                    proxy.address,
                    mockImplV2.address, 
                    "0x", 
                    {from: sa.governor}
                ),
                "Upgrade already proposed");
                await expectInRequest(
                    delayedProxyAdmin, 
                    proxy.address, 
                    mockImplV2.address, 
                    null, 
                    timestamp
                );
            });

            it("when new implementation same as current implementation", async () => {
                await shouldFail.reverting.withMessage(delayedProxyAdmin.proposeUpgrade(
                    proxy.address,
                    mockImplV1.address, 
                    "0x", 
                    {from: sa.governor}
                ),
                "Implementation must be different");
            });
        });
    });

    describe("cancelUpgrade()", async () => {
        context("should succeed", async () => {
            it("when valid cancel request and function called by the Governor");
        });

        context("should fail", async () => {
            it("when valid cancel request and function called by the Other");
            it("when proxy address is zero");
            it("when no valid request found");
        });
    });

    describe("acceptRequest()", async () => {
        context("should succeed", async () => {
            it("when valid request and function called by the Governor");
            it("when only implementation contract is upgraded");
            it("when upgrade and call a function on new implementation");
            it("when ETH is sent to upgraded implementation along with function call");
        });

        context("should fail", async () => {
            it("when valid request and function called by the Other");
            it("when proxy address is zero");
            it("when no request found");
            it("when opt-out delay not over");
            it("when ETH sent and no data supplied");
        });
    });

    describe("getProxyAdmin()", async () => {
        context("should succeed", async () => {
            it("when proxy exist and returns admin address");
        });

        context("should fail", async () => {
            it("when proxy address is zero", async () => {
                await shouldFail.reverting.withMessage(
                    delayedProxyAdmin.getProxyAdmin(ZERO_ADDRESS),
                    ""
                );
            });
        });
    });
    
    describe("getProxyImplementation()", async () => {
        context("should succeed", async () => {
            it("when proxy exist and returns implementation address");
        });

        context("should fail", async () => {
            it("when proxy address is zero", async () => {
                await shouldFail.reverting.withMessage(
                    delayedProxyAdmin.getProxyImplementation(ZERO_ADDRESS),
                    ""
                );
            });
        });
    });

});

async function expectInRequest(
    proxyAdmin: t.DelayedProxyAdminInstance,
    proxy: string,
    impl: string,
    data: string,
    timestamp: BN
) 
{
    expect(proxy).to.not.equal(ZERO_ADDRESS);    
    const req = await proxyAdmin.requests(proxy);
    const reqImpl: string = req[0];
    const reqData: string = req[1]
    const reqTimestamp: BN = req[2];

    expect(impl).to.equal(reqImpl);
    expect(data).to.equal(reqData);
    expect(timestamp).to.bignumber.equal(reqTimestamp);
}

async function expectDataInMockImpl(
    proxy: t.InitializableAdminUpgradeabilityProxyInstance,
    version: string,
    uintVal: BN,
) 
{
    const proxyToImpl: t.MockImplementationV2Instance = 
        await MockImplementationV2.at(proxy.address);
    const returnedVersion = await proxyToImpl.version();
    expect(version).to.equal(returnedVersion);
    const returnedUintVal = await proxyToImpl.uintVal();
    expect(uintVal).to.bignumber.equals(returnedUintVal);
}