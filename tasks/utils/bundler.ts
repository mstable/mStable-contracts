import { BytesLike, ContractReceipt, Signer } from "ethers"
import { ethers } from "hardhat"
import { DataEmitter } from "types/generated"

/// Calls a number of view functions in the same block as a transaction is executed
export const bundleInBlock = async (
    dataEmitter: DataEmitter,
    callAddress: string,
    callEncodedData: BytesLike,
    txAddress: string,
    rawTx: BytesLike,
    signer: Signer,
): Promise<{ callReceipt: ContractReceipt; txReceipt: ContractReceipt }> => {
    // Step 1 : Stop auto mining a new block with every transaction
    await ethers.provider.send("evm_setAutomine", [false])

    // Step 2 : Get the view function call result before the tx in the same block
    const callTx = await dataEmitter.emitStaticCall(callAddress, callEncodedData)

    // Step 3 : Send the transaction
    const tx = await signer.sendTransaction({ to: txAddress, data: rawTx })

    // Step 4 : Mine the view function calls and the transaction in the same block
    await ethers.provider.send("evm_mine", [])

    // Step 5 : Get the tx receipts
    const callReceipt = await callTx.wait()
    const txReceipt = await tx.wait()

    return {
        callReceipt,
        txReceipt,
    }
}
