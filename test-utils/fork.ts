/* eslint-disable no-await-in-loop */
import { Signer, utils } from "ethers"
import { Account } from "types"
import { BN } from "./math"

// impersonates a specific account
export const impersonate = async (addr: string, fund = true): Promise<Signer> => {
    // Dynamic import hardhat module to avoid importing while hardhat config is being defined.
    // The error this avoids is:
    // Error HH9: Error while loading Hardhat's configuration.
    // You probably tried to import the "hardhat" module from your config or a file imported from it.
    // This is not possible, as Hardhat can't be initialized while its config is being defined.
    const { network, ethers } = await import("hardhat")
    await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [addr],
    })
    if (fund) {
        // Give the account 10 Ether
        await network.provider.request({
            method: "hardhat_setBalance",
            params: [addr, "0x8AC7230489E80000"],
        })
    }
    return ethers.provider.getSigner(addr)
}

export const impersonateAccount = async (address: string, fund = true): Promise<Account> => {
    const signer = await impersonate(address, fund)
    return {
        signer,
        address,
    }
}

export const toBytes32 = (bn: BN): string => utils.hexlify(utils.zeroPad(bn.toHexString(), 32))

export const setStorageAt = async (address: string, index: string, value: string): Promise<void> => {
    const { ethers } = await import("hardhat")

    await ethers.provider.send("hardhat_setStorageAt", [address, index, value])
    await ethers.provider.send("evm_mine", []) // Just mines to the next block
}
/**
 *
 * Based on https://blog.euler.finance/brute-force-storage-layout-discovery-in-erc20-contracts-with-hardhat-7ff9342143ed
 * @export
 * @param {string} tokenAddress
 * @return {*}  {Promise<number>}
 */
export const findBalancesSlot = async (tokenAddress: string): Promise<number> => {
    const { ethers, network } = await import("hardhat")

    const encode = (types, values) => ethers.utils.defaultAbiCoder.encode(types, values)

    const account = ethers.constants.AddressZero
    const probeA = encode(["uint"], [1])
    const probeB = encode(["uint"], [2])
    const token = await ethers.getContractAt("@openzeppelin/contracts/token/ERC20/ERC20.sol:ERC20", tokenAddress)

    for (let i = 0; i < 100; i += 1) {
        let probedSlot = ethers.utils.keccak256(encode(["address", "uint"], [account, i]))
        // remove padding for JSON RPC
        while (probedSlot.startsWith("0x0")) probedSlot = `0x${probedSlot.slice(3)}`

        const prev = await network.provider.send("eth_getStorageAt", [tokenAddress, probedSlot, "latest"])
        // make sure the probe will change the slot value
        const probe = prev === probeA ? probeB : probeA

        await network.provider.send("hardhat_setStorageAt", [tokenAddress, probedSlot, probe])

        const balance = await token.balanceOf(account)
        // reset to previous value
        await network.provider.send("hardhat_setStorageAt", [tokenAddress, probedSlot, prev])
        if (balance.eq(ethers.BigNumber.from(probe))) return i
    }
    throw new Error("Balances slot not found!")
}

export const setBalance = async (userAddress: string, tokenAddress: string, amount: BN, slotIndex?: string): Promise<void> => {
    const balanceSlot = await findBalancesSlot(tokenAddress)
    const index =
        slotIndex === undefined
            ? utils.solidityKeccak256(
                  ["uint256", "uint256"],
                  [userAddress, balanceSlot], // key, slot
              )
            : slotIndex

    console.log(`Setting balance of user  ${userAddress} with token ${tokenAddress} at index ${index}`)
    await setStorageAt(tokenAddress, toBytes32(BN.from(index)), toBytes32(amount).toString())
}
