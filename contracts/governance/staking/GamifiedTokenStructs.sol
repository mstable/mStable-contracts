// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

struct Balance {
    /// units of staking token that has been deposited and consequently wrapped
    uint128 raw;
    /// (block.timestamp - weightedTimestamp) represents the seconds a user has had their full raw balance wrapped.
    /// If they deposit or withdraw, the weightedTimestamp is dragged towards block.timestamp proportionately
    uint32 weightedTimestamp;
    /// last timestamp at which the user made a write action to this contract
    uint32 lastAction;
    /// permanent multiplier applied to an account, awarded for PERMANENT QuestTypes
    uint16 permMultiplier;
    /// multiplier that decays after each "season" (~9 months) by 75%, to avoid multipliers getting out of control
    uint16 seasonMultiplier;
    /// multiplier awarded for staking for a long time
    uint16 timeMultiplier;
    /// shows if a user has entered their cooldown ready for a withdrawal. Can be used to slash voting balance
    uint16 cooldownMultiplier;
}
/// @notice Quests can either give permanent rewards or only for the season
enum QuestType {
    PERMANENT,
    SEASONAL
}
/// @notice Quests can be turned off by the questMaster. All those who already completed remain
enum QuestStatus {
    ACTIVE,
    EXPIRED
}
struct Quest {
    /// Type of quest rewards
    QuestType model;
    /// Multiplier, from 1 == 1.01x to 100 == 2.00x
    uint16 multiplier;
    /// Is the current quest valid?
    QuestStatus status;
    /// Expiry date in seconds for the quest
    uint32 expiry;
}
