import "ts-node/register"
import "tsconfig-paths/register"

import { task } from "hardhat/config"
import { KEY_PROXY_ADMIN, KEY_SAVINGS_MANAGER, ZERO_ADDRESS } from "@utils/constants"
import { simpleToExactAmount } from "@utils/math"
import { Signer } from "ethers"
import { AssetProxy, AssetProxy__factory, DelayedProxyAdmin, ERC20, Masset, MockERC20__factory, Nexus, Masset__factory, Nexus__factory, DelayedProxyAdmin__factory, MassetLogic, MassetLogic__factory, MassetManager, MassetManager__factory } from "types/generated"
import { MassetLibraryAddresses } from "types/generated/factories/Masset__factory"
import { getSigner } from "./utils/signerFactory"
import { deployContract } from "./utils/deploy-utils"

interface Bassets {
    name: string
    symbol: string
    decimals: number
    integrator: string
    initialMint: number
}

interface DeployedBasset extends Bassets {
    bAssetContract: ERC20
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const sleepTime = 10000 // milliseconds

const fUsdBassets: Bassets[] = [
    {
        name: "USD Coin on Fuse",
        symbol: "USDC",
        decimals: 6,
        integrator: ZERO_ADDRESS,
        initialMint: 1000000,
    },
    {
        name: "Binance USD on Fuse",
        symbol: "BUSD",
        decimals: 18,
        integrator: ZERO_ADDRESS,
        initialMint: 1000000,
    },
    {
        name: "Tether USD on Fuse",
        symbol: "USDT",
        decimals: 6,
        integrator: ZERO_ADDRESS,
        initialMint: 1000000,
    },
]

const attachBassets = (
    deployer: Signer,
    bAssetsProps: Bassets[],
    bAssetAddresses: string[]
): DeployedBasset[] => {
    const bAssets: DeployedBasset[] = []
    bAssetsProps.forEach((basset, i) => {
        const bAssetContract = new MockERC20__factory(deployer).attach(bAssetAddresses[i])
        bAssets.push({
            ...bAssetsProps[i],
            bAssetContract
        })
    })
    return bAssets
}

const deployMasset = async (
    deployer: Signer,
    linkedAddress: MassetLibraryAddresses,
    nexus: Nexus,
    delayedProxyAdmin: DelayedProxyAdmin,
    recolFee = simpleToExactAmount(5, 13),
): Promise<Masset> => {
    const mAssetFactory = new Masset__factory(linkedAddress, deployer)
    const impl = await deployContract<Masset>(mAssetFactory, "Masset Impl", [nexus.address, recolFee])
    const proxy = await deployContract<AssetProxy>(new AssetProxy__factory(deployer), "Masset Proxy", [
        impl.address,
        delayedProxyAdmin.address,
        "0x", // Passing zero bytes as we'll initialize the proxy contract later
    ])
    return mAssetFactory.attach(proxy.address)
}

task("deploy-fuse", "Deploys fUSD & System to Fuse network")
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre)
        const signerAddress = await signer.getAddress()

        const nexus = await deployContract<Nexus>(new Nexus__factory(signer), "Nexus", [signerAddress])

        // Deploy DelayedProxyAdmin
        const delayedProxyAdmin = await deployContract<DelayedProxyAdmin>(new DelayedProxyAdmin__factory(signer), "DelayedProxyAdmin", [
            nexus.address,
        ])

        await sleep(sleepTime)

        const deployedUsdBassets: DeployedBasset[] = attachBassets(
            signer,
            fUsdBassets,
            [
                '0x620fd5fa44BE6af63715Ef4E65DDFA0387aD13F5',
                '0x6a5F6A8121592BeCd6747a38d67451B310F7f156',
                '0xFaDbBF8Ce7D5b7041bE672561bbA99f79c532e10'
            ]
        )
        const multiSigAddress = '0x03709784c96aeaAa9Dd38Df14A23e996681b2C66'

        const massetLogic = await deployContract<MassetLogic>(new MassetLogic__factory(signer), "MassetLogic")
        const managerLib = await deployContract<MassetManager>(new MassetManager__factory(signer), "MassetManager")
        const linkedAddress = {
            "contracts/masset/MassetLogic.sol:MassetLogic": massetLogic.address,
            "contracts/masset/MassetManager.sol:MassetManager": managerLib.address
        }

        const fUsd = await deployMasset(signer, linkedAddress, nexus, delayedProxyAdmin)

        await sleep(sleepTime)

        const config = {
            a: 300,
            limits: {
                min: simpleToExactAmount(10, 16),
                max: simpleToExactAmount(50, 16)
            }
        }

        const txFusd = await fUsd.initialize(
            "Fuse Dollar",
            "fUSD",
            deployedUsdBassets.map((b) => ({
                addr: b.bAssetContract.address,
                integrator: ZERO_ADDRESS,
                hasTxFee: false,
                status: 0
            })),
            config
        )

        console.log(`fUSD initialize tx ${txFusd.hash}`)
        const receiptFusd = await txFusd.wait()
        console.log(`fUSD initialize stats ${receiptFusd.status} from receipt`)

        await sleep(sleepTime)

        const moduleKeys = [KEY_SAVINGS_MANAGER, KEY_PROXY_ADMIN]
        const moduleAddresses = [multiSigAddress, delayedProxyAdmin.address]
        const moduleIsLocked = [false, true]
        const nexusTx = await nexus.connect(signer).initialize(moduleKeys, moduleAddresses, moduleIsLocked, multiSigAddress)
        const nexusReceipt = await nexusTx.wait()
        console.log(`Nexus initialize status ${nexusReceipt.status} from receipt`)
    })
