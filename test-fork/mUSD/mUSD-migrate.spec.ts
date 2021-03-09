/* eslint-disable no-underscore-dangle */
/* eslint-disable no-param-reassign */
/* eslint-disable @typescript-eslint/no-unused-expressions */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable no-console */
import { expect } from "chai"
import { Contract, ContractFactory, Signer } from "ethers"
import { ethers, network } from "hardhat"

import { ONE_WEEK, ZERO_ADDRESS } from "@utils/constants"
import { applyDecimals, applyRatio, applyRatioMassetToBasset, BN, simpleToExactAmount } from "@utils/math"
import { DelayedProxyAdmin, DelayedProxyAdmin__factory, ERC20__factory, Masset, MusdV3, MusdV3__factory } from "types/generated"
import { MusdV3LibraryAddresses } from "types/generated/factories/MusdV3__factory"
import { increaseTime } from "@utils/time"
import { BassetStatus } from "@utils/mstable-objects"

// eslint-disable-next-line @typescript-eslint/no-var-requires
import { formatUnits } from "ethers/lib/utils"

import { abi as MusdV2Abi, bytecode as MusdV2Bytecode } from "./MassetV2.json"
import { abi as BasketManagerV2Abi, bytecode as BasketManagerV2Bytecode } from "./BasketManagerV2.json"

// Accounts that are impersonated
const deployerAddress = "0x19F12C947D25Ff8a3b748829D8001cA09a28D46d"
const governorMultisigSigner = "0x4186C5AEd424876f7EBe52f9148552A45E17f287"
const ethWhaleAddress = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"
const mUsdWhaleAddress = "0x6595732468A241312bc307F327bA0D64F02b3c20"

// Mainnet contract addresses
const mUsdProxyAddress = "0xe2f2a5C287993345a840Db3B0845fbC70f5935a5"
const mUsdV2ImplAddress = "0xE0d0D052d5B1082E52C6b8422Acd23415c3DF1c4"
const basketManagerAddress = "0x66126B4aA2a1C07536Ef8E5e8bD4EfDA1FdEA96D"
const nexusAddress = "0xafce80b19a8ce13dec0739a1aab7a028d6845eb3"
const delayedProxyAdminAddress = "0x5C8eb57b44C1c6391fC7a8A0cf44d26896f92386"
const governorMultisigAddress = "0x4186c5aed424876f7ebe52f9148552a45e17f287"
const invariantValidatorAddress = "0xd36050B5F28126b5292B59128ED25E489a0f2F3f"

const forkBlockNumber = 11880000

const defaultConfig = {
    a: 120,
    limits: {
        min: simpleToExactAmount(5, 16),
        max: simpleToExactAmount(75, 16),
    },
}

interface Token {
    index: number
    symbol: string
    address: string
    integrator: string
    decimals: number
    vaultBalance: BN
    whaleAddress: string
}
const usdTokens: Token[] = [
    {
        index: 0,
        symbol: "sUSD",
        address: "0x57Ab1ec28D129707052df4dF418D58a2D46d5f51",
        integrator: "0xf617346A0FB6320e9E578E0C9B2A4588283D9d39", // Aave vault
        decimals: 18,
        vaultBalance: BN.from("1510840253989803619708"),
        whaleAddress: "0x8cA24021E3Ee3B5c241BBfcee0712554D7Dc38a1",
    },
    {
        index: 1,
        symbol: "USDC",
        address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        integrator: "0xD55684f4369040C12262949Ff78299f2BC9dB735", // Compound Vault
        decimals: 6,
        vaultBalance: BN.from("23165151348244"),
        whaleAddress: "0xf977814e90da44bfa03b6295a0616a897441acec", // Binance
    },
    {
        index: 2,
        symbol: "TUSD",
        address: "0x0000000000085d4780B73119b644AE5ecd22b376",
        integrator: "0xf617346A0FB6320e9E578E0C9B2A4588283D9d39", // Aave vault
        decimals: 18,
        vaultBalance: BN.from("17673157027919657817275871"),
        whaleAddress: "0xf977814e90da44bfa03b6295a0616a897441acec", // Binance
    },
    {
        index: 3,
        symbol: "USDT",
        address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
        integrator: "0xf617346A0FB6320e9E578E0C9B2A4588283D9d39", // Aave vault
        decimals: 6,
        vaultBalance: BN.from("4447093695923"),
        whaleAddress: "0xf977814e90da44bfa03b6295a0616a897441acec", // Binance
    },
]

