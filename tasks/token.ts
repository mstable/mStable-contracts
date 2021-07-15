import { task, types } from "hardhat/config"
import { ERC20__factory } from "types/generated"
import { simpleToExactAmount } from "@utils/math"
import { formatUnits } from "ethers/lib/utils"
import { MAX_INT128 } from "@utils/constants"
import { tokens } from "./utils/tokens"
import { getSigner } from "./utils/signerFactory"
import { logTxDetails } from "./utils/deploy-utils"
import { getChain, resolveAddress } from "./utils/networkAddressFactory"

task("token-approve", "Approve address or contract to transfer an amount of tokens from the signer's account")
    .addParam("asset", "Symbol of the asset being approved. eg mUSD, imUSD, PmUSD, GUSD, alUSD, MTA", undefined, types.string)
    .addParam("account", "Address or contract name of the account that is approved to transferFrom", undefined, types.string)
    .addOptionalParam("tokenType", "Token address, savings, vault or feederPool.", "address", types.string)
    .addOptionalParam("amount", "Amount to approve. Default is max unit128", undefined, types.int)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)
        const signer = await getSigner(hre, taskArgs.speed)
        const signerAddress = await signer.getAddress()

        const assetSymbol = taskArgs.asset
        const assetToken = tokens.find((t) => t.symbol === assetSymbol && t.chain === chain)
        if (!assetToken) throw Error(`Could not find asset with symbol ${assetSymbol}`)
        const { tokenType } = taskArgs
        if (!assetToken[tokenType]) throw Error(`Can not find ${tokenType} for token ${assetSymbol}`)
        const token = ERC20__factory.connect(assetToken[tokenType], signer)

        const approveAddress = resolveAddress(taskArgs.account, chain)
        const amount = Number.isInteger(taskArgs.amount) ? simpleToExactAmount(taskArgs.amount, assetToken.decimals) : MAX_INT128

        const tx = await token.approve(approveAddress, amount)
        await logTxDetails(
            tx,
            `${signerAddress} approves ${approveAddress} to transfer ${formatUnits(amount, assetToken.decimals)} ${assetSymbol}`,
        )
    })

task("token-transfer", "Transfer an amount of tokens from the signer to the recipient")
    .addParam("asset", "Symbol of the asset being approved. eg mUSD, imUSD, PmUSD, GUSD, alUSD, MTA", undefined, types.string)
    .addParam("recipient", "Address or contract name the tokens will be sent to.", undefined, types.string)
    .addOptionalParam("tokenType", "Token address, savings, vault or feederPool.", "address", types.string)
    .addParam("amount", "Amount to of token to be sent without the token decimals.", undefined, types.int)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)
        const signer = await getSigner(hre, taskArgs.speed)
        const signerAddress = await signer.getAddress()

        const assetSymbol = taskArgs.asset
        const assetToken = tokens.find((t) => t.symbol === assetSymbol && t.chain === chain)
        if (!assetToken) throw Error(`Could not find asset with symbol ${assetSymbol}`)
        const { tokenType } = taskArgs
        if (!assetToken[tokenType]) throw Error(`Can not find ${tokenType} for token ${assetSymbol}`)
        const token = ERC20__factory.connect(assetToken[tokenType], signer)

        const recipientAddress = resolveAddress(taskArgs.recipient, chain)
        const amount = simpleToExactAmount(taskArgs.amount, assetToken.decimals)

        const desc = `${signerAddress} transfers ${formatUnits(amount, assetToken.decimals)} ${assetSymbol} to ${recipientAddress}`
        console.log(`About to send tx ${desc}`)
        const tx = await token.transfer(recipientAddress, amount)
        await logTxDetails(tx, desc)
    })

task("token-transfer-from", "Transfer an amount of tokens from the sender to the recipient")
    .addParam("asset", "Symbol of the asset being approved. eg mUSD, imUSD, PmUSD, GUSD, alUSD, MTA", undefined, types.string)
    .addParam("sender", "Address or contract name the tokens will be sent from.", undefined, types.string)
    .addParam("recipient", "Address or contract name the tokens will be sent to.", undefined, types.string)
    .addOptionalParam("tokenType", "Token address, savings, vault or feederPool.", "address", types.string)
    .addParam("amount", "Amount to of token to be sent without the token decimals.", undefined, types.int)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const chain = getChain(hre)
        const signer = await getSigner(hre, taskArgs.speed)
        const signerAddress = await signer.getAddress()

        const assetSymbol = taskArgs.asset
        const assetToken = tokens.find((t) => t.symbol === assetSymbol && t.chain === chain)
        if (!assetToken) throw Error(`Could not find asset with symbol ${assetSymbol}`)
        const { tokenType } = taskArgs
        if (!assetToken[tokenType]) throw Error(`Can not find ${tokenType} for token ${assetSymbol}`)
        const token = ERC20__factory.connect(assetToken[tokenType], signer)

        const senderAddress = resolveAddress(taskArgs.sender, chain)
        const recipientAddress = resolveAddress(taskArgs.recipient, chain)
        const amount = simpleToExactAmount(taskArgs.amount, assetToken.decimals)

        const tx = await token.transferFrom(senderAddress, recipientAddress, amount)
        await logTxDetails(
            tx,
            `${signerAddress} transfers ${formatUnits(amount, assetToken.decimals)} ${assetSymbol} to ${recipientAddress}`,
        )
    })

module.exports = {}
