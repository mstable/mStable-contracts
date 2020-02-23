pragma solidity ^0.5.12;

interface IEcosystemRewards {

    /** Manually assign points to specific rewardees */
    function addRewardeeData(address[] calldata _rewardees, uint256[] calldata _points) external;

    /** Refresh the data at a given tranche, provided it is still open */
    function refreshTrancheData(uint256 _trancheNumber) external;
}