const impersonate = async (addr): Promise<Signer> => {
    await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [addr],
    })
    return ethers.provider.getSigner(addr)
}

const impersonateAccounts = async () => {
    // Impersonate mainnet accounts
    const accounts = {
        deployer: await impersonate(deployerAddress),
        governorMultisig: await impersonate(governorMultisigAddress),
        ethWhale: await impersonate(ethWhaleAddress),
        mUSDWhale: await impersonate(mUsdWhaleAddress),
    }

    // send some Ether to the impersonated multisig contract as it doesn't have Ether
    await accounts.ethWhale.sendTransaction({
        to: governorMultisigAddress,
        value: simpleToExactAmount(10),
    })

    return accounts
}

const deployMusdV3 = async (deployer: Signer): Promise<{ mUsdV3Proxy: MusdV3; mUsdV3Impl: MusdV3 }> => {
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
        mUsdV3Proxy,
        mUsdV3Impl,
    }
}

// Test the token storage variables
const validateTokenStorage = async (token: MusdV3 | Masset | Contract) => {
    expect(await token.symbol(), "symbol").to.eq("mUSD")
    expect(await token.name(), "name").to.eq("mStable USD")
    expect(await token.decimals(), "decimals").to.eq(18)
    // some mUSD token holder
    expect(await token.balanceOf("0x5C80E54f903458edD0723e268377f5768C7869d7"), `mUSD balance at block ${forkBlockNumber}`).to.eq(
        "6971708003000000000000",
    )
    // For block number 11880000
    expect(await token.totalSupply(), `totalSupply at block ${forkBlockNumber}`).to.eq("45286852911137226622051552")
}

// Test the existing Masset V2 storage variables
const validateUnchangedMassetStorage = async (mUsd: MusdV3 | Masset | Contract) => {
    expect(await mUsd.swapFee(), "swap fee").to.eq(simpleToExactAmount(6, 14))
    expect(await mUsd.redemptionFee(), "redemption fee").to.eq(simpleToExactAmount(3, 14))
    expect(await mUsd.cacheSize(), "cache size").to.eq(simpleToExactAmount(3, 16))
    // vaultBalanceSum
    // maxCache
    expect(await mUsd.surplus(), `surplus at block ${forkBlockNumber}`).to.eq("60000000000000000001")
}

