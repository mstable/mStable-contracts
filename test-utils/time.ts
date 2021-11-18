import { ethers } from "hardhat"
import { Block } from "@ethersproject/abstract-provider"
import { BigNumberish } from "@ethersproject/bignumber"
import { BN } from "./math"
import { ONE_WEEK } from "./constants"

export const advanceBlock = async (): Promise<void> => ethers.provider.send("evm_mine", [])

export const increaseTime = async (length: BN | number): Promise<void> => {
    await ethers.provider.send("evm_increaseTime", [BN.from(length).toNumber()])
    await advanceBlock()
}
export const latestBlock = async (): Promise<Block> => ethers.provider.getBlock(await ethers.provider.getBlockNumber())

export const getTimestamp = async (): Promise<BN> => BN.from((await latestBlock()).timestamp)

export const increaseTimeTo = async (target: BN | number): Promise<void> => {
    const now = await getTimestamp()
    const later = BN.from(target)
    if (later.lt(now)) throw Error(`Cannot increase current time (${now.toNumber()}) to a moment in the past (${later.toNumber()})`)
    const diff = later.sub(now)
    await increaseTime(diff)
    await advanceBlock()
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export const startWeek = (epochSeconds: BigNumberish): BN => BN.from(epochSeconds).div(ONE_WEEK).mul(ONE_WEEK)
export const startCurrentWeek = async (): Promise<BN> => startWeek(await getTimestamp())

export const weekEpoch = (epochSeconds: BigNumberish): BN => BN.from(epochSeconds).div(ONE_WEEK)
export const currentWeekEpoch = async (): Promise<BN> => weekEpoch(await getTimestamp())
