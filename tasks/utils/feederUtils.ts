/* eslint-disable no-restricted-syntax */
/* eslint-disable no-await-in-loop */
import { DEAD_ADDRESS, ZERO_ADDRESS } from "@utils/constants"
import { BN, simpleToExactAmount } from "@utils/math"
import { Signer } from "ethers"
import { formatEther, formatUnits } from "ethers/lib/utils"
import {
    FeederPool,
    BoostDirector,
    BoostDirector__factory,
    ERC20,
    FeederLogic__factory,
    FeederManager__factory,
    BoostedSavingsVault,
    MockERC20__factory,
    FeederWrapper,
    InterestValidator__factory,
    FeederWrapper__factory,
    AaveV2Integration__factory,
    MockInitializableToken__factory,
    AssetProxy__factory,
    MockERC20,
    FeederPool__factory,
    BoostedSavingsVault__factory,
    Masset__factory,
    MV2__factory,
    ExposedMasset,
} from "types/generated"
import { deployContract, logTxDetails } from "./deploy-utils"
import { Token } from "./tokens"

export interface CommonAddresses {
    nexus: string
    proxyAdmin: string
    staking?: string
    mta: string
    rewardsDistributor?: string
    aave?: string
    boostDirector?: string
    feederManager?: string
    feederLogic?: string
    feederRouter?: string
    interestValidator?: string
}

interface DeployedFasset {
    integrator: string
    txFee: boolean
    contract: ERC20
    address: string
    symbol: string
}

export interface Pair {
    mAsset: Token
    fAsset: Token
    aToken: string
    priceCoeff: BN
    A: BN
}

interface Config {
    a: BN
    limits: {
        min: BN
        max: BN
    }
}

interface FeederData {
    nexus: string
    proxyAdmin: string
    feederManager: string
    feederLogic: string
    mAsset: DeployedFasset
    fAsset: DeployedFasset
    aToken: string
    name: string
    symbol: string
    config: Config
    vaultName: string
    vaultSymbol: string
    priceCoeff: BN
    pool?: FeederPool
    vault?: BoostedSavingsVault
}

const COEFF = 48

export const deployFasset = async (
    sender: Signer,
    name: string,
    symbol: string,
    decimals = 18,
    initialMint = BN.from(500000),
): Promise<MockERC20> => {
    // Implementation
    const impl = await deployContract(
        new MockInitializableToken__factory(sender),
        `MockInitializableToken with name ${name}, symbol ${symbol} and decimals ${decimals}`,
    )

    // Initialization Data
    const data = impl.interface.encodeFunctionData("initialize", [name, symbol, decimals, await sender.getAddress(), initialMint])
    // Proxy
    const proxy = await deployContract(new AssetProxy__factory(sender), "AssetProxy", [impl.address, DEAD_ADDRESS, data])

    return new MockERC20__factory(sender).attach(proxy.address)
}

const deployFeederPool = async (signer: Signer, feederData: FeederData): Promise<FeederPool> => {
    // Invariant Validator
    const linkedAddress = {
        __$60670dd84d06e10bb8a5ac6f99a1c0890c$__: feederData.feederManager,
        __$7791d1d5b7ea16da359ce352a2ac3a881c$__: feederData.feederLogic,
    }
    const feederPoolFactory = new FeederPool__factory(linkedAddress, signer)

    const impl = await deployContract(new FeederPool__factory(linkedAddress, signer), "FeederPool", [
        feederData.nexus,
        feederData.mAsset.address,
    ])

    // Initialization Data
    const bAssets = await (feederData.mAsset.contract as ExposedMasset).getBassets()
    const mpAssets = bAssets.personal.map((bAsset) => bAsset.addr)
    console.log(`mpAssets. count = ${mpAssets.length}, list: `, mpAssets)
    console.log(
        `Initializing FeederPool with: ${feederData.name}, ${feederData.symbol}, mAsset ${feederData.mAsset.address}, fAsset ${
            feederData.fAsset.address
        }, A: ${feederData.config.a.toString()}, min: ${formatEther(feederData.config.limits.min)}, max: ${formatEther(
            feederData.config.limits.max,
        )}`,
    )
    const initializeData = impl.interface.encodeFunctionData("initialize", [
        feederData.name,
        feederData.symbol,
        {
            addr: feederData.mAsset.address,
            integrator: ZERO_ADDRESS,
            hasTxFee: false,
            status: 0,
        },
        {
            addr: feederData.fAsset.address,
            integrator: feederData.fAsset.integrator,
            hasTxFee: false,
            status: 0,
        },
        mpAssets,
        feederData.config,
    ])

    const feederPoolProxy = await deployContract(new AssetProxy__factory(signer), "Feeder Pool Proxy", [
        impl.address,
        feederData.proxyAdmin,
        initializeData,
    ])

    // Create a FeederPool contract pointing to the deployed proxy contract
    return feederPoolFactory.attach(feederPoolProxy.address)
}

