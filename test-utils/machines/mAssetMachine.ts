/* eslint-disable class-methods-use-this */
/* eslint-disable no-nested-ternary */

import { Signer } from "ethers"
import { ethers } from "hardhat"
import {
    InvariantValidator__factory,
    MockInvariantValidator__factory,
    AssetProxy__factory,
    MockNexus__factory,
    ExposedMasset,
    ExposedMasset__factory,
    Masset,
    InvariantValidator,
    MockERC20,
    DelayedProxyAdmin,
    MockInitializableToken,
    MockAaveV2__factory,
    MockATokenV2__factory,
    MockPlatformIntegration,
    MockPlatformIntegration__factory,
    IPlatformIntegration,
    MockInitializableToken__factory,
    MockInitializableTokenWithFee__factory,
    Manager,
} from "types/generated"
import { BN, minimum, simpleToExactAmount } from "@utils/math"
import { fullScale, MainnetAccounts, ratioScale, ZERO_ADDRESS, DEAD_ADDRESS } from "@utils/constants"
import { Basset } from "@utils/mstable-objects"
import { StandardAccounts } from "./standardAccounts"
import { ActionDetails, BasketComposition, BassetIntegrationDetails } from "../../types/machines"

export interface MassetDetails {
    mAsset?: ExposedMasset
    forgeValidator?: InvariantValidator
    bAssets?: Array<MockERC20>
    pTokens?: Array<string>
    proxyAdmin?: DelayedProxyAdmin
    platform?: MockPlatformIntegration
    aavePlatformAddress?: string
    managerLib?: Manager
}

export class MassetMachine {
    public sa: StandardAccounts

    public ma: MainnetAccounts

    constructor() {
        this.ma = new MainnetAccounts()
    }

    public async initAccounts(accounts: Signer[]): Promise<MassetMachine> {
        this.sa = await new StandardAccounts().initAccounts(accounts)
        return this
    }

    public async deployMasset(useMockValidator = false, useLendingMarkets = false, useTransferFees = false): Promise<MassetDetails> {
        // 1. Bassets
        const bAssets = await this.loadBassetsLocal(useLendingMarkets, useTransferFees)

        // 2. Invariant Validator
        // If mocks enabled, uses mock which returns 1:1 on all actions
        const forgeVal = await (useMockValidator
            ? new MockInvariantValidator__factory(this.sa.default.signer).deploy()
            : new InvariantValidator__factory(this.sa.default.signer).deploy(simpleToExactAmount(1, 24), simpleToExactAmount(1, 24)))

        // 3. Masset
        // 3.1. Dependencies
        const ManagerFactory = await ethers.getContractFactory("Manager")
        const managerLib = (await ManagerFactory.deploy()) as Manager

        const nexus = await new MockNexus__factory(this.sa.default.signer).deploy(
            this.sa.governor.address,
            this.sa.mockSavingsManager.address,
        )
        const integrationAddress = useLendingMarkets
            ? (
                  await new MockPlatformIntegration__factory(this.sa.default.signer).deploy(
                      nexus.address,
                      bAssets.aavePlatformAddress,
                      bAssets.bAssets.map((b) => b.address),
                      bAssets.aTokens.map((a) => a.aToken),
                  )
              ).address
            : ZERO_ADDRESS

        // 3.2. Masset
        const MassetFactory = (await (
            await ethers.getContractFactory("ExposedMasset", {
                libraries: {
                    Manager: managerLib.address,
                },
            })
        ).connect(this.sa.default.signer)) as ExposedMasset__factory
        const impl = (await MassetFactory.deploy(nexus.address)) as ExposedMasset

        const data = impl.interface.encodeFunctionData("initialize", [
            "mStable BTC",
            "mBTC",
            forgeVal.address,
            bAssets.bAssets.map((b, i) => ({
                addr: b.address,
                integrator: integrationAddress,
                hasTxFee: bAssets.bAssetTxFees[i],
                status: 0,
            })),
            {
                a: simpleToExactAmount(1, 2),
                limits: {
                    min: simpleToExactAmount(5, 16),
                    max: simpleToExactAmount(55, 16),
                },
            },
        ])
        const mAsset = await new AssetProxy__factory(this.sa.default.signer).deploy(impl.address, DEAD_ADDRESS, data)

        if (useLendingMarkets) {
            await new MockPlatformIntegration__factory(this.sa.default.signer).attach(integrationAddress).addWhitelist([mAsset.address])
        }
        return {
            mAsset: (await MassetFactory.attach(mAsset.address)) as ExposedMasset,
            bAssets: bAssets.bAssets,
            pTokens: bAssets.aTokens.map((a) => a.aToken),
            aavePlatformAddress: bAssets.aavePlatformAddress,
            forgeValidator: forgeVal as InvariantValidator,
            platform: useLendingMarkets
                ? await new MockPlatformIntegration__factory(this.sa.default.signer).attach(integrationAddress)
                : null,
            managerLib: (await ManagerFactory.attach(mAsset.address)) as Manager,
        }
    }

