import "ts-node/register"
import "tsconfig-paths/register"
import { Contract, Signer } from "ethers"
import { task, types } from "hardhat/config"
import { Unwrapper__factory, AssetProxy__factory } from "types/generated"
import { deployContract } from "./utils/deploy-utils"
import { getSigner } from "./utils/signerFactory"
import { getChain, resolveAddress } from "./utils/networkAddressFactory"
import { Chain } from "./utils/tokens"
import { verifyEtherscan } from "./utils/etherscan"

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const approveUnwrapperTokens = async (chain: Chain, unwrapper: Contract, governor: Signer) => {
    // Mainnet and Polygon
    const fraxFeederPool = resolveAddress("FRAX", chain, "feederPool")
    const musdAddress = resolveAddress("mUSD", chain)

    let routers = []
    let tokens = []

    if (chain === Chain.polygon) {
        routers = [fraxFeederPool]
        tokens = [musdAddress]
    } else {
        const alusdFeederPool = resolveAddress("alUSD", chain, "feederPool")
        const gusdFeederPool = resolveAddress("GUSD", chain, "feederPool")
        const busdFeederPool = resolveAddress("BUSD", chain, "feederPool")
        const raiFeederPool = resolveAddress("RAI", chain, "feederPool")
        const feiFeederPool = resolveAddress("FEI", chain, "feederPool")

        const hbtcFeederPool = resolveAddress("HBTC", chain, "feederPool")
        const tbtcv2FeederPool = resolveAddress("tBTCv2", chain, "feederPool")
        const mbtcAddress = resolveAddress("mBTC", chain)

        routers = [
            musdAddress,
            alusdFeederPool,
            gusdFeederPool,
            busdFeederPool,
            raiFeederPool,
            feiFeederPool,
            mbtcAddress,
            hbtcFeederPool,
            tbtcv2FeederPool,
        ]
        tokens = [musdAddress, musdAddress, musdAddress, musdAddress, musdAddress, musdAddress, mbtcAddress, mbtcAddress, mbtcAddress]
    }
    // approve tokens for router
    await unwrapper.connect(governor).approve(routers, tokens)
}

task("deploy-unwrapper-single", "Deploy Unwrapper without a proxy")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)
        const nexus = resolveAddress("Nexus", chain)

        const constructorArguments = [nexus]
        // Deploy step 1 - Deploy Unwrapper
        const unwrapper = await deployContract(new Unwrapper__factory(signer), "Unwrapper", constructorArguments)

        await verifyEtherscan(hre, {
            address: unwrapper.address,
            contract: "contracts/savings/peripheral/Unwrapper.sol:Unwrapper",
            constructorArguments,
        })

        // Deploy step 2 - Approve tokens
        // approveUnwrapperTokens(chain, unwrapper, signer)
    })

task("deploy-unwrapper-proxy", "Deploy Unwrapper as a proxy on mainnet")
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)
        const nexus = resolveAddress("Nexus", chain)
        const proxyAdminAddress = resolveAddress("DelayedProxyAdmin", chain)

        const constructorArguments = [nexus]
        // Deploy step 1 - Deploy Unwrapper
        const unwrapperImpl = await deployContract(new Unwrapper__factory(signer), "Unwrapper", constructorArguments)

        const initializeData = []
        const proxy = await deployContract(new AssetProxy__factory(signer), "AssetProxy", [
            unwrapperImpl.address,
            proxyAdminAddress,
            initializeData,
        ])
        const unwrapper = new Unwrapper__factory(signer).attach(proxy.address)

        await verifyEtherscan(hre, {
            address: unwrapperImpl.address,
            contract: "contracts/savings/peripheral/Unwrapper.sol:Unwrapper",
            constructorArguments,
        })

        console.log(`Set Unwrapper in the networkAddressFactory to ${unwrapper.address}`)

        // Deploy step 2 - Approve tokens
        // approveUnwrapperTokens(chain, unwrapper, signer)
    })

module.exports = {}