const mint = async (sender: Signer, bAssets: DeployedFasset[], feederData: FeederData) => {
    // e.e. $4e18 * 1e18 / 1e18 = 4e18
    // e.g. 4e18 * 1e18 / 5e22 = 8e13 or 0.00008
    const scaledTestQty = simpleToExactAmount(4).mul(simpleToExactAmount(1)).div(feederData.priceCoeff)

    // Approve spending
    const approvals: BN[] = []
    // eslint-disable-next-line
    for (const bAsset of bAssets) {
        // eslint-disable-next-line
        const dec = await bAsset.contract.decimals()
        const approval = dec === 18 ? scaledTestQty : scaledTestQty.div(simpleToExactAmount(1, BN.from(18).sub(dec)))
        approvals.push(approval)
        // eslint-disable-next-line
        const tx = await bAsset.contract.approve(feederData.pool.address, approval)
        // eslint-disable-next-line
        const receiptApprove = await tx.wait()
        console.log(
            // eslint-disable-next-line
            `Approved FeederPool to transfer ${formatUnits(approval, dec)} ${bAsset.symbol} from ${await sender.getAddress()}. gas used ${
                receiptApprove.gasUsed
            }`,
        )
    }

    // Mint
    console.log(
        bAssets.map(() => scaledTestQty.toString()),
        await Promise.all(
            bAssets.map(async (b) => (await b.contract.allowance(await sender.getAddress(), feederData.pool.address)).toString()),
        ),
        await Promise.all(bAssets.map(async (b) => (await b.contract.balanceOf(await sender.getAddress())).toString())),
        bAssets.map((b) => b.address),
        (await feederData.pool.getBassets())[0].map((b) => b[0]),
        await feederData.pool.mAsset(),
    )
    const tx = await feederData.pool.mintMulti(
        bAssets.map((b) => b.address),
        approvals,
        1,
        await sender.getAddress(),
    )
    const receiptMint = await tx.wait()

    // Log minted amount
    const mAssetAmount = formatEther(await feederData.pool.totalSupply())
    console.log(
        `Minted ${mAssetAmount} fpToken from ${formatEther(scaledTestQty)} Units for each [mAsset, fAsset]. gas used ${
            receiptMint.gasUsed
        }`,
    )
}

const deployBoostedVault = async (
    sender: Signer,
    addresses: CommonAddresses,
    lpToken: string,
    priceCoeff: BN,
    vaultName: string,
    vaultSymbol: string,
    depositAmt = BN.from(0),
): Promise<BoostedSavingsVault> => {
    const vImpl = await deployContract(
        new BoostedSavingsVault__factory(sender),
        `Vault Impl with LP token ${lpToken}, director ${addresses.boostDirector}, priceCoeff ${formatEther(
            priceCoeff,
        )}, coeff ${COEFF}, mta: ${addresses.mta}}`,
        [addresses.nexus, lpToken, addresses.boostDirector, priceCoeff, COEFF, addresses.mta],
    )

    // Data
    console.log(
        `Initializing Vault with: distributor: ${addresses.rewardsDistributor}, admin ${addresses.proxyAdmin}, ${vaultName}, ${vaultSymbol}`,
    )
    const vData = vImpl.interface.encodeFunctionData("initialize", [addresses.rewardsDistributor, vaultName, vaultSymbol])
    // Proxy
    const vProxy = await deployContract(new AssetProxy__factory(sender), "AssetProxy for vault", [
        vImpl.address,
        addresses.proxyAdmin,
        vData,
    ])

    if (depositAmt.gt(0)) {
        const erc20 = await new MockERC20__factory(sender).attach(lpToken)
        const approveTx = await erc20.approve(vProxy.address, depositAmt)
        await logTxDetails(
            approveTx,
            `Approving the vault deposit of ${depositAmt.toString()}. Your balance: ${(
                await erc20.balanceOf(await sender.getAddress())
            ).toString()}`,
        )

        const vault = new BoostedSavingsVault__factory(sender).attach(vProxy.address)
        const depositTx = await vault["stake(uint256)"](depositAmt)
        await logTxDetails(depositTx, "Depositing to vault")
    }

    return BoostedSavingsVault__factory.connect(vProxy.address, sender)
}

