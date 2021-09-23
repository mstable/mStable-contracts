import { PopulatedTransaction, Signer, UnsignedTransaction } from "ethers"
import { BN } from "@utils/math"
import { JsonRpcProvider } from "@ethersproject/providers"
import axios from "axios"

const baseUrl = "https://api.taichi.network:10001"

export const sendPrivateRawTransaction = async (txEncodedSigned: string): Promise<string> => {
    // Ethers provider is used as a convenient way to send JSON RPC transactions
    const provider = new JsonRpcProvider(`${baseUrl}/rpc/public`)

    // Send Taichi Private Transaction
    const txHash = await provider.send("eth_sendPrivateTransaction", [txEncodedSigned])
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
