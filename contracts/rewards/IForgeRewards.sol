pragma solidity ^0.5.16;

interface IForgeRewards {
    /** Participant actions to earn rewards through minting */
    function mintTo(address _basset, uint256 _bassetQuantity, address _massetRecipient, address _rewardRecipient)
        external returns (uint256 massetMinted);
    function mintMulti(uint32 _bAssetBitmap, uint256[] calldata _bassetQuantities, address _massetRecipient, address _rewardRecipient)
        external returns (uint256 massetMinted);
}