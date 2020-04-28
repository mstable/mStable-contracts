/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable class-methods-use-this */

import * as t from "types/generated";
import { simpleToExactAmount, percentToWeight } from "@utils/math";
import { BN } from "@utils/tools";
import { fullScale, MainnetAccounts, ratioScale, ZERO_ADDRESS } from "@utils/constants";
import { Basset } from "@utils/mstable-objects";
import { SystemMachine, StandardAccounts } from ".";
import { Address } from "../../types/common";
import { BassetIntegrationDetails, Platform, BasketComposition } from "../../types/machines";

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
const c_BasketManager: t.MockBasketManagerContract = artifacts.require("MockBasketManager");

// Masset
const c_MUSD: t.MUSDContract = artifacts.require("MUSD");
const c_MockERC20WithFee: t.MockERC20WithFeeContract = artifacts.require("MockERC20WithFee");
const c_MockERC20: t.MockERC20Contract = artifacts.require("MockERC20");
const c_MockUSDT: t.MockUSDTContract = artifacts.require("MockUSDT");
const c_ERC20: t.ERC20Contract = artifacts.require("ERC20");

export interface MassetDetails {
    mAsset?: t.MassetInstance;
    forgeValidator?: t.ForgeValidatorInstance;
    basketManager?: t.MockBasketManagerInstance;
    bAssets?: Array<t.MockERC20Instance>;
    proxyAdmin?: t.DelayedProxyAdminInstance;
    aaveIntegration?: t.AaveIntegrationInstance;
    compoundIntegration?: t.CompoundIntegrationInstance;
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

    /**
     * @dev Deploys an mAsset with default parameters, modelled on original mUSD
     * @return Interface will all deployed information
     */
    public async deployMasset(enableUSDTFee = false): Promise<MassetDetails> {
        const md: MassetDetails = {};

        /** *************************************
        0. Mock platforms and bAssets
        Dependencies: []
        *************************************** */
        const bassetDetails = await this.loadBassets(enableUSDTFee);
        md.bAssets = bassetDetails.bAssets;

        /** *************************************
        2. mUSD
            Dependencies: [
                BasketManager [
                    ProxyAdmin,
                    PlatformIntegrations [ 
                        MockPlatforms
                    ]
                ]
            ]
        *************************************** */

        // 2.0. Deploy ProxyAdmin
        const d_DelayedProxyAdmin: t.DelayedProxyAdminInstance = await c_DelayedProxyAdmin.new(
            this.system.nexus.address,
            {
                from: this.sa.default,
            },
        );
        md.proxyAdmin = d_DelayedProxyAdmin;

        // 2.1. Deploy no Init BasketManager
        //  - Deploy Implementation
        const d_BasketManager: t.BasketManagerInstance = await c_BasketManager.new();
        //  - Deploy Initializable Proxy
        const d_BasketManagerProxy: t.InitializableAdminUpgradeabilityProxyInstance = await c_InitializableProxy.new();

        // 2.2. Deploy no Init AaveIntegration
        //  - Deploy Implementation with dummy params (this storage doesn't get used)
        const d_AaveIntegration: t.AaveIntegrationInstance = await c_AaveIntegration.new();
        //  - Deploy Initializable Proxy
        const d_AaveIntegrationProxy: t.InitializableAdminUpgradeabilityProxyInstance = await c_InitializableProxy.new();

        // 2.3. Deploy no Init CompoundIntegration
        //  - Deploy Implementation
        // We do not need platform address for compound
        const d_CompoundIntegration: t.CompoundIntegrationInstance = await c_CompoundIntegration.new();
        //  - Deploy Initializable Proxy
        const d_CompoundIntegrationProxy: t.InitializableAdminUpgradeabilityProxyInstance = await c_InitializableProxy.new();

        md.basketManager = await c_BasketManager.at(d_BasketManagerProxy.address);
        md.aaveIntegration = await c_AaveIntegration.at(d_AaveIntegrationProxy.address);
        md.compoundIntegration = await c_CompoundIntegration.at(d_CompoundIntegrationProxy.address);

        // 2.4. Deploy mUSD (w/ BasketManager addr)
        // 2.4.1. Deploy ForgeValidator
        const d_ForgeValidator: t.ForgeValidatorInstance = await c_ForgeValidator.new({
            from: this.sa.default,
        });
        md.forgeValidator = d_ForgeValidator;
        // 2.4.2. Deploy mUSD
        const d_MUSD: t.MUSDInstance = await c_MUSD.new(
            this.system.nexus.address,
            this.sa.feeRecipient,
            d_ForgeValidator.address,
            d_BasketManagerProxy.address,
            { from: this.sa.default },
        );
        md.mAsset = d_MUSD;

        // 2.5. Init AaveIntegration
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

        // 2.6. Init CompoundIntegration
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

        // 2.7. Init BasketManager
        const weight = 100;
        const initializationData_BasketManager: string = d_BasketManager.contract.methods
            .initialize(
                this.system.nexus.address,
                d_MUSD.address,
                bassetDetails.bAssets.map((b) => b.address),
                bassetDetails.platforms.map((p) =>
                    p === Platform.aave
                        ? d_AaveIntegrationProxy.address
                        : d_CompoundIntegrationProxy.address,
                ),
                bassetDetails.bAssets.map(() => percentToWeight(weight).toString()),
                bassetDetails.fees,
            )
            .encodeABI();
        await d_BasketManagerProxy.initialize(
            d_BasketManager.address,
            d_DelayedProxyAdmin.address,
            initializationData_BasketManager,
        );

        return md;
    }

