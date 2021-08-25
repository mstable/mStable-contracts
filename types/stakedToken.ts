import { BN } from "@utils/math"

export interface UserBalances {
    raw: BN
    weightedTimestamp: number
    questMultiplier: number
    timeMultiplier: number
}

export interface QuestBalance {
    lastAction: number
    permMultiplier: number
    seasonMultiplier: number
}

export interface UserStakingData {
    stakedBalance: BN
    votes: BN
    earnedRewards: BN
    cooldownTimestamp: BN
    cooldownUnits: BN
    rewardsBalance: BN
    userBalances: UserBalances
    questBalance: QuestBalance
}

export enum QuestType {
    PERMANENT,
    SEASONAL,
}

export enum QuestStatus {
    ACTIVE,
    EXPIRED,
}
