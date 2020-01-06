pragma solidity ^0.5.12;
pragma experimental ABIEncoderV2;

import { CommonHelpers } from "../shared/libs/CommonHelpers.sol";

import { IERC20 } from "./MassetToken.sol";
import { MassetCore, IManager, ISystok, IForgeLib, StableMath } from "./MassetCore.sol";
import { MassetStructs } from "./libs/MassetStructs.sol";

/**
 * @title MassetBasket
 * @dev Manages the Masset Basket composition and acts as a cache to store the Basket Assets (Bassets)
 */
contract MassetBasket is MassetStructs, MassetCore {

    /** @dev Struct holding Basket details */
    Basket public basket;

    /** @dev Forging events */
    event BassetAdded(address indexed basset);
    event BassetRemoved(address indexed basset);
    event BasketWeightsUpdated(address[] indexed bassets, uint256[] targetWeights);

    /** @dev constructor */
    constructor(
        address[] memory _bassets,
        bytes32[] memory _keys,
        uint256[] memory _weights,
        uint256[] memory _multiples
    )
        public
    {
        basket.collateralisationRatio = 1e18;
        basket.grace = 2e24; // 2,000,000 e18 == 2e24

        mintingFee = 0;
        redemptionFee = 2e16;

        for (uint256 i = 0; i < _bassets.length; i++) {
            _addBasset(_bassets[i], _keys[i], _multiples[i]);
        }
        _setBasketWeights(_bassets, _weights);
    }

    modifier basketIsHealthy(){
        require(!basket.failed, "Basket must be alive");
        _;
    }


    /***************************************
              RE-COLLATERALISATION
    ****************************************/

    /**
      * @dev Executes the Auto Redistribution event by isolating the Basset from the Basket
      * @param _basset Address of the ERC20 token to isolate
      * @param _belowPeg Bool to describe whether the basset deviated below peg (t) or above (f)
      * @return alreadyActioned Bool to show whether a Basset had already been actioned
      */
    function handlePegLoss(address _basset, bool _belowPeg)
    external
    onlyManager
    basketIsHealthy
    returns (bool alreadyActioned) {
        (bool exists, uint i) = _isAssetInBasket(_basset);
        require(exists, "Basset must exist in Basket");

        BassetStatus oldStatus = basket.bassets[i].status;
        BassetStatus newStatus = _belowPeg ? BassetStatus.BrokenBelowPeg : BassetStatus.BrokenAbovePeg;

        if(oldStatus == newStatus ||
          _bassetHasRecolled(oldStatus)) {
            return true;
        }

        // If we need to update the status.. then do it
        basket.bassets[i].status = newStatus;
        return false;
    }

    /**
      * @dev Negates the isolation of a given Basset
      * @param _basset Address of the Basset
      */
    function negatePegLoss(address _basset)
    external
    onlyManager {
        (bool exists, uint i) = _isAssetInBasket(_basset);
        require(exists, "Basset must exist in Basket");

        if(basket.bassets[i].status == BassetStatus.BrokenBelowPeg ||
          basket.bassets[i].status == BassetStatus.BrokenAbovePeg) {
            basket.bassets[i].status = BassetStatus.Normal;
        }
    }

    /**
      * @dev Sends the affected Basset off to the Recollateraliser to be auctioned
      * @param _basset Address of the Basset to isolate
      * @param _recollateraliser Address of the recollateraliser, to which the tokens should be sent
      */
    function initiateRecol(address _basset, address _recollateraliser)
    external
    onlyManager
    basketIsHealthy {
        (bool exists, uint i) = _isAssetInBasket(_basset);
        require(exists, "Basset must exist in Basket");

        (, , , , uint256 vaultBalance, BassetStatus status) = _getBasset(i);
        require(!_bassetHasRecolled(status), "Invalid Basset state");
        require(vaultBalance > 0, "Must have something to recollateralise");

        basket.bassets[i].targetWeight = 0;
        basket.bassets[i].status = BassetStatus.Liquidating;
        basket.bassets[i].vaultBalance = 0;

        // Approve the recollateraliser to take the Basset
        IERC20(_basset).approve(_recollateraliser, vaultBalance);

    }

    /**
      * @dev Completes the auctioning process for a given Basset
      * @param _basset Address of the ERC20 token to isolate
      * @param _unitsUnderCollateralised Masset units that we failed to recollateralise
      */
    function completeRecol(address _basset, uint256 _unitsUnderCollateralised)
    external
    onlyManager {
        (bool exists, uint i) = _isAssetInBasket(_basset);
        require(exists, "Basset must exist in Basket");

        (, , , , , BassetStatus status) = _getBasset(i);
        require(status == BassetStatus.Liquidating, "Invalid Basset state");

        if(_unitsUnderCollateralised > 0){
            // TODO - ERROR -  what if another Basset is auctioning.. that throws calcs off.
            // Should be Massets in circulation && units undercol rather than adding up vault
            uint256 unitsOfCollateralisation = 0;

            // Calc total Massets collateralised
            for(uint j = 0; j < basket.bassets.length; j++){
                if(basket.bassets[i].vaultBalance > 0){
                    uint ratioedBasset = basket.bassets[i].vaultBalance.mulRatioTruncate(basket.bassets[i].ratio);
                    unitsOfCollateralisation = unitsOfCollateralisation.add(ratioedBasset);
                }
            }

            // e.g. _unitsUnderCollateralised = 10e18
            // e.g. 1. if unitsOfCollateralisation = 90e18 && collateralisationRatio = 1e18 (first)
            // e.g. 2. if unitsOfCollateralisation = 90e18 && collateralisationRatio = 9e17 (concurrent finality)
            // e.g. 1. e = 90e18/1e18 = 90e18
            // e.g. 2. e = 90e18/9e17 = 100e18
            uint256 extrapolatedUnitsOfCollateralisation = unitsOfCollateralisation.divPrecisely(basket.collateralisationRatio);
            // e.g. 1. e = 90e18/100e18 = 9e17 (90%)
            // e.g. 2. e = 90e18/110e18 = 8.181..e17 (81.8181%)
            basket.collateralisationRatio = unitsOfCollateralisation.divPrecisely(extrapolatedUnitsOfCollateralisation.add(_unitsUnderCollateralised));

            basket.bassets[i].status = BassetStatus.Failed;
            basket.failed = true;
        } else {
            basket.bassets[i].status = BassetStatus.Liquidated;
            _removeBasset(_basset);
        }
    }


    /***************************************
                BASKET ADJUSTMENTS
    ****************************************/

    /**
      * @dev External func to allow the Manager to conduct add operations on the Basket
      * @param _basset Address of the ERC20 token to add to the Basket
      * @param _key Bytes32 key that will be used to lookup price in Oracle
      * @param _measurementMultiple MeasurementMultiple of the Basset where 1:1 == 1e8
      */
    function addBasset(address _basset, bytes32 _key, uint256 _measurementMultiple)
    external
    onlyGovernance
    basketIsHealthy {
        _addBasset(_basset, _key, _measurementMultiple);
    }

    /**
      * @dev Adds a basset to the Basket, fetching its decimals and calculating the Ratios
      * @param _basset Address of the ERC20 token to add to the Basket
      * @param _key Bytes32 key that will be used to lookup price in Oracle
      * @param _measurementMultiple base 1e8 var to determine measurement ratio between basset:masset
      * e.g. a Gold backed basset pegged to 1g where Masset is base 10g would be 1e7 (0.1:1)
      * e.g. a USD backed basset pegged to 1 USD where Masset is pegged to 1 USD would be 1e8 (1:1)
      */
    function _addBasset(address _basset, bytes32 _key, uint256 _measurementMultiple)
    internal {
        require(_basset != address(0), "Asset address must be valid.");
        (bool alreadyInBasket, ) = _isAssetInBasket(_basset);
        require(!alreadyInBasket, "Asset cannot already be in the basket.");

        // Check for ERC20 compatibility by forcing decimal retrieval
        // Ultimate enforcement of Basset validity should service through governance
        uint256 basset_decimals = CommonHelpers.mustGetDecimals(_basset);

        uint256 delta = uint256(18).sub(basset_decimals);

        uint256 ratio = _measurementMultiple.mul(10 ** delta);

        basket.bassets.push(Basset({
            addr: _basset,
            decimals: basset_decimals,
            key: _key,
            ratio: ratio,
            targetWeight: 0,
            vaultBalance: 0,
            status: BassetStatus.Normal
        }));

        emit BassetAdded(_basset);
    }

    /**
      * @dev Removes a specific Asset from the Basket, given that its target/collateral level is 0
      * As this is a cleanup operation, anybody should be able to perform this task
      * @param _assetToRemove The asset to remove from the basket
      * @return bool To signify whether the asset was found and removed from the basket
      */
    function removeBasset(address _assetToRemove)
    external
    basketIsHealthy
    returns (bool removed) {
        _removeBasset(_assetToRemove);
        return true;
    }

    function _removeBasset(address _assetToRemove)
    internal {
        (bool existsInBasket, uint index) = _isAssetInBasket(_assetToRemove);
        require(existsInBasket, "Asset must appear in Basket");

        uint len = basket.bassets.length;

        Basset memory basset = basket.bassets[index];
        require(basset.targetWeight == 0, "Basset must have a target weight of 0");
        require(basset.vaultBalance == 0, "Basset vault must be completely empty");
        require(basset.status != BassetStatus.Liquidating, "Basset must be active");

        basket.bassets[index] = basket.bassets[len-1];
        basket.bassets.length--;

        basket.expiredBassets.push(_assetToRemove);

        emit BassetRemoved(_assetToRemove);
    }

    /**
      * @dev External call to set weightings of a new Basket
      * @param _bassets Array of Basset addresses
      * @param _weights Array of Basset weights - summing 100% where 100% == 1e18
      */
    function setBasketWeights(
        address[] calldata _bassets,
        uint256[] calldata _weights
    )
        external
        onlyGovernance
        basketIsHealthy
    {
        _setBasketWeights(_bassets, _weights);
    }


    /**
      * @notice Sets new Basket weightings
      * @dev Requires the Basket to be in a healthy state, i.e. no Broken assets
      * @param _bassets Array of Basset addresses
      * @param _weights Array of Basset weights - summing 100% where 100% == 1e18
      */
    function _setBasketWeights(
        address[] memory _bassets,
        uint256[] memory _weights
    )
        internal
    {
        uint256 bassetCount = _bassets.length;

        require(bassetCount == _weights.length, "Must be matching basset data arrays");
        require(bassetCount == basket.bassets.length, "Must be matching existing basket layout");

        uint256 weightSum = CommonHelpers.sumOfArrayValues(_weights);
        require(weightSum == StableMath.getScale(), "Basket weight must total 100% == 1");

        for (uint256 i = 0; i < bassetCount; i++) {
            address basset = _bassets[i];

            require(basset == basket.bassets[i].addr, "Basset must be represented symmetrically");

            require(basket.bassets[i].status == BassetStatus.Normal, "Basket must not contain broken assets");

            uint256 bassetWeight = _weights[i];
            require(bassetWeight >= 0, "Weight must be positive");
            require(bassetWeight <= StableMath.getScale(), "Asset weight must be less than or equal to 1");

            basket.bassets[i].targetWeight = bassetWeight;
        }

        emit BasketWeightsUpdated(_bassets, _weights);
    }

    /**
      * @dev Set the basket grace value
      * @param _grace The distance from net target weight in which post does not need to be closer than pre (where 100% == 1e18)
      */
    function setBasketGrace(
        uint256 _grace
    )
        external
        onlyGovernance
        basketIsHealthy
    {
        require(_grace >= minGrace, "Grace value must be under a certain max threshold");
        basket.grace = _grace;
    }


    /*************************************
    ************   GETTERS   *************
    *************************************/

    /**
      * @dev Get basket details
      * @return All the details
      */
    function getBasket()
    external
    view
    returns (
        address[] memory expiredBassets,
        uint256 grace,
        bool failed,
        uint256 collateralisationRatio
    ) {
        return (basket.expiredBassets, basket.grace, basket.failed, basket.collateralisationRatio);
    }

    /**
      * @dev Get all basket assets
      * @return Struct array of all basket assets
      */
    function getBassets()
    external
    view
    returns (
        address[] memory addresses,
        bytes32[] memory keys,
        uint256[] memory ratios,
        uint256[] memory targets,
        uint256[] memory vaults,
        BassetStatus[] memory statuses
    ) {
        uint256 len = basket.bassets.length;

        addresses = new address[](len);
        keys = new bytes32[](len);
        ratios = new uint256[](len);
        targets = new uint256[](len);
        vaults = new uint256[](len);
        statuses = new BassetStatus[](len);

        for(uint i = 0; i < len; i++){
            (addresses[i], keys[i], ratios[i], targets[i], vaults[i], statuses[i]) = _getBasset(i);
        }
    }

    /**
      * @dev Get all basket assets
      * @return Struct array of all basket assets
      */
    function _getBasset(uint256 _bassetIndex)
    internal
    view
    returns (
        address addr,
        bytes32 key,
        uint256 ratio,
        uint256 targetWeight,
        uint256 vaultBalance,
        BassetStatus status
    ) {
        Basset memory b = basket.bassets[_bassetIndex];
        return (b.addr, b.key, b.ratio, b.targetWeight, b.vaultBalance, b.status);
    }

    /**
      * @dev Get all basket assets, failing if the Basset does not exist
      * @return Struct array of all basket assets
      */
    function getBasset(address _basset)
    public
    view
    returns (
        address addr,
        bytes32 key,
        uint256 ratio,
        uint256 targetWeight,
        uint256 vaultBalance,
        BassetStatus status
    ) {
        (bool exists, uint index) = _isAssetInBasket(_basset);
        require(exists, "Basset must exist");
        return _getBasset(index);
    }

    /**
      * @dev Checks if a particular asset is in the basket
      * @param _asset Address of Basset to look for
      * @return bool to signal that the asset is in basket
      * @return uint Index of the Basset
      */
    function _isAssetInBasket(address _asset)
    internal
    view
    returns (bool exists, uint index) {
        uint256 arrayLength = basket.bassets.length;
        for (uint256 i = 0; i < arrayLength; i++) {
            if (_asset == basket.bassets[i].addr) {
                return (true, i);
            }
        }
        return (false, 0);
    }

    /**
     * @notice Determine whether or not a Basset has already undergone re-collateralisation
     */
    function _bassetHasRecolled(BassetStatus _status)
    internal
    pure
    returns (bool) {
      if(_status == BassetStatus.Liquidating ||
          _status == BassetStatus.Liquidated ||
          _status == BassetStatus.Failed) {
          return true;
      }
      return false;
    }
}
