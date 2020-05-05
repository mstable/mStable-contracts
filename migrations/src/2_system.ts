/* eslint-disable @typescript-eslint/triple-slash-reference,spaced-comment */
/// <reference path="../../types/generated/index.d.ts" />
/// <reference path="../../types/generated/types.d.ts" />

/* eslint-disable @typescript-eslint/camelcase */
import { percentToWeight, simpleToExactAmount } from "@utils/math";
import { ZERO_ADDRESS, RopstenAccounts } from "@utils/constants";
import * as t from "types/generated";
import { Address } from "../../types";

export interface ATokenDetails {
    bAsset: Address;
    aToken: Address;
}
export interface CTokenDetails {
    bAsset: Address;
    cToken: Address;
}

export enum Platform {
    aave,
    compound,
}

export interface BassetIntegrationDetails {
    bAssets: Array<t.MockErc20Instance>;
    platforms: Array<Platform>;
    aavePlatformAddress: Address;
    aTokens: Array<ATokenDetails>;
    cTokens: Array<CTokenDetails>;
}

async function loadBassetsRopsten(artifacts: Truffle.Artifacts): Promise<BassetIntegrationDetails> {
    const c_MockERC20 = artifacts.require("MockERC20");

    let ra = new RopstenAccounts();
    // load all the REAL bAssets from Ropsten
    const bAsset_DAI = await c_MockERC20.at(ra.DAI);
    const bAsset_USDC = await c_MockERC20.at(ra.USDC);
    const bAsset_TUSD = await c_MockERC20.at(ra.TUSD);
    const bAsset_USDT = await c_MockERC20.at(ra.USDT);
    const bAssets = [bAsset_DAI, bAsset_USDC, bAsset_TUSD, bAsset_USDT];
    // return all the addresses
    return {
        bAssets,
        platforms: [Platform.compound, Platform.compound, Platform.aave, Platform.aave],
        aavePlatformAddress: ra.aavePlatform,
        cTokens: [
            {
                bAsset: bAsset_DAI.address,
                cToken: ra.cDAI,
            },
            {
                bAsset: bAsset_USDC.address,
                cToken: ra.cUSDC,
            },
        ],
        aTokens: [
            {
                bAsset: bAsset_TUSD.address,
                aToken: ra.aTUSD,
            },
            {
                bAsset: bAsset_USDT.address,
                aToken: ra.aUSDT,
            },
        ],
    };
}

