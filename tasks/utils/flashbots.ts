/* eslint-disable no-restricted-syntax */
/* eslint-disable no-await-in-loop */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { PopulatedTransaction, Signer, UnsignedTransaction } from "ethers"
import { BN } from "@utils/math"
import { JsonRpcProvider, TransactionResponse } from "@ethersproject/providers"

// Ethers provider for Flashbots Protect RPC
const flashbotsProvider = new JsonRpcProvider("https://rpc.flashbots.net")

export const sendPrivateTransaction = async (tx: PopulatedTransaction, signer: Signer): Promise<TransactionResponse> => {
    console.log(`About to send private transaction using signer address ${await signer.getAddress()}`)

    const gasPriceChain = tx.gasPrice ?? (await signer.getGasPrice())
    const gasPrice = gasPriceChain.mul(6).div(5) // add 20% to gas price

    const txUnsigned: UnsignedTransaction = {
        to: tx.to,
        data: tx.data,
        nonce: tx.nonce ?? (await signer.getTransactionCount()),
        gasLimit: tx.gasLimit ?? (await signer.estimateGas(tx)),
        gasPrice,
        value: tx.value ?? BN.from(0),
        chainId: tx.chainId ?? (await signer.getChainId()),
    }
    console.log(`nonce ${txUnsigned.nonce}`)
    console.log(`gas limit ${txUnsigned.gasLimit}`)
    console.log(`gas price ${txUnsigned.gasPrice}`)

    const txRaw = await signer.signTransaction(txUnsigned)

    return flashbotsProvider.sendTransaction(txRaw)
}

export const sendBundledRawTransactions = async (txsEncodedSigned: string[], fromBlock: BN): Promise<string> => {
    const txHash = await flashbotsProvider.send("eth_sendBundle", [{ txs: txsEncodedSigned, fromBlock: fromBlock.toHexString() }])
    console.log(`Taichi tx hash ${txHash}`)

    return txHash
}

export const sendBundledTransactions = async (txs: PopulatedTransaction[], signer: Signer): Promise<string> => {
    console.log(`About to send a bundle of ${txs.length} transactions using signer address ${await signer.getAddress()}`)

    let nonce = await signer.getTransactionCount()
    const gasPrice = await signer.getGasPrice()
    const chainId = await signer.getChainId()
    const block = await signer.provider.getBlock("latest")

    const rawTxs: string[] = []
    for (const tx of txs) {
        const txUnsigned: UnsignedTransaction = {
            to: tx.to,
            data: tx.data,
            nonce,
            gasLimit: tx.gasLimit ?? (await signer.estimateGas(tx)),
            gasPrice: gasPrice.mul(6).div(5), // add 20% to gas price
            value: tx.value ?? BN.from(0),
            chainId,
        }
        console.log(`nonce ${txUnsigned.nonce}`)
        console.log(`gas limit ${txUnsigned.gasLimit}`)
        console.log(`gas price ${txUnsigned.gasPrice}`)

        const txRaw = await signer.signTransaction(txUnsigned)

        nonce += 1
    }

    return sendBundledRawTransactions(rawTxs, BN.from(block.number))
}
