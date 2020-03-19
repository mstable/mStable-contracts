import { MassetDetails } from "./massetMachine";
import * as t from "types/generated";
import { Address } from "types/common";
import { SystemMachine, StandardAccounts, BassetMachine } from ".";
import { createMultiple, simpleToExactAmount, percentToWeight } from "@utils/math";
import { BN, aToH } from "@utils/tools";
import { fullScale, MainnetAccounts, ratioScale } from "@utils/constants";
import { Basset, BassetStatus } from "@utils/mstable-objects";
import { ZERO_ADDRESS } from "@utils/constants";

// ForgeValidator
const c_ForgeValidator: t.ForgeValidatorContract = artifacts.require("ForgeValidator");

// Proxy
const c_DelayedProxyAdmin: t.DelayedProxyAdminContract = artifacts.require("DelayedProxyAdmin");
const c_InitializableProxy: t.InitializableAdminUpgradeabilityProxyContract = artifacts.require(
    "@openzeppelin/upgrades/InitializableAdminUpgradeabilityProxy",
);

// Integrations
const c_AaveIntegration: t.AaveIntegrationContract = artifacts.require("AaveIntegration");
const c_MockAave: t.MockAaveContract = artifacts.require("MockAave");
const c_MockAToken: t.MockATokenContract = artifacts.require("MockAToken");
const c_CompoundIntegration: t.CompoundIntegrationContract = artifacts.require(
    "CompoundIntegration",
);
const c_MockCToken: t.MockCTokenContract = artifacts.require("MockCToken");

// Basket
const c_BasketManager: t.BasketManagerContract = artifacts.require("BasketManager");

// Masset
const c_MUSD: t.MUSDContract = artifacts.require("MUSD");
const c_ERC20Mock: t.ERC20MockContract = artifacts.require("ERC20Mock");
const c_ERC20: t.ERC20Contract = artifacts.require("ERC20");

export interface MassetDetails {
    mAsset?: t.MassetInstance;
    basketManager?: t.BasketManagerInstance;
    bAssets?: Array<t.ERC20MockInstance>;
    aaveIntegration?: t.AaveIntegrationInstance;
    compoundIntegration?: t.CompoundIntegrationInstance;
}

interface ATokenDetails {
    bAsset: Address;
    aToken: Address;
}
interface CTokenDetails {
    bAsset: Address;
    cToken: Address;
}

enum Platform {
    aave,
    compound,
}

interface BassetIntegrationDetails {
    bAssets: Array<t.ERC20MockInstance>;
    platforms: Array<Platform>;
    aavePlatformAddress: Address;
    aTokens: Array<ATokenDetails>;
    cTokens: Array<CTokenDetails>;
}

export class MassetMachine {
    public system: SystemMachine;
    public sa: StandardAccounts;

    public ma: MainnetAccounts;

    constructor(systemMachine: SystemMachine) {
        this.system = systemMachine;
        this.ma = new MainnetAccounts();
        this.sa = this.system.sa;
    }

