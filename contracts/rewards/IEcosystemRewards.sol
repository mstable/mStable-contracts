pragma solidity ^0.5.12;

interface IEcosystemRewards {

    /** Manually assign points to specific rewardees */
    function airdropRewards(address[] calldata _rewardees, uint256[] calldata _points) external;
}