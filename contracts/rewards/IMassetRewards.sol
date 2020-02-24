pragma solidity ^0.5.16;


interface IMassetRewards {

    /** Participant actions to claim tranche rewards */
    function claimReward(uint256 _trancheNumber) external returns(bool);
    function claimReward(uint256 _trancheNumber, address _rewardee) external returns(bool);
    function redeemReward(uint256 _trancheNumber) external returns(bool);
    function redeemReward(uint256 _trancheNumber, address _rewardee) external returns(bool);

    /** Governor actions to manage tranche rewards */
    function fundTranche(uint256 _trancheNumber, uint256 _fundQuantity) external;
    function withdrawUnclaimedRewards(uint256 _trancheNumber) external;

    /** Getters for accessing nested tranche data */
    function getTrancheData(uint256 _trancheNumber)
        external view returns(
            uint256 startTime,
            uint256 endTime,
            uint256 claimEndTime,
            uint256 unlockTime,
            uint256 totalPoints,
            uint256 totalRewardUnits,
            uint256 unclaimedRewardUnits,
            address[] memory participants);

    /** Getters for easily parsing all rewardee data */
    function getRewardeeParticipation(uint256 _trancheNumber, address _rewardee)
        external view returns(bool hasParticipated);
    function getRewardeeData(uint256 _trancheNumber, address _rewardee)
        external view returns(
            bool earningWindowClosed,
            bool claimWindowClosed,
            bool unlocked,
            uint256 userPoints,
            bool claimed,
            uint256 rewardAllocation,
            bool redeemed);
    function getRewardeeData(uint256[] calldata _trancheNumbers, address _rewardee)
        external view returns(
            bool[] memory earningWindowClosed,
            bool[] memory claimWindowClosed,
            bool[] memory unlocked,
            uint256[] memory userPoints,
            bool[] memory claimed,
            uint256[] memory rewardAllocation,
            bool[] memory redeemed);
    function getRewardeesData(uint256 _trancheNumber, address[] calldata _rewardees)
        external view returns(
            uint256[] memory userPoints,
            bool[] memory claimed,
            uint256[] memory rewardAllocation,
            bool[] memory redeemed);
}