import { BN } from "@utils/math"

export interface UserBalance {
    raw: BN
    weightedTimestamp: number
    questMultiplier: number
    timeMultiplier: number
    cooldownTimestamp: number
    cooldownUnits: BN
}

export interface QuestBalance {
    lastAction: number
    permMultiplier: number
    seasonMultiplier: number
}

export interface UserStakingData {
    scaledBalance: BN
    votes: BN
    pastStakerVotes?: BN
    earnedRewards: BN
    numCheckpoints?: number
    rewardTokenBalance?: BN
    rawBalance: UserBalance
    userPriceCoeff: BN
    questBalance?: QuestBalance
    balData?: BalConfig
}
export interface BalConfig {
    totalSupply: BN
    pastTotalSupply?: BN
    pendingBPTFees: BN
    priceCoefficient: BN
    lastPriceUpdateTime: BN
    mbptBalOfStakedToken?: BN
    mbptBalOfGauge?: BN
    stakerBal?: BN
    stakerVotes?: BN
    pastStakerVotes?: BN
    deployerStkbptBal?: BN
    whitelisted?: boolean[]
    delegatee?: string
}

export enum QuestType {
    PERMANENT,
    SEASONAL,
}

export enum QuestStatus {
    ACTIVE,
    EXPIRED,
}
