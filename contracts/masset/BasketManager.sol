pragma solidity 0.5.16;
pragma experimental ABIEncoderV2;

import { CommonHelpers } from "../shared/libs/CommonHelpers.sol";

import { MassetStructs } from "./shared/MassetStructs.sol";
import { Module } from "../shared/Module.sol";

import { IERC20 } from "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "openzeppelin-solidity/contracts/token/ERC20/SafeERC20.sol";
import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";

/**
 * @title MassetBasket
 * @dev Manages the Masset Basket composition and acts as a cache to store the Basket Assets (Bassets)
 */
contract BasketManager is Module, MassetStructs {

    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    /** @dev Struct holding Basket details */
    Basket public basket;
    bool public measurementMultipleEnabled;

    /** @dev Forging events */
    event BassetAdded(address indexed basset);
    event BassetRemoved(address indexed basset);
    event BasketWeightsUpdated(address[] indexed bassets, uint256[] maxWeights);

    /** @dev constructor */
    constructor(
        address _nexus,
        address[] memory _bassets,
        uint256[] memory _weights,
        uint256[] memory _multiples,
        bool[] memory _hasTransferFees
    )
        MassetCore(_nexus)
        internal
    {
        require(_bassets.length > 0, "Must initialise with some bAssets");

        measurementMultipleEnabled = _multiples.length > 0;

        // Defaults
        basket.maxBassets = 16;               // 16
        basket.collateralisationRatio = 1e18; // 100%
        redemptionFee = 2e16;                 // 2%

        for (uint256 i = 0; i < _bassets.length; i++) {
            _addBasset(
                _bassets[i],
                measurementMultipleEnabled ? _multiples[i] : StableMath.getRatioScale(),
                _hasTransferFees[i]
                );
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
        returns (bool alreadyActioned)
    {
        (bool exists, uint256 i) = _isAssetInBasket(_basset);
        require(exists, "bASset must exist in Basket");

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
    function negateIsolation(address _basset)
    external
    managerOrGovernor {
        (bool exists, uint256 i) = _isAssetInBasket(_basset);
        require(exists, "bASset must exist in Basket");

        BassetStatus currentStatus = basket.bassets[i].status;
        if(currentStatus == BassetStatus.BrokenBelowPeg ||
          currentStatus == BassetStatus.BrokenAbovePeg ||
          currentStatus == BassetStatus.Blacklisted) {
            basket.bassets[i].status = BassetStatus.Normal;
        }
    }

    /**
      * @dev Sends the affected Basset off to the Recollateraliser to be auctioned
      * @param _basset Address of the Basset to isolate
      */
    function initiateRecol(address _basset)
        external
        managerOrGovernor
        basketIsHealthy
        returns (bool requiresAuction, bool isTransferable)
    {
        (bool exists, uint256 i) = _isAssetInBasket(_basset);
        require(exists, "bASset must exist in Basket");

        (, , , uint256 vaultBalance, , BassetStatus status) = _getBasset(i);
        require(!_bassetHasRecolled(status), "Invalid Basset state");

        // Blist -> require status to == BList || BrokenPeg

        // If vaultBalance is 0 and we want to recol, then just remove from Basket
        // Ensure removal possible
        if(vaultBalance == 0){
            _removeBasset(_basset);
            return (false, false);
        }

        basket.bassets[i].status = BassetStatus.Liquidating;
        basket.bassets[i].vaultBalance = 0;

        // Blist -> If status == Blist then return true, else
        // If status == brokenPeg then call Approve
        // req re-collateraliser != address(0)
        // req approve 0 then approve

        // Approve the recollateraliser to take the Basset
        IERC20(_basset).approve(_recollateraliser(), vaultBalance);
        return (true, true);
    }

    /**
     * @dev Completes the auctioning process for a given Basset
     * @param _basset Address of the ERC20 token to isolate
     * @param _unitsUnderCollateralised Masset units that we failed to recollateralise
     */
    function completeRecol(address _basset, uint256 _unitsUnderCollateralised)
        external
        onlyManager
    {
        (bool exists, uint256 i) = _isAssetInBasket(_basset);
        require(exists, "bAsset must exist in Basket");

        (, , , , , BassetStatus status) = _getBasset(i);
        require(status == BassetStatus.Liquidating, "Invalid Basset state");
        basket.bassets[i].maxWeight = 0;
        basket.bassets[i].vaultBalance = 0;

        if(_unitsUnderCollateralised > 0){
            uint256 massetSupply = this.totalSupply();
            // e.g. 1. c = 100e24 * 1e18 = 100e24
            // e.g. 2. c = 100e24 * 9e17 =  90e24
            uint256 collateralisedMassets = massetSupply.mulTruncate(basket.collateralisationRatio);
            // e.g. 1. c = (100e24 - 5e24)*1e18 / 100e24 = 95e42/100e24 = 95e16
            // e.g. 2. c = ( 90e24 - 5e24)*1e18 / 100e24 = 85e16
            basket.collateralisationRatio = (collateralisedMassets.sub(_unitsUnderCollateralised)).divPrecisely(massetSupply);
            basket.bassets[i].status = BassetStatus.Failed;
            basket.failed = true;
            _removeBasset(_basset);
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
      */
    function addBasset(address _basset, bool _isTransferFeeCharged)
        external
        managerOrGovernor
        basketIsHealthy
    {
        require(!measurementMultipleEnabled, "Specifying _mm enabled");
        _addBasset(_basset, StableMath.getRatioScale(), _isTransferFeeCharged);
    }

    /**
      * @dev External func to allow the Manager to conduct add operations on the Basket
      * @param _basset Address of the ERC20 token to add to the Basket
      * @param _measurementMultiple MeasurementMultiple of the Basset where 1:1 == 1e8
      */
    function addBasset(
        address _basset,
        uint256 _measurementMultiple,
        bool _isTransferFeeCharged
    )
        external
        managerOrGovernor
        basketIsHealthy
    {
        require(measurementMultipleEnabled, "Specifying _mm disabled");
        _addBasset(_basset, _measurementMultiple, _isTransferFeeCharged);
    }

    /**
      * @dev Adds a basset to the Basket, fetching its decimals and calculating the Ratios
      * @param _basset Address of the ERC20 token to add to the Basket
      * @param _measurementMultiple base 1e8 var to determine measurement ratio between basset:masset
      * e.g. a Gold backed basset pegged to 1g where Masset is base 10g would be 1e7 (0.1:1)
      * e.g. a USD backed basset pegged to 1 USD where Masset is pegged to 1 USD would be 1e8 (1:1)
      */
    function _addBasset(
        address _basset,
        uint256 _measurementMultiple,
        bool _isTransferFeeCharged
    )
        internal
    {
        require(_basset != address(0), "Asset address must be valid");
        (bool alreadyInBasket, ) = _isAssetInBasket(_basset);
        require(!alreadyInBasket, "Asset already exists in Basket");

        require(
            IManager(_manager()).validateBasset(address(this), _basset, _measurementMultiple, _isTransferFeeCharged),
            "New bAsset must be valid"
        );

        // Check for ERC20 compatibility by forcing decimal retrieval
        // Ultimate enforcement of Basset validity should service through governance
        uint256 basset_decimals = CommonHelpers.mustGetDecimals(_basset);

        uint256 delta = uint256(18).sub(basset_decimals);

        uint256 ratio = _measurementMultiple.mul(10 ** delta);

        uint256 numberOfBassetsInBasket = basket.bassets.length;
        require(numberOfBassetsInBasket < basket.maxBassets, "Max bAssets in Basket");

        basket.bassetsMap[_basset] = numberOfBassetsInBasket;

        basket.bassets.push(Basset({
            addr: _basset,
            ratio: ratio,
            maxWeight: 0,
            vaultBalance: 0,
            status: BassetStatus.Normal,
            isTransferFeeCharged: _isTransferFeeCharged
        }));

        emit BassetAdded(_basset);
    }

    /**
     * @dev Update transfer fee flag
     * @param _bAsset bAsset address
     * @param _flag Charge transfer fee when its set to 'true', otherwise 'false'
     */
    function upgradeTransferFees(address _bAsset, bool _flag)
        external
        onlyGovernor
    {
        (bool exist, uint256 index) = _isAssetInBasket(_bAsset);
        require(exist, "bAsset does not exist");
        basket.bassets[index].isTransferFeeCharged = _flag;
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
        managerOrGovernor
        returns (bool removed)
    {
        _removeBasset(_assetToRemove);
        return true;
    }

    function _removeBasset(address _assetToRemove)
    internal {
        (bool existsInBasket, uint256 index) = _isAssetInBasket(_assetToRemove);
        require(existsInBasket, "Asset must appear in Basket");

        uint256 len = basket.bassets.length;

        Basset memory basset = basket.bassets[index];
        // require(basset.maxWeight == 0, "bASset must have a target weight of 0");
        require(basset.vaultBalance == 0, "bASset vault must be empty");
        require(basset.status != BassetStatus.Liquidating, "bASset must be active");

        basket.bassets[index] = basket.bassets[len-1];
        basket.bassets.pop();

        basket.bassetsMap[_assetToRemove] = 0;

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
        onlyGovernor
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

        require(bassetCount == _weights.length, "Must be matching basset arrays");
        require(bassetCount == basket.bassets.length, "Must match existing basket");

        uint256 weightSum = CommonHelpers.sumOfArrayValues(_weights);
        require(weightSum >= StableMath.getFullScale(), "Basket weight must be >= 1e18");

        for (uint256 i = 0; i < bassetCount; i++) {
            address basset = _bassets[i];

            require(basset == basket.bassets[i].addr, "Input must be symmetrical");

            uint256 bassetWeight = _weights[i];
            if(basket.bassets[i].status == BassetStatus.Normal) {
                require(bassetWeight >= 0, "Weight must be positive");
                require(bassetWeight <= StableMath.getFullScale(), "Asset weight must be <= 1e18");
                basket.bassets[i].maxWeight = bassetWeight;
            } else {
                require(bassetWeight == basket.bassets[i].maxWeight, "Affected bAssets must be static");
            }
        }

        emit BasketWeightsUpdated(_bassets, _weights);
    }


    /***************************************
                    HELPERS
    ****************************************/

    /**
     * @dev Get bitmap for all bAsset addresses
     * @return bitmap with bits set according to bAsset address position
     */
    function getBitmapForAllBassets() external view returns (uint32 bitmap) {
        for(uint32 i = 0; i < basket.bassets.length; i++) {
            bitmap |= uint32(2)**i;
        }
    }

    /**
     * @dev Returns the bitmap for given bAssets addresses
     * @param _bassets bAsset addresses for which bitmap is needed
     * @return bitmap with bits set according to bAsset address position
     */
    function getBitmapFor(address[] calldata _bassets) external view returns (uint32 bitmap) {
        for(uint32 i = 0; i < _bassets.length; i++) {
            (bool exist, uint256 idx) = _isAssetInBasket(_bassets[i]);
            if(exist) bitmap |= uint32(2)**uint8(idx);
        }
    }

    /**
     * @dev Convert bitmap representing bAssets location to bAssets addresses
     * @param _bitmap bits set in bitmap represents which bAssets to use
     * @param _size size of bAssets array
     * @return array of bAssets array
     */
    function convertBitmapToBassetsAddress(uint32 _bitmap, uint8 _size) external view returns (address[] memory) {
        uint8[] memory indexes = _convertBitmapToIndexArr(_bitmap, _size);
        address[] memory bAssets = new address[](_size);
        for(uint8 i = 0; i < indexes.length; i++) {
            bAssets[i] = basket.bassets[indexes[i]].addr;
        }
        return bAssets;
    }


    /**
     * @dev Convert bitmap representing bAssets location to Bassets array
     * @param _bitmap bits set in bitmap represents which bAssets to use
     * @param _size size of bAssets array
     * @return array of Basset array
     */
    function convertBitmapToBassets(
        uint32 _bitmap,
        uint8 _size
    )
        public
        view
        returns (Basset[] memory, uint8[] memory)
    {
        uint8[] memory indexes = _convertBitmapToIndexArr(_bitmap, _size);
        Basset[] memory bAssets = new Basset[](_size);
        for(uint8 i = 0; i < indexes.length; i++) {
            bAssets[i] = basket.bassets[indexes[i]];
        }
        return (bAssets, indexes);
    }


    /**
     * @dev Convert the given bitmap into an array representing bAssets index location in the array
     * @param _bitmap bits set in bitmap represents which bAssets to use
     * @param _size size of the bassetsQuantity array
     * @return array having indexes of each bAssets
     */
    function _convertBitmapToIndexArr(uint32 _bitmap, uint8 _size) internal view returns (uint8[] memory) {
        uint8[] memory indexes = new uint8[](_size);
        uint8 idx = 0;
        // Assume there are 4 bAssets in array
        // size = 2
        // bitmap   = 00000000 00000000 00000000 00001010
        // mask     = 00000000 00000000 00000000 00001000 //mask for 4th pos
        // isBitSet = 00000000 00000000 00000000 00001000 //checking 4th pos
        // indexes  = [1, 3]
        uint256 len = basket.bassets.length;
        for(uint8 i = 0; i < len; i++) {
            uint32 mask = uint32(2)**i;
            uint32 isBitSet = _bitmap & mask;
            if(isBitSet >= 1) indexes[idx++] = i;
        }
        require(idx == _size, "Found incorrect elements");
        return indexes;
    }

    function _transferTokens(
        address _basset,
        bool _isFeeCharged,
        uint256 _qty
    )
        internal
        returns (uint256 receivedQty)
    {
        receivedQty = _qty;
        if(_isFeeCharged) {
            uint256 balBefore = IERC20(_basset).balanceOf(address(this));
            IERC20(_basset).safeTransferFrom(msg.sender, address(this), _qty);
            uint256 balAfter = IERC20(_basset).balanceOf(address(this));
            receivedQty = StableMath.min(_qty, balAfter.sub(balBefore));
        } else {
            IERC20(_basset).safeTransferFrom(msg.sender, address(this), _qty);
        }
    }


    /***************************************
                    GETTERS
    ****************************************/

    /**
      * @dev Get basket details
      * @return All the details
      */
    function getBasket()
    external
    view
    returns (
        uint256 masBassets,
        bool failed,
        uint256 collateralisationRatio
    ) {
        return (basket.masBassets, basket.failed, basket.collateralisationRatio);
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
        uint256[] memory ratios,
        uint256[] memory targets,
        uint256[] memory vaults,
        bool[] memory isTransferFeeCharged,
        BassetStatus[] memory statuses,
        uint256 len
    ) {
        len = basket.bassets.length;

        addresses = new address[](len);
        ratios = new uint256[](len);
        targets = new uint256[](len);
        vaults = new uint256[](len);
        isTransferFeeCharged = new bool[](len);
        statuses = new BassetStatus[](len);

        for(uint256 i = 0; i < len; i++){
            (addresses[i], ratios[i], targets[i], vaults[i], isTransferFeeCharged[i], statuses[i]) = _getBasset(i);
        }
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
            uint256 ratio,
            uint256 maxWeight,
            uint256 vaultBalance,
            bool isTransferFeeCharged,
            BassetStatus status
        )
    {
        (bool exists, uint256 index) = _isAssetInBasket(_basset);
        require(exists, "bASset must exist");
        return _getBasset(index);
    }

    /**
     * @dev Get all bAssets addresses
     * @return return an array of bAssets addresses
     */
    function getAllBassetsAddress()
        public
        view
        returns (address[] memory)
    {
        uint256 len = basket.bassets.length;
        address[] memory bAssets = new address[](len);
        for(uint256 i = 0; i < len; i++) {
            bAssets[i] = basket.bassets[i].addr;
        }
        return bAssets;
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
            uint256 ratio,
            uint256 maxWeight,
            uint256 vaultBalance,
            bool isTransferFeeCharged,
            BassetStatus status
        )
    {
        Basset memory b = basket.bassets[_bassetIndex];
        return (b.addr, b.ratio, b.maxWeight, b.vaultBalance, b.isTransferFeeCharged, b.status);
    }


    /**
      * @dev Checks if a particular asset is in the basket
      * @param _asset Address of Basset to look for
      * @return bool to signal that the asset is in basket
      * @return uint256 Index of the Basset
      */
    function _isAssetInBasket(address _asset)
        internal
        view
        returns (bool exists, uint256 index)
    {
        index = basket.bassetsMap[_asset];
        if(index == 0) {
            if(basket.bassets.length == 0){
                return (false, 0);
            }
            return (basket.bassets[0].addr == _asset, 0);
        }
        return (true, index);
    }

    /**
     * @notice Determine whether or not a Basset has already undergone re-collateralisation
     */
    function _bassetHasRecolled(BassetStatus _status)
        internal
        pure
        returns (bool)
    {
        if(_status == BassetStatus.Liquidating ||
            _status == BassetStatus.Liquidated ||
            _status == BassetStatus.Failed) {
            return true;
        }
        return false;
    }
}
