pragma solidity 0.5.16;
pragma experimental ABIEncoderV2;

import { MassetStructs } from "../masset/shared/MassetStructs.sol";

/**
 * @title IBasketManager
 * @dev (Internal) Interface for interacting with BasketManager
 */
contract IBasketManager is MassetStructs {

    /** @dev Setters for mAsset to update balances */
    function increaseVaultBalance(
        uint8 _bAsset,
        address _integrator,
        uint256 _increaseAmount) external;

    function increaseVaultBalances(
        uint8[] calldata _bAsset,
        address[] calldata _integrator,
        uint256[] calldata _increaseAmount,
        uint256 _len) external;

    function decreaseVaultBalance(
        uint8 _bAsset,
        address _integrator,
        uint256 _decreaseAmount) external;

    function decreaseVaultBalances(
        uint8[] calldata _bAsset,
        address[] calldata _integrator,
        uint256[] calldata _decreaseAmount,
        uint256 _len) external;

    function collectInterest() external
        returns (uint256 interestCollected, uint32 bitmap, uint256[] memory gains);

    /** @dev Setters for Gov to update Basket composition */
    function addBasset(
        address _basset,
        address _integration,
        bool _isTransferFeeCharged) external returns (uint8 index);

    function setBasketWeights(address[] calldata _bassets, uint256[] calldata _weights) external;

    function setTransferFeesFlag(address _bAsset, bool _flag) external;

    /** @dev Getters to retrieve Basket information */
    function getBasket() external view returns (Basket memory b);

    function prepareForgeBasset(address _token, uint256 _amt, bool _mint) external
        returns (ForgeProps memory props);

    function prepareForgeBassets(
        uint32 _bitmap,
        uint8 _size,
        uint256[] calldata _amts,
        bool _mint) external returns (ForgePropsMulti memory props);

    function getBasset(address _token) external view returns (Basset memory bAsset);

    function getBassets()
        external view returns (Basset[] memory bAssets, uint32 bitmap, uint256 len);

    /** @dev Conversion functions */
    function getBitmapFor(address[] calldata _bassets) external view returns (uint32 bitmap);

    /** @dev Recollateralisation */
    function handlePegLoss(address _basset, bool _belowPeg) external returns (bool actioned);

    function negateIsolation(address _basset) external;
}
