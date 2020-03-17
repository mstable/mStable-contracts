import * as t from "types/generated";
import { Address } from "types/common";
import { SystemMachine, StandardAccounts, BassetMachine } from ".";
import { createMultiple, simpleToExactAmount, percentToWeight } from "@utils/math";
import { BN, aToH } from "@utils/tools";
import { expScale, MainnetAccounts } from "@utils/constants";
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

export interface MassetDetails {
    mUSD?: t.MUSDInstance;
    basketManager?: t.BasketManagerInstance;
    bAssets?: Array<t.ERC20MockInstance>;
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

    public async deployMasset(): Promise<MassetDetails> {
        let md: MassetDetails = {};

        /***************************************
        0. Mock platforms and bAssets
        Dependencies: []
        ****************************************/

        if (isForkedGanache) {
            // load all the REAL bAssets and credit the user with balance
        } else {
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

            md.bAssets = [mockBasset1, mockBasset2, mockBasset3, mockBasset4];
        }

        //  - Mock Aave integration
        const d_MockAave: t.MockAaveInstance = await c_MockAave.new({ from: this.sa.default });

        //  - Mock aTokens
        const mockAToken1: t.MockATokenInstance = await c_MockAToken.new(
            d_MockAave.address,
            mockBasset1.address,
        );
        const mockAToken2: t.MockATokenInstance = await c_MockAToken.new(
            d_MockAave.address,
            mockBasset2.address,
        );
        const mockAToken3: t.MockATokenInstance = await c_MockAToken.new(
            d_MockAave.address,
            mockBasset3.address,
        );

        //  - Add to the Platform
        await d_MockAave.addAToken(mockAToken1.address, mockBasset1.address);
        await d_MockAave.addAToken(mockAToken2.address, mockBasset2.address);
        await d_MockAave.addAToken(mockAToken3.address, mockBasset3.address);

        // Mock C Token
        const mockCToken4: t.MockCTokenInstance = await c_MockCToken.new(mockBasset4.address);

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
            d_MockAave.address,
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
        md.compoundIntegration = await c_CompoundIntegration.at(c_CompoundIntegration.address);

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
        md.mUSD = d_MUSD;

        // 2.5. Init BasketManager
        const initializationData_BasketManager: string = d_BasketManager.contract.methods
            .initialize(
                this.system.nexus.address,
                d_MUSD.address,
                [
                    mockBasset1.address,
                    mockBasset2.address,
                    mockBasset3.address,
                    mockBasset4.address,
                ],
                [
                    d_AaveIntegrationProxy.address,
                    d_AaveIntegrationProxy.address,
                    d_AaveIntegrationProxy.address,
                    d_CompoundIntegrationProxy.address,
                ],
                [
                    percentToWeight(100).toString(),
                    percentToWeight(100).toString(),
                    percentToWeight(100).toString(),
                    percentToWeight(100).toString(),
                ],
                [false, false, false, false],
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
                d_MockAave.address,
                [mockBasset1.address, mockBasset2.address, mockBasset3.address],
                [mockAToken1.address, mockAToken2.address, mockAToken3.address],
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
                [mockBasset4.address],
                [mockCToken4.address],
            )
            .encodeABI();
        await d_CompoundIntegrationProxy.initialize(
            d_CompoundIntegration.address,
            d_DelayedProxyAdmin.address,
            initializationData_CompoundIntegration,
        );
        return md;
    }

    public async mintAllTokens() {
        // When Ganache not running mainnet forked version, dont mint
        if (!(await this.system.isRunningValidFork())) {
            console.warn(
                "*** Ganache not running on MAINNET fork. Hence, avoid minting tokens ***",
            );
            return;
        }

        // mainnet addresses
        await this.mintERC20(this.ma.DAI);
        await this.mintERC20(this.ma.GUSD);
        await this.mintERC20(this.ma.PAX);
        // SUSD
        // Getting error when calling `transfer()` "Transfer requires settle"
        //await this.mintERC20(this.ma.SUSD);
        await this.mintERC20(this.ma.TUSD);
        await this.mintERC20(this.ma.USDC);
        await this.mintERC20(this.ma.USDT);
    }

    public async mintERC20(erc20: string) {
        const instance: t.ERC20MockInstance = await c_ERC20Mock.at(erc20);
        const decimals = await instance.decimals();
        const symbol = await instance.symbol();
        console.log("Symbol: " + symbol + " decimals: " + decimals);
        const ONE_TOKEN = new BN(10).pow(decimals);
        const HUNDRED_TOKEN = ONE_TOKEN.mul(new BN(100));
        let i;
        for (i = 0; i < this.sa.all.length; i++) {
            await instance.transfer(this.sa.all[i], HUNDRED_TOKEN, {
                from: this.ma.FUND_SOURCE,
            });
            const bal: BN = await instance.balanceOf(this.sa.all[i]);
            console.log(bal.toString(10));
        }
    }

    // /**
    //  * @dev Deploy a Masset via the Manager
    //  */
    // public async createBasicMasset(
    //     bAssetCount: number = 5,
    //     sender: Address = this.system.sa.governor,
    // ): Promise<MassetDetails> {
    //     const bassetMachine = new BassetMachine(
    //         this.system.sa.default,
    //         this.system.sa.other,
    //         500000,
    //     );

    //     let bAssetPromises = [];
    //     for (var i = 0; i < bAssetCount; i++) {
    //         bAssetPromises.push(bassetMachine.deployERC20Async());
    //     }
    //     let bAssets: Array<ERC20MockInstance> = await Promise.all(bAssetPromises);

