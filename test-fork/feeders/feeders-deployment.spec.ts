import { ZERO_ADDRESS } from "@utils/constants"
import { Signer } from "ethers"
import { ethers, network } from "hardhat"
import { formatEther, formatUnits } from "ethers/lib/utils"
import {
    FeederPool,
    FeederPool__factory,
    FeederLogic__factory,
    AssetProxy__factory,
    MockERC20__factory,
    BoostedVault__factory,
    ERC20,
    FeederManager,
    FeederLogic,
    BoostedVault,
    BoostDirector__factory,
    AaveV2Integration__factory,
    FeederWrapper__factory,
    FeederWrapper,
    Masset__factory,
    InterestValidator__factory,
} from "types/generated"
import { simpleToExactAmount, BN } from "@utils/math"
import { impersonate } from "@utils/fork"

// Accounts that are impersonated
const deployerAddress = "0x19F12C947D25Ff8a3b748829D8001cA09a28D46d"

interface CommonAddresses {
    nexus: string
    proxyAdmin: string
    staking: string
    mta: string
    rewardsDistributor: string
    aave?: string
    aaveToken?: string
    boostDirector?: string
    feederManager?: FeederManager
    feederLogic?: FeederLogic
}

interface DeployedFasset {
    integrator: string
    txFee: boolean
    contract: ERC20
    address: string
    symbol: string
}

interface Pair {
    mAsset: string
    fAsset: string
    aToken: string
    priceCoeff: BN
    A: BN
}

interface FeederData {
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
    vault?: BoostedVault
}

const COEFF = 48

interface Config {
    a: BN
    limits: {
        min: BN
        max: BN
    }
}

