/* eslint-disable no-underscore-dangle */
/* eslint-disable no-param-reassign */
/* eslint-disable @typescript-eslint/no-unused-expressions */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable no-console */
import { expect } from "chai"
import { Contract, ContractFactory, Signer } from "ethers"
import { ethers, network } from "hardhat"

import { ONE_WEEK, ONE_DAY, ZERO_ADDRESS } from "@utils/constants"
import { applyDecimals, applyRatio, applyRatioMassetToBasset, BN, simpleToExactAmount } from "@utils/math"
import {
    DelayedProxyAdmin,
    DelayedProxyAdmin__factory,
    ERC20__factory,
    Masset,
    MusdV3,
    MusdV3__factory,
    MockPlatformIntegration__factory,
} from "types/generated"
import { MusdV3LibraryAddresses } from "types/generated/factories/MusdV3__factory"
import { increaseTime } from "@utils/time"
import { BassetStatus } from "@utils/mstable-objects"

// eslint-disable-next-line @typescript-eslint/no-var-requires
import { formatUnits } from "ethers/lib/utils"

import { abi as MusdV2Abi, bytecode as MusdV2Bytecode } from "./MassetV2.json"
import { abi as BasketManagerV2Abi, bytecode as BasketManagerV2Bytecode } from "./BasketManagerV2.json"

// Accounts that are impersonated
const deployerAddress = "0x19F12C947D25Ff8a3b748829D8001cA09a28D46d"
const ethWhaleAddress = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
const mUsdWhaleAddress = "0x6595732468A241312bc307F327bA0D64F02b3c20"

// Mainnet contract addresses
const mUsdProxyAddress = "0xe2f2a5C287993345a840Db3B0845fbC70f5935a5"
const mUsdV2ImplAddress = "0xE0d0D052d5B1082E52C6b8422Acd23415c3DF1c4"
const basketManagerAddress = "0x66126B4aA2a1C07536Ef8E5e8bD4EfDA1FdEA96D"
const nexusAddress = "0xAFcE80b19A8cE13DEc0739a1aaB7A028d6845Eb3"
const delayedProxyAdminAddress = "0x5C8eb57b44C1c6391fC7a8A0cf44d26896f92386"
const governorAddress = "0xF6FF1F7FCEB2cE6d26687EaaB5988b445d0b94a2"
const invariantValidatorAddress = "0xd36050B5F28126b5292B59128ED25E489a0f2F3f"

const forkBlockNumber = 12017855

const defaultConfig = {
    a: 120,
    limits: {
        min: simpleToExactAmount(5, 16),
        max: simpleToExactAmount(75, 16),
    },
}

interface Token {
    index?: number
    symbol: string
    address: string
    integrator: string
    decimals: number
    vaultBalance: BN
    whaleAddress: string
}

const sUSD: Token = {
    symbol: "sUSD",
    address: "0x57Ab1ec28D129707052df4dF418D58a2D46d5f51",
    integrator: "0xf617346A0FB6320e9E578E0C9B2A4588283D9d39", // Aave vault
    decimals: 18,
    vaultBalance: BN.from("80909520797288555012"),
    whaleAddress: "0x8cA24021E3Ee3B5c241BBfcee0712554D7Dc38a1",
}
const USDC: Token = {
    symbol: "USDC",
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    integrator: "0xD55684f4369040C12262949Ff78299f2BC9dB735", // Compound Vault
    decimals: 6,
    vaultBalance: BN.from("12410493975798"),
    whaleAddress: "0xf977814e90da44bfa03b6295a0616a897441acec", // Binance
}
const TUSD: Token = {
    symbol: "TUSD",
    address: "0x0000000000085d4780B73119b644AE5ecd22b376",
    integrator: "0xf617346A0FB6320e9E578E0C9B2A4588283D9d39", // Aave vault
    decimals: 18,
    vaultBalance: BN.from("19905538420654920737967597"),
    whaleAddress: "0xf977814e90da44bfa03b6295a0616a897441acec", // Binance
}
const USDT: Token = {
    symbol: "USDT",
    address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    integrator: "0xf617346A0FB6320e9E578E0C9B2A4588283D9d39", // Aave vault
    decimals: 6,
    vaultBalance: BN.from("14183856804674"),
    whaleAddress: "0xf977814e90da44bfa03b6295a0616a897441acec", // Binance
}
const DAI: Token = {
    symbol: "DAI",
    address: "0x6b175474e89094c44da98b954eedeac495271d0f",
    integrator: "0xD55684f4369040C12262949Ff78299f2BC9dB735", // Compound Vault
    decimals: 18,
    vaultBalance: BN.from(0),
    whaleAddress: "0xbe0eb53f46cd790cd13851d5eff43d12404d33e8",
}

