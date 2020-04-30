pragma solidity 0.5.16;

/**
 * @title   IBuyAndMint
 * @author  Stability Labs Pty. Ltd.
 * @notice  Interface to Buy bAssets and Mint the mAssets from the DEXes
 */
interface IBuyAndMint {
    /**
     * @dev Buy the maximum bAsset tokens from DEX and mint mAsset tokens from mStable.
     *      ETH sent to the function used to buy bAsset tokens from DEX.
     * @param _srcBasset Source bAsset token address
     * @param _destMasset mAsset token address to mint
     * @return mAssetQtyMinted Returns the quantity of mAsset minted from mStable
     */
    function buyAndMint(address _srcBasset, address _destMasset)
        external payable returns (uint256 mAssetQtyMinted);

    /**
     * @dev Buy the required bAsset tokens from the DEX and Mint the specific amount of
     *      mAssets from mStable. ETH sent to the function used to buy bAsset tokens from DEX.
     * @param _srcBasset Source bAsset token address
     * @param _destMasset mAsset token address to mint
     * @param _amountOfMasset Expected amount of mAssets to mint from mStable
     * @return mAssetQtyMinted Returns the quantity of mAsset minted from mStable
     */
    function buyAndMint(address _srcBasset, address _destMasset, uint256 _amountOfMasset)
        external payable returns (uint256 mAssetQtyMinted);

    /**
     * @dev Buy the required bAssets tokens from the DEX and Mint mAssets from mStable.
     *      ETH sent to the function used to buy bAsset tokens from DEX.
     * @param _srcBassets Array of source bAssets token address
     * @param _ethAmount Array of ETH amount to buy corresponding bAsset from DEX
     * @param _destMAsset mAsset token address to mint
     * @return mAssetQtyMinted Returns the quantity of mAsset minted from mStable
     */
    function buyAndMint(
        address[] calldata _srcBassets,
        uint256[] calldata _ethAmount,
        address _destMAsset
    ) external payable returns (uint256 mAssetQtyMinted);
}