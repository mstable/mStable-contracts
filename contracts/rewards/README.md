

## Files

Why so many?

Actually only 3 are base contracts

### RewardsDistributor

Allows reward allocators ("FundManagers") to distribute rewards.

### StakingRewardsWithLockup

`StakingRewardsWithLockup` is `StakingRewards` is `RewardsDistributionRecipient` is `StakingTokenWrapper`

This preserves the code written, tested, audited and deployed by `Synthetix` (StakingRewards & StakingTokenWrapper).

Originally: Synthetix (forked from /Synthetixio/synthetix/contracts/StakingRewards.sol)
Audit: https://github.com/sigp/public-audits/blob/master/synthetix/unipool/review.pdf`

### RewardsVault

All earned tokens from `StakingRewardsWithLockup` will be credited to this `RewardsVault` for a 6 month lockup, after which time they are redeemable
