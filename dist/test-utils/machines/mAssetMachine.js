"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MassetMachine = void 0;
const hardhat_1 = require("hardhat");
const generated_1 = require("types/generated");
const math_1 = require("@utils/math");
const constants_1 = require("@utils/constants");
const standardAccounts_1 = require("./standardAccounts");
class MassetMachine {
    constructor() {
        this.ma = new constants_1.MainnetAccounts();
    }
    async initAccounts(accounts) {
        this.sa = await new standardAccounts_1.StandardAccounts().initAccounts(accounts);
        return this;
    }
    // 3 bAssets, custom reserve
    async deployLite(a = 135) {
        const bAssets = await Promise.all([0, 1, 2].map((i) => this.loadBassetProxy(`${i}BASSET`, `${i}BASSET`, 18)));
        // 2. Invariant Validator
        const logicLib = await new generated_1.MassetLogic__factory(this.sa.default.signer).deploy();
        // 3. Invariant Validator
        const ManagerFactory = await new generated_1.MassetManager__factory(this.sa.default.signer);
        const managerLib = await ManagerFactory.deploy();
        const nexus = await new generated_1.MockNexus__factory(this.sa.default.signer).deploy(this.sa.governor.address, this.sa.mockSavingsManager.address, this.sa.mockInterestValidator.address);
        const mAssetFactoryLibs = {
            __$6a4be19f34d71a078def5cee18ccebcd10$__: logicLib.address,
            __$3b19b776afde68cd758db0cae1b8e49f94$__: managerLib.address,
        };
        const MassetFactory = new generated_1.ExposedMasset__factory(mAssetFactoryLibs, this.sa.default.signer);
        const impl = (await MassetFactory.deploy(nexus.address, math_1.simpleToExactAmount(5, 13)));
        const data = impl.interface.encodeFunctionData("initialize", [
            "mAsset Lite",
            "mLite",
            bAssets.map((b) => ({
                addr: b.address,
                integrator: constants_1.ZERO_ADDRESS,
                hasTxFee: false,
                status: 0,
            })),
            {
                a: math_1.BN.from(a),
                limits: {
                    min: math_1.simpleToExactAmount(5, 16),
                    max: math_1.simpleToExactAmount(75, 16),
                },
            },
        ]);
        const mAsset = await new generated_1.AssetProxy__factory(this.sa.default.signer).deploy(impl.address, constants_1.DEAD_ADDRESS, data);
        return {
            mAsset: (await MassetFactory.attach(mAsset.address)),
            bAssets,
            logicLib: logicLib,
            nexus,
        };
    }
    async deployMasset(useLendingMarkets = false, useTransferFees = false, a = 100) {
        // 1. Bassets
        const bAssets = await this.loadBassetsLocal(useLendingMarkets, useTransferFees);
        // 2. Invariant Validator
        const logicLib = await new generated_1.MassetLogic__factory(this.sa.default.signer).deploy();
        // 3. Invariant Validator
        const ManagerFactory = await new generated_1.MassetManager__factory(this.sa.default.signer);
        const managerLib = await ManagerFactory.deploy();
        const nexus = await new generated_1.MockNexus__factory(this.sa.default.signer).deploy(this.sa.governor.address, this.sa.mockSavingsManager.address, this.sa.mockInterestValidator.address);
        const integrationAddress = useLendingMarkets
            ? (await new generated_1.MockPlatformIntegration__factory(this.sa.default.signer).deploy(nexus.address, bAssets.aavePlatformAddress, bAssets.bAssets.map((b) => b.address), bAssets.aTokens.map((at) => at.aToken))).address
            : constants_1.ZERO_ADDRESS;
        // 3.2. Masset
        const mAssetFactoryLibs = {
            __$6a4be19f34d71a078def5cee18ccebcd10$__: logicLib.address,
            __$3b19b776afde68cd758db0cae1b8e49f94$__: managerLib.address,
        };
        const MassetFactory = new generated_1.ExposedMasset__factory(mAssetFactoryLibs, this.sa.default.signer);
        const impl = (await MassetFactory.deploy(nexus.address, math_1.simpleToExactAmount(5, 13)));
        const data = impl.interface.encodeFunctionData("initialize", [
            "mStable BTC",
            "mBTC",
            bAssets.bAssets.map((b, i) => ({
                addr: b.address,
                integrator: integrationAddress,
                hasTxFee: bAssets.bAssetTxFees[i],
                status: 0,
            })),
            {
                a,
                limits: {
                    min: math_1.simpleToExactAmount(5, 16),
                    max: math_1.simpleToExactAmount(65, 16),
                },
            },
        ]);
        const mAsset = await new generated_1.AssetProxy__factory(this.sa.default.signer).deploy(impl.address, constants_1.DEAD_ADDRESS, data);
        if (useLendingMarkets) {
            await new generated_1.MockPlatformIntegration__factory(this.sa.default.signer).attach(integrationAddress).addWhitelist([mAsset.address]);
        }
        return {
            mAsset: (await MassetFactory.attach(mAsset.address)),
            bAssets: bAssets.bAssets,
            aavePlatformAddress: bAssets.aavePlatformAddress,
            integrationAddress,
            platform: useLendingMarkets
                ? await new generated_1.MockPlatformIntegration__factory(this.sa.default.signer).attach(integrationAddress)
                : null,
            pTokens: useLendingMarkets ? bAssets.aTokens.map((at) => at.aToken) : [],
            logicLib,
            managerLib,
            wrappedManagerLib: await ManagerFactory.attach(mAsset.address),
            nexus,
        };
    }
    /**
     * @dev Seeds the mAsset basket with custom weightings
     * @param md Masset details object containing all deployed contracts
     * @param weights Whole numbers of mAsset to mint for each given bAsset
     */
    async seedWithWeightings(md, weights, inputIsInBaseUnits = false) {
        const { mAsset, bAssets } = md;
        const approvals = await Promise.all(bAssets.map((b, i) => this.approveMasset(b, mAsset, weights[i], this.sa.default.signer, inputIsInBaseUnits)));
        await mAsset.mintMulti(bAssets.map((b) => b.address), approvals, 0, this.sa.default.address);
    }
    // /**
    //  * @dev Deploys an mAsset with default parameters, modelled on original mUSD
    //  * @return Interface will all deployed information
    //  */
    // public async deployMasset(enableUSDTFee = false, useOldAave = false): Promise<MassetDetails> {
    //     const md: MassetDetails = {};
    //     /** *************************************
    //     0. Mock platforms and bAssets
    //     Dependencies: []
    //     *************************************** */
    //     const bassetDetails = await this.loadBassets(enableUSDTFee, useOldAave);
    //     md.bAssets = bassetDetails.bAssets;
    //     /** *************************************
    //     2. mUSD
    //         Dependencies: [
    //             BasketManager [
    //                 ProxyAdmin,
    //                 PlatformIntegrations [
    //                     MockPlatforms
    //                 ]
    //             ]
    //         ]
    //     *************************************** */
    //     // 2.0. Deploy ProxyAdmin
    //     const d_DelayedProxyAdmin: t.DelayedProxyAdminInstance = await c_DelayedProxyAdmin.new(
    //         this.system.nexus.address,
    //         {
    //             from: this.sa.default,
    //         },
    //     );
    //     md.proxyAdmin = d_DelayedProxyAdmin;
    //     // 2.1. Deploy no Init BasketManager
    //     //  - Deploy Implementation
    //     const d_BasketManager = await c_BasketManager.new();
    //     //  - Initialize the BasketManager implementation to avoid someone else doing it
    //     const d_DeadIntegration = await c_DeadIntegration.new();
    //     const d_DeadErc20 = await c_MockERC20.new("DEAD", "D34", 18, DEAD_ADDRESS, 1);
    //     await d_BasketManager.initialize(
    //         DEAD_ADDRESS,
    //         DEAD_ADDRESS,
    //         [d_DeadErc20.address],
    //         [d_DeadIntegration.address],
    //         [percentToWeight(100).toString()],
    //         [false],
    //     );
    //     //  - Deploy Initializable Proxy
    //     const d_BasketManagerProxy = await c_BasketManagerProxy.new();
    //     // 2.2. Deploy no Init AaveIntegration
    //     //  - Deploy Implementation with dummy params (this storage doesn't get used)
    //     const d_AaveIntegration = await (useOldAave
    //         ? c_AaveIntegration.new()
    //         : c_AaveV2Integration.new());
    //     await d_AaveIntegration.initialize(DEAD_ADDRESS, [DEAD_ADDRESS], DEAD_ADDRESS, [], []);
    //     //  - Deploy Initializable Proxy
    //     const d_AaveIntegrationProxy = await c_VaultProxy.new();
    //     // 2.3. Deploy no Init CompoundIntegration
    //     //  - Deploy Implementation
    //     // We do not need platform address for compound
    //     const d_CompoundIntegration: t.CompoundIntegrationInstance = await c_CompoundIntegration.new();
    //     await d_CompoundIntegration.initialize(DEAD_ADDRESS, [DEAD_ADDRESS], DEAD_ADDRESS, [], []);
    //     //  - Deploy Initializable Proxy
    //     const d_CompoundIntegrationProxy = await c_VaultProxy.new();
    //     md.basketManager = await c_BasketManager.at(d_BasketManagerProxy.address);
    //     md.aaveIntegration = await c_AaveIntegration.at(d_AaveIntegrationProxy.address);
    //     md.compoundIntegration = await c_CompoundIntegration.at(d_CompoundIntegrationProxy.address);
    //     // 2.4. Deploy mUSD (w/ BasketManager addr)
    //     // 2.4.1. Deploy ForgeValidator
    //     const d_ForgeValidator = await c_ForgeValidator.new({
    //         from: this.sa.default,
    //     });
    //     md.forgeValidator = d_ForgeValidator;
    //     // 2.4.2. Deploy mUSD
    //     // Deploy implementation
    //     const d_mUSD = await c_Masset.new();
    //     await d_mUSD.initialize("", "", DEAD_ADDRESS, DEAD_ADDRESS, DEAD_ADDRESS);
    //     // Deploy proxy
    //     const d_mUSDProxy = await c_AssetProxy.new();
    //     // Initialize proxy
    //     const initializationData_mUSD: string = d_mUSD.contract.methods
    //         .initialize(
    //             "mStable Mock",
    //             "mMOCK",
    //             this.system.nexus.address,
    //             d_ForgeValidator.address,
    //             d_BasketManagerProxy.address,
    //         )
    //         .encodeABI();
    //     await d_mUSDProxy.methods["initialize(address,address,bytes)"](
    //         d_mUSD.address,
    //         d_DelayedProxyAdmin.address,
    //         initializationData_mUSD,
    //     );
    //     md.mAsset = await c_Masset.at(d_mUSDProxy.address);
    //     // 2.5. Init AaveIntegration
    //     const initializationData_AaveIntegration: string = d_AaveIntegration.contract.methods
    //         .initialize(
    //             this.system.nexus.address,
    //             [d_mUSDProxy.address, d_BasketManagerProxy.address],
    //             bassetDetails.aavePlatformAddress,
    //             bassetDetails.aTokens.map((a) => a.bAsset),
    //             bassetDetails.aTokens.map((a) => a.aToken),
    //         )
    //         .encodeABI();
    //     await d_AaveIntegrationProxy.methods["initialize(address,address,bytes)"](
    //         d_AaveIntegration.address,
    //         d_DelayedProxyAdmin.address,
    //         initializationData_AaveIntegration,
    //     );
    //     // 2.6. Init CompoundIntegration
    //     const initializationData_CompoundIntegration: string = d_CompoundIntegration.contract.methods
    //         .initialize(
    //             this.system.nexus.address,
    //             [d_mUSDProxy.address, d_BasketManagerProxy.address],
    //             ZERO_ADDRESS, // We don't need Compound sys addr
    //             bassetDetails.cTokens.map((c) => c.bAsset),
    //             bassetDetails.cTokens.map((c) => c.cToken),
    //         )
    //         .encodeABI();
    //     await d_CompoundIntegrationProxy.methods["initialize(address,address,bytes)"](
    //         d_CompoundIntegration.address,
    //         d_DelayedProxyAdmin.address,
    //         initializationData_CompoundIntegration,
    //     );
    //     // 2.7. Init BasketManager
    //     const weight = 100;
    //     const initializationData_BasketManager: string = d_BasketManager.contract.methods
    //         .initialize(
    //             this.system.nexus.address,
    //             d_mUSDProxy.address,
    //             bassetDetails.bAssets.map((b) => b.address),
    //             bassetDetails.platforms.map((p) =>
    //                 p === Platform.aave
    //                     ? d_AaveIntegrationProxy.address
    //                     : d_CompoundIntegrationProxy.address,
    //             ),
    //             bassetDetails.bAssets.map(() => percentToWeight(weight).toString()),
    //             bassetDetails.fees,
    //         )
    //         .encodeABI();
    //     await d_BasketManagerProxy.methods["initialize(address,address,bytes)"](
    //         d_BasketManager.address,
    //         d_DelayedProxyAdmin.address,
    //         initializationData_BasketManager,
    //     );
    //     return md;
    // }
    // public async loadBassets(
    //     enableUSDTFee = false,
    //     useOldAave = false,
    // ): Promise<BassetIntegrationDetails> {
    //     return this.system.isGanacheFork
    //         ? this.loadBassetsFork(enableUSDTFee)
    //         : this.loadBassetsLocal(enableUSDTFee, useOldAave);
    // }
    // public async loadBassetsFork(enableUSDTFee = false): Promise<BassetIntegrationDetails> {
    //     // load all the REAL bAssets
    //     const bAsset_DAI = await c_MockERC20.at(this.ma.DAI);
    //     await this.mintERC20(bAsset_DAI, this.ma.FUND_SOURCES.dai);
    //     const bAsset_USDC = await c_MockERC20.at(this.ma.USDC);
    //     await this.mintERC20(bAsset_USDC, this.ma.FUND_SOURCES.usdc);
    //     const bAsset_TUSD = await c_MockERC20.at(this.ma.TUSD);
    //     await this.mintERC20(bAsset_TUSD, this.ma.FUND_SOURCES.tusd);
    //     const bAsset_USDT = await c_MockERC20.at(this.ma.USDT);
    //     await this.mintERC20(bAsset_USDT, this.ma.FUND_SOURCES.usdt);
    //     const mockUSDT = await c_MockUSDT.at(bAsset_USDT.address);
    //     if (enableUSDTFee) {
    //         // Set fee rate to 0.1% and max fee to 30 USDT
    //         await mockUSDT.setParams("10", "30", {
    //             from: this.ma.USDT_OWNER,
    //         });
    //     } else {
    //         // Set fee rate to 0.1% and max fee to 30 USDT
    //         await mockUSDT.setParams("0", "30", {
    //             from: this.ma.USDT_OWNER,
    //         });
    //     }
    //     // credit sa.default with ample balances
    //     const bAssets = [bAsset_DAI, bAsset_USDC, bAsset_TUSD, bAsset_USDT];
    //     // return all the addresses
    //     return {
    //         bAssets,
    //         fees: [false, false, false, enableUSDTFee],
    //         platforms: [Platform.compound, Platform.compound, Platform.aave, Platform.aave],
    //         aavePlatformAddress: this.ma.aavePlatform,
    //         aTokens: [
    //             {
    //                 bAsset: bAsset_TUSD.address,
    //                 aToken: this.ma.aTUSD,
    //             },
    //             {
    //                 bAsset: bAsset_USDT.address,
    //                 aToken: this.ma.aUSDT,
    //             },
    //         ],
    //         cTokens: [
    //             {
    //                 bAsset: bAsset_DAI.address,
    //                 cToken: this.ma.cDAI,
    //             },
    //             {
    //                 bAsset: bAsset_USDC.address,
    //                 cToken: this.ma.cUSDC,
    //             },
    //         ],
    //     };
    // }
    async loadBassetProxy(name, sym, dec, recipient = this.sa.default.address, init = 10000000000, enableUSDTFee = false) {
        // Factories
        const tokenFactory = enableUSDTFee
            ? await new generated_1.MockInitializableTokenWithFee__factory(this.sa.default.signer)
            : await new generated_1.MockInitializableToken__factory(this.sa.default.signer);
        const AssetProxyFactory = new generated_1.AssetProxy__factory(this.sa.default.signer);
        // Impl
        const mockInitializableToken = (await tokenFactory.deploy());
        // Proxy
        const data = await mockInitializableToken.interface.encodeFunctionData("initialize", [name, sym, dec, recipient, init]);
        const mAssetProxy = await AssetProxyFactory.deploy(mockInitializableToken.address, this.sa.governor.address, data);
        const mAsset = (await hardhat_1.ethers.getContractAt("MockERC20", mAssetProxy.address));
        return mAsset;
    }
    async loadBassetsLocal(useLendingMarkets = false, useTransferFees = false, recipient = this.sa.default.address) {
        //  - Mock bAssets
        const mockBasset1 = await this.loadBassetProxy("Ren BTC", "renBTC", 18, recipient);
        const mockBasset2 = await this.loadBassetProxy("Synthetix BTC", "sBTC", 6, recipient);
        const mockBasset3 = await this.loadBassetProxy("Wrapped BTC", "wBTC", 12, recipient, 10000000000, useTransferFees);
        const mockBasset4 = await this.loadBassetProxy("Binance Wrapped BTC", "bBTC", 18, recipient, 10000000000, useTransferFees);
        const bAssets = [mockBasset1, mockBasset2, mockBasset3, mockBasset4];
        // bAssets at index 2 and 3 only have transfer fees if useTransferFees is true
        const bAssetTxFees = bAssets.map((_, i) => useTransferFees && (i === 2 || i === 3));
        // Only deploy Aave mock and A tokens if lending markets are required
        const lendingProperties = useLendingMarkets ? await this.loadATokens(bAssets) : {};
        return {
            aavePlatformAddress: constants_1.ZERO_ADDRESS,
            aTokens: [],
            ...lendingProperties,
            bAssets,
            bAssetTxFees,
        };
    }
    /**
     * Deploy a mocked Aave contract.
     * For each bAsset:
     *   - transfer some bAsset tokens to the Aave mock
     *   - deploy a new mocked A token for the bAsset
     *   - add new A token to the mAsset platform integration
     * @param bAssets
     * @returns
     */
    async loadATokens(bAssets) {
        //  - Mock Aave integration
        const mockAave = await new generated_1.MockAaveV2__factory(this.sa.default.signer).deploy();
        await Promise.all(bAssets.map(async (b) => b.transfer(mockAave.address, (await b.totalSupply()).div(1000))));
        //  - Mock aTokens
        const aTokenFactory = new generated_1.MockATokenV2__factory(this.sa.default.signer);
        const mockATokens = await Promise.all(bAssets.map((b) => aTokenFactory.deploy(mockAave.address, b.address)));
        //  - Add to the Platform
        await Promise.all(bAssets.map((b, i) => mockAave.addAToken(mockATokens[i].address, b.address)));
        return {
            aavePlatformAddress: mockAave.address,
            aTokens: bAssets.map((b, i) => ({
                bAsset: b.address,
                aToken: mockATokens[i].address,
            })),
        };
    }
    // public async mintERC20(
    //     erc20: t.MockERC20Instance,
    //     source: Address,
    //     recipient: string = this.sa.default,
    // ): Promise<Truffle.TransactionResponse<any>> {
    //     const decimals = await erc20.decimals();
    //     return erc20.transfer(recipient, simpleToExactAmount(1000, decimals), {
    //         from: source,
    //     });
    // }
    // /**
    //  * @dev Deploy a Masset via the Manager then:
    //  *      1. Mint with optimal weightings
    //  */
    // public async deployMassetAndSeedBasket(
    //     enableUSDTFee = false,
    //     initialSupply = 100,
    // ): Promise<MassetDetails> {
    //     const mAssetDetails = await this.deployMasset(enableUSDTFee);
    //     // Mint initialSupply with shared weightings
    //     const basketDetails = await this.getBassetsInMasset(mAssetDetails);
    //     // Calc optimal weightings
    //     const totalWeighting = basketDetails.reduce((p, c) => {
    //         return p.add(new BN(c.maxWeight));
    //     }, new BN(0));
    //     const totalMintAmount = simpleToExactAmount(initialSupply, 18);
    //     const mintAmounts = await Promise.all(
    //         basketDetails.map(async (b) => {
    //             // e.g. 5e35 / 2e18 = 2.5e17
    //             const relativeWeighting = new BN(b.maxWeight).mul(fullScale).div(totalWeighting);
    //             // e.g. 1e20 * 25e16 / 1e18 = 25e18
    //             const mintAmount = totalMintAmount.mul(relativeWeighting).div(fullScale);
    //             // const bAssetDecimals: BN = await b.decimals();
    //             // const decimalDelta = new BN(18).sub(bAssetDecimals);
    //             return mintAmount.mul(ratioScale).div(new BN(b.ratio));
    //         }),
    //     );
    //     // Approve bAssets
    //     await Promise.all(
    //         mAssetDetails.bAssets.map((b, i) =>
    //             b.approve(mAssetDetails.mAsset.address, mintAmounts[i].muln(2), {
    //                 from: this.system.sa.default,
    //             }),
    //         ),
    //     );
    //     await mAssetDetails.mAsset.mintMulti(
    //         basketDetails.map((b) => b.addr),
    //         mintAmounts,
    //         this.system.sa.default,
    //         { from: this.system.sa.default },
    //     );
    //     await mAssetDetails.mAsset.mintMulti(
    //         basketDetails.map((b) => b.addr),
    //         mintAmounts,
    //         this.system.sa.default,
    //         { from: this.system.sa.default },
    //     );
    //     return mAssetDetails;
    // }
    async getBassetsInMasset(mAssetDetails) {
        const [personal, data] = await mAssetDetails.mAsset.getBassets();
        const bArrays = personal.map((b, i) => {
            const d = data[i];
            return {
                addr: b.addr,
                status: b.status,
                isTransferFeeCharged: b.hasTxFee,
                ratio: math_1.BN.from(d.ratio),
                vaultBalance: math_1.BN.from(d.vaultBalance),
                integratorAddr: b.integrator,
            };
        });
        const bAssetContracts = await Promise.all(bArrays.map((b) => hardhat_1.ethers.getContractAt("MockERC20", b.addr, this.sa.default.signer)));
        const integrators = (await Promise.all(bArrays.map((b) => b.integratorAddr === constants_1.ZERO_ADDRESS
            ? null
            : hardhat_1.ethers.getContractAt("MockPlatformIntegration", b.integratorAddr, this.sa.default.signer))));
        return bArrays.map((b, i) => ({
            ...b,
            contract: bAssetContracts[i],
            integrator: integrators[i],
        }));
    }
    async getBasset(mAssetDetails, bAssetAddress) {
        const bAsset = await mAssetDetails.mAsset.getBasset(bAssetAddress);
        const bAssetContract = (await hardhat_1.ethers.getContractAt("MockERC20", bAsset.personal.addr, this.sa.default.signer));
        const integrator = bAsset.personal.integrator === constants_1.ZERO_ADDRESS
            ? null
            : (await new generated_1.MockPlatformIntegration__factory(this.sa.default.signer).attach(bAsset.personal.integrator));
        return {
            addr: bAsset.personal.addr,
            status: bAsset.personal.status,
            isTransferFeeCharged: bAsset.personal.hasTxFee,
            ratio: math_1.BN.from(bAsset.bData.ratio),
            vaultBalance: math_1.BN.from(bAsset.bData.vaultBalance),
            integratorAddr: bAsset.personal.integrator,
            contract: bAssetContract,
            pToken: integrator ? await integrator.callStatic["bAssetToPToken(address)"](bAsset.personal.addr) : null,
            integrator,
        };
    }
    async getBasketComposition(mAssetDetails) {
        // raw bAsset data
        const bAssets = await this.getBassetsInMasset(mAssetDetails);
        const [failed, undergoingRecol] = await mAssetDetails.mAsset.getBasket();
        // total supply of mAsset
        const supply = await mAssetDetails.mAsset.totalSupply();
        const { surplus } = await mAssetDetails.mAsset.data();
        // get actual balance of each bAsset
        const rawBalances = await Promise.all(bAssets.map((b) => b.integrator ? b.contract.balanceOf(b.integrator.address) : b.contract.balanceOf(mAssetDetails.mAsset.address)));
        const platformBalances = await Promise.all(bAssets.map((b) => (b.integrator ? b.integrator.callStatic.checkBalance(b.addr) : math_1.BN.from(0))));
        const balances = rawBalances.map((b, i) => b.add(platformBalances[i]));
        // get overweight
        const currentVaultUnits = bAssets.map((b) => math_1.BN.from(b.vaultBalance).mul(math_1.BN.from(b.ratio)).div(constants_1.ratioScale));
        // get total amount
        const sumOfBassets = currentVaultUnits.reduce((p, c) => p.add(c), math_1.BN.from(0));
        return {
            bAssets: bAssets.map((b, i) => ({
                ...b,
                address: b.addr,
                mAssetUnits: currentVaultUnits[i],
                actualBalance: balances[i],
                rawBalance: rawBalances[i],
                platformBalance: platformBalances[i],
            })),
            totalSupply: supply,
            surplus,
            sumOfBassets,
            failed,
            undergoingRecol,
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
    async approveMasset(bAsset, mAsset, fullMassetUnits, sender = this.sa.default.signer, inputIsBaseUnits = false) {
        const bAssetDecimals = await bAsset.decimals();
        const approvalAmount = inputIsBaseUnits ? math_1.BN.from(fullMassetUnits) : math_1.simpleToExactAmount(fullMassetUnits, bAssetDecimals);
        await bAsset.connect(sender).approve(mAsset.address, approvalAmount);
        return approvalAmount;
    }
    async approveMassetMulti(bAssets, mAsset, fullMassetUnits, sender) {
        const result = Promise.all(bAssets.map((b) => this.approveMasset(b, mAsset, fullMassetUnits, sender)));
        return result;
    }
    static async getPlatformInteraction(mAsset, type, amount, bAsset) {
        const hasIntegrator = bAsset.integratorAddr === constants_1.ZERO_ADDRESS;
        const integratorBalBefore = await bAsset.contract.balanceOf(bAsset.integrator ? bAsset.integratorAddr : mAsset.address);
        if (hasIntegrator) {
            return {
                hasLendingMarket: false,
                expectInteraction: false,
                rawBalance: type === "deposit" ? integratorBalBefore.add(amount) : integratorBalBefore.sub(amount),
            };
        }
        const hasTxFee = bAsset.isTransferFeeCharged;
        if (hasTxFee) {
            return {
                hasLendingMarket: true,
                expectInteraction: true,
                amount,
                rawBalance: math_1.BN.from(0),
            };
        }
        const totalSupply = await mAsset.totalSupply();
        const { cacheSize, surplus } = await mAsset.data();
        const maxC = totalSupply.add(surplus).mul(constants_1.ratioScale).div(math_1.BN.from(bAsset.ratio)).mul(cacheSize).div(constants_1.fullScale);
        const newSum = math_1.BN.from(integratorBalBefore).add(amount);
        const expectInteraction = type === "deposit" ? newSum.gte(maxC) : amount.gt(math_1.BN.from(integratorBalBefore));
        return {
            hasLendingMarket: true,
            expectInteraction,
            amount: type === "deposit"
                ? newSum.sub(maxC.div(2))
                : math_1.minimum(maxC.div(2).add(amount).sub(math_1.BN.from(integratorBalBefore)), math_1.BN.from(bAsset.vaultBalance).sub(math_1.BN.from(integratorBalBefore))),
            rawBalance: type === "deposit"
                ? expectInteraction
                    ? maxC.div(2)
                    : newSum
                : expectInteraction
                    ? math_1.minimum(maxC.div(2), math_1.BN.from(bAsset.vaultBalance).sub(amount))
                    : math_1.BN.from(integratorBalBefore).sub(amount),
        };
    }
}
exports.MassetMachine = MassetMachine;
//# sourceMappingURL=mAssetMachine.js.map