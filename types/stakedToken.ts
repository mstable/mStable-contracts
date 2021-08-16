import { BN } from "@utils/math"

export interface UserBalances {
    raw: BN
    weightedTimestamp: number
    lastAction: number
    permMultiplier: number
    seasonMultiplier: number
    timeMultiplier: number
    cooldownMultiplier: number
}

export interface UserStakingData {
    stakedBalance: BN
    votes: BN
    earnedRewards: BN
    cooldownTimestamp: BN
    cooldownPercentage: BN
    rewardsBalance: BN
    userBalances: UserBalances
}

export enum QuestType {
    PERMANENT,
    SEASONAL,
}

export enum QuestStatus {
    ACTIVE,
    EXPIRED,
}