// bAssets before changes
const currentBassets: Token[] = [
    {
        index: 0,
        ...sUSD,
    },
    {
        index: 1,
        ...USDC,
    },
    {
        index: 2,
        ...TUSD,
    },
    {
        index: 3,
        ...USDT,
    },
]

const intermediaryBassets: Token[] = [
    {
        index: 0,
        ...sUSD,
    },
    {
        index: 1,
        ...USDC,
    },
    {
        index: 2,
        ...TUSD,
    },
    {
        index: 3,
        ...USDT,
    },
    {
        index: 4,
        ...DAI,
    },
]

// ideal bAssets before upgrade
const finalBassets: Token[] = [
    {
        index: 0,
        ...sUSD,
    },
    {
        index: 1,
        ...DAI,
    },
    {
        index: 2,
        ...TUSD,
    },
    {
        index: 3,
        ...USDT,
    },
]

// impersonates a specific account
const impersonate = async (addr): Promise<Signer> => {
    await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [addr],
    })
    return ethers.provider.getSigner(addr)
}

// impersonates all accounts
const impersonateAccounts = async () => {
    // Impersonate mainnet accounts
    const accounts = {
        deployer: await impersonate(deployerAddress),
        governor: await impersonate(governorAddress),
        ethWhale: await impersonate(ethWhaleAddress),
        mUSDWhale: await impersonate(mUsdWhaleAddress),
    }

    // send some Ether to the impersonated multisig contract as it doesn't have Ether
    await accounts.ethWhale.sendTransaction({
        to: governorAddress,
        value: simpleToExactAmount(10),
    })

    return accounts
}

interface DeployedMusdV3 {
    proxy: MusdV3
    impl: MusdV3
}

// Deploys Migrator, pulls Manager address and deploys mUSD implementation
const deployMusdV3 = async (deployer: Signer): Promise<DeployedMusdV3> => {
    // Deploy the Migrator library used by new mUSD implementation
    const MigratorFactory = await ethers.getContractFactory("Migrator")
    const migratorLib = await MigratorFactory.connect(deployer).deploy()
    await migratorLib.deployTransaction.wait()
    const linkedAddress: MusdV3LibraryAddresses = {
        __$4ff61640dcfbdf6af5752b96f9de1a9efe$__: migratorLib.address, // Migrator library
        __$1a38b0db2bd175b310a9a3f8697d44eb75$__: "0x1E91F826fa8aA4fa4D3F595898AF3A64dd188848", // Masset Manager
    }

    // Point to the mUSD contract using the new V3 interface via the existing mUSD proxy
    const mUsdV3Factory = new MusdV3__factory(linkedAddress, deployer)
    const mUsdV3Proxy = mUsdV3Factory.attach(mUsdProxyAddress)

    // Check the mUSD V3 implementation contract size
    const size = mUsdV3Factory.bytecode.length / 2 / 1000
    if (size > 24.576) {
        console.error(`Masset size is ${size} kb: ${size - 24.576} kb too big`)
    } else {
        console.log(`Masset = ${size} kb`)
    }

    // Deploy the new mUSD implementation
    const mUsdV3Impl = await mUsdV3Factory.deploy(nexusAddress)

    return {
        proxy: mUsdV3Proxy,
        impl: mUsdV3Impl,
    }
}

