pragma solidity ^0.5.12;

interface IForgeRewards {
    /** Participant actions to earn rewards through minting */
    function mintTo(uint32 _bAssetBitmap, uint256[] calldata _bassetQuantities, address _massetRecipient, address _rewardRecipient)
        external returns (uint256 massetMinted);
    function mintSingleTo(address _basset, uint256 _bassetQuantity, address _massetRecipient, address _rewardRecipient)
        external returns (uint256 massetMinted);
}