    //     const mAsset = await MassetArtifact.new(
    //         "TestMasset",
    //         "TMT",
    //         this.system.nexus.address,
    //         bAssets.map((b) => b.address),
    //         bAssets.map(() => percentToWeight(200 / bAssetCount)),
    //         bAssets.map(() => createMultiple(1)),
    //         bAssets.map(() => false),
    //         this.system.sa.feeRecipient,
    //         this.system.forgeValidator.address,
    //     );

    //     // Adds the Masset to Manager so that it can look up its price
    //     await this.system.manager.addMasset(aToH("TMT"), mAsset.address, {
    //         from: this.system.sa.governor,
    //     });
    //     return {
    //         mAsset,
    //         bAssets,
    //     };
    // }

    // /**
    //  * @dev Deploy a Masset via the Manager then:
    //  *      1. Mint with optimal weightings
    //  */
    // public async createMassetAndSeedBasket(
    //     initialSupply: number = 5000000,
    //     bAssetCount: number = 5,
    //     sender: Address = this.system.sa.governor,
    // ): Promise<MassetDetails> {
    //     try {
    //         let massetDetails = await this.createBasicMasset();

    //         // Mint initialSupply with shared weightings
    //         let basketDetails = await this.getBassetsInMasset(massetDetails.mAsset.address);

    //         // Calc optimal weightings
    //         let totalWeighting = basketDetails.reduce((p, c) => p.add(c.maxWeight), new BN(0));
    //         let totalMintAmount = simpleToExactAmount(initialSupply, 18);
    //         let mintAmounts = basketDetails.map((b) => {
    //             // e.g. 5e35 / 2e18 = 2.5e17
    //             const relativeWeighting = b.maxWeight.mul(expScale).div(totalWeighting);
    //             // e.g. 5e25 * 25e16 / 1e18
    //             return totalMintAmount.mul(relativeWeighting).div(expScale);
    //         });

    //         // Approve bAssets
    //         await Promise.all(
    //             massetDetails.bAssets.map((b, i) =>
    //                 b.approve(massetDetails.mAsset.address, mintAmounts[i], {
    //                     from: this.system.sa.default,
    //                 }),
    //             ),
    //         );

    //         const bitmap = await massetDetails.mAsset.getBitmapForAllBassets();
    //         // Mint
    //         // console.log("Checkpoint 4", bitmap.toNumber());
    //         // console.log(
    //         //     "Checkpoint 4",
    //         //     mintAmounts.map((m) => m.toString()),
    //         // );
    //         // console.log(
    //         //     "Checkpoint 4",
    //         //     await Promise.all(
    //         //         massetDetails.bAssets.map(async (b) =>
    //         //             (
    //         //                 await b.allowance(this.system.sa.default, massetDetails.mAsset.address)
    //         //             ).toString(),
    //         //         ),
    //         //     ),
    //         // );
    //         // console.log(
    //         //     "Checkpoint 5",
    //         //     await Promise.all(
    //         //         massetDetails.bAssets.map(async (b) =>
    //         //             (await b.balanceOf(this.system.sa.default)).toString(),
    //         //         ),
    //         //     ),
    //         // );

    //         await massetDetails.mAsset.mintMulti(
    //             bitmap.toNumber(),
    //             mintAmounts,
    //             this.system.sa.default,
    //             { from: this.system.sa.default },
    //         );

    //         return massetDetails;
    //     } catch (e) {
    //         console.error(e);
    //     }
    // }

    // public async getMassetAtAddress(address: Address): Promise<MassetInstance> {
    //     return MassetArtifact.at(address);
    // }

    // public async getBassetsInMasset(address: Address): Promise<Basset[]> {
    //     // const masset = await this.getMassetAtAddress(address);
    //     const masset = await this.getMassetAtAddress(address);
    //     const bArrays = await masset.getBassets();

    //     return this.convertToBasset(bArrays);
    // }

    // /*
    // public async function createMassetWithBassets(
    //     sysMachine: SystemMachine,
    //     sa: StandardAccounts,
    //     numOfBassets): Promise<MassetInstance> {

    //     await sysMachine.initialiseMocks();
    //     const bassetMachine = new BassetMachine(sa.default, sa.other, 500000);

    //     // 1. Deploy bAssets
    //     let bAssets = new Array();
    //     let bAssetsAddr = new Array();
    //     let symbols = new Array();
    //     let weights = new Array();
    //     let multiplier = new Array();

    //     const percent = 200 / numOfBassets;// Lets take 200% and divide by total bAssets to create
    //     let i;
    //     for (i = 0; i < numOfBassets; i++) {
    //         bAssets[i] = await bassetMachine.deployERC20Async();
    //         bAssetsAddr[i] = bAssets[i].address;
    //         symbols[i] = aToH("bAsset-" + (i + 1));
    //         weights[i] = percentToWeight(percent);
    //         multiplier[i] = createMultiple(1); // By Default all ratio 1
    //     }

    //     // 2. Masset contract deploy
    //     const masset: MassetInstance = await MassetArtifact.new(
    //         "TestMasset",
    //         "TMT",
    //         sysMachine.nexus.address,
    //         bAssetsAddr,
    //         symbols,
    //         weights,
    //         multiplier,
    //         sa.feeRecipient,
    //         sysMachine.forgeValidator.address,
    //     );
    //     return masset;
    // }
    // */

    // private convertToBasset = (bArrays: any[]): Basset[] => {
    //     return bArrays[0].map((_, i) => {
    //         return {
    //             addr: bArrays[0][i],
    //             ratio: bArrays[1][i],
    //             maxWeight: bArrays[2][i],
    //             vaultBalance: bArrays[3][i],
    //             isTransferFeeCharged: bArrays[4][i],
    //             status: parseInt(bArrays[5][i].toString()),
    //         };
    //     });
    // };
}
