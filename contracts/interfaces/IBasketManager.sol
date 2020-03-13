pragma solidity 0.5.16;
pragma experimental ABIEncoderV2;

import { MassetStructs } from "../masset/shared/MassetStructs.sol";

/**
 * @title IMasset
 * @dev (Internal) Interface for interacting with Masset
 */
contract IBasketManager is MassetStructs {

    /** @dev Basket Manager Version */
    string public constant version_intf = "1.0";

    /** @dev Setters for mAsset to update balances */
    function increaseVaultBalance(uint8 _bAsset, address _integrator, uint256 _increaseAmount) external;
    function decreaseVaultBalance(uint8 _bAsset, address _integrator, uint256 _decreaseAmount) external;
    function collectInterest() external returns (uint256 interestCollected, uint32 bitmap, uint256[] memory gains);

    /** @dev Setters for Gov to update Basket composition */
    function addBasset(address _basset, address _integration, bool _isTransferFeeCharged) external returns (uint8 index);
    function setBasketWeights(address[] calldata _bassets, uint256[] calldata _weights) external;
    function setTransferFeesFlag(address _bAsset, bool _flag) external;

    /** @dev Public cleanup function to get rid of finished Bassets */
    function removeBasset(address _assetToRemove) external returns (bool);

    /** @dev Getters to retrieve Basket information */
    function getBasket() external view returns (Basket memory b);
    function getForgeBasset(address _token, bool _mint) external view
        returns (Basset memory bAsset, address integrator, uint8 index);
    function getForgeBassets(uint32 _bitmap, uint8 _size, bool _mint) external view
        returns (Basset[] memory bAssets, address[] memory integrators, uint8[] memory indexes);
    function getBasset(address _token) external view returns (Basset memory bAsset);
    function getBassets() external view returns (Basset[] memory bAssets, uint32 bitmap, uint256 len);

    /** @dev Conversion functions */
    // function getBitmapForAllBassets() external view returns (uint32 bitmap);
    function getBitmapFor(address[] calldata _bassets) external view returns (uint32 bitmap);
    // function convertBitmapToBassetsAddress(uint32 _bitmap, uint8 _size) external view returns (address[] memory);
    // function convertBitmapToBassets(uint32 _bitmap, uint8 _size) external view returns (Basset[] memory, uint8[] memory);


    /** @dev Recollateralisation */
    function handlePegLoss(address _basset, bool _belowPeg) external returns (bool actioned);
    function negateIsolation(address _basset) external;

    // function initiateRecol(address _basset) external returns (bool auctionNeeded, bool isTransferable);
    // function completeRecol(address _basset, uint256 _unitsUnderCollateralised) external;
}
