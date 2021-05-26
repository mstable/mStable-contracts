import { Signer } from "ethers"
import { ethers, network } from "hardhat"
import { Account } from "@utils/machines"

// impersonates a specific account
export const impersonate = async (addr: string): Promise<Signer> => {
    await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [addr],
    })
    return ethers.provider.getSigner(addr)
}

export const impersonateAccount = async (addr: string): Promise<Account> => {
    await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [addr],
    })
    const signer = ethers.provider.getSigner(addr)
    return {
        signer,
        address: await signer.getAddress(),
    }
}