const approveFeederWrapper = async (
    sender: Signer,
    feederWrapper: FeederWrapper,
    feederPools: FeederPool[],
    vaults: BoostedSavingsVault[],
): Promise<void> => {
    // Get tokens to approve
    const len = feederPools.length
    // eslint-disable-next-line
    for (let i = 0; i < len; i++) {
        const [[{ addr: massetAddr }, { addr: fassetAddr }]] = await feederPools[i].getBassets()
        const masset = Masset__factory.connect(massetAddr, sender)
        const [bassets] = await masset.getBassets()
        const assets = [massetAddr, fassetAddr, ...bassets.map(({ addr }) => addr)]

        // Make the approval in one tx
        const approveTx = await feederWrapper["approve(address,address,address[])"](feederPools[i].address, vaults[i].address, assets)
        await logTxDetails(approveTx, "Approved FeederWrapper tokens")
    }
}

export const deployBoostedFeederPools = async (deployer: Signer, addresses: CommonAddresses, pairs: Pair[]): Promise<void> => {
    // 1.    Deploy boostDirector & Libraries
    const start = await deployer.getBalance()
    console.log(`\n~~~~~ PHASE 1 - LIBS ~~~~~\n\n`)
    let director: BoostDirector
    if (!addresses.boostDirector && addresses.boostDirector !== ZERO_ADDRESS) {
        director = await deployContract(new BoostDirector__factory(deployer), "BoostDirector", [addresses.nexus, addresses.staking])
        const directorInitTx = await director.initialize([])
        await logTxDetails(directorInitTx, "Initializing BoostDirector")
    } else {
        director = BoostDirector__factory.connect(addresses.boostDirector, deployer)
    }

    const feederLibs = {
        feederManager: addresses.feederManager,
        feederLogic: addresses.feederLogic,
    }
    if (!addresses.feederManager || !addresses.feederLogic) {
        const feederManager = await deployContract(new FeederManager__factory(deployer), "FeederManager")
        const feederLogic = await deployContract(new FeederLogic__factory(deployer), "FeederLogic")
        feederLibs.feederManager = feederManager.address
        feederLibs.feederLogic = feederLogic.address
    }

    // 2.2   For each fAsset
    //        - fetch fAsset & mAsset
    const data: FeederData[] = []

    // eslint-disable-next-line
    for (const pair of pairs) {
        const mAssetContract = MV2__factory.connect(pair.mAsset.address, deployer)
        const fAssetContract = MockERC20__factory.connect(pair.fAsset.address, deployer)
        const deployedMasset: DeployedFasset = {
            integrator: ZERO_ADDRESS,
            txFee: false,
            contract: mAssetContract,
            address: pair.mAsset.address,
            symbol: pair.mAsset.symbol,
        }
        const deployedFasset: DeployedFasset = {
            integrator: ZERO_ADDRESS,
            txFee: false,
            contract: fAssetContract,
            address: pair.fAsset.address,
            symbol: pair.fAsset.symbol,
        }
        data.push({
            ...feederLibs,
            nexus: addresses.nexus,
            proxyAdmin: addresses.proxyAdmin,
            mAsset: deployedMasset,
            fAsset: deployedFasset,
            aToken: pair.aToken,
            name: `${deployedMasset.symbol}/${deployedFasset.symbol} Feeder Pool`,
            symbol: `fP${deployedMasset.symbol}/${deployedFasset.symbol}`,
            config: {
                a: pair.A,
                limits: {
                    min: simpleToExactAmount(10, 16),
                    max: simpleToExactAmount(90, 16),
                },
            },
            vaultName: `${deployedMasset.symbol}/${deployedFasset.symbol} fPool Vault`,
            vaultSymbol: `v-fP${deployedMasset.symbol}/${deployedFasset.symbol}`,
            priceCoeff: pair.priceCoeff,
        })
    }
    //        - create fPool (nexus, mAsset, name, integrator, config)
    // eslint-disable-next-line
    for (const poolData of data) {
        console.log(`\n~~~~~ POOL ${poolData.symbol} ~~~~~\n\n`)
        console.log("Remaining ETH in deployer: ", formatUnits(await deployer.getBalance()))
        // Deploy Feeder Pool
        const feederPool = await deployFeederPool(deployer, poolData)
        poolData.pool = feederPool

        // Mint initial supply
        // await mint(deployer, [poolData.mAsset, poolData.fAsset], poolData)

        // Rewards Contract
        if (addresses.boostDirector) {
            const bal = await feederPool.balanceOf(await deployer.getAddress())
            const vault = await deployBoostedVault(
                deployer,
                addresses,
                poolData.pool.address,
                poolData.priceCoeff,
                poolData.vaultName,
                poolData.vaultSymbol,
                bal,
            )
            poolData.vault = vault
        }
    }
    // 3.    Clean
    //        - initialize boostDirector with pools
    console.log(`\n~~~~~ PHASE 3 - ETC ~~~~~\n\n`)
    console.log("Remaining ETH in deployer: ", formatUnits(await deployer.getBalance()))

    if (!addresses.boostDirector && addresses.boostDirector !== ZERO_ADDRESS) {
        const directorInitTx = await director.initialize(data.map((d) => d.vault.address))
        logTxDetails(directorInitTx, `Initializing BoostDirector for vaults: ${data.map((d) => d.vault.address)}`)
    }

    // - if aToken != 0: deploy Aave integrator & initialize with fPool & aToken addr
    for (const poolData of data) {
        if (poolData.aToken !== ZERO_ADDRESS) {
            const integration = await deployContract(
                new AaveV2Integration__factory(deployer),
                `integration for ${poolData.symbol} at pool ${poolData.pool.address}`,
                [addresses.nexus, poolData.pool.address, addresses.aave, DEAD_ADDRESS],
            )

            const initTx = await integration.initialize([poolData.fAsset.address], [poolData.aToken])
            await logTxDetails(initTx, `Initializing pToken ${poolData.aToken} for bAsset ${poolData.fAsset.address}...`)
        }
    }

    // Deploy feederRouter
    let feederWrapper: FeederWrapper
    if (addresses.boostDirector !== ZERO_ADDRESS) {
        if (!addresses.feederRouter) {
            // Deploy FeederWrapper
            feederWrapper = await deployContract<FeederWrapper>(new FeederWrapper__factory(deployer), "FeederWrapper")
        } else {
            feederWrapper = FeederWrapper__factory.connect(addresses.feederRouter, deployer)
        }
        await approveFeederWrapper(
            deployer,
            feederWrapper,
            data.map((d) => d.pool),
            data.map((d) => d.vault),
        )
    }

    //        - deploy interestValidator
    if (!addresses.interestValidator) {
        await deployContract(new InterestValidator__factory(deployer), "InterestValidator", [addresses.nexus])
    }

    console.log(`\n~~~~~ 🥳 CONGRATS! Time for Phase 4 🥳 ~~~~~\n\n`)
    // 4.    Post
    //        -  Fund small amt to vaults
    //        -  Add InterestValidator as a module
    //        -  Fund vaults
    console.log("Remaining ETH in deployer: ", formatUnits(await deployer.getBalance()))
    const end = await deployer.getBalance()
    console.log("Total ETH used: ", formatUnits(end.sub(start)))
}
