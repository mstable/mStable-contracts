/* eslint-disable no-restricted-syntax */
/* eslint-disable no-await-in-loop */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { PopulatedTransaction, Signer, UnsignedTransaction } from "ethers"
import { BN } from "@utils/math"
import { JsonRpcProvider } from "@ethersproject/providers"
import axios from "axios"
import { arrayify } from "@ethersproject/bytes"

const baseUrl = "https://api.taichi.network:10001"
const rpcUrl = `${baseUrl}/rpc/public`

// Ethers provider is used as a convenient way to send JSON RPC transactions
const provider = new JsonRpcProvider(rpcUrl)

// Send a private transaction via the Taichi network
export const sendPrivateRawTransaction = async (txEncodedSigned: string): Promise<string> => {
    const txHash = await provider.send("eth_sendPrivateTransaction", [txEncodedSigned])
    console.log(`Taichi tx hash ${txHash}`)

    return txHash
}

export const sendBundledRawTransactions = async (txsEncodedSigned: string[], fromBlock: BN): Promise<string> => {
    const txHash = await provider.send("eth_sendBundle", [{ txs: txsEncodedSigned, fromBlock: fromBlock.toHexString() }])
    console.log(`Taichi tx hash ${txHash}`)

    return txHash
}

export const sendPrivateTransaction = async (tx: PopulatedTransaction, signer: Signer): Promise<string> => {
    console.log(`About to send private transaction using signer address ${await signer.getAddress()}`)

    const txUnsigned: UnsignedTransaction = {
        to: tx.to,
        data: tx.data,
        nonce: tx.nonce ?? (await signer.getTransactionCount()),
        gasLimit: tx.gasLimit ?? (await signer.estimateGas(tx)),
        gasPrice: tx.gasPrice ?? (await signer.getGasPrice()),
        value: tx.value ?? BN.from(0),
        chainId: tx.chainId ?? (await signer.getChainId()),
    }
    console.log(`nonce ${txUnsigned.nonce}`)
    console.log(`gas limit ${txUnsigned.gasLimit}`)
    console.log(`gas price ${txUnsigned.gasPrice}`)

    const txRaw = await signer.signTransaction(txUnsigned)

    return sendPrivateRawTransaction(txRaw)
}

export const getPrivateTxDetails = async (txHash: string): Promise<void> => {
    const response = await axios.get(`${baseUrl}/txscan/priTx?txHash=${txHash}`)
    console.log(`Status ${response.data.obj.status}`)
    console.log(`Tx details: ${JSON.stringify(response.data)}`)
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