// Check that the bAsset data is what we expect
const validateBasset = (bAssets, i: number, expectToken: Token, expectVaultBalances?: BN[]) => {
    if (!expectVaultBalances) {
        expectVaultBalances = usdTokens.map((token) => token.vaultBalance)
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
    usdTokens.forEach((token, i) => {
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
    scaledVaultBalances[inputToken.index] = scaledVaultBalances[inputToken.index].add(minBassetAmount)
    // this is not 100% accurate as the outputs are less fees but it's close enough for testing
    scaledVaultBalances[outputToken.index] = scaledVaultBalances[outputToken.index].add(minBassetAmount)
}

/**
 * TESTING mUSD Upgrade
 * ------------------------------
 * Step 1: Upgrade AaveIntegration, CompoundIntegration, BasketManager
 * Test 1: i) Ensure system still functions as normal
 *          - Minting
 *          - Redemption
 *          - CollectInterest
 *         ii) Ensure withdrawRaw is protected
 *
 * Step 2: Upgrade SavingsManager
 * Test 2: i) Deposit Liquidated, collect platform interest (breaks)
 *         ii) Test basic deposit to SAVE
 *
 * Step 3: Upgrade Masset
 * Test 3: i) Ensure system still functions as normal (0 cache size)
 *         ii) Ensure 1.1 vars still accessible
 *
 * Step 4: Set cache size
 * Test 4: i) Ensure deposit and withdraw works
 *         ii) Ensure surplus accrues correctly
 *         iii) Ensure SAVE deposit works
 *         iv) Ensure collectPlatformInterest works
 *
 * Proxy Upgrades
 * Masset.sol > https://www.diffchecker.com/8nXgYzdi
 * BasketManager.sol > https://www.diffchecker.com/W6oOQNb7
 * AaveIntegration.sol > https://www.diffchecker.com/Nt1pEP8b
 * CompoundIntegration.sol > https://www.diffchecker.com/Ay8DBaZa
 * SavingsManager.sol > https://www.diffchecker.com/8XJoknka
 */
describe("mUSD V2.0 to V3.0", () => {
    let mUsdV2Factory: ContractFactory
    let mUsdV3Factory: MusdV3__factory
    let mUsdV2: Contract
    let mUsdV3: MusdV3
    let delayedProxyAdmin: DelayedProxyAdmin
    let deployer: Signer
    let governorMultisig: Signer
    before(async () => {
        const accounts = await impersonateAccounts()
        deployer = accounts.deployer
        governorMultisig = accounts.governorMultisig

        // Point to mUSD contract using the old V2 interface via the proxy
        mUsdV2Factory = new ContractFactory(MusdV2Abi, MusdV2Bytecode, deployer)
        mUsdV2 = mUsdV2Factory.attach(mUsdProxyAddress)

        delayedProxyAdmin = new DelayedProxyAdmin__factory(governorMultisig).attach(delayedProxyAdminAddress)
    })
    it("Connected to forked V2 via the mUSD proxy", async () => {
        expect(await mUsdV2.getBasketManager(), "basket manager").to.eq(basketManagerAddress)
        await validateTokenStorage(mUsdV2 as Masset)
        await validateUnchangedMassetStorage(mUsdV2 as Masset)
    })
    it("Validate delayedProxyAdmin", async () => {
        expect(await delayedProxyAdmin.UPGRADE_DELAY(), "upgrade delay").to.eq(ONE_WEEK)
        expect(await delayedProxyAdmin.getProxyImplementation(mUsdProxyAddress), "delayed proxy admin").to.eq(
            "0xE0d0D052d5B1082E52C6b8422Acd23415c3DF1c4",
        )
        expect(await delayedProxyAdmin.getProxyAdmin(mUsdProxyAddress), "delayed proxy admin").to.eq(delayedProxyAdminAddress)
    })
    context("Upgrade proxy to point to exact old mUSD implementation", () => {
        before(async () => {
            const mUsdV2New = await mUsdV2Factory.deploy()
            // The mUSD implementation will have a blank validator
            expect(await mUsdV2New.forgeValidator(), "before old validator").to.eq(ZERO_ADDRESS)

            // Propose upgrade to the mUSD proxy contract using the delayed proxy admin contract
            const proposeUpgradeTx = delayedProxyAdmin.proposeUpgrade(mUsdProxyAddress, mUsdV2New.address, "0x")
            await expect(proposeUpgradeTx).to.emit(delayedProxyAdmin, "UpgradeProposed")

            // Move the chain forward by just over 1 week so the proposed upgrade can be accepted
            await increaseTime(ONE_WEEK.toNumber() + 100)

            // Approve and execute call to upgradeToAndCall on mUSD proxy which then calls migrate on the new mUSD V3 implementation
            await delayedProxyAdmin.acceptUpgradeRequest(mUsdProxyAddress)
        })
        it("should preserve storage in mUSD proxy", async () => {
            await validateTokenStorage(mUsdV2)
            await validateUnchangedMassetStorage(mUsdV2)
            expect(await mUsdV2.getBasketManager(), "basket manager").to.eq(basketManagerAddress)
        })
    })
    describe("Balance mUSD bAssets before upgrade", () => {
        let basketManager: Contract
        const scaledVaultBalances: BN[] = []
        let scaledTargetBalance: BN
        const balancedVaultBalances: BN[] = []
        before(async () => {
            await network.provider.request({
                method: "hardhat_reset",
                params: [
                    {
                        forking: {
                            jsonRpcUrl: process.env.NODE_URL,
                            blockNumber: forkBlockNumber,
                        },
                    },
                ],
            })
            const accounts = await impersonateAccounts()
            deployer = accounts.deployer
            governorMultisig = accounts.governorMultisig

            const basketManagerFactory = new ContractFactory(BasketManagerV2Abi, BasketManagerV2Bytecode, governorMultisig)
            basketManager = basketManagerFactory.attach(basketManagerAddress)
        })
        it("should get bAssets to check current weights", async () => {
            const { bAssets } = await basketManager.getBassets()
            let scaledTotalVaultBalance = BN.from(0)
            usdTokens.forEach((token, i) => {
                const scaledVaultBalance = applyDecimals(bAssets[i].vaultBalance, token.decimals)
                scaledVaultBalances[i] = scaledVaultBalance
                scaledTotalVaultBalance = scaledTotalVaultBalance.add(scaledVaultBalance)
                expect(bAssets[i].vaultBalance).to.eq(token.vaultBalance)
            })
            expect(scaledVaultBalances[0].mul(10000).div(scaledTotalVaultBalance)).to.eq(0)
            expect(scaledVaultBalances[1].mul(10000).div(scaledTotalVaultBalance)).to.eq(5115)
            expect(scaledVaultBalances[2].mul(10000).div(scaledTotalVaultBalance)).to.eq(3902)
            expect(scaledVaultBalances[3].mul(10000).div(scaledTotalVaultBalance)).to.eq(981)
            scaledTargetBalance = scaledTotalVaultBalance.div(usdTokens.length)
        })
        it("should update max weights to 25.01%", async () => {
            await basketManager.setBasketWeights(
                usdTokens.map((token) => token.address),
                usdTokens.map((token) => simpleToExactAmount(2501, 14)), // 25.01% where 100% = 1e18
            )
        })
        it("should swap USDT for USDC to balance USDT", async () => {
            await balanceBasset(mUsdV2, scaledVaultBalances, scaledTargetBalance, usdTokens[3], usdTokens[1])
        })
        it("should swap sUSD for TUSD to balance TUSD", async () => {
            await balanceBasset(mUsdV2, scaledVaultBalances, scaledTargetBalance, usdTokens[0], usdTokens[2])
        })
        it("should swap sUSD for USDC to balance both sUSD and USDC", async () => {
            await balanceBasset(mUsdV2, scaledVaultBalances, scaledTargetBalance, usdTokens[0], usdTokens[1])
        })
        it("should have valid storage before upgrade", async () => {
            await validateTokenStorage(mUsdV2)
            await validateUnchangedMassetStorage(mUsdV2) // bAsset personal data

            // Get new vault balanced after the bAssets have been balanced
            const { bAssets } = await basketManager.getBassets()
            usdTokens.forEach((token, i) => {
                balancedVaultBalances[i] = bAssets[i].vaultBalance
            })
        })
        it("Should upgrade balanced mUSD", async () => {
            const { mUsdV3Proxy, mUsdV3Impl } = await deployMusdV3(deployer)
            mUsdV3 = mUsdV3Proxy

            // Propose upgrade to the mUSD proxy contract using the delayed proxy admin contract
            const proposeUpgradeTx = delayedProxyAdmin.proposeUpgrade(mUsdProxyAddress, mUsdV3Impl.address, "0x")
            await expect(proposeUpgradeTx).to.emit(delayedProxyAdmin, "UpgradeProposed")

            // Move forward 7 weeks to avoid the TVL cap in the invariant validator deployed on 12 Feb 2021
            await increaseTime(ONE_WEEK.mul(7).toNumber() + 100)

            // Approve and execute call to upgradeToAndCall on mUSD proxy which then calls migrate on the new mUSD V3 implementation
            await delayedProxyAdmin.acceptUpgradeRequest(mUsdProxyAddress)

            await mUsdV3.upgrade(invariantValidatorAddress, defaultConfig)

            // validate after the upgrade
            await validateTokenStorage(mUsdV3)
            await validateUnchangedMassetStorage(mUsdV3)
            await validateNewMassetStorage(mUsdV3, balancedVaultBalances)
        })
        it("Enable mUSD after upgrade", async () => {
            await mUsdV3.connect(governorMultisig).negateIsolation(usdTokens[0].address)

            // Get basket state
            const basketState = await mUsdV3.basket()
            expect(basketState.undergoingRecol, "undergoingRecol").to.be.false
            expect(basketState[0], "basketState[0]").to.be.false
            expect(basketState.failed, "undergoingRecol").to.be.false
            expect(basketState[1], "basketState[1]").to.be.false
        })
        it("Should fail to upgrade mUSD again", async () => {
            await expect(mUsdV3.upgrade(invariantValidatorAddress, defaultConfig)).to.revertedWith("already upgraded")
        })
        it("Should mint after upgrade", async () => {
            const token = usdTokens[0]
            const signer = await impersonate(token.whaleAddress)
            const tokenContract = new ERC20__factory(signer).attach(token.address)
            const qty = simpleToExactAmount(10000, token.decimals)
            expect(await tokenContract.balanceOf(token.whaleAddress)).gte(qty)
            await tokenContract.approve(mUsdProxyAddress, qty)
            const tx = mUsdV3.connect(signer).mint(token.address, qty, 0, await signer.getAddress())
            await expect(tx, "Minted event").to.emit(mUsdV3, "Minted")
        })
        // TODO add mint, swap and redeem
        // TODO collect interest
        // Do some admin operations
    })
    context.skip("Upgrade of mUSD implementation using upgradeTo from delayed admin proxy", () => {
        before(async () => {
            await network.provider.request({
                method: "hardhat_reset",
                params: [
                    {
                        forking: {
                            jsonRpcUrl: process.env.NODE_URL,
                            blockNumber: forkBlockNumber,
                        },
                    },
                ],
            })
            const accounts = await impersonateAccounts()
            deployer = accounts.deployer
            governorMultisig = accounts.governorMultisig

            const { mUsdV3Proxy, mUsdV3Impl } = await deployMusdV3(deployer)
            mUsdV3 = mUsdV3Proxy

            // The mUSD implementation will have a blank validator
            expect(await mUsdV3Impl.forgeValidator(), "before old validator").to.eq(ZERO_ADDRESS)

            // Propose upgrade to the mUSD proxy contract using the delayed proxy admin contract
            const proposeUpgradeTx = delayedProxyAdmin.proposeUpgrade(mUsdProxyAddress, mUsdV3Impl.address, "0x")
            await expect(proposeUpgradeTx).to.emit(delayedProxyAdmin, "UpgradeProposed")

            // Move the chain forward by just over 1 week
            await increaseTime(ONE_WEEK.toNumber() + 100)

            // Approve and execute call to upgradeToAndCall on mUSD proxy which then calls migrate on the new mUSD V3 implementation
            await delayedProxyAdmin.acceptUpgradeRequest(mUsdProxyAddress)
        })
        it("Should upgrade unbalanced mUSD", async () => {
            // validate before the upgrade
            await validateTokenStorage(mUsdV3)
            await validateUnchangedMassetStorage(mUsdV3)

            await mUsdV3.upgrade(invariantValidatorAddress, defaultConfig)

            // validate after the upgrade
            await validateTokenStorage(mUsdV3)
            await validateUnchangedMassetStorage(mUsdV3)
            await validateNewMassetStorage(mUsdV3)
        })
    })
    // TODO get this working again. The acceptUpgradeRequest is reverting with no reason
    context.skip("Upgrade of mUSD implementation using upgradeToAndCall from delayed admin proxy", () => {
        before(async () => {
            await network.provider.request({
                method: "hardhat_reset",
                params: [
                    {
                        forking: {
                            jsonRpcUrl: process.env.NODE_URL,
                            blockNumber: forkBlockNumber,
                        },
                    },
                ],
            })
            const accounts = await impersonateAccounts()
            deployer = accounts.deployer
            governorMultisig = accounts.governorMultisig
        })
        it("migrate via time deploy admin contract", async () => {
            const { mUsdV3Proxy, mUsdV3Impl } = await deployMusdV3(deployer)
            mUsdV3 = mUsdV3Proxy

            // The mUSD implementation will have a blank validator
            expect(await mUsdV3Impl.forgeValidator(), "before old validator").to.eq(ZERO_ADDRESS)

            // construct the tx data to call migrate on the newly deployed mUSD V3 implementation
            const migrateCallData = mUsdV3.interface.encodeFunctionData("upgrade", [invariantValidatorAddress, defaultConfig])
            // Propose upgrade to the mUSD proxy contract using the delayed proxy admin contract
            const proposeUpgradeTx = delayedProxyAdmin.proposeUpgrade(mUsdProxyAddress, mUsdV3Impl.address, migrateCallData)
            await expect(proposeUpgradeTx).to.emit(delayedProxyAdmin, "UpgradeProposed")

            // Move the chain forward by just over 1 week
            await increaseTime(ONE_WEEK.toNumber() + 100)

            // Approve and execute call to upgradeToAndCall on mUSD proxy which then calls migrate on the new mUSD V3 implementation
            const tx = delayedProxyAdmin.acceptUpgradeRequest(mUsdProxyAddress)
            await expect(tx)
                .to.emit(delayedProxyAdmin, "Upgraded")
                .withArgs(mUsdProxyAddress, mUsdV2ImplAddress, mUsdV3Impl.address, migrateCallData)

            await validateTokenStorage(mUsdV3)
            await validateUnchangedMassetStorage(mUsdV3)
            await validateNewMassetStorage(mUsdV3)

            // The new mUSD implementation will still have a blank validator
            // as the mUSD storage is in the proxy
            expect(await mUsdV3Impl.forgeValidator(), "after old validator").to.eq(ZERO_ADDRESS)
        })
    })
})
