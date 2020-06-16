pragma solidity 0.5.16;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title   IMintWith1Inch
 * @author  Stability Labs Pty. Ltd.
 * @notice  Interface to Buy bAssets and Mint the mAssets from the OneSplit (1inch exchange)
 */
interface IMintWith1Inch {
    /**
     * @dev Buy the maximum bAsset tokens from DEX and mint mAsset tokens from mStable.
     *      ETH sent to the function used to buy bAsset tokens from DEX.
     * @param _srcBasset Source bAsset token address
     * @param _destMasset mAsset token address to mint
     * @param _minBassetUnits Minimum amount of bAssets to purchase
     * @param _distribution Distribution for different DEXes to buy bAssets from
     * @return mAssetQtyMinted Returns the quantity of mAsset minted from mStable
     */
    function buyAndMint(IERC20 _srcBasset, address _destMasset, uint256 _minBassetUnits, uint256[] calldata _distribution)
        external payable returns (uint256 mAssetQtyMinted);

}