pragma solidity ^0.5.12;

interface IMassetForgeRewards {

    /** Participant actions to earn rewards through minting */
    function mintTo(uint256[] calldata _bassetQuantities, address _massetRecipient, address _rewardRecipient)
        external returns (uint256 massetMinted);
    function mintSingleTo(address _basset, uint256 _bassetQuantity, address _massetRecipient, address _rewardRecipient)
        external returns (uint256 massetMinted);

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
            uint256 totalMintVolume,
            uint256 totalRewardUnits,
            uint256 unclaimedRewardUnits,
            address[] memory participants);

    /** Getters for easily parsing all rewardee data */
    function getRewardeeData(uint256 _trancheNumber, address _rewardee)
        external view returns(
            bool mintWindowClosed,
            bool claimWindowClosed,
            bool unlocked,
            uint256 mintVolume,
            bool claimed,
            uint256 rewardAllocation,
            bool redeemed);
    function getRewardeeData(uint256[] calldata _trancheNumbers, address _rewardee)
        external view returns(
            bool[] memory mintWindowClosed,
            bool[] memory claimWindowClosed,
            bool[] memory unlocked,
            uint256[] memory mintVolume,
            bool[] memory claimed,
            uint256[] memory rewardAllocation,
            bool[] memory redeemed);
    function getRewardeesData(uint256 _trancheNumber, address[] calldata _rewardees)
        external view returns(
            uint256[] memory mintVolume,
            bool[] memory claimed,
            uint256[] memory rewardAllocation,
            bool[] memory redeemed);
}