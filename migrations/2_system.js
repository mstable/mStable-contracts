/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable no-undef */
/* eslint-disable spaced-comment */

// Imports parallel to folder layout

// Masset
// - ForgeValidator
const c_ForgeValidator = artifacts.require("ForgeValidator");
// - Platforms (u)
//    - Aave
const c_AaveIntegration = artifacts.require("AaveIntegration");
const c_MockAave = artifacts.require("MockAave");
const c_MockAToken = artifacts.require("MockAToken");
//    - Compound
const c_CompoundIntegration = artifacts.require("CompoundIntegration");
const c_MockCToken = artifacts.require("MockCToken");
// - BasketManager (u)
const c_BasketManager = artifacts.require("BasketManager");
// - mUSD
const c_MUSD = artifacts.require("MUSD");
const c_ERC20Mock = artifacts.require("ERC20Mock");

// Nexus
const c_Nexus = artifacts.require("Nexus");

// Proxy
// - Admin
const c_DelayedProxyAdmin = artifacts.require("DelayedProxyAdmin");
// - BaseProxies
const c_InitializableProxy = artifacts.require(
    "@openzeppelin/upgrades/InitializableAdminUpgradeabilityProxy",
);

// Savings
// - Contract
const c_SavingsContract = artifacts.require("SavingsContract");
// - Manager
const c_SavingsManager = artifacts.require("SavingsManager");

const { percentToWeight } = require("@utils/math");
const { ZERO_ADDRESS } = require("@utils/constants");

module.exports = async (deployer, network, accounts) => {
    const [default_, governor, , , feeRecipient] = accounts;

    /***************************************
    0. Mock platforms and bAssets
    Dependencies: []
    ****************************************/

    //  - Mock bAssets
    const mockBasset1 = await c_ERC20Mock.new("Mock1", "MK1", 12, default_, 100000000);
    const mockBasset2 = await c_ERC20Mock.new("Mock2", "MK2", 18, default_, 100000000);
    const mockBasset3 = await c_ERC20Mock.new("Mock3", "MK3", 6, default_, 100000000);
    const mockBasset4 = await c_ERC20Mock.new("Mock4", "MK4", 18, default_, 100000000);

    //  - Mock Aave integration
    await deployer.deploy(c_MockAave, { from: default_ });
    const d_MockAave = await c_MockAave.deployed();

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

    /***************************************
    1. Nexus
    Dependencies: []
    ****************************************/

    await deployer.deploy(c_Nexus, default_, { from: default_ });
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
    await deployer.deploy(c_BasketManager, d_Nexus.address, { from: default_ });
    const d_BasketManager = await c_BasketManager.deployed();
    //  - Deploy Initializable Proxy
    const d_BasketManagerProxy = await c_InitializableProxy.new();


    // 2.2. Deploy no Init AaveIntegration
    //  - Deploy Implementation with dummy params (this storage doesn't get used)
    await deployer.deploy(
        c_AaveIntegration,
        d_Nexus.address,
        [d_BasketManagerProxy.address],
        d_MockAave.address,
        [],
        [],
        { from: default_ },
    );
    const d_AaveIntegration = await c_AaveIntegration.deployed();
    //  - Deploy Initializable Proxy
    const d_AaveIntegrationProxy = await c_InitializableProxy.new();


    // 2.3. Deploy no Init CompoundIntegration
    //  - Deploy Implementation
    // We do not need platform address for compound
    await deployer.deploy(
        c_CompoundIntegration,
        d_Nexus.address,
        [d_BasketManagerProxy.address],
        [],
        [],
        { from: default_ },
    );
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
    const initializationData_BasketManager = d_BasketManager.contract.methods.initialize(
        d_Nexus.address,
        d_MUSD.address,
        [mockBasset1.address, mockBasset2.address, mockBasset3.address, mockBasset4.address],
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
    ).encodeABI();
    await d_BasketManagerProxy.initialize(
        d_BasketManager.address,
        d_DelayedProxyAdmin.address,
        initializationData_BasketManager,
    );

    // 2.6. Init AaveIntegration
    const initializationData_AaveIntegration = d_AaveIntegration.contract.methods.initialize(
        d_Nexus.address,
        [d_MUSD.address, d_BasketManagerProxy.address],
        d_MockAave.address,
        [mockBasset1.address, mockBasset2.address, mockBasset3.address],
        [mockAToken1.address, mockAToken2.address, mockAToken3.address],
    ).encodeABI();
    await d_AaveIntegrationProxy.initialize(
        d_AaveIntegration.address,
        d_DelayedProxyAdmin.address,
        initializationData_AaveIntegration,
    );

    // 2.7. Init CompoundIntegration
    const initializationData_CompoundIntegration = d_CompoundIntegration.contract.methods.initialize(
        d_Nexus.address,
        [d_MUSD.address, d_BasketManagerProxy.address],
        ZERO_ADDRESS, // We don't need Compound sys addr
        [mockBasset4.address],
        [mockCToken4.address],
    ).encodeABI();
    await d_CompoundIntegrationProxy.initialize(
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

    const module_keys = [await d_SavingsManager.Key_SavingsManager()];
    const module_addresses = [d_SavingsManager.address];
    const module_isLocked = [false];
    await d_Nexus.initialize(module_keys, module_addresses, module_isLocked, governor, {
        from: default_,
    });

    console.log(`[mUSD]: '${d_MUSD.address}'`);
    console.log(`[SavingsManager]: '${d_SavingsManager.address}'`);
    console.log(`[SavingsContract]: '${d_SavingsContract.address}'`);
};