    /**
     * @dev Seeds the mAsset basket with custom weightings
     * @param md Masset details object containing all deployed contracts
     * @param weights Whole numbers of mAsset to mint for each given bAsset
     */
    public async seedWithWeightings(md: MassetDetails, weights: Array<BN | number>): Promise<void> {
        const { mAsset, bAssets } = md
        const approvals = await Promise.all(bAssets.map((b, i) => this.approveMasset(b, mAsset, weights[i], this.sa.default.signer)))
        await mAsset.mintMulti(
            bAssets.map((b) => b.address),
            approvals,
            0,
            this.sa.default.address,
        )
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

    public async loadBassetProxy(
        name: string,
        sym: string,
        dec: number,
        recipient: string = this.sa.default.address,
        init = 10000000000,
        enableUSDTFee = false,
    ): Promise<MockERC20> {
        // Factories
        const tokenFactory = enableUSDTFee
            ? await new MockInitializableTokenWithFee__factory(this.sa.default.signer)
            : await new MockInitializableToken__factory(this.sa.default.signer)
        const AssetProxyFactory = await ethers.getContractFactory("AssetProxy")

        // Impl
        const mockInitializableToken = (await tokenFactory.deploy()) as MockInitializableToken

        // Proxy
        const data = await mockInitializableToken.interface.encodeFunctionData("initialize", [name, sym, dec, recipient, init])
        const mAssetProxy = await AssetProxyFactory.deploy(mockInitializableToken.address, this.sa.governor.address, data)
        const mAsset = (await ethers.getContractAt("MockERC20", mAssetProxy.address)) as MockERC20
        return mAsset
    }

    public async loadBassetsLocal(useLendingMarkets = false, useTransferFees = false): Promise<BassetIntegrationDetails> {
        //  - Mock bAssets
        const mockBasset1 = await this.loadBassetProxy("Ren BTC", "renBTC", 18)
        const mockBasset2 = await this.loadBassetProxy("Synthetix BTC", "sBTC", 6)
        const mockBasset3 = await this.loadBassetProxy("Wrapped BTC", "wBTC", 12, this.sa.default.address, 10000000000, useTransferFees)
        const mockBasset4 = await this.loadBassetProxy(
            "Binance Wrapped BTC",
            "bBTC",
            18,
            this.sa.default.address,
            10000000000,
            useTransferFees,
        )
        const bAssets = [mockBasset1, mockBasset2, mockBasset3, mockBasset4]
        // bAssets at index 2 and 3 only have transfer fees if useTransferFees is true
        const bAssetTxFees = bAssets.map((_, i) => useTransferFees && (i === 2 || i === 3))

        //  - Mock Aave integration
        const mockAave = await new MockAaveV2__factory(this.sa.default.signer).deploy()

        //  - Mock aTokens
        const aTokenFactory = new MockATokenV2__factory(this.sa.default.signer)
        await Promise.all(bAssets.map(async (b) => b.transfer(mockAave.address, (await b.totalSupply()).div(1000))))
        const mockAToken1 = await aTokenFactory.deploy(mockAave.address, mockBasset1.address)
        const mockAToken2 = await aTokenFactory.deploy(mockAave.address, mockBasset2.address)
        const mockAToken3 = await aTokenFactory.deploy(mockAave.address, mockBasset3.address)
        const mockAToken4 = await aTokenFactory.deploy(mockAave.address, mockBasset4.address)

        //  - Add to the Platform
        await mockAave.addAToken(mockAToken1.address, mockBasset1.address)
        await mockAave.addAToken(mockAToken2.address, mockBasset2.address)
        await mockAave.addAToken(mockAToken3.address, mockBasset3.address)
        await mockAave.addAToken(mockAToken4.address, mockBasset4.address)

        return {
            bAssets,
            bAssetTxFees,
            aavePlatformAddress: mockAave.address,
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
                {
                    bAsset: mockBasset4.address,
                    aToken: mockAToken4.address,
                },
            ],
        }
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

    public async getBassetsInMasset(mAssetDetails: MassetDetails): Promise<Basset[]> {
        const [personal, data] = await mAssetDetails.mAsset.getBassets()
        const bArrays: Array<Basset> = personal.map((b, i) => {
            const d = data[i]
            return {
                addr: b.addr,
                status: b.status,
                isTransferFeeCharged: b.hasTxFee,
                ratio: BN.from(d.ratio),
                vaultBalance: BN.from(d.vaultBalance),
                integratorAddr: b.integrator,
            }
        })
        const bAssetContracts: MockERC20[] = await Promise.all(
            bArrays.map((b) => ethers.getContractAt("MockERC20", b.addr, this.sa.default.signer) as Promise<MockERC20>),
        )
        const integrators = (await Promise.all(
            bArrays.map((b) =>
                b.integratorAddr === ZERO_ADDRESS
                    ? null
                    : ethers.getContractAt("MockPlatformIntegration", b.integratorAddr, this.sa.default.signer),
            ),
        )) as Array<IPlatformIntegration>
        return bArrays.map((b, i) => ({
            ...b,
            contract: bAssetContracts[i],
            integrator: integrators[i],
        }))
    }

    public async getBasset(mAssetDetails: MassetDetails, bAssetAddress: string): Promise<Basset> {
        const bAsset = await mAssetDetails.mAsset.getBasset(bAssetAddress)
        const bAssetContract = (await ethers.getContractAt("MockERC20", bAsset.personal.addr, this.sa.default.signer)) as MockERC20
        const integrator =
            bAsset.personal.integrator === ZERO_ADDRESS
                ? null
                : (((await new MockPlatformIntegration__factory(this.sa.default.signer).attach(
                      bAsset.personal.integrator,
                  )) as unknown) as IPlatformIntegration)
        return {
            addr: bAsset.personal.addr,
            status: bAsset.personal.status,
            isTransferFeeCharged: bAsset.personal.hasTxFee,
            ratio: BN.from(bAsset.data.ratio),
            vaultBalance: BN.from(bAsset.data.vaultBalance),
            integratorAddr: bAsset.personal.integrator,
            contract: bAssetContract,
            pToken: integrator ? await integrator.callStatic["bAssetToPToken(address)"](bAsset.personal.addr) : null,
            integrator,
        }
    }

    public async getBasketComposition(mAssetDetails: MassetDetails): Promise<BasketComposition> {
        // raw bAsset data
        const bAssets = await this.getBassetsInMasset(mAssetDetails)

        const [failed, undergoingRecol] = await mAssetDetails.mAsset.getBasket()
        // total supply of mAsset
        const supply = await mAssetDetails.mAsset.totalSupply()
        const surplus = await mAssetDetails.mAsset.surplus()
        // get actual balance of each bAsset
        const rawBalances = await Promise.all(
            bAssets.map((b) =>
                b.integrator ? b.contract.balanceOf(b.integrator.address) : b.contract.balanceOf(mAssetDetails.mAsset.address),
            ),
        )
        const platformBalances = await Promise.all(
            bAssets.map((b) => (b.integrator ? b.integrator.callStatic.checkBalance(b.addr) : BN.from(0))),
        )

        const balances = rawBalances.map((b, i) => b.add(platformBalances[i]))
        // get overweight
        const currentVaultUnits = bAssets.map((b) => BN.from(b.vaultBalance).mul(BN.from(b.ratio)).div(ratioScale))
        // get total amount
        const sumOfBassets = currentVaultUnits.reduce((p, c) => p.add(c), BN.from(0))
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
        }
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
        bAsset: MockERC20,
        mAsset: Masset | ExposedMasset,
        fullMassetUnits: number | BN | string,
        sender: Signer = this.sa.default.signer,
        inputIsBaseUnits = false,
    ): Promise<BN> {
        const bAssetDecimals = await bAsset.decimals()
        const approvalAmount: BN = inputIsBaseUnits ? BN.from(fullMassetUnits) : simpleToExactAmount(fullMassetUnits, bAssetDecimals)
        await bAsset.connect(sender).approve(mAsset.address, approvalAmount)
        return approvalAmount
    }