// Test mUSD token storage variables
const validateTokenStorage = async (token: MusdV3 | Masset | Contract) => {
    expect(await token.symbol(), "symbol").to.eq("mUSD")
    expect(await token.name(), "name").to.eq("mStable USD")
    expect(await token.decimals(), "decimals").to.eq(18)
    // some mUSD token holder
    expect(await token.balanceOf("0x5C80E54f903458edD0723e268377f5768C7869d7"), `mUSD balance at block ${forkBlockNumber}`).to.eq(
        "6971708003000000000000",
    )
    // For block number 11880000
    expect(await token.totalSupply(), `totalSupply at block ${forkBlockNumber}`).to.eq("46499970109431651210054546")
}

// Test the existing Masset V2 storage variables
const validateUnchangedMassetStorage = async (mUsd: MusdV3 | Masset | Contract) => {
    expect(await mUsd.swapFee(), "swap fee").to.eq(simpleToExactAmount(6, 14))
    expect(await mUsd.redemptionFee(), "redemption fee").to.eq(simpleToExactAmount(3, 14))
    expect(await mUsd.cacheSize(), "cache size").to.eq(simpleToExactAmount(3, 16))
    expect(await mUsd.surplus(), `surplus at block ${forkBlockNumber}`).to.eq("1")
}

// Check that the bAsset data is what we expect
const validateBasset = (bAssets, i: number, expectToken: Token, expectVaultBalances?: BN[]) => {
    if (!expectVaultBalances) {
        expectVaultBalances = currentBassets.map((token) => token.vaultBalance)
    }
    expect(bAssets.personal[i].addr, `${expectToken.symbol} address`).to.eq(expectToken.address)
    expect(bAssets.personal[i].integrator, `${expectToken.symbol} integrator`).to.eq(expectToken.integrator) // Compound Vault
    expect(bAssets.personal[i].hasTxFee, `${expectToken.symbol} hasTxFee`).to.be.false
    expect(bAssets.personal[i].status, `${expectToken.symbol} status`).to.eq(BassetStatus.Normal)
    expect(bAssets.data[i].ratio, `${expectToken.symbol} ratio`).to.eq(simpleToExactAmount(1, 8 + (18 - expectToken.decimals)))
    expect(bAssets.data[i].vaultBalance, `${expectToken.symbol} vault`).to.eq(expectVaultBalances[i])
}

// Test the new Masset V3 storage variables
const validateNewMassetStorage = async (mUsd: MusdV3 | Masset, expectVaultBalances?: BN[]) => {
    expect(await mUsd.forgeValidator(), "forge validator").to.eq(invariantValidatorAddress)
    expect(await mUsd.maxBassets(), "maxBassets").to.eq(10)

    // bAsset personal data
    const bAssets = await mUsd.getBassets()
    currentBassets.forEach((token, i) => {
        validateBasset(bAssets, i, token, expectVaultBalances)
    })

    // Get basket state
    const basketState = await mUsd.basket()
    expect(basketState.undergoingRecol, "undergoingRecol").to.be.true
    expect(basketState[0], "basketState[0]").to.be.true
    expect(basketState.failed, "undergoingRecol").to.be.false
    expect(basketState[1], "basketState[1]").to.be.false

    const invariantConfig = await mUsd.getConfig()
    expect(invariantConfig.a, "amplification coefficient (A)").to.eq(defaultConfig.a * 100)
    expect(invariantConfig.limits.min, "min limit").to.eq(defaultConfig.limits.min)
    expect(invariantConfig.limits.max, "max limit").to.eq(defaultConfig.limits.max)
}

