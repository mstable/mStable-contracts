import { subtask, task, types } from "hardhat/config"
import { ERC20__factory, MockERC20__factory } from "types/generated"
import { simpleToExactAmount } from "@utils/math"
import { formatUnits } from "ethers/lib/utils"
import { MAX_INT128 } from "@utils/constants"
import { getSigner } from "./utils/signerFactory"
import { deployContract, logTxDetails } from "./utils/deploy-utils"
import { getChain, resolveAddress, resolveToken } from "./utils/networkAddressFactory"

subtask("token-approve", "Approve address or contract to spend (transferFrom) an amount of tokens from the signer's account")
    .addParam("asset", "Symbol of the asset being approved. eg mUSD, imUSD, PmUSD, GUSD, alUSD, MTA", undefined, types.string)
    .addOptionalParam("tokenType", "Asset token type: address, savings, vault or feederPool.", "address", types.string)
    .addParam("spender", "Address or contract name that will send the transferFrom transaction.", undefined, types.string)
    .addOptionalParam(
        "spenderTokenType",
        "If spender is a token, then either address, savings, vault or feederPool.",
        "address",
        types.string,
    )
    .addOptionalParam("amount", "Amount to approve. Default is max unit128", undefined, types.float)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { asset, tokenType, spender, spenderTokenType, amount } = taskArgs

        const chain = getChain(hre)
        const signer = await getSigner(hre, taskArgs.speed)
        const signerAddress = await signer.getAddress()

        const assetToken = resolveToken(asset, chain, tokenType)
        const token = ERC20__factory.connect(assetToken[tokenType], signer)

        const spenderAddress = resolveAddress(spender, chain, spenderTokenType)
        const amountBN = Number.isInteger(amount) ? simpleToExactAmount(amount, assetToken.decimals) : MAX_INT128

        const tx = await token.approve(spenderAddress, amountBN)
        await logTxDetails(
            tx,
            `${signerAddress} approves ${spenderAddress} to transfer ${formatUnits(amountBN, assetToken.decimals)} ${asset}`,
        )
    })
task("token-approve").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("token-transfer", "Transfer an amount of tokens from the signer to the recipient")
    .addParam("asset", "Symbol of the asset being approved. eg mUSD, imUSD, PmUSD, GUSD, alUSD, MTA", undefined, types.string)
    .addOptionalParam("tokenType", "Asset token type: address, savings, vault or feederPool.", "address", types.string)
    .addParam("recipient", "Address or contract name the tokens will be sent to.", undefined, types.string)
    .addOptionalParam(
        "recipientTokenType",
        "If recipient is a token, then either address, savings, vault or feederPool.",
        "address",
        types.string,
    )
    .addParam("amount", "Amount to of token to be sent without the token decimals.", undefined, types.float)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { speed, tokenType, recipient, recipientTokenType, amount } = taskArgs
        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)
        const signerAddress = await signer.getAddress()

        const assetToken = resolveToken(taskArgs.asset, chain, tokenType)
        const token = ERC20__factory.connect(assetToken[tokenType], signer)

        const recipientAddress = resolveAddress(recipient, chain, recipientTokenType)
        const amountBN = simpleToExactAmount(amount, assetToken.decimals)

        const desc = `${signerAddress} transfers ${formatUnits(amountBN, assetToken.decimals)} ${taskArgs.asset} to ${recipientAddress}`
        console.log(`About to send tx ${desc}`)
        const tx = await token.transfer(recipientAddress, amountBN)
        await logTxDetails(tx, desc)
    })
task("token-transfer").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("token-transfer-from", "Transfer an amount of tokens from the sender to the recipient")
    .addParam("asset", "Symbol of the asset being approved. eg mUSD, imUSD, PmUSD, GUSD, alUSD, MTA", undefined, types.string)
    .addOptionalParam("tokenType", "Asset token type: address, savings, vault or feederPool.", "address", types.string)
    .addParam("sender", "Address or contract name the tokens will be sent from.", undefined, types.string)
    .addOptionalParam(
        "senderTokenType",
        "If sender is a token, then either address, savings, vault or feederPool.",
        "address",
        types.string,
    )
    .addParam("recipient", "Address or contract name the tokens will be sent to.", undefined, types.string)
    .addOptionalParam(
        "recipientTokenType",
        "If recipient is a token, then either address, savings, vault or feederPool.",
        "address",
        types.string,
    )
    .addParam("amount", "Amount to of token to be sent without the token decimals.", undefined, types.float)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { speed, tokenType, sender, senderTokenType, recipient, recipientTokenType, amount } = taskArgs
        const chain = getChain(hre)
        const signer = await getSigner(hre, speed)
        const signerAddress = await signer.getAddress()

        const assetToken = resolveToken(taskArgs.asset, chain, tokenType)
        const token = ERC20__factory.connect(assetToken[tokenType], signer)

        const senderAddress = resolveAddress(sender, chain, senderTokenType)
        const recipientAddress = resolveAddress(recipient, chain, recipientTokenType)
        const amountBN = simpleToExactAmount(amount, assetToken.decimals)

        const tx = await token.transferFrom(senderAddress, recipientAddress, amountBN)
        await logTxDetails(
            tx,
            `${signerAddress} transfers ${formatUnits(amountBN, assetToken.decimals)} ${taskArgs.asset} to ${recipientAddress}`,
        )
    })