async function loadBassetsLocal(
    artifacts: Truffle.Artifacts,
    deployer,
): Promise<BassetIntegrationDetails> {
    const c_MockERC20 = artifacts.require("MockERC20");
    const c_MockAave = artifacts.require("MockAave");
    const c_MockAToken = artifacts.require("MockAToken");
    const c_MockCToken = artifacts.require("MockCToken");
    //  - Mock bAssets
    const mockBasset1 = await c_MockERC20.new("Mock1", "MK1", 12, deployer, 100000000);
    const mockBasset2 = await c_MockERC20.new("Mock2", "MK2", 18, deployer, 100000000);
    const mockBasset3 = await c_MockERC20.new("Mock3", "MK3", 6, deployer, 100000000);
    const mockBasset4 = await c_MockERC20.new("Mock4", "MK4", 18, deployer, 100000000);

    //  - Mock Aave integration
    const d_MockAave = await c_MockAave.new({ from: deployer });

    //  - Mock aTokens
    const mockAToken1 = await c_MockAToken.new(d_MockAave.address, mockBasset1.address);
    const mockAToken2 = await c_MockAToken.new(d_MockAave.address, mockBasset2.address);
    const mockAToken3 = await c_MockAToken.new(d_MockAave.address, mockBasset3.address);

    //  - Add to the Platform
    await d_MockAave.addAToken(mockAToken1.address, mockBasset1.address);
    await d_MockAave.addAToken(mockAToken2.address, mockBasset2.address);
    await d_MockAave.addAToken(mockAToken3.address, mockBasset3.address);

    // Mock C Token
    const mockCToken4 = await c_MockCToken.new(mockBasset4.address);
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

export default async (
    { artifacts }: { artifacts: Truffle.Artifacts },
    deployer,
    network,
    accounts,
) => {
    if (deployer.network === "fork") {
        // Don't bother running these migrations -- speed up the testing
        return;
    }

    /***************************************
    0. TYPECHAIN IMPORTS
    Imports parallel to folder layout
    ****************************************/

    // Masset
    // - ForgeValidator
    const c_ForgeValidator = artifacts.require("ForgeValidator");
    // - Platforms (u)
    //    - Aave
    const c_AaveIntegration = artifacts.require("AaveIntegration");
    //    - Compound
    const c_CompoundIntegration = artifacts.require("CompoundIntegration");
    // - BasketManager (u)
    const c_BasketManager = artifacts.require("BasketManager");
    // - mUSD
    const c_MUSD = artifacts.require("MUSD");

    // Nexus
    const c_Nexus = artifacts.require("Nexus");

    // Proxy
    // - Admin
    const c_DelayedProxyAdmin = artifacts.require("DelayedProxyAdmin");
    // - BaseProxies
    const c_InitializableProxy = artifacts.require(
        // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
        // @ts-ignore
        "@openzeppelin/upgrades/InitializableAdminUpgradeabilityProxy",
    ) as t.InitializableAdminUpgradeabilityProxyContract;

    // Savings
    // - Contract
    const c_SavingsContract = artifacts.require("SavingsContract");
    // - Manager
    const c_SavingsManager = artifacts.require("SavingsManager");

    /***************************************
    0. Mock platforms and bAssets
    Dependencies: []
    ****************************************/

    let default_, governor, feeRecipient;
    let bassetDetails: BassetIntegrationDetails;
    if (deployer.network === "ropsten") {
        [default_, governor] = accounts;
        feeRecipient = accounts[2];
        console.log("Loading Ropsten bAssets and lending platforms");
        bassetDetails = await loadBassetsRopsten(artifacts);
    } else {
        [default_, governor, feeRecipient] = accounts;
        console.log(
            `==============================================\n` +
                `Generating mock bAssets and lending platforms\n` +
                `==============================================\n\n`,
        );
        bassetDetails = await loadBassetsLocal(artifacts, default_);
    }

    /***************************************
    1. Nexus
    Dependencies: []
    ****************************************/

    await deployer.deploy(c_Nexus, governor, { from: default_ });
    const d_Nexus = await c_Nexus.deployed();

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
    await deployer.deploy(c_DelayedProxyAdmin, d_Nexus.address, { from: default_ });
    const d_DelayedProxyAdmin = await c_DelayedProxyAdmin.deployed();

    // 2.1. Deploy no Init BasketManager
    //  - Deploy Implementation
    await deployer.deploy(c_BasketManager);
    const d_BasketManager = await c_BasketManager.deployed();
    //  - Deploy Initializable Proxy
    const d_BasketManagerProxy = await c_InitializableProxy.new();

    // 2.2. Deploy no Init AaveIntegration
    //  - Deploy Implementation with dummy params (this storage doesn't get used)
    await deployer.deploy(c_AaveIntegration);
    const d_AaveIntegration = await c_AaveIntegration.deployed();
    //  - Deploy Initializable Proxy
    const d_AaveIntegrationProxy = await c_InitializableProxy.new();

    // 2.3. Deploy no Init CompoundIntegration
    //  - Deploy Implementation
    // We do not need platform address for compound
    await deployer.deploy(c_CompoundIntegration);
    const d_CompoundIntegration = await c_CompoundIntegration.deployed();
    //  - Deploy Initializable Proxy
    const d_CompoundIntegrationProxy = await c_InitializableProxy.new();

    // 2.4. Deploy mUSD (w/ BasketManager addr)
    // 2.4.1. Deploy ForgeValidator
    await deployer.deploy(c_ForgeValidator, { from: default_ });
    const d_ForgeValidator = await c_ForgeValidator.deployed();
    // 2.4.2. Deploy mUSD
    await deployer.deploy(
        c_MUSD,
        d_Nexus.address,
        feeRecipient,
        d_ForgeValidator.address,
        d_BasketManagerProxy.address,
        { from: default_ },
    );
    const d_MUSD = await c_MUSD.deployed();

    // 2.5. Init BasketManager
    const initializationData_BasketManager: string = d_BasketManager.contract.methods
        .initialize(
            d_Nexus.address,
            d_MUSD.address,
            simpleToExactAmount(1, 24).toString(),
            bassetDetails.bAssets.map((b) => b.address),
            bassetDetails.platforms.map((p) =>
                p === Platform.aave
                    ? d_AaveIntegrationProxy.address
                    : d_CompoundIntegrationProxy.address,
            ),
            bassetDetails.bAssets.map(() => percentToWeight(25).toString()),
            bassetDetails.bAssets.map(() => false),
        )
        .encodeABI();
    await d_BasketManagerProxy.methods["initialize(address,address,bytes)"](
        d_BasketManager.address,
        d_DelayedProxyAdmin.address,
        initializationData_BasketManager,
    );

    // 2.6. Init AaveIntegration
    const initializationData_AaveIntegration: string = d_AaveIntegration.contract.methods
        .initialize(
            d_Nexus.address,
            [d_MUSD.address, d_BasketManagerProxy.address],
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

    // 2.7. Init CompoundIntegration
    const initializationData_CompoundIntegration: string = d_CompoundIntegration.contract.methods
        .initialize(
            d_Nexus.address,
            [d_MUSD.address, d_BasketManagerProxy.address],
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

    /***************************************
    3. Savings
    Dependencies: [
      mUSD
    ]
    ****************************************/

    // Savings Contract
    await deployer.deploy(c_SavingsContract, d_Nexus.address, d_MUSD.address, { from: default_ });
    const d_SavingsContract = await c_SavingsContract.deployed();

    // Savings Manager
    await deployer.deploy(
        c_SavingsManager,
        d_Nexus.address,
        d_MUSD.address,
        d_SavingsContract.address,
        { from: default_ },
    );
    const d_SavingsManager = await c_SavingsManager.deployed();

    /***************************************
    4. Initialize Nexus Modules
    Dependencies: [
      New Governor,
      SavingsManager
    ]
  ****************************************/

    const module_keys = [
        await d_SavingsManager.KEY_SAVINGS_MANAGER(),
        await d_DelayedProxyAdmin.KEY_PROXY_ADMIN(),
    ];
    const module_addresses = [d_SavingsManager.address, d_DelayedProxyAdmin.address];
    const module_isLocked = [false, true];
    await d_Nexus.initialize(module_keys, module_addresses, module_isLocked, governor, {
        from: governor,
    });

    console.log(`[mUSD]: '${d_MUSD.address}'`);
    console.log(`[SavingsManager]: '${d_SavingsManager.address}'`);
    console.log(`[SavingsContract]: '${d_SavingsContract.address}'`);
};
