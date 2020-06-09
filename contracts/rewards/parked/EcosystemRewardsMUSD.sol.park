pragma solidity 0.5.16;

import { IEcosystemRewards } from "./IEcosystemRewards.sol";
import { MassetRewards } from "./MassetRewards.sol";

import { IMasset } from "../interfaces/IMasset.sol";
import { IMetaToken } from "../interfaces/IMetaToken.sol";

/**
 * @title   EcosystemRewardsMUSD
 * @author  Stability Labs Pty. Ltd.
 * @notice  A rewards contract incentivising the usage of mUSD across the DeFi
 *          ecosystem. Allows the `governor` to add rewardee data to a given tranche.
 */
contract EcosystemRewardsMUSD is MassetRewards, IEcosystemRewards {

    /**
     * @notice Basic constructor, implementing the abstract MassetRewards contract
     */
    constructor(IMasset _mUSD, IMetaToken _MTA, address _governor)
        public
        MassetRewards(_mUSD, _MTA, _governor) {
    }

    /**
     * @notice Similar to an airdrop, this method allows the fund manager to add rewardee data
     * to the given tranche, provided that it is still within the time window
     * @dev Adds to existing rewardee data, so it is able to be called multiple times before the tranche
     * end period. May need to split up into multiple calls in order to satisfy all rewardees
     * @param _trancheNumber  ID of the tranche for which to add data
     * @param _rewardees      Addresses of all the rewardees to add (no rule against duplicates)
     * @param _points         Points earned by each rewardee
     */
    function addRewardeeData(uint256 _trancheNumber, address[] calldata _rewardees, uint256[] calldata _points)
        external
        onlyGovernor
    {
        // Protect against obviously incorrect calls.
        uint256 len = _rewardees.length;
        require(len == _points.length, "Addresses and values mismatch");

        // Data must be added before the Tranche end time
        // or, before claim end, so long as no data has been previously added
        TrancheDates memory trancheDates = _getTrancheDates(_trancheNumber);
        if(now > trancheDates.endTime){
            require(now < trancheDates.claimEndTime, "Cannot add data after claim period");
            require(trancheData[_trancheNumber].totalPoints == 0, "Cannot increase data after end time");
        }

        uint256 totalPointsAdded = 0;

        // Loop through each rewardee and add points
        for(uint256 i = 0; i < len; i++) {
            // Cache position
            uint256 points = _points[i];
            address rewardee = _rewardees[i];

            // Add to total points
            totalPointsAdded = totalPointsAdded.add(points);

            // Log the individuals rewards
            _logIndividualPoints(_trancheNumber, rewardee, points);
        }

        // Add to total points count
        _logNewTotalPoints(_trancheNumber, totalPointsAdded);
    }

    /**
     * @notice Allow the governor to clear tranche data, so long as nothing has been claimed yet
     * @dev Removes all rewardee data from the tranche. Requires time to be < endTime or, if < claimEnd
     *      then requires no rewards to have been claimed so far.
     * @param _trancheNumber  ID of the tranche for which to clear data
     */
    function clearRewardeeData(uint256 _trancheNumber)
        external
        onlyGovernor
    {
        // Data must be added before the Tranche end time
        // or, before claim end, so long as no data has been previously added
        TrancheDates memory trancheDates = _getTrancheDates(_trancheNumber);
        if(now > trancheDates.endTime){
            require(now < trancheDates.claimEndTime, "Cannot clear after claim period");
            require(
                trancheData[_trancheNumber].totalRewardUnits == trancheData[_trancheNumber].unclaimedRewardUnits,
                "Cannot clear after rewards claimed");
        }

        address[] memory oldRewardees = trancheData[_trancheNumber].rewardees;
        uint256 len = oldRewardees.length;

        // Reset total points
        trancheData[_trancheNumber].totalPoints = 0;

        // Loop through each rewardee and delete old rewardee
        for(uint256 i = 0; i < len; i++) {
            delete trancheData[_trancheNumber].rewardeeData[oldRewardees[i]];
        }

        // Reset array data
        delete trancheData[_trancheNumber].rewardees;
    }
}