pragma solidity 0.5.16;
pragma experimental ABIEncoderV2;

import { MassetStructs } from "../masset/shared/MassetStructs.sol";

/**
 * @title IMasset
 * @dev (Internal) Interface for interacting with Masset
 */
contract IBasketManager is MassetStructs {

    /** @dev Setters for mAsset to update balances */
    function increaseVaultBalance(address _bAsset, uint256 _increaseAmount) external;
    function decreaseVaultBalance(address _bAsset, uint256 _decreaseAmount) external;
    function logInterest(uint256[] calldata _increaseAmounts) external returns (bool isValid);

    /** @dev Setters for Gov to update Basket composition */
    function addBasset(address _basset, bool _isTransferFeeCharged) external;
    function setBasketWeights(address[] calldata _bassets, uint256[] calldata _weights) external;
    function setTransferFeesFlag(address _bAsset, bool _flag) external;

    /** @dev Public cleanup function to get rid of finished Bassets */
    function removeBasset(address _assetToRemove) external returns (bool);

    /** @dev Conversion functions */
    function getBitmapForAllBassets() external view returns (uint32 bitmap);
    function getBitmapFor(address[] calldata _bassets) external view returns (uint32 bitmap);
    function convertBitmapToBassetsAddress(uint32 _bitmap, uint8 _size) external view returns (address[] memory);
    function convertBitmapToBassets(uint32 _bitmap, uint8 _size) external view returns (Basset[] memory, uint8[] memory);

    /** @dev Getters to retrieve Basket information */
    function getAllBassetsAddress() public view returns (address[] memory);
    function getBasket() external view returns (Basket memory b);
    function getBassets()
        external
        view
        returns (
            Basset[] memory bAssets,
            uint32 bitmap,
            uint256 len
        );
    function getBasset(address _basset)
        external
        view
        returns (
            Basset memory bAsset,
            uint256 index
        );

    /** @dev Recollateralisation */
    function handlePegLoss(address _basset, bool _belowPeg) external returns (bool actioned);
    function negateIsolation(address _basset) external;
}

    // function initiateRecol(address _basset) external returns (bool auctionNeeded, bool isTransferable);
    // function completeRecol(address _basset, uint256 _unitsUnderCollateralised) external;