    public async deployMasset(): Promise<MassetDetails> {
        let md: MassetDetails = {};

        /***************************************
        0. Mock platforms and bAssets
        Dependencies: []
        ****************************************/
        const bassetDetails = await this.loadBassets();
        md.bAssets = bassetDetails.bAssets;

        /***************************************
        2. mUSD
            Dependencies: [
                BasketManager [
                    ProxyAdmin,
                    PlatformIntegrations [ 
                        MockPlatforms
                    ]
                ]
            ]
        ****************************************/

        // 2.0. Deploy ProxyAdmin
        const d_DelayedProxyAdmin: t.DelayedProxyAdminInstance = await c_DelayedProxyAdmin.new(
            this.system.nexus.address,
            {
                from: this.sa.default,
            },
        );

        // 2.1. Deploy no Init BasketManager
        //  - Deploy Implementation
        const d_BasketManager: t.BasketManagerInstance = await c_BasketManager.new(
            this.system.nexus.address,
            {
                from: this.sa.default,
            },
        );
        //  - Deploy Initializable Proxy
        const d_BasketManagerProxy: t.InitializableAdminUpgradeabilityProxyInstance = await c_InitializableProxy.new();

        // 2.2. Deploy no Init AaveIntegration
        //  - Deploy Implementation with dummy params (this storage doesn't get used)
        const d_AaveIntegration: t.AaveIntegrationInstance = await c_AaveIntegration.new(
            this.system.nexus.address,
            [d_BasketManagerProxy.address],
            bassetDetails.aavePlatformAddress,
            [],
            [],
            { from: this.sa.default },
        );
        //  - Deploy Initializable Proxy
        const d_AaveIntegrationProxy: t.InitializableAdminUpgradeabilityProxyInstance = await c_InitializableProxy.new();

        // 2.3. Deploy no Init CompoundIntegration
        //  - Deploy Implementation
        // We do not need platform address for compound
        const d_CompoundIntegration: t.CompoundIntegrationInstance = await c_CompoundIntegration.new(
            this.system.nexus.address,
            [d_BasketManagerProxy.address],
            [],
            [],
            { from: this.sa.default },
        );
        //  - Deploy Initializable Proxy
        const d_CompoundIntegrationProxy: t.InitializableAdminUpgradeabilityProxyInstance = await c_InitializableProxy.new();

        md.basketManager = await c_BasketManager.at(d_BasketManagerProxy.address);
        md.aaveIntegration = await c_AaveIntegration.at(d_AaveIntegration.address);
        md.compoundIntegration = await c_CompoundIntegration.at(d_CompoundIntegration.address);

        // 2.4. Deploy mUSD (w/ BasketManager addr)
        // 2.4.1. Deploy ForgeValidator
        const d_ForgeValidator: t.ForgeValidatorInstance = await c_ForgeValidator.new({
            from: this.sa.default,
        });
        // 2.4.2. Deploy mUSD
        const d_MUSD: t.MUSDInstance = await c_MUSD.new(
            this.system.nexus.address,
            this.sa.feeRecipient,
            d_ForgeValidator.address,
            d_BasketManagerProxy.address,
            { from: this.sa.default },
        );
        md.mAsset = d_MUSD;

        // 2.5. Init BasketManager
        const initializationData_BasketManager: string = d_BasketManager.contract.methods
            .initialize(
                this.system.nexus.address,
                d_MUSD.address,
                bassetDetails.bAssets.map((b) => b.address),
                bassetDetails.platforms.map((p) =>
                    p == Platform.aave
                        ? d_AaveIntegrationProxy.address
                        : d_CompoundIntegrationProxy.address,
                ),
                bassetDetails.bAssets.map(() => percentToWeight(100).toString()),
                bassetDetails.bAssets.map(() => false),
            )
            .encodeABI();
        await d_BasketManagerProxy.initialize(
            d_BasketManager.address,
            d_DelayedProxyAdmin.address,
            initializationData_BasketManager,
        );

        // 2.6. Init AaveIntegration
        const initializationData_AaveIntegration: string = d_AaveIntegration.contract.methods
            .initialize(
                this.system.nexus.address,
                [d_MUSD.address, d_BasketManagerProxy.address],
                bassetDetails.aavePlatformAddress,
                bassetDetails.aTokens.map((a) => a.bAsset),
                bassetDetails.aTokens.map((a) => a.aToken),
            )
            .encodeABI();
        await d_AaveIntegrationProxy.initialize(
            d_AaveIntegration.address,
            d_DelayedProxyAdmin.address,
            initializationData_AaveIntegration,
        );

        // 2.7. Init CompoundIntegration
        const initializationData_CompoundIntegration: string = d_CompoundIntegration.contract.methods
            .initialize(
                this.system.nexus.address,
                [d_MUSD.address, d_BasketManagerProxy.address],
                ZERO_ADDRESS, // We don't need Compound sys addr
                bassetDetails.cTokens.map((c) => c.bAsset),
                bassetDetails.cTokens.map((c) => c.cToken),
            )
            .encodeABI();
        await d_CompoundIntegrationProxy.initialize(
            d_CompoundIntegration.address,
            d_DelayedProxyAdmin.address,
            initializationData_CompoundIntegration,
        );
        return md;
    }

    public async loadBassets(): Promise<BassetIntegrationDetails> {
        return this.system.isGanacheFork ? this.loadBassetsFork() : this.loadBassetsLocal();
    }

    public async loadBassetsFork(): Promise<BassetIntegrationDetails> {
        // load all the REAL bAssets
        const bAsset_DAI = await c_ERC20Mock.at(this.ma.DAI);
        await this.mintERC20(bAsset_DAI, this.ma.FUND_SOURCES.dai);

        const bAsset_USDC = await c_ERC20Mock.at(this.ma.USDC);
        await this.mintERC20(bAsset_USDC, this.ma.FUND_SOURCES.usdc);

        const bAsset_TUSD = await c_ERC20Mock.at(this.ma.TUSD);
        await this.mintERC20(bAsset_TUSD, this.ma.FUND_SOURCES.tusd);

        const bAsset_USDT = await c_ERC20Mock.at(this.ma.USDT);
        await this.mintERC20(bAsset_USDT, this.ma.FUND_SOURCES.usdt);
        // credit sa.default with ample balances
        const bAssets = [bAsset_DAI, bAsset_USDC, bAsset_TUSD, bAsset_USDT];
        // return all the addresses
        return {
            bAssets,
            platforms: [Platform.compound, Platform.compound, Platform.aave, Platform.aave],
            aavePlatformAddress: this.ma.aavePlatform,
            aTokens: [
                {
                    bAsset: bAsset_TUSD.address,
                    aToken: this.ma.aTUSD,
                },
                {
                    bAsset: bAsset_USDT.address,
                    aToken: this.ma.aUSDT,
                },
            ],
            cTokens: [
                {
                    bAsset: bAsset_DAI.address,
                    cToken: this.ma.cDAI,
                },
                {
                    bAsset: bAsset_USDC.address,
                    cToken: this.ma.cUSDC,
                },
            ],
        };
    }

