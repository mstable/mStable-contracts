pragma solidity ^0.5.12;

import { IManager } from "./IManager.sol";
import { ISystok } from "./ISystok.sol";

import { MassetStructs } from "../masset/shared/MassetStructs.sol";

/**
 * @title IMasset
 * @dev (Internal) Interface for interacting with Masset
 */
contract IMasset is MassetStructs {

    // function mint(uint256[] calldata _bassetQuantity, address _recipient) external returns (uint256 massetMinted);
    function mintTo(uint256[] calldata _bassetQuantity, address _recipient) external returns (uint256 massetMinted);
    function mintTo(address _basset, uint256 _bassetQuantity, address _recipient) external returns (uint256 massetMinted);

    /** @dev Setters for the Manager or Gov to update module info */
    function upgradeForgeValidator(address _newForgeValidator) external;

    /** @dev Setters for Gov to set system params */
    function setRedemptionFee(uint256 _redemptionFee) external;
    function setFeePool(address _feePool) external;

    /** @dev Setters for Gov to update Basket composition */
    function addBasset(address _basset, bytes32 _key) external;
    function addBasset(address _basset, bytes32 _key, uint256 _measurementMultiple) external;
    function setBasketWeights(address[] calldata _bassets, uint256[] calldata _weights) external;

    /** @dev Recollateralisation */
    function handlePegLoss(address _basset, bool _belowPeg) external returns (bool actioned);
    function negatePegLoss(address _basset) external;
    function initiateRecol(address _basset, address _recollateraliser) external;
    function completeRecol(address _basset, uint256 _unitsUnderCollateralised) external;

    /** @dev Public cleanup function to get rid of finished Bassets */
    function removeBasset(address _assetToRemove) external returns (bool);

    /** @dev Getters to retrieve Basket information */
    function getBasket()
    external
    view
    returns (
        address[] memory expiredBassets,
        bool failed,
        uint256 collateralisationRatio);
    function getBassets()
        external
        view
        returns (
            address[] memory addresses,
            bytes32[] memory keys,
            uint256[] memory ratios,
            uint256[] memory weights,
            uint256[] memory vaults,
            BassetStatus[] memory statuses
        );
    function getBasset(address _basset)
        external
        view
        returns (
            address addr,
            bytes32 key,
            uint256 ratio,
            uint256 weight,
            uint256 vaultBalance,
            BassetStatus status
        );
}
