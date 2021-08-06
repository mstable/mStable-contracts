import { ethers } from "hardhat"
import { BN } from "./math"

export const increaseTime = async (length: BN | number): Promise<void> => {
    await ethers.provider.send("evm_increaseTime", [BN.from(length).toNumber()])
    await ethers.provider.send("evm_mine", [])
}

export const getTimestamp = async (): Promise<BN> => BN.from((await ethers.provider.getBlock("latest")).timestamp)

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