    public async loadBassetsLocal(): Promise<BassetIntegrationDetails> {
        //  - Mock bAssets
        const mockBasset1: t.ERC20MockInstance = await c_ERC20Mock.new(
            "Mock1",
            "MK1",
            12,
            this.sa.default,
            100000000,
        );
        const mockBasset2: t.ERC20MockInstance = await c_ERC20Mock.new(
            "Mock2",
            "MK2",
            18,
            this.sa.default,
            100000000,
        );
        const mockBasset3: t.ERC20MockInstance = await c_ERC20Mock.new(
            "Mock3",
            "MK3",
            6,
            this.sa.default,
            100000000,
        );
        const mockBasset4: t.ERC20MockInstance = await c_ERC20Mock.new(
            "Mock4",
            "MK4",
            18,
            this.sa.default,
            100000000,
        );

        //  - Mock Aave integration
        const d_MockAave: t.MockAaveInstance = await c_MockAave.new({ from: this.sa.default });

        //  - Mock aTokens
        const mockAToken1: t.IAaveATokenInstance = await c_MockAToken.new(
            d_MockAave.address,
            mockBasset1.address,
        );
        const mockAToken2: t.IAaveATokenInstance = await c_MockAToken.new(
            d_MockAave.address,
            mockBasset2.address,
        );
        const mockAToken3: t.IAaveATokenInstance = await c_MockAToken.new(
            d_MockAave.address,
            mockBasset3.address,
        );

        //  - Add to the Platform
        await d_MockAave.addAToken(mockAToken1.address, mockBasset1.address);
        await d_MockAave.addAToken(mockAToken2.address, mockBasset2.address);
        await d_MockAave.addAToken(mockAToken3.address, mockBasset3.address);

        // Mock C Token
        const mockCToken4: t.MockCTokenInstance = await c_MockCToken.new(mockBasset4.address);
        return {
            bAssets: [mockBasset1, mockBasset2, mockBasset3, mockBasset4],
            platforms: [Platform.aave, Platform.aave, Platform.aave, Platform.compound],
            aavePlatformAddress: d_MockAave.address,
            aTokens: [
                {
                    bAsset: mockBasset1.address,
                    aToken: mockAToken1.address,
                },
                {
                    bAsset: mockBasset2.address,
                    aToken: mockAToken2.address,
                },
                {
                    bAsset: mockBasset3.address,
                    aToken: mockAToken3.address,
                },
            ],
            cTokens: [
                {
                    bAsset: mockBasset4.address,
                    cToken: mockCToken4.address,
                },
            ],
        };
    }

    public async mintERC20(
        erc20: t.ERC20MockInstance,
        source: Address,
        recipient: string = this.sa.default,
    ): Promise<Truffle.TransactionResponse> {
        const decimals = await erc20.decimals();
        return erc20.transfer(recipient, simpleToExactAmount(1000, decimals), {
            from: source,
        });
    }

    /**
     * @dev Deploy a Masset via the Manager then:
     *      1. Mint with optimal weightings
     */
    public async createMassetAndSeedBasket(
        initialSupply: number = 100,
        bAssetCount: number = 4,
        sender: Address = this.system.sa.governor,
    ): Promise<MassetDetails> {
        let massetDetails = await this.deployMasset();

        // Mint initialSupply with shared weightings
        let basketDetails = await this.getBassetsInMasset(massetDetails);

        // Calc optimal weightings
        let totalWeighting = basketDetails.reduce((p, c) => {
            return p.add(c.maxWeight);
        }, new BN(0));
        let totalMintAmount = simpleToExactAmount(initialSupply, 18);
        let mintAmounts = await Promise.all(
            basketDetails.map(async (b) => {
                // e.g. 5e35 / 2e18 = 2.5e17
                const relativeWeighting = b.maxWeight.mul(fullScale).div(totalWeighting);
                // e.g. 1e20 * 25e16 / 1e18 = 25e18
                const mintAmount = totalMintAmount.mul(relativeWeighting).div(fullScale);
                // const bAssetDecimals: BN = await b.decimals();
                // const decimalDelta = new BN(18).sub(bAssetDecimals);
                return mintAmount.mul(ratioScale).div(b.ratio);
            }),
        );

        // Approve bAssets
        await Promise.all(
            massetDetails.bAssets.map((b, i) =>
                b.approve(massetDetails.mAsset.address, mintAmounts[i], {
                    from: this.system.sa.default,
                }),
            ),
        );

        const bitmap = await massetDetails.basketManager.getBitmapFor(
            basketDetails.map((b) => b.addr),
        );
        await massetDetails.mAsset.mintMulti(
            bitmap.toNumber(),
            mintAmounts,
            this.system.sa.default,
            { from: this.system.sa.default },
        );

        return massetDetails;
    }

    public async getBassetsInMasset(masset: MassetDetails): Promise<Basset[]> {
        const response = await masset.basketManager.getBassets();
        const bArrays: Array<Basset> = response[0].map((b) => {
            return {
                addr: b.addr,
                status: parseInt(b.status.toString()),
                isTransferFeeCharged: b.isTransferFeeCharged,
                ratio: new BN(b.ratio),
                maxWeight: new BN(b.maxWeight),
                vaultBalance: new BN(b.vaultBalance),
            };
        });
        return bArrays;
    }
}
