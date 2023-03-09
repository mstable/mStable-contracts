import "ts-node/register"
import "tsconfig-paths/register"
import { task, types } from "hardhat/config"
import { MetaTokenRedeemer__factory } from "types/generated"
import { BigNumber } from "ethers"
import { deployContract } from "./utils/deploy-utils"
import { getSigner } from "./utils/signerFactory"
import { verifyEtherscan } from "./utils/etherscan"
import { MTA } from "./utils"

task("deploy-MetaTokenRedeemer")
    .addParam("rate", "Redemption rate  with 18 decimal points", types.string)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const signer = await getSigner(hre, taskArgs.speed)
        const mtaAddr = MTA.address
        const wethAddr = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"

        const metaTokenRedeemer = await deployContract(new MetaTokenRedeemer__factory(signer), "MetaTokenRedeemer", [
            mtaAddr,
            wethAddr,
            BigNumber.from(taskArgs.rate),
        ])

        await verifyEtherscan(hre, {
            address: metaTokenRedeemer.address,
            contract: "contracts/shared/MetaTokenRedeemer.sol:MetaTokenRedeemer",
        })
    })
module.exports = {}