    public async approveMassetMulti(
        bAssets: Array<MockERC20>,
        mAsset: Masset | ExposedMasset,
        fullMassetUnits: number,
        sender: Signer,
    ): Promise<Array<BN>> {
        const result = Promise.all(bAssets.map((b) => this.approveMasset(b, mAsset, fullMassetUnits, sender)))
        return result
    }

    public async getPlatformInteraction(
        mAsset: Masset | ExposedMasset,
        type: "deposit" | "withdrawal",
        amount: BN,
        bAsset: Basset,
    ): Promise<ActionDetails> {
        const hasIntegrator = bAsset.integratorAddr === ZERO_ADDRESS
        const integratorBalBefore = await bAsset.contract.balanceOf(bAsset.integrator ? bAsset.integratorAddr : mAsset.address)
        if (hasIntegrator) {
            return {
                hasLendingMarket: false,
                expectInteraction: false,
                rawBalance: type === "deposit" ? integratorBalBefore.add(amount) : integratorBalBefore.sub(amount),
            }
        }
        const hasTxFee = bAsset.isTransferFeeCharged
        if (hasTxFee) {
            return {
                hasLendingMarket: true,
                expectInteraction: true,
                amount,
                rawBalance: BN.from(0),
            }
        }
        const totalSupply = await mAsset.totalSupply()
        const surplus = await mAsset.surplus()
        const cacheSize = await mAsset.cacheSize()
        const maxC = totalSupply.add(surplus).mul(ratioScale).div(BN.from(bAsset.ratio)).mul(cacheSize).div(fullScale)
        const newSum = BN.from(integratorBalBefore).add(amount)
        const expectInteraction = type === "deposit" ? newSum.gte(maxC) : amount.gt(BN.from(integratorBalBefore))
        return {
            hasLendingMarket: true,
            expectInteraction,
            amount:
                type === "deposit"
                    ? newSum.sub(maxC.div(2))
                    : minimum(
                          maxC.div(2).add(amount).sub(BN.from(integratorBalBefore)),
                          BN.from(bAsset.vaultBalance).sub(BN.from(integratorBalBefore)),
                      ),
            rawBalance:
                type === "deposit"
                    ? expectInteraction
                        ? maxC.div(2)
                        : newSum
                    : expectInteraction
                    ? minimum(maxC.div(2), BN.from(bAsset.vaultBalance).sub(amount))
                    : BN.from(integratorBalBefore).sub(amount),
        }
    }
}
