import { Signer } from "ethers"
import { ethers, network } from "hardhat"

// impersonates a specific account
export const impersonate = async (addr: string): Promise<Signer> => {
    await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [addr],
    })
    return ethers.provider.getSigner(addr)
}
