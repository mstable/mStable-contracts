pragma solidity 0.5.16;

/**
 * @title   IBuyAndMintWithOneSplit
 * @author  Stability Labs Pty. Ltd.
 * @notice  Interface to Buy bAssets and Mint the mAssets from the OneSplit (1inch exchange)
 */
interface IBuyAndMintWithOneSplit {
    /**
     * @dev Buy the maximum bAsset tokens from DEX and mint mAsset tokens from mStable.
     *      ETH sent to the function used to buy bAsset tokens from DEX.
     * @param _srcBasset Source bAsset token address
     * @param _destMasset mAsset token address to mint
     * @param _distribution Distribution for different DEXes to buy bAssets from
     * @return mAssetQtyMinted Returns the quantity of mAsset minted from mStable
     */
    function buyAndMint(address _srcBasset, address _destMasset, uint256[] calldata _distribution)
        external payable returns (uint256 mAssetQtyMinted);

}