task("token-transfer-from").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("token-allowance", "Logs the amount of tokens a spender can transfer from an owner")
    .addParam("token", "Symbol of the token. eg mUSD, imUSD, PmUSD, GUSD, alUSD, MTA", undefined, types.string)
    .addOptionalParam("tokenType", "Token address, savings, vault or feederPool.", "address", types.string)
    .addParam("owner", "Address or contract name where the tokens are held.", undefined, types.string)
    .addOptionalParam("ownerTokenType", "If owner is a token, then either address, savings, vault or feederPool.", "address", types.string)
    .addParam("spender", "Address or contract name that can transferFrom.", undefined, types.string)
    .addOptionalParam(
        "spenderTokenType",
        "If spender is a token, then either address, savings, vault or feederPool.",
        "address",
        types.string,
    )
    .setAction(async (taskArgs, hre) => {
        const { tokenType, owner, ownerTokenType, spender, spenderTokenType } = taskArgs
        const chain = getChain(hre)
        const signer = await getSigner(hre)

        const assetSymbol = taskArgs.token
        const assetToken = resolveToken(taskArgs.token, chain, tokenType)
        const token = ERC20__factory.connect(assetToken[tokenType], signer)

        const ownerAddress = resolveAddress(owner, chain, ownerTokenType)
        const spenderAddress = resolveAddress(spender, chain, spenderTokenType)

        const amount = await token.allowance(ownerAddress, spenderAddress)
        console.log(
            `Spender ${spenderAddress} can transfer ${formatUnits(amount, assetToken.decimals)} ${assetSymbol} from ${spenderAddress}`,
        )
    })
task("token-allowance").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("token-balance", "Logs the token balance of an owner")
    .addParam("token", "Symbol of the token. eg mUSD, imUSD, PmUSD, GUSD, alUSD, MTA", undefined, types.string)
    .addOptionalParam("tokenType", "Token address, savings, vault or feederPool.", "address", types.string)
    .addParam("owner", "Address or contract name where the tokens are held.", undefined, types.string)
    .addOptionalParam("ownerTokenType", "If owner is a token, then either address, savings, vault or feederPool.", "address", types.string)
    .setAction(async (taskArgs, hre) => {
        const { tokenType, owner, ownerTokenType } = taskArgs
        const chain = getChain(hre)
        const signer = await getSigner(hre)

        const assetToken = resolveToken(taskArgs.token, chain, tokenType)
        const token = ERC20__factory.connect(assetToken[tokenType], signer)

        const ownerAddress = resolveAddress(owner, chain, ownerTokenType)

        const amount = await token.balanceOf(ownerAddress)
        console.log(`Balance of ${ownerAddress} is ${formatUnits(amount, assetToken.decimals)} ${taskArgs.token}`)
    })
task("token-balance").setAction(async (_, __, runSuper) => {
    await runSuper()
})

subtask("token-deploy", "Deploys a new mock ERC20 token")
    .addParam("name", "Token name", undefined, types.string)
    .addParam("symbol", "Token symbol", undefined, types.string)
    .addOptionalParam("decimals", "Token decimal places", 18, types.int)
    .addOptionalParam("recipient", "Initial mint recipient", undefined, types.string)
    .addOptionalParam("supply", "Initial mint amount", 1000000, types.int)
    .addOptionalParam("speed", "Defender Relayer speed param: 'safeLow' | 'average' | 'fast' | 'fastest'", "fast", types.string)
    .setAction(async (taskArgs, hre) => {
        const { name, symbol, decimals, supply } = taskArgs
        const signer = await getSigner(hre)
        const signerAddress = await signer.getAddress()
        const recipient = taskArgs.recipient || signerAddress

        await deployContract(new MockERC20__factory(signer), `Token ${name} (${symbol})`, [name, symbol, decimals, recipient, supply])
    })
task("token-deploy").setAction(async (_, __, runSuper) => {
    await runSuper()
})

module.exports = {}