const deployFeederPool = async (sender: Signer, addresses: CommonAddresses, feederData: FeederData): Promise<FeederPool> => {
    // Invariant Validator
    let feederPoolFactory: FeederPool__factory
    if (addresses.feederLogic && addresses.feederManager) {
        console.log(`Using FeederLogic ${addresses.feederLogic.address} and FeederManager ${addresses.feederManager.address}`)
        const linkedAddress = {
            "contracts/feeders/FeederLogic.sol:FeederLogic": addresses.feederLogic.address,
            "contracts/feeders/FeederManager.sol:FeederManager": addresses.feederManager.address,
        }
        // Implementation
        feederPoolFactory = new FeederPool__factory(linkedAddress, sender)
    } else {
        console.log(`Deploying FeederLogic`)
        const feederLogic = await new FeederLogic__factory(sender).deploy()
        const receiptFeederLogic = await feederLogic.deployTransaction.wait()
        console.log(`Deployed FeederLogic to ${feederLogic.address}. gas used ${receiptFeederLogic.gasUsed}`)

        // External linked library
        const Manager = await ethers.getContractFactory("FeederManager")
        const managerLib = await Manager.deploy()
        const receiptManager = await managerLib.deployTransaction.wait()
        console.log(`Deployed FeederManager library to ${managerLib.address}. gas used ${receiptManager.gasUsed}`)

        const linkedAddress = {
            "contracts/feeders/FeederLogic.sol:FeederLogic": managerLib.address,
            "contracts/feeders/FeederManager.sol:FeederManager": managerLib.address,
        }
        // Implementation
        feederPoolFactory = new FeederPool__factory(linkedAddress, sender)
    }

    console.log(`Deploying FeederPool impl with Nexus ${addresses.nexus} and mAsset ${feederData.mAsset.address}`)
    const impl = await feederPoolFactory.deploy(addresses.nexus, feederData.mAsset.address)
    const receiptImpl = await impl.deployTransaction.wait()
    console.log(`Deployed FeederPool impl to ${impl.address}. gas used ${receiptImpl.gasUsed}`)

    // Initialization Data
    const mpAssets = (await feederPoolFactory.attach(feederData.mAsset.address).getBassets())[0].map((p) => p[0])
    console.log(`mpAssets. count = ${mpAssets.length}, list: `, mpAssets)
    console.log(
        `Initializing FeederPool with: ${feederData.name}, ${feederData.symbol}, mAsset ${feederData.mAsset.address}, fAsset ${
            feederData.fAsset.contract.address
        }, A: ${feederData.config.a.toString()}, min: ${formatEther(feederData.config.limits.min)}, max: ${formatEther(
            feederData.config.limits.max,
        )}`,
    )
    const data = impl.interface.encodeFunctionData("initialize", [
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

    console.log(`Deploying FeederPool proxy with impl: ${impl.address} and admin ${addresses.proxyAdmin}`)
    const feederPoolProxy = await new AssetProxy__factory(sender).deploy(impl.address, addresses.proxyAdmin, data)
    const receiptProxy = await feederPoolProxy.deployTransaction.wait()

    console.log(`Deployed FeederPool proxy to address ${feederPoolProxy.address}. gas used ${receiptProxy.gasUsed}`)

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

const deployVault = async (
    sender: Signer,
    addresses: CommonAddresses,
    lpToken: string,
    priceCoeff: BN,
    vaultName: string,
    vaultSymbol: string,
    depositAmt = BN.from(0),
): Promise<BoostedVault> => {
    console.log(
        `Deploying Vault Impl with LP token ${lpToken}, director ${addresses.boostDirector}, priceCoeff ${formatEther(
            priceCoeff,
        )}, coeff ${COEFF}, mta: ${addresses.mta}}`,
    )
    const vImpl = await new BoostedVault__factory(sender).deploy(
        addresses.nexus,
        lpToken,
        addresses.boostDirector,
        priceCoeff,
        COEFF,
        addresses.mta,
    )
    const receiptVaultImpl = await vImpl.deployTransaction.wait()
    console.log(`Deployed Vault Impl to ${vImpl.address}. gas used ${receiptVaultImpl.gasUsed}`)

    // Data
    console.log(
        `Initializing Vault with: distributor: ${addresses.rewardsDistributor}, admin ${addresses.proxyAdmin}, ${vaultName}, ${vaultSymbol}`,
    )
    const vData = vImpl.interface.encodeFunctionData("initialize", [addresses.rewardsDistributor, vaultName, vaultSymbol])
    // Proxy
    const vProxy = await new AssetProxy__factory(sender).deploy(vImpl.address, addresses.proxyAdmin, vData)
    const receiptVaultProxy = await vProxy.deployTransaction.wait()
    console.log(`Deployed Vault Proxy to ${vProxy.address}. gas used ${receiptVaultProxy.gasUsed}`)

    if (depositAmt.gt(0)) {
        const erc20 = await new MockERC20__factory(sender).attach(lpToken)
        console.log(
            `Approving the vault deposit of ${depositAmt.toString()}. Your balance: ${(
                await erc20.balanceOf(await sender.getAddress())
            ).toString()}`,
        )
        const approval = await erc20.approve(vProxy.address, depositAmt)
        await approval.wait()

        console.log(`Depositing to vault...`)
        const vault = new BoostedVault__factory(sender).attach(vProxy.address)
        const deposit = await vault["stake(uint256)"](depositAmt)
        await deposit.wait()
    }

    return BoostedVault__factory.connect(vProxy.address, sender)
}

const deployFeederWrapper = async (sender: Signer, feederPools: FeederPool[], vaults: BoostedVault[]): Promise<FeederWrapper> => {
    // Deploy FeederWrapper
    const feederWrapper = await new FeederWrapper__factory(sender).deploy()
    const deployReceipt = await feederWrapper.deployTransaction.wait()
    console.log(`Deployed FeederWrapper to ${feederWrapper.address}. gas used ${deployReceipt.gasUsed}`)

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
        const approveReceipt = await approveTx.wait()
        console.log(`Approved FeederWrapper tokens. gas used ${approveReceipt.gasUsed}`)
    }

    return feederWrapper
}

context("deploying feeder", () => {
    it("deploys everything", async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.NODE_URL,
                        blockNumber: 12146547,
                    },
                },
            ],
        })

        const deployer = await impersonate(deployerAddress)

        const addresses: CommonAddresses = {
            mta: "0xa3BeD4E1c75D00fa6f4E5E6922DB7261B5E9AcD2",
            staking: "0xae8bc96da4f9a9613c323478be181fdb2aa0e1bf",
            nexus: "0xafce80b19a8ce13dec0739a1aab7a028d6845eb3",
            proxyAdmin: "0x5c8eb57b44c1c6391fc7a8a0cf44d26896f92386",
            rewardsDistributor: "0x04dfdfa471b79cc9e6e8c355e6c71f8ec4916c50",
            aave: "0xB53C1a33016B2DC2fF3653530bfF1848a515c8c5",
            aaveToken: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9",
        }

        const pairs: Pair[] = [
            // mBTC / hBTC
            {
                mAsset: "0x945facb997494cc2570096c74b5f66a3507330a1",
                fAsset: "0x0316EB71485b0Ab14103307bf65a021042c6d380",
                aToken: ZERO_ADDRESS,
                priceCoeff: simpleToExactAmount(58000),
                A: BN.from(325),
            },
            // mBTC / tBTC
            {
                mAsset: "0x945facb997494cc2570096c74b5f66a3507330a1",
                fAsset: "0x8dAEBADE922dF735c38C80C7eBD708Af50815fAa",
                aToken: ZERO_ADDRESS,
                priceCoeff: simpleToExactAmount(58000),
                A: BN.from(175),
            },
            // mUSD / bUSD
            {
                mAsset: "0xe2f2a5C287993345a840Db3B0845fbC70f5935a5",
                fAsset: "0x4fabb145d64652a948d72533023f6e7a623c7c53",
                aToken: "0xa361718326c15715591c299427c62086f69923d9",
                priceCoeff: simpleToExactAmount(1),
                A: BN.from(500),
            },
            // mUSD / GUSD
            {
                mAsset: "0xe2f2a5C287993345a840Db3B0845fbC70f5935a5",
                fAsset: "0x056fd409e1d7a124bd7017459dfea2f387b6d5cd",
                aToken: "0xD37EE7e4f452C6638c96536e68090De8cBcdb583",
                priceCoeff: simpleToExactAmount(1),
                A: BN.from(225),
            },
        ]

        // 1.    Deploy boostDirector & Libraries
        const start = await deployer.getBalance()
        console.log(`\n~~~~~ PHASE 1 - LIBS ~~~~~\n\n`)
        console.log("Remaining ETH in deployer: ", formatUnits(await deployer.getBalance()))
        console.log(`Deploying BoostDirector with ${addresses.nexus}, ${addresses.staking}`)
        const director = await new BoostDirector__factory(deployer).deploy(addresses.nexus, addresses.staking)
        await director.deployTransaction.wait()
        console.log(`Deployed Director to ${director.address}`)
        addresses.boostDirector = director.address

        console.log(`Deploying FeederLogic`)
        const feederLogic = await new FeederLogic__factory(deployer).deploy()
        const receiptFeederLogic = await feederLogic.deployTransaction.wait()
        console.log(`Deployed FeederLogic to ${feederLogic.address}. gas used ${receiptFeederLogic.gasUsed}`)
        addresses.feederLogic = feederLogic

        // External linked library
        const Manager = await ethers.getContractFactory("FeederManager")
        const managerLib = await Manager.deploy()
        const receiptManager = await managerLib.deployTransaction.wait()
        console.log(`Deployed FeederManager library to ${managerLib.address}. gas used ${receiptManager.gasUsed}`)
        addresses.feederManager = managerLib as FeederManager

        // 2.1   Deploy imBTC vault & deposit
        console.log(`\n~~~~~ PHASE 2 - POOLS ~~~~~\n\n`)
        console.log("Remaining ETH in deployer: ", formatUnits(await deployer.getBalance()))
        const imBTC = await deployVault(
            deployer,
            addresses,
            "0x17d8cbb6bce8cee970a4027d1198f6700a7a6c24",
            simpleToExactAmount(5800),
            "imBTC Vault",
            "v-imBTC",
            simpleToExactAmount(3, 15),
        )
        console.log(`imBTC vault deployed to ${imBTC.address}`)

        // 2.2   For each fAsset
        //        - fetch fAsset & mAsset
        const data: FeederData[] = []

        // eslint-disable-next-line
        for (const pair of pairs) {
            const mAssetContract = await new MockERC20__factory(deployer).attach(pair.mAsset)
            const fAssetContract = await new MockERC20__factory(deployer).attach(pair.fAsset)
            const deployedMasset: DeployedFasset = {
                integrator: ZERO_ADDRESS,
                txFee: false,
                contract: mAssetContract,
                address: pair.mAsset,
                symbol: await mAssetContract.symbol(),
            }
            const deployedFasset: DeployedFasset = {
                integrator: ZERO_ADDRESS,
                txFee: false,
                contract: fAssetContract,
                address: pair.fAsset,
                symbol: await fAssetContract.symbol(),
            }
            data.push({
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
            const feederPool = await deployFeederPool(deployer, addresses, poolData)
            poolData.pool = feederPool
            // Mint initial supply
            await mint(deployer, [poolData.mAsset, poolData.fAsset], poolData)
            // Rewards Contract
            const bal = await feederPool.balanceOf(await deployer.getAddress())
            const vault = await deployVault(
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
        // 3.    Clean
        //        - initialize boostDirector with pools
        console.log(`\n~~~~~ PHASE 3 - ETC ~~~~~\n\n`)
        console.log("Remaining ETH in deployer: ", formatUnits(await deployer.getBalance()))
        console.log(`Initializing BoostDirector...`, [...data.map((d) => d.vault.address), imBTC.address])
        const directorInit = await director.initialize(data.map((d) => d.vault.address))
        await directorInit.wait()
        //        - if aToken != 0: deploy integrator & initialize with fPool & aToken addr
        // eslint-disable-next-line
        for (const poolData of data) {
            if (poolData.aToken !== ZERO_ADDRESS) {
                const integration = await new AaveV2Integration__factory(deployer).deploy(
                    addresses.nexus,
                    poolData.pool.address,
                    addresses.aave,
                    addresses.aaveToken,
                )
                console.log(`Deploying integration for ${poolData.symbol} at pool ${poolData.pool.address}`)
                await integration.deployTransaction.wait()
                console.log(`Deployed integration to ${integration.address}`)

                console.log(`Initializing pToken ${poolData.aToken} for bAsset ${poolData.fAsset.address}...`)
                const init = await integration.initialize([poolData.fAsset.address], [poolData.aToken])
                await init.wait()
            }
        }
        //        - deploy feederRouter
        console.log("Deploying feederRouter...")
        await deployFeederWrapper(
            deployer,
            data.map((d) => d.pool),
            data.map((d) => d.vault),
        )
        //        - deploy interestValidator
        const interestValidator = await new InterestValidator__factory(deployer).deploy(addresses.nexus)
        const deployReceipt = await interestValidator.deployTransaction.wait()
        console.log(`Deployed Interest Validator to ${interestValidator.address}. gas used ${deployReceipt.gasUsed}`)
        console.log(`\n~~~~~ 🥳 CONGRATS! Time for Phase 4 🥳 ~~~~~\n\n`)
        // 4.    Post
        //        -  migrate GUSD & bUSD to aave
        //        -  Add InterestValidator as a module
        //        -  Fund vaults
        console.log("Remaining ETH in deployer: ", formatUnits(await deployer.getBalance()))
        const end = await deployer.getBalance()
        console.log("Total ETH used: ", formatUnits(end.sub(start)))
    })
})

module.exports = {}
