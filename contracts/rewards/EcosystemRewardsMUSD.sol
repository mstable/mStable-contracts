pragma solidity ^0.5.12;

import { IEcosystemRewards } from "./IEcosystemRewards.sol";
import { MassetRewards } from "./MassetRewards.sol";

import { IMasset } from "../interfaces/IMasset.sol";
import { ISystok } from "../interfaces/ISystok.sol";

/**
 * @title EcosystemRewardsMUSD
 */
contract EcosystemRewardsMUSD is MassetRewards, IEcosystemRewards {

    constructor(IMasset _mUSD, ISystok _MTA, address _governor)
      public
      MassetRewards(_mUSD, _MTA, _governor) {
    }

    /**
     * @dev somethingsomething rewards
     */
    function addRewardeeData(uint256 _trancheNumber, address[] calldata _rewardees, uint256[] calldata _points)
        external
        onlyGovernor
    {
        // Protect against obviously incorrect calls.
        uint256 len = _rewardees.length;
        require(len == _points.length, "Addresses and values mismatch");

        // TODO - Confirm it's ok to add data to this tranche
        // require() TrancheDates .. must still be in window

        uint256 totalPointsAdded = 0;

        // Loop through each rewardee and add points
        for(uint256 i = 0; i < len; i++) {
            // Cache position
            uint256 points = _points[i];
            address rewardee = _rewardees[i];

            // Add to total points
            totalPointsAdded = totalPointsAdded.add(points);

            // Fetch individual user rewards
            uint256 currentPointsForUser = trancheData[_trancheNumber].rewardeeData[rewardee].userPoints;

            // If this is a new rewardee, add her to array
            if(currentPointsForUser == 0){
                trancheData[_trancheNumber].rewardees.push(rewardee);
            }

            // Assign updated points on the rewardee data
            uint256 newPointsForUser = currentPointsForUser.add(points);
            trancheData[_trancheNumber].rewardeeData[rewardee].userPoints = newPointsForUser;
            emit RewardeePointsIncreased(_trancheNumber, rewardee, newPointsForUser);
        }

        uint256 newTotalPoints = trancheData[_trancheNumber].totalPoints.add(totalPointsAdded);
        trancheData[_trancheNumber].totalPoints = newTotalPoints;
        emit TotalPointsIncreased(_trancheNumber, newTotalPoints);
    }

    function refreshTrancheData(uint256 _trancheNumber)
        external
        onlyGovernor
    {
        // TODO do something
        // Require that its still before opening
    }
}
