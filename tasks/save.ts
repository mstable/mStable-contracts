import { subtask, task, types } from "hardhat/config"
import { SavingsContract__factory } from "types/generated"
import { simpleToExactAmount } from "@utils/math"
import { getSignerAccount } from "./utils/signerFactory"
import { logTxDetails } from "./utils/deploy-utils"
import { getChain, resolveAddress } from "./utils/networkAddressFactory"

subtask("save-deposit", "Deposit to savings contract")
    .addParam("masset", "Symbol of the mAsset. eg mUSD or mBTC", undefined, types.string)
    .addParam("amount", "Amount to be staked", undefined, types.float)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)
        const signerAccount = await getSignerAccount(hre, taskArgs.speed)

        const saveAddress = resolveAddress(taskArgs.masset, chain, "savings")
        const save = SavingsContract__factory.connect(saveAddress, signerAccount.signer)

        const amount = simpleToExactAmount(taskArgs.amount)

        const tx = await save["depositSavings(uint256)"](amount)
        await logTxDetails(tx, `deposit ${taskArgs.amount} ${taskArgs.masset} in Save`)
    })
task("save-deposit").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("save-redeem", "Redeems a number of Save credits from a savings contract")
    .addParam("masset", "Symbol of the mAsset. eg mUSD or mBTC", undefined, types.string)
    .addParam("amount", "Amount of Save credits to be redeemed", undefined, types.float)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)
        const signerAccount = await getSignerAccount(hre, taskArgs.speed)

        const saveAddress = resolveAddress(taskArgs.masset, chain, "savings")
        const save = SavingsContract__factory.connect(saveAddress, signerAccount.signer)

        const amount = simpleToExactAmount(taskArgs.amount)

        const tx = await save["redeem(uint256)"](amount)
        await logTxDetails(tx, `redeem ${taskArgs.amount} ${taskArgs.masset} in Save`)
    })
task("save-redeem").setAction(async (_, __, runSuper) => {
    await runSuper()
})

module.exports = {}
