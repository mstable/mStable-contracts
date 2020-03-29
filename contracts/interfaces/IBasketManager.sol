pragma solidity 0.5.16;
pragma experimental ABIEncoderV2;

import { MassetStructs } from "../masset/shared/MassetStructs.sol";

/**
 * @title IBasketManager
 * @dev (Internal) Interface for interacting with BasketManager
 */
contract IBasketManager is MassetStructs {

    /** @dev Basket Manager Version */
    string private constant version_intf = "1.0";

    /** @dev Setters for mAsset to update balances */
    function increaseMyVaultBalance(uint8 _bAsset, address _integrator, uint256 _increaseAmount) external;
    function decreaseMyVaultBalance(uint8 _bAsset, address _integrator, uint256 _decreaseAmount) external;
    function collectMyInterest() external returns (uint256 interestCollected, uint32 bitmap, uint256[] memory gains);

    /** @dev Setters for Gov to update Basket composition */
    function addBasset(address _mAsset, address _basset, address _integration, bool _isTransferFeeCharged) external returns (uint8 index);
    function setBasketWeights(address _mAsset, address[] calldata _bassets, uint256[] calldata _weights) external;
    function setTransferFeesFlag(address _mAsset, address _bAsset, bool _flag) external;

    /** @dev Getters to retrieve Basket information */
    function getBasket(address _mAsset) external view returns (Basket memory b);
    function prepareForgeBasset(address _mAsset, address _token, bool _mint) external
        returns (ForgeProps memory props);
    function prepareForgeBassets(address _mAsset, uint32 _bitmap, uint8 _size, bool _mint) external
        returns (ForgePropsMulti memory props);
    function getBasset(address _mAsset, address _token) external view returns (Basset memory bAsset);
    function getBassets(address _mAsset) external view returns (Basset[] memory bAssets, uint32 bitmap, uint256 len);

    /** @dev Conversion functions */
    function getBitmapFor(address _mAsset, address[] calldata _bassets) external view returns (uint32 bitmap);

    /** @dev Recollateralisation */
    function handlePegLoss(address _mAsset, address _basset, bool _belowPeg) external returns (bool actioned);
    function negateIsolation(address _mAsset, address _basset) external;
}
