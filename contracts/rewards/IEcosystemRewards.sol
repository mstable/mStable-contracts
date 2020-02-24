pragma solidity ^0.5.16;

interface IEcosystemRewards {

    /** Manually assign points to specific rewardees */
    function addRewardeeData(uint256 _trancheNumber, address[] calldata _rewardees, uint256[] calldata _points) external;

    /** Refresh the rewardee data at a given tranche, provided it is still open */
    function clearRewardeeData(uint256 _trancheNumber) external;
}