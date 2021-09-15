import { BigNumberish, Signer } from "ethers"
import { arrayify, solidityKeccak256 } from "ethers/lib/utils"

export const signUserQuests = async (user: string, questIds: BigNumberish[], questSigner: Signer): Promise<string> => {
    const messageHash = solidityKeccak256(["address", "uint256[]"], [user, questIds])
    const signature = await questSigner.signMessage(arrayify(messageHash))
    return signature
}

export const signQuestUsers = async (questId: BigNumberish, users: string[], questSigner: Signer): Promise<string> => {
    const messageHash = solidityKeccak256(["uint256", "address[]"], [questId, users])
    const signature = await questSigner.signMessage(arrayify(messageHash))
    return signature
}
