/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable class-methods-use-this */
/* eslint-disable no-nested-ternary */

import * as t from "types/generated";
import { simpleToExactAmount, percentToWeight } from "@utils/math";
import { BN } from "@utils/tools";
import {
    fullScale,
    MainnetAccounts,
    ratioScale,
    ZERO_ADDRESS,
    DEAD_ADDRESS,
} from "@utils/constants";
import { Basset } from "@utils/mstable-objects";
import { SystemMachine, StandardAccounts } from ".";
import { Address } from "../../types/common";
import {
    BassetIntegrationDetails,
    Platform,
    BasketComposition,
    ActionDetails,
} from "../../types/machines";

// ForgeValidator
const c_ForgeValidator = artifacts.require("ForgeValidator");

// Proxy
const c_DelayedProxyAdmin = artifacts.require("DelayedProxyAdmin");
const c_MassetProxy = artifacts.require("MassetProxy");
const c_BasketManagerProxy = artifacts.require("BasketManagerProxy");
const c_DeadIntegration = artifacts.require("DeadIntegration");
const c_VaultProxy = artifacts.require("VaultProxy");

// Integrations
const c_AaveIntegration = artifacts.require("AaveIntegration");
const c_AaveV2Integration = artifacts.require("AaveV2Integration");
const c_MockAaveV1 = artifacts.require("MockAaveV1");
const c_MockAaveV2 = artifacts.require("MockAaveV2");
const c_MockAToken = artifacts.require("MockAToken");
const c_MockATokenV2 = artifacts.require("MockATokenV2");
const c_CompoundIntegration = artifacts.require("CompoundIntegration");
const c_MockCToken = artifacts.require("MockCToken");

// Basket
const c_BasketManager = artifacts.require("MockBasketManager");

