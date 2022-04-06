import { subtask, task, types } from "hardhat/config"
import { Masset__factory } from "types/generated"
import { BN, simpleToExactAmount } from "@utils/math"
import { getSignerAccount } from "./utils/signerFactory"
import { logTxDetails } from "./utils/deploy-utils"
import { getChain, resolveAddress, resolveToken } from "./utils/networkAddressFactory"

subtask("masset-redeem", "Redeems a number of Save credits from a savings contract")
    .addParam("masset", "Symbol of the mAsset. eg mUSD or mBTC", undefined, types.string)
    .addParam("basset", "Symbol of the bAsset. eg USDC, DAI, USDT or DAI", undefined, types.string)
    .addParam("amount", "Amount of mAssets to be redeemed", undefined, types.float)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)
        const signerAccount = await getSignerAccount(hre, taskArgs.speed)

        const mAssetAddress = resolveAddress(taskArgs.masset, chain, "address")
        const bAsset = resolveToken(taskArgs.basset, chain, "address")

        const mAsset = Masset__factory.connect(mAssetAddress, signerAccount.signer)

        const amount = simpleToExactAmount(taskArgs.amount)
        const minAmount = amount
            .mul(99)
            .div(100)
            .div(BN.from(10).pow(18 - bAsset.decimals))

        const tx = await mAsset.redeem(bAsset.address, amount, minAmount, signerAccount.address)
        await logTxDetails(tx, `redeem ${taskArgs.amount} ${taskArgs.masset} for ${taskArgs.basset}`)
    })
task("masset-redeem").setAction(async (_, __, runSuper) => {
    await runSuper()
})

module.exports = {}