// Swaps two tokens in an attempted rebalance
const balanceBasset = async (
    mUsdV2: Contract,
    scaledVaultBalances: BN[],
    scaledTargetBalance: BN,
    inputToken: Token,
    outputToken: Token,
): Promise<void> => {
    const { whaleAddress } = inputToken
    const signer = await impersonate(whaleAddress)
    // scaled target weight - input scaled balance
    const inputDiffToTarget = scaledTargetBalance.sub(scaledVaultBalances[inputToken.index])
    // output scaled balance - scaled target weight
    // If output is TUSD then simply set the baseline to 0
    scaledTargetBalance = outputToken.symbol === "TUSD" ? BN.from(0) : scaledTargetBalance
    const outputDiffToTarget = scaledVaultBalances[outputToken.index].sub(scaledTargetBalance)
    const minBassetAmount = inputDiffToTarget.lt(outputDiffToTarget) ? inputDiffToTarget : outputDiffToTarget
    if (minBassetAmount.lt(0)) return
    const bAssetAmount = applyRatioMassetToBasset(minBassetAmount, BN.from(10).pow(26 - inputToken.decimals))

    // Check the whale has enough input tokens
    const inputTokenContract = new ERC20__factory(signer).attach(inputToken.address)
    const whaleBalance = await inputTokenContract.balanceOf(whaleAddress)
    expect(whaleBalance, `Whale ${inputToken.symbol} balance`).to.gte(bAssetAmount)
    // whale approves input tokens
    await inputTokenContract.approve(mUsdV2.address, whaleAddress)

    const tx = mUsdV2.connect(signer).swap(inputToken.address, outputToken.address, bAssetAmount, whaleAddress)
    await expect(tx).to.emit(mUsdV2, "Swapped")
    // TODO - consider what this is used for and whether to rely on cached settings
    scaledVaultBalances[inputToken.index] = scaledVaultBalances[inputToken.index].add(minBassetAmount)
    // this is not 100% accurate as the outputs are less fees but it's close enough for testing
    scaledVaultBalances[outputToken.index] = scaledVaultBalances[outputToken.index].sub(minBassetAmount)
}

/**
 * TESTING mUSD Upgrade
 * ------------------------------
 * Step 1: Deploy contract and propose upgrade to begin the 1 week countdown
 *           1. Deploy Migrator, Manager & InvariantValidator
 *           2. Deploy mUSD & propose upgrade with initialization data
 * Test 1: i) Deployed mUSDV3 contract has been proposed correctly
 *
 * ~~ Wait 6 days ~~
 *
 * Step 2: Achieve equilibrium weights & prep
 *           1. Add DAI to CompoundIntegration
 *           2. Add DAI to the basket
 *           3. Set max weights
 *           4. Collect interest
 *           5. Achieve equilibrium weights
 *             - Ensure it cannot be broken
 *           6. Pause BasketManager & SavingsManager
 *           7. Remove TUSD from basket
 * Test 2: i) Existing storage in BasketManager checks out
 *         ii) State at 2.3
 *         iii) Mostly on 2.4 execution
 *         iv) Final state pre-upgrade (everything in place & paused)
 *
 * Step 3: Upgrade mUSD
 *           1. Accept governance proposal
 *           2. Verify storage & paused
 *           3. Unpause system
 * Test 3: i) Upgrade works as intended
 *         ii) All storage has been added & system is paused
 *         iii) Post-unpause: ensure mint, swap, redeem all work as expected
 *         iv) Collect interest & platform interest work
 *         v) Do some admin operations
 *
 * Data
 * ------------------------------
 * mUSD proxy address: 0xe2f2a5C287993345a840Db3B0845fbC70f5935a5
 * Current implementation: 0xe0d0d052d5b1082e52c6b8422acd23415c3df1c4 & https://github.com/mstable/mStable-contracts/blob/6d935eb8c8797e240a7e9fde7603c90d730608ce/contracts/masset/Masset.sol
 * New implementation: ../../contracts/masset/mUSD/MusdV3.sol
 * Contract diff vs current implementation: https://www.diffchecker.com/QqxVbKxb
 * Contract diff vs Masset.sol: https://www.diffchecker.com/jwpfAgVK
 */