// Masset
const c_Masset = artifacts.require("Masset");
const c_MockERC20 = artifacts.require("MockERC20");
const c_MockInitializableToken = artifacts.require("MockInitializableToken");
const c_MockInitializableTokenWithFee = artifacts.require("MockInitializableTokenWithFee");
const c_MockUSDT = artifacts.require("MockUSDT");
const c_PlatformIntegration = artifacts.require("IPlatformIntegration");

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
    public async deployMasset(enableUSDTFee = false, useOldAave = false): Promise<MassetDetails> {
        const md: MassetDetails = {};

        /** *************************************
        0. Mock platforms and bAssets
        Dependencies: []
        *************************************** */
        const bassetDetails = await this.loadBassets(enableUSDTFee, useOldAave);
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
        const d_BasketManager = await c_BasketManager.new();
        //  - Initialize the BasketManager implementation to avoid someone else doing it
        const d_DeadIntegration = await c_DeadIntegration.new();
        const d_DeadErc20 = await c_MockERC20.new("DEAD", "D34", 18, DEAD_ADDRESS, 1);
        await d_BasketManager.initialize(
            DEAD_ADDRESS,
            DEAD_ADDRESS,
            [d_DeadErc20.address],
            [d_DeadIntegration.address],
            [percentToWeight(100).toString()],
            [false],
        );
        //  - Deploy Initializable Proxy
        const d_BasketManagerProxy = await c_BasketManagerProxy.new();

        // 2.2. Deploy no Init AaveIntegration
        //  - Deploy Implementation with dummy params (this storage doesn't get used)
        const d_AaveIntegration = await (useOldAave
            ? c_AaveIntegration.new()
            : c_AaveV2Integration.new());
        await d_AaveIntegration.initialize(DEAD_ADDRESS, [DEAD_ADDRESS], DEAD_ADDRESS, [], []);
        //  - Deploy Initializable Proxy
        const d_AaveIntegrationProxy = await c_VaultProxy.new();

        // 2.3. Deploy no Init CompoundIntegration
        //  - Deploy Implementation
        // We do not need platform address for compound
        const d_CompoundIntegration: t.CompoundIntegrationInstance = await c_CompoundIntegration.new();
        await d_CompoundIntegration.initialize(DEAD_ADDRESS, [DEAD_ADDRESS], DEAD_ADDRESS, [], []);
        //  - Deploy Initializable Proxy
        const d_CompoundIntegrationProxy = await c_VaultProxy.new();

        md.basketManager = await c_BasketManager.at(d_BasketManagerProxy.address);
        md.aaveIntegration = await c_AaveIntegration.at(d_AaveIntegrationProxy.address);
        md.compoundIntegration = await c_CompoundIntegration.at(d_CompoundIntegrationProxy.address);

        // 2.4. Deploy mUSD (w/ BasketManager addr)
        // 2.4.1. Deploy ForgeValidator
        const d_ForgeValidator = await c_ForgeValidator.new({
            from: this.sa.default,
        });
        md.forgeValidator = d_ForgeValidator;
        // 2.4.2. Deploy mUSD
        // Deploy implementation
        const d_mUSD = await c_Masset.new();
        await d_mUSD.initialize("", "", DEAD_ADDRESS, DEAD_ADDRESS, DEAD_ADDRESS);
        // Deploy proxy
        const d_mUSDProxy = await c_MassetProxy.new();
        // Initialize proxy
        const initializationData_mUSD: string = d_mUSD.contract.methods
            .initialize(
                "mStable Mock",
                "mMOCK",
                this.system.nexus.address,
                d_ForgeValidator.address,
                d_BasketManagerProxy.address,
            )
            .encodeABI();
        await d_mUSDProxy.methods["initialize(address,address,bytes)"](
            d_mUSD.address,
            d_DelayedProxyAdmin.address,
            initializationData_mUSD,
        );
        md.mAsset = await c_Masset.at(d_mUSDProxy.address);

        // 2.5. Init AaveIntegration
        const initializationData_AaveIntegration: string = d_AaveIntegration.contract.methods
            .initialize(
                this.system.nexus.address,
                [d_mUSDProxy.address, d_BasketManagerProxy.address],
                bassetDetails.aavePlatformAddress,
                bassetDetails.aTokens.map((a) => a.bAsset),
                bassetDetails.aTokens.map((a) => a.aToken),
            )
            .encodeABI();
        await d_AaveIntegrationProxy.methods["initialize(address,address,bytes)"](
            d_AaveIntegration.address,
            d_DelayedProxyAdmin.address,
            initializationData_AaveIntegration,
        );

        // 2.6. Init CompoundIntegration
        const initializationData_CompoundIntegration: string = d_CompoundIntegration.contract.methods
            .initialize(
                this.system.nexus.address,
                [d_mUSDProxy.address, d_BasketManagerProxy.address],
                ZERO_ADDRESS, // We don't need Compound sys addr
                bassetDetails.cTokens.map((c) => c.bAsset),
                bassetDetails.cTokens.map((c) => c.cToken),
            )
            .encodeABI();
        await d_CompoundIntegrationProxy.methods["initialize(address,address,bytes)"](
            d_CompoundIntegration.address,
            d_DelayedProxyAdmin.address,
            initializationData_CompoundIntegration,
        );

        // 2.7. Init BasketManager
        const weight = 100;
        const initializationData_BasketManager: string = d_BasketManager.contract.methods
            .initialize(
                this.system.nexus.address,
                d_mUSDProxy.address,
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
        await d_BasketManagerProxy.methods["initialize(address,address,bytes)"](
            d_BasketManager.address,
            d_DelayedProxyAdmin.address,
            initializationData_BasketManager,
        );

        return md;
    }

    public async loadBassets(
        enableUSDTFee = false,
        useOldAave = false,
    ): Promise<BassetIntegrationDetails> {
        return this.system.isGanacheFork
            ? this.loadBassetsFork(enableUSDTFee)
            : this.loadBassetsLocal(enableUSDTFee, useOldAave);
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

    private async loadBassetProxy(
        name: string,
        sym: string,
        dec: number,
        recipient = this.sa.default,
        init = 100000000,
        enableUSDTFee = false,
    ): Promise<t.MockERC20Instance> {
        const x = await c_MassetProxy.new();
        const y = enableUSDTFee
            ? await c_MockInitializableTokenWithFee.new()
            : await c_MockInitializableToken.new();
        const data = y.contract.methods.initialize(name, sym, dec, recipient, init).encodeABI();
        await x.methods["initialize(address,address,bytes)"](y.address, this.sa.governor, data);
        return (await c_MockERC20.at(x.address)) as t.MockERC20Instance;
    }

    public async loadBassetsLocal(
        enableUSDTFee = false,
        useOldAave = false,
    ): Promise<BassetIntegrationDetails> {
        //  - Mock bAssets

        const mockBasset1 = await this.loadBassetProxy("Mock1", "MK1", 12);
        const mockBasset2 = await this.loadBassetProxy(
            "Mock5",
            "MK5",
            6,
            this.sa.default,
            100000000,
            enableUSDTFee,
        );

        const mockBasset3 = await this.loadBassetProxy("Mock3", "MK3", 18);
        const mockBasset4 = await this.loadBassetProxy(
            "Mock4",
            "MK4",
            18,
            this.sa.default,
            100000000,
            enableUSDTFee,
        );

        // Mock C Token
        const mockCToken1 = await c_MockCToken.new(mockBasset1.address);
        const mockCToken2 = await c_MockCToken.new(mockBasset2.address);

        //  - Mock Aave integration
        const aaveVersion = useOldAave ? c_MockAaveV1 : c_MockAaveV2;
        const d_MockAave = await aaveVersion.new({ from: this.sa.default });

        //  - Mock aTokens
        const aToken = useOldAave ? c_MockAToken : c_MockATokenV2;
        const mockAToken3 = await aToken.new(d_MockAave.address, mockBasset3.address);
        const mockAToken4 = await aToken.new(d_MockAave.address, mockBasset4.address);

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
    ): Promise<Truffle.TransactionResponse<any>> {
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
                b.approve(massetDetails.mAsset.address, mintAmounts[i].muln(2), {
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
        const integratorAddresses = await Promise.all(
            bArrays.map((b, i) => massetDetails.basketManager.integrations(i)),
        );
        const integrators = await Promise.all(
            integratorAddresses.map((i) => c_PlatformIntegration.at(i)),
        );
        return bArrays.map((b, i) => {
            return {
                ...b,
                contract: bAssetContracts[i],
                integrator: integrators[i],
            };
        });
    }

    public async getBasketComposition(massetDetails: MassetDetails): Promise<BasketComposition> {
        // raw bAsset data
        const bAssets = await this.getBassetsInMasset(massetDetails);
        const basket = await massetDetails.basketManager.getBasket();
        // total supply of mAsset
        const supply = await massetDetails.mAsset.totalSupply();
        const surplus = await massetDetails.mAsset.surplus();
        const totalSupply = supply.add(surplus);
        // get weights (relative to totalSupply)
        // apply ratios, then find proportion of totalSupply all in BN
        const maxWeightInUnits = bAssets.map((b) =>
            totalSupply.mul(new BN(b.maxWeight)).div(fullScale),
        );
        // get actual balance of each bAsset
        const rawBalances = await Promise.all(
            bAssets.map((b) => b.contract.balanceOf(b.integrator.address)),
        );
        const platformBalances = await Promise.all(
            bAssets.map((b) => b.integrator.checkBalance.call(b.addr)),
        );
        const balances = rawBalances.map((b, i) => b.add(platformBalances[i]));
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
                    actualBalance: balances[i],
                    rawBalance: rawBalances[i],
                    platformBalance: platformBalances[i],
                };
            }),
            totalSupply: supply,
            surplus,
            sumOfBassets,
            failed: basket.failed,
            undergoingRecol: basket.undergoingRecol,
            colRatio: basket.collateralisationRatio,
        };
    }

    /**
     * @dev Takes a whole unit approval amount, and converts it to the equivalent
     * base asset amount, before approving and returning the exact approval
     * @param bAsset Asset to approve spending of
     * @param mAsset Masset that gets permission to spend
     * @param fullMassetUnits Whole number or fraction to approve
     * @param sender Set if needed, else fall back to default
     * @param inputIsBaseUnits Override the scaling up to MassetQ
     */
    public async approveMasset(
        bAsset: t.MockERC20Instance,
        mAsset: t.MassetInstance,
        fullMassetUnits: number | BN | string,
        sender: string = this.sa.default,
        inputIsBaseUnits = false,
    ): Promise<BN> {
        const bAssetDecimals: BN = await bAsset.decimals();
        // let decimalDifference: BN = bAssetDecimals.sub(new BN(18));
        const approvalAmount: BN = inputIsBaseUnits
            ? new BN(fullMassetUnits)
            : simpleToExactAmount(fullMassetUnits, bAssetDecimals.toNumber());
        await bAsset.approve(mAsset.address, approvalAmount, { from: sender });
        return approvalAmount;
    }

    public async getBasset(bm: t.MockBasketManagerInstance, addr: string): Promise<Basset> {
        const bAsset = await bm.getBasset(addr);
        const bAssetContract = await c_MockERC20.at(addr);
        const integratorAddresses = await bm.getBassetIntegrator(addr);
        const integrator = await c_PlatformIntegration.at(integratorAddresses);
        return {
            ...bAsset,
            contract: bAssetContract,
            integrator,
        };
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

    public async getPlatformInteraction(
        mAsset: t.MassetInstance,
        type: "deposit" | "withdrawal",
        amount: BN,
        integratorBalBefore: number | BN,
        bAsset: Basset,
    ): Promise<ActionDetails> {
        const hasTxFee = bAsset.isTransferFeeCharged;
        if (hasTxFee) {
            return {
                expectInteraction: true,
                amount,
                rawBalance: new BN(0),
            };
        }
        const totalSupply = await mAsset.totalSupply();
        const surplus = await mAsset.surplus();
        const cacheSize = await mAsset.cacheSize();
        const maxC = totalSupply
            .add(surplus)
            .mul(ratioScale)
            .div(new BN(bAsset.ratio))
            .mul(cacheSize)
            .div(fullScale);
        const newSum = new BN(integratorBalBefore).add(amount);
        const expectInteraction =
            type === "deposit" ? newSum.gte(maxC as any) : amount.gt(new BN(integratorBalBefore));
        return {
            expectInteraction,
            amount:
                type === "deposit"
                    ? newSum.sub(maxC.divn(2))
                    : BN.min(
                          maxC
                              .divn(2)
                              .add(amount)
                              .sub(new BN(integratorBalBefore)),
                          new BN(bAsset.vaultBalance).sub(new BN(integratorBalBefore)),
                      ),
            rawBalance:
                type === "deposit"
                    ? expectInteraction
                        ? maxC.divn(2)
                        : newSum
                    : expectInteraction
                    ? BN.min(maxC.divn(2), new BN(bAsset.vaultBalance).sub(amount))
                    : new BN(integratorBalBefore).sub(amount),
        };
    }
}
