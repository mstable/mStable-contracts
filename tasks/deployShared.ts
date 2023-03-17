import "ts-node/register"
import "tsconfig-paths/register"
import { task, types } from "hardhat/config"
import { MetaTokenRedeemer__factory } from "types/generated"
import { BigNumber } from "ethers"
import { deployContract } from "./utils/deploy-utils"
import { getSigner } from "./utils/signerFactory"
import { verifyEtherscan } from "./utils/etherscan"
import { MTA } from "./utils"
import { getChain, getChainAddress } from "./utils/networkAddressFactory"

task("deploy-MetaTokenRedeemer")
    .addParam("duration", "Registration period duration, default value 90 days (7776000)", 7776000, types.int)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const chain = getChain(hre)
        const mtaAddr = MTA.address
        const wethAddr = getChainAddress("UniswapEthToken", chain)

        const metaTokenRedeemer = await deployContract(new MetaTokenRedeemer__factory(signer), "MetaTokenRedeemer", [
            mtaAddr,
            wethAddr,
            BigNumber.from(taskArgs.duration),
        ])

        await verifyEtherscan(hre, {
            address: metaTokenRedeemer.address,
            contract: "contracts/shared/MetaTokenRedeemer.sol:MetaTokenRedeemer",
        })
    })
module.exports = {}