    public async loadBassets(enableUSDTFee = false): Promise<BassetIntegrationDetails> {
        return this.system.isGanacheFork
            ? this.loadBassetsFork(enableUSDTFee)
            : this.loadBassetsLocal(enableUSDTFee);
    }

    public async loadBassetsFork(enableUSDTFee = false): Promise<BassetIntegrationDetails> {
        // load all the REAL bAssets
        const bAsset_DAI = await c_MockERC20.at(this.ma.DAI);
        await this.mintERC20(bAsset_DAI, this.ma.FUND_SOURCES.dai);

        const bAsset_USDC = await c_MockERC20.at(this.ma.USDC);
        await this.mintERC20(bAsset_USDC, this.ma.FUND_SOURCES.usdc);

        const bAsset_TUSD = await c_MockERC20.at(this.ma.TUSD);
        await this.mintERC20(bAsset_TUSD, this.ma.FUND_SOURCES.tusd);

        const bAsset_USDT = await c_MockERC20.at(this.ma.USDT);
        await this.mintERC20(bAsset_USDT, this.ma.FUND_SOURCES.usdt);

        const mockUSDT = await c_MockUSDT.at(bAsset_USDT.address);
        if (enableUSDTFee) {
            // Set fee rate to 0.1% and max fee to 30 USDT
            await mockUSDT.setParams("10", "30", {
                from: this.ma.USDT_OWNER,
            });
        } else {
            // Set fee rate to 0.1% and max fee to 30 USDT
            await mockUSDT.setParams("0", "30", {
                from: this.ma.USDT_OWNER,
            });
        }
        // credit sa.default with ample balances
        const bAssets = [bAsset_DAI, bAsset_USDC, bAsset_TUSD, bAsset_USDT];
        // return all the addresses
        return {
            bAssets,
            fees: [false, false, false, enableUSDTFee],
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

    public async loadBassetsLocal(enableUSDTFee = false): Promise<BassetIntegrationDetails> {
        //  - Mock bAssets
        const mockBasset1: t.MockERC20Instance = await c_MockERC20.new(
            "Mock1",
            "MK1",
            12,
            this.sa.default,
            100000000,
        );
        const mockBasset2: t.MockERC20Instance = enableUSDTFee
            ? await c_MockERC20WithFee.new("Mock5", "MK5", 6, this.sa.default, 100000000)
            : await c_MockERC20.new("Mock5", "MK5", 6, this.sa.default, 100000000);

        const mockBasset3: t.MockERC20Instance = await c_MockERC20.new(
            "Mock3",
            "MK3",
            18,
            this.sa.default,
            100000000,
        );
        // Mock up USDT for Aave
        const mockBasset4: t.MockERC20Instance = enableUSDTFee
            ? await c_MockERC20WithFee.new("Mock4", "MK4", 18, this.sa.default, 100000000)
            : await c_MockERC20.new("Mock4", "MK4", 18, this.sa.default, 100000000);

        // Mock C Token
        const mockCToken1: t.MockCTokenInstance = await c_MockCToken.new(mockBasset1.address);
        const mockCToken2: t.MockCTokenInstance = await c_MockCToken.new(mockBasset2.address);

        //  - Mock Aave integration
        const d_MockAave: t.MockAaveInstance = await c_MockAave.new({ from: this.sa.default });

        //  - Mock aTokens
        const mockAToken3: t.IAaveATokenInstance = await c_MockAToken.new(
            d_MockAave.address,
            mockBasset3.address,
        );
        const mockAToken4: t.IAaveATokenInstance = await c_MockAToken.new(
            d_MockAave.address,
            mockBasset4.address,
        );

        //  - Add to the Platform
        await d_MockAave.addAToken(mockAToken3.address, mockBasset3.address);
        await d_MockAave.addAToken(mockAToken4.address, mockBasset4.address);

        return {
            // DAI, USDC, TUSDT(aave), USDT(compound)
            bAssets: [mockBasset1, mockBasset2, mockBasset3, mockBasset4],
            fees: [false, enableUSDTFee, false, enableUSDTFee],
            platforms: [Platform.compound, Platform.compound, Platform.aave, Platform.aave],
            aavePlatformAddress: d_MockAave.address,
            aTokens: [
                {
                    bAsset: mockBasset3.address,
                    aToken: mockAToken3.address,
                },
                {
                    bAsset: mockBasset4.address,
                    aToken: mockAToken4.address,
                },
            ],
            cTokens: [
                {
                    bAsset: mockBasset1.address,
                    cToken: mockCToken1.address,
                },
                {
                    bAsset: mockBasset2.address,
                    cToken: mockCToken2.address,
                },
            ],
        };
    }

    public async mintERC20(
        erc20: t.MockERC20Instance,
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
    public async deployMassetAndSeedBasket(
        enableUSDTFee = false,
        initialSupply = 100,
    ): Promise<MassetDetails> {
        const massetDetails = await this.deployMasset(enableUSDTFee);

        // Mint initialSupply with shared weightings
        const basketDetails = await this.getBassetsInMasset(massetDetails);

        // Calc optimal weightings
        const totalWeighting = basketDetails.reduce((p, c) => {
            return p.add(new BN(c.maxWeight));
        }, new BN(0));
        const totalMintAmount = simpleToExactAmount(initialSupply, 18);
        const mintAmounts = await Promise.all(
            basketDetails.map(async (b) => {
                // e.g. 5e35 / 2e18 = 2.5e17
                const relativeWeighting = new BN(b.maxWeight).mul(fullScale).div(totalWeighting);
                // e.g. 1e20 * 25e16 / 1e18 = 25e18
                const mintAmount = totalMintAmount.mul(relativeWeighting).div(fullScale);
                // const bAssetDecimals: BN = await b.decimals();
                // const decimalDelta = new BN(18).sub(bAssetDecimals);
                return mintAmount.mul(ratioScale).div(new BN(b.ratio));
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

        await massetDetails.mAsset.mintMulti(
            basketDetails.map((b) => b.addr),
            mintAmounts,
            this.system.sa.default,
            { from: this.system.sa.default },
        );

        return massetDetails;
    }

    public async getBassetsInMasset(massetDetails: MassetDetails): Promise<Basset[]> {
        const response = await massetDetails.basketManager.getBassets();
        const bArrays: Array<Basset> = response[0].map((b) => {
            return {
                addr: b.addr,
                status: b.status,
                isTransferFeeCharged: b.isTransferFeeCharged,
                ratio: new BN(b.ratio),
                maxWeight: new BN(b.maxWeight),
                vaultBalance: new BN(b.vaultBalance),
            };
        });
        const bAssetContracts = await Promise.all(bArrays.map((b) => c_MockERC20.at(b.addr)));
        return bArrays.map((b, i) => {
            return {
                ...b,
                contract: bAssetContracts[i],
            };
        });
    }

    public async getBasketComposition(massetDetails: MassetDetails): Promise<BasketComposition> {
        // raw bAsset data
        const bAssets = await this.getBassetsInMasset(massetDetails);
        const basket = await massetDetails.basketManager.getBasket();
        // total supply of mAsset
        const totalSupply = await massetDetails.mAsset.totalSupply();
        // get weights (relative to totalSupply)
        // apply ratios, then find proportion of totalSupply all in BN
        const maxWeightInUnits = bAssets.map((b) =>
            totalSupply.mul(new BN(b.maxWeight)).div(fullScale),
        );
        // get overweight
        const currentVaultUnits = bAssets.map((b) =>
            new BN(b.vaultBalance).mul(new BN(b.ratio)).div(ratioScale),
        );
        const overweightBassets = bAssets.map(
            (b, i) => totalSupply.gt(new BN(0)) && currentVaultUnits[i].gt(maxWeightInUnits[i]),
        );
        // get total amount
        const sumOfBassets = currentVaultUnits.reduce((p, c, i) => p.add(c), new BN(0));
        return {
            bAssets: bAssets.map((b, i) => {
                return {
                    ...b,
                    address: b.addr,
                    mAssetUnits: currentVaultUnits[i],
                    overweight: overweightBassets[i],
                };
            }),
            totalSupply,
            sumOfBassets,
            failed: basket.failed,
            colRatio: basket.collateralisationRatio,
        };
    }

    public async approveMasset(
        bAsset: t.MockERC20Instance,
        mAsset: t.MassetInstance,
        fullMassetUnits: number | BN,
        sender: string = this.sa.default,
    ): Promise<BN> {
        const bAssetDecimals: BN = await bAsset.decimals();
        // let decimalDifference: BN = bAssetDecimals.sub(new BN(18));
        const approvalAmount: BN = simpleToExactAmount(fullMassetUnits, bAssetDecimals.toNumber());
        await bAsset.approve(mAsset.address, approvalAmount, { from: sender });
        return approvalAmount;
    }

    public async approveMassetMulti(
        bAssets: Array<t.MockERC20Instance>,
        mAsset: t.MassetInstance,
        fullMassetUnits: number,
        sender: string,
    ): Promise<Array<BN>> {
        const result = Promise.all(
            bAssets.map((b) => this.approveMasset(b, mAsset, fullMassetUnits, sender)),
        );
        return result;
    }
}
