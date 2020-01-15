pragma solidity ^0.5.12;

/**
 * @title ForgeRewards
 * @dev Forge wrapper that rewards minters for their contribution to liquidity
 *
 *
 * > Ulimited tranches @ 2 week intervals starting from contract launch (tranche# == date-startDate/tranchePeriod)
 *  > Certain authority called the 'RewardsGovernor'
 *  > 'FundTranche' function that funds a given tranche (MUST BE DONE BEFORE (ideally) OR DURING A TRANCHE PERIOD)
 *    > Sends XXX MTA to load into a given tranche
 * > User mints through 'Rewards' contract
 * > Volume of mint logged in tranche (Tranche number based on timestamp)
 * > At end of tranche, users have 4 weeks to CLAIM their reward (not claimable without funding)
 *  > Claiming reward calculates the payout (f(usersMintVolume, totalMintVolume, trancheFunding))
 *  > Unclaimed rewards are able to be withdrawn by the fund authority and re-used
 *  > Reward locked for 12 months
 *  > Redeem reward
 *
 *
 * MUST HAVE:
 *  - Getters for quickly tallying or projecting rewards
 *  - No ability for Governance to extract the collateral
 *  - 
 */
contract ForgeRewards {


}