describe("mUSD V2.0 to V3.0", () => {
    let accounts
    let mUsdV2Factory: ContractFactory
    let mUsdV2: Contract
    let mUsdV3: DeployedMusdV3
    let delayedProxyAdmin: DelayedProxyAdmin
    let deployer: Signer
    let governor: Signer
    before("Set-up globals", async () => {
        accounts = await impersonateAccounts()
        deployer = accounts.deployer
        governor = accounts.governor

        // Point to mUSD contract using the old V2 interface via the proxy
        mUsdV2Factory = new ContractFactory(MusdV2Abi, MusdV2Bytecode, deployer)
        mUsdV2 = mUsdV2Factory.attach(mUsdProxyAddress)

        delayedProxyAdmin = new DelayedProxyAdmin__factory(governor).attach(delayedProxyAdminAddress)
    })
    it("connects to forked V2 via the mUSD proxy", async () => {
        expect(await mUsdV2.getBasketManager(), "basket manager").to.eq(basketManagerAddress)
        await validateTokenStorage(mUsdV2 as Masset)
        await validateUnchangedMassetStorage(mUsdV2 as Masset)
    })
    it("validates delayedProxyAdmin", async () => {
        expect(await delayedProxyAdmin.UPGRADE_DELAY(), "upgrade delay").to.eq(ONE_WEEK)
        expect(await delayedProxyAdmin.getProxyImplementation(mUsdProxyAddress), "delayed proxy admin").to.eq(
            "0xE0d0D052d5B1082E52C6b8422Acd23415c3DF1c4",
        )
        expect(await delayedProxyAdmin.getProxyAdmin(mUsdProxyAddress), "delayed proxy admin").to.eq(delayedProxyAdminAddress)
    })

    /**
     * Step 1: Deploy contract and propose upgrade to begin the 1 week countdown
     *           1. Deploy Migrator & InvariantValidator
     *           2. Deploy mUSD & propose upgrade with initialization data
     * Test 1: i) Deployed mUSDV3 contract has been proposed correctly
     *         ii) Existing storage in BasketManager checks out
     */
    describe("STEP 1: Deploy & propose upgrade", () => {
        it("deploys mUSD", async () => {
            mUsdV3 = await deployMusdV3(deployer)

            // Move forward 7 weeks to avoid the TVL cap in the invariant validator deployed on 12 Feb 2021
            await increaseTime(ONE_WEEK.mul(7).toNumber() + 100)
        })
        it("proposes mUSD upgrade to proxyadmin", async () => {
            const Validator = await ethers.getContractFactory("InvariantValidator")
            const validator = await Validator.deploy()
            await validator.deployTransaction.wait()
            const data = await mUsdV3.impl.interface.encodeFunctionData("upgrade", [validator.address, defaultConfig])

            // Propose upgrade to the mUSD proxy contract using the delayed proxy admin contract
            await impersonate(governorAddress)
            const proposeUpgradeTx = delayedProxyAdmin.connect(governor).proposeUpgrade(mUsdProxyAddress, mUsdV3.impl.address, data)
            await expect(proposeUpgradeTx).to.emit(delayedProxyAdmin, "UpgradeProposed")

            const request = await delayedProxyAdmin.requests(mUsdProxyAddress)
            expect(request.data).eq(data)
            expect(request.implementation).eq(mUsdV3.impl.address)
        })
        it("checks nexus address on deployed mUSD", async () => {
            const assignedNexus = await mUsdV3.impl.nexus()
            expect(assignedNexus).eq(nexusAddress)
        })
        it("delays 6 days", async () => {
            await increaseTime(ONE_DAY.mul(6).toNumber())
        })
    })

    /*
     * Step 2: Achieve equilibrium weights & prep
     *           1. Add DAI to CompoundIntegration
     *           2. Add DAI to the basket
     *           3. Set max weights
     *           4. Collect interest
     *           5. Achieve equilibrium weights
     *             - Ensure it cannot be broken
     *           6. Pause BasketManager & SavingsManager
     *           7. Remove TUSD from basket
     * Test 2: i) State at 2.3
     *         ii) Mostly on 2.5 execution
     *         iii) Final state pre-upgrade (everything in place & paused)
     */
    describe("STEP 2 - Achieve equilibrium weights & prep", () => {
        let basketManager: Contract
        const scaledVaultBalances: BN[] = []
        let scaledTargetBalance: BN
        const balancedVaultBalances: BN[] = []
        before(async () => {
            const basketManagerFactory = new ContractFactory(BasketManagerV2Abi, BasketManagerV2Bytecode, governor)
            basketManager = basketManagerFactory.attach(basketManagerAddress)
        })
        it("adds DAI to the basket", async () => {
            // 2. Add DAI to basket
            await basketManager.addBasset(DAI.address, "0xD55684f4369040C12262949Ff78299f2BC9dB735", false)
        })
        it("should get bAssets to check current weights", async () => {
            const { bAssets } = await basketManager.getBassets()
            let scaledTotalVaultBalance = BN.from(0)
            intermediaryBassets.forEach((token, i) => {
                const scaledVaultBalance = applyDecimals(bAssets[i].vaultBalance, token.decimals)
                scaledVaultBalances[i] = scaledVaultBalance
                scaledTotalVaultBalance = scaledTotalVaultBalance.add(scaledVaultBalance)
                expect(bAssets[i].vaultBalance).to.eq(token.vaultBalance)
            })
            scaledTargetBalance = scaledTotalVaultBalance.div(4)
            expect(scaledVaultBalances[0].mul(10000).div(scaledTotalVaultBalance)).to.eq(0)
            expect(scaledVaultBalances[1].mul(10000).div(scaledTotalVaultBalance)).to.eq(2668)
            expect(scaledVaultBalances[2].mul(10000).div(scaledTotalVaultBalance)).to.eq(4280)
            expect(scaledVaultBalances[3].mul(10000).div(scaledTotalVaultBalance)).to.eq(3050)
            expect(scaledVaultBalances[4].mul(10000).div(scaledTotalVaultBalance)).to.eq(0)
        })
        it("should update max weights to 25.01%", async () => {
            await basketManager.setBasketWeights(
                intermediaryBassets.map((token) => token.address),
                [
                    simpleToExactAmount(2501, 14),
                    simpleToExactAmount(2501, 14),
                    0,
                    simpleToExactAmount(2501, 14),
                    simpleToExactAmount(2501, 14),
                ], // 25.01% where 100% = 1e18
            )
        })
        it("should check basket state at 2.3", async () => {
            // const bAssets = await basketManager.getBassets()
            // intermediaryBassets.forEach((token, i) => {
            //     validateBasset(bAssets, i, token)
            // })
        })
        // Step 1. Swap DAI in for TUSD
        // Step 2. Swap sUSD in for else
        // Check: Taking DAI or sUSD out of the basket is not possible once in
        it("should swap DAI for USDT to balance DAI", async () => {
            await balanceBasset(mUsdV2, scaledVaultBalances, scaledTargetBalance, intermediaryBassets[4], intermediaryBassets[2])
        })
        it("should swap sUSD for TUSD to balance TUSD", async () => {
            await balanceBasset(mUsdV2, scaledVaultBalances, scaledTargetBalance, currentBassets[0], currentBassets[2])
        })
        it("should swap sUSD for USDC to balance both sUSD and USDC", async () => {
            await balanceBasset(mUsdV2, scaledVaultBalances, scaledTargetBalance, currentBassets[0], currentBassets[1])
        })
        it("should swap sUSD for USDT to balance both sUSD and USDT", async () => {
            await balanceBasset(mUsdV2, scaledVaultBalances, scaledTargetBalance, currentBassets[0], currentBassets[3])
        })
        it("pauses BasketManager and SavingsManager", async () => {
            // do the pause
            await basketManager.pause()
            await basketManager.attach("0x9781C4E9B9cc6Ac18405891DF20Ad3566FB6B301").pause()
            // check pause
            expect(await basketManager.paused()).eq(true)
            // check that nothing can be called
            await expect(mUsdV2.mint(intermediaryBassets[0].address, simpleToExactAmount(1))).to.be.revertedWith("Pausable: paused")
        })
        it("removes TUSD from the basket", async () => {
            await basketManager.removeBasset(TUSD.address)
        })
        it("should have valid storage before upgrade", async () => {
            await validateTokenStorage(mUsdV2)
            await validateUnchangedMassetStorage(mUsdV2) // bAsset personal data

            // Get new vault balances after the bAssets have been balanced
            const { bAssets } = await basketManager.getBassets()
            currentBassets.forEach((token, i) => {
                balancedVaultBalances[i] = bAssets[i].vaultBalance
            })
        })
    })

    /*
     * Step 3: Upgrade mUSD
     *           1. Accept governance proposal
     *           2. Verify storage & paused
     *           3. Unpause system
     * Test 3: i) Upgrade works as intended
     *         ii) All storage has been added & system is paused
     *         iii) Post-unpause: ensure mint, swap, redeem all work as expected
     *         iv) Collect interest & platform interest work
     *         v) Do some admin operations
     */
    describe("STEP 3 - Upgrading mUSD", () => {
        before("elapse the time", async () => {
            await increaseTime(ONE_DAY.mul(2))
        })
        it("Should upgrade balanced mUSD", async () => {
            // Approve and execute call to upgradeToAndCall on mUSD proxy which then calls migrate on the new mUSD V3 implementation
            await delayedProxyAdmin.acceptUpgradeRequest(mUsdProxyAddress)
            // await mUsdV3.upgrade(invariantValidatorAddress, defaultConfig)
            // validate after the upgrade
            await validateTokenStorage(mUsdV3.proxy)
            await validateUnchangedMassetStorage(mUsdV3.proxy)
            // await validateNewMassetStorage(mUsdV3.proxy, balancedVaultBalances)
        })
        // it("Enable mUSD after upgrade", async () => {
        //     await mUsdV3.connect(governorMultisig).negateIsolation(currentBassets[0].address)
        //     // Get basket state
        //     const basketState = await mUsdV3.basket()
        //     expect(basketState.undergoingRecol, "undergoingRecol").to.be.false
        //     expect(basketState[0], "basketState[0]").to.be.false
        //     expect(basketState.failed, "undergoingRecol").to.be.false
        //     expect(basketState[1], "basketState[1]").to.be.false
        // })
        // it("Should fail to upgrade mUSD again", async () => {
        //     await expect(mUsdV3.upgrade(invariantValidatorAddress, defaultConfig)).to.revertedWith("already upgraded")
        // })
        // it("Should mint after upgrade", async () => {
        //     const token = currentBassets[0]
        //     const signer = await impersonate(token.whaleAddress)
        //     const tokenContract = new ERC20__factory(signer).attach(token.address)
        //     const qty = simpleToExactAmount(10000, token.decimals)
        //     expect(await tokenContract.balanceOf(token.whaleAddress)).gte(qty)
        //     await tokenContract.approve(mUsdProxyAddress, qty)
        //     const tx = mUsdV3.connect(signer).mint(token.address, qty, 0, await signer.getAddress())
        //     await expect(tx, "Minted event").to.emit(mUsdV3, "Minted")
        // })
    })

    // (AS) - what is this?
    // context.skip("Upgrade of mUSD implementation using upgradeTo from delayed admin proxy", () => {
    //     before(async () => {
    //         await network.provider.request({
    //             method: "hardhat_reset",
    //             params: [
    //                 {
    //                     forking: {
    //                         jsonRpcUrl: process.env.NODE_URL,
    //                         blockNumber: forkBlockNumber,
    //                     },
    //                 },
    //             ],
    //         })
    //         const accounts = await impersonateAccounts()
    //         deployer = accounts.deployer
    //         governorMultisig = accounts.governorMultisig

    //         const { mUsdV3Proxy, mUsdV3Impl } = await deployMusdV3(deployer)
    //         mUsdV3 = mUsdV3Proxy

    //         // The mUSD implementation will have a blank validator
    //         expect(await mUsdV3Impl.forgeValidator(), "before old validator").to.eq(ZERO_ADDRESS)

    //         // Propose upgrade to the mUSD proxy contract using the delayed proxy admin contract
    //         const proposeUpgradeTx = delayedProxyAdmin.proposeUpgrade(mUsdProxyAddress, mUsdV3Impl.address, "0x")
    //         await expect(proposeUpgradeTx).to.emit(delayedProxyAdmin, "UpgradeProposed")

    //         // Move the chain forward by just over 1 week
    //         await increaseTime(ONE_WEEK.toNumber() + 100)

    //         // Approve and execute call to upgradeToAndCall on mUSD proxy which then calls migrate on the new mUSD V3 implementation
    //         await delayedProxyAdmin.acceptUpgradeRequest(mUsdProxyAddress)
    //     })
    //     it("Should upgrade unbalanced mUSD", async () => {
    //         // validate before the upgrade
    //         await validateTokenStorage(mUsdV3)
    //         await validateUnchangedMassetStorage(mUsdV3)

    //         await mUsdV3.upgrade(invariantValidatorAddress, defaultConfig)

    //         // validate after the upgrade
    //         await validateTokenStorage(mUsdV3)
    //         await validateUnchangedMassetStorage(mUsdV3)
    //         await validateNewMassetStorage(mUsdV3)
    //     })
    // })
    // // TODO get this working again. The acceptUpgradeRequest is reverting with no reason
    // context.skip("Upgrade of mUSD implementation using upgradeToAndCall from delayed admin proxy", () => {
    //     before(async () => {
    //         await network.provider.request({
    //             method: "hardhat_reset",
    //             params: [
    //                 {
    //                     forking: {
    //                         jsonRpcUrl: process.env.NODE_URL,
    //                         blockNumber: forkBlockNumber,
    //                     },
    //                 },
    //             ],
    //         })
    //         const accounts = await impersonateAccounts()
    //         deployer = accounts.deployer
    //         governorMultisig = accounts.governorMultisig
    //     })
    //     it("migrate via time deploy admin contract", async () => {
    //         const { mUsdV3Proxy, mUsdV3Impl } = await deployMusdV3(deployer)
    //         mUsdV3 = mUsdV3Proxy

    //         // The mUSD implementation will have a blank validator
    //         expect(await mUsdV3Impl.forgeValidator(), "before old validator").to.eq(ZERO_ADDRESS)

    //         // construct the tx data to call migrate on the newly deployed mUSD V3 implementation
    //         const migrateCallData = mUsdV3.interface.encodeFunctionData("upgrade", [invariantValidatorAddress, defaultConfig])
    //         // Propose upgrade to the mUSD proxy contract using the delayed proxy admin contract
    //         const proposeUpgradeTx = delayedProxyAdmin.proposeUpgrade(mUsdProxyAddress, mUsdV3Impl.address, migrateCallData)
    //         await expect(proposeUpgradeTx).to.emit(delayedProxyAdmin, "UpgradeProposed")

    //         // Move the chain forward by just over 1 week
    //         await increaseTime(ONE_WEEK.toNumber() + 100)

    //         // Approve and execute call to upgradeToAndCall on mUSD proxy which then calls migrate on the new mUSD V3 implementation
    //         const tx = delayedProxyAdmin.acceptUpgradeRequest(mUsdProxyAddress)
    //         await expect(tx)
    //             .to.emit(delayedProxyAdmin, "Upgraded")
    //             .withArgs(mUsdProxyAddress, mUsdV2ImplAddress, mUsdV3Impl.address, migrateCallData)

    //         await validateTokenStorage(mUsdV3)
    //         await validateUnchangedMassetStorage(mUsdV3)
    //         await validateNewMassetStorage(mUsdV3)

    //         // The new mUSD implementation will still have a blank validator
    //         // as the mUSD storage is in the proxy
    //         expect(await mUsdV3Impl.forgeValidator(), "after old validator").to.eq(ZERO_ADDRESS)
    //     })
    // })
})
