pragma solidity 0.5.16;
pragma experimental ABIEncoderV2;

// Internal
import { MassetStructs } from "./shared/MassetStructs.sol";
import { Module } from "../shared/Module.sol";
import { IBasketManager } from "../interfaces/IBasketManager.sol";

// Libs
import { CommonHelpers } from "../shared/libs/CommonHelpers.sol";
import { IERC20 } from "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "openzeppelin-solidity/contracts/token/ERC20/SafeERC20.sol";
import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";
import { StableMath } from "../shared/StableMath.sol";

/**
 * @title MassetBasket
 * @dev Manages the Masset Basket composition and acts as a cache to store the Basket Assets (Bassets)
 */
contract BasketManager is IBasketManager, Module {

    using SafeMath for uint256;
    using StableMath for uint256;
    using SafeERC20 for IERC20;

    /** @dev Basket Manager Version */
    string public constant version = "1.0";

    /** @dev Struct holding Basket details */
    Basket public basket;
    // Mapping holds bAsset token address => integration address => index
    mapping(address => mapping(address => uint256)) private bassetsMap;

    address public mAsset;

    /** @dev Basket composition events */
    event BassetAdded(address indexed basset, address integrator);
    event BassetRemoved(address indexed basset, address integrator);
    event BasketWeightsUpdated(address[] indexed bassets, uint256[] maxWeights);

    /** @dev constructor */
    constructor(
        address _nexus,
        address _mAsset,
        address[] memory _bassets,
        address[] memory _integrators,
        uint256[] memory _weights,
        bool[] memory _hasTransferFees
    )
        Module(_nexus)
        public
    {
        mAsset = _mAsset;
        require(_bassets.length > 0, "Must initialise with some bAssets");

        // Defaults
        basket.maxBassets = 16;               // 16
        basket.collateralisationRatio = 1e18; // 100%

        for (uint256 i = 0; i < _bassets.length; i++) {
            _addBasset(
                _bassets[i],
                _integrators[i],
                StableMath.getRatioScale(),
                _hasTransferFees[i]
                );
        }
        _setBasketWeights(_bassets, _weights);
    }

    modifier basketIsHealthy(){
        require(!basket.failed, "Basket must be alive");
        _;
    }

    /**
      * @dev Verifies that the caller either Manager or Gov
      */
    modifier managerOrGovernor() {
        require(_manager() == msg.sender || _governor() == msg.sender, "Must be manager or governance");
        _;
    }

    /**
      * @dev Verifies that the caller either Manager or Gov
      */
    modifier onlyMasset() {
        require(mAsset == msg.sender, "Must be called by mAsset");
        _;
    }

    /***************************************
                    VAULT BALANCE
    ****************************************/

    function increaseVaultBalance(uint8 _bAsset, uint256 _increaseAmount)
        external
        onlyMasset
    {
        require(basket.bassets.length > _bAsset, "bAsset does not exist");
        basket.bassets[_bAsset].vaultBalance = basket.bassets[_bAsset].vaultBalance.add(_increaseAmount);
    }

    function decreaseVaultBalance(uint8 _bAsset, uint256 _decreaseAmount)
        external
        onlyMasset
    {
        require(basket.bassets.length > _bAsset, "bAsset does not exist");
        basket.bassets[_bAsset].vaultBalance = basket.bassets[_bAsset].vaultBalance.sub(_decreaseAmount);
    }

    function logInterest(uint256[] calldata gains)
        external
        onlyMasset
        returns (bool isValid)
    {
        uint256 len = gains.length;
        require(len == basket.bassets.length, "Must be valid array");
        for(uint256 i = 0; i < len; i++){
            basket.bassets[i].vaultBalance = basket.bassets[i].vaultBalance.add(gains[i]);
        }
        return true;
    }


    /***************************************
                BASKET ADJUSTMENTS
    ****************************************/

    /**
      * @dev External func to allow the Manager to conduct add operations on the Basket
      * @param _basset Address of the ERC20 token to add to the Basket
      */
    function addBasset(address _basset, address _integration, bool _isTransferFeeCharged)
        external
        onlyGovernor
        basketIsHealthy
    {
        _addBasset(_basset, _integration, StableMath.getRatioScale(), _isTransferFeeCharged);
    }

    /**
      * @dev Adds a basset to the Basket, fetching its decimals and calculating the Ratios
      * @param _basset Address of the ERC20 token to add to the Basket
      * @param _integration Address of the Platform Integration
      * @param _measurementMultiple base 1e8 var to determine measurement ratio between basset:masset
      * e.g. a Gold backed basset pegged to 1g where Masset is base 10g would be 1e7 (0.1:1)
      * e.g. a USD backed basset pegged to 1 USD where Masset is pegged to 1 USD would be 1e8 (1:1)
      */
    function _addBasset(
        address _basset,
        address _integration,
        uint256 _measurementMultiple,
        bool _isTransferFeeCharged
    )
        internal
    {
        require(_basset != address(0), "Asset address must be valid");
        require(_integration != address(0), "Asset address must be valid");
        (bool alreadyInBasket, ) = _isAssetInBasket(_basset, _integration);
        require(!alreadyInBasket, "Asset already exists in Basket");

        // require(
        //     IManager(_manager()).validateBasset(address(this), _basset, _measurementMultiple, _isTransferFeeCharged),
        //     "New bAsset must be valid"
        // );

        // Check for ERC20 compatibility by forcing decimal retrieval
        // Ultimate enforcement of Basset validity should service through governance & manager
        uint256 basset_decimals = CommonHelpers.mustGetDecimals(_basset);

        uint256 delta = uint256(18).sub(basset_decimals);

        uint256 ratio = _measurementMultiple.mul(10 ** delta);

        uint256 numberOfBassetsInBasket = basket.bassets.length;
        require(numberOfBassetsInBasket < basket.maxBassets, "Max bAssets in Basket");

        bassetsMap[_basset][_integration] = numberOfBassetsInBasket;

        basket.bassets.push(Basset({
            addr: _basset,
            integrator: _integration,
            ratio: ratio,
            maxWeight: 0,
            vaultBalance: 0,
            status: BassetStatus.Normal,
            isTransferFeeCharged: _isTransferFeeCharged
        }));

        emit BassetAdded(_basset, _integration);
    }

    /**
     * @dev Update transfer fee flag
     * @param _bAsset bAsset address
     * @param _flag Charge transfer fee when its set to 'true', otherwise 'false'
     */
    function setTransferFeesFlag(address _bAsset, bool _flag)
        external
        managerOrGovernor
    {
        uint256 len = basket.bassets.length;
        // Cycle through all bAssets and set flag dependent on bAsset addr
        for(uint256 i = 0; i < len; i++){
            if(basket.bassets[i].addr == _bAsset){
                basket.bassets[i].isTransferFeeCharged = _flag;
            }
        }
    }

    /**
      * @dev Removes a specific Asset from the Basket, given that its target/collateral level is 0
      * As this is a cleanup operation, anybody should be able to perform this task
      * @param _assetToRemove The asset to remove from the basket
      * @return bool To signify whether the asset was found and removed from the basket
      */
    function removeBasset(uint8 _assetToRemove)
        external
        basketIsHealthy
        managerOrGovernor
        returns (bool removed)
    {
        _removeBasset(_assetToRemove);
        return true;
    }

    function _removeBasset(uint8 _assetToRemove)
    internal {
        uint256 len = basket.bassets.length;
        require(len > _assetToRemove, "Basset does not exist");

        Basset memory basset = basket.bassets[_assetToRemove];
        // require(basset.maxWeight == 0, "bASset must have a target weight of 0");
        require(basset.vaultBalance == 0, "bASset vault must be empty");
        require(basset.status != BassetStatus.Liquidating, "bASset must be active");

        basket.bassets[_assetToRemove] = basket.bassets[len-1];
        basket.bassets.pop();

        // require(bassetsMap[basset.addr][basset.integration] )
        // TODO - come back to this to validate
        bassetsMap[basset.addr][basset.integrator] = 0;

        emit BassetRemoved(basset.addr, basset.integrator);
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
        uint256 len = basket.bassets.length;
        for(uint32 i = 0; i < len; i++) {
            bitmap |= uint32(2)**i;
        }
    }

    /**
     * @dev Returns the bitmap for given bAssets addresses
     * @param _bassets bAsset addresses for which bitmap is needed
     * @return bitmap with bits set according to bAsset address position
     */
    function getBitmapFor(uint8[] calldata _bassets) external view returns (uint32 bitmap) {
        uint256 len = basket.bassets.length;
        for(uint32 i = 0; i < _bassets.length; i++) {
            require(len > _bassets[i], "bAsset does not exist");
            bitmap |= uint32(2)**uint8(_bassets[i]);
        }
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
        external
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
        Basket memory b
    ) {
        return basket;
    }

    /**
      * @dev Get all basket assets
      * @return Struct array of all basket assets
      */
    function getBassets()
    external
    view
    returns (
        Basset[] memory bAssets,
        uint32 bitmap,
        uint256 len
    ) {
        len = basket.bassets.length;

        bAssets = new Basset[](len);

        for(uint256 i = 0; i < len; i++){
            bitmap |= uint32(2)**uint8(i);
            bAssets[i] = _getBasset(i);
        }
    }

    /**
      * @dev Get all basket assets, failing if the Basset does not exist
      * @return Struct array of all basket assets
      */
    function getBasset(uint8 _basset)
        external
        view
        returns (
            Basset memory bAsset
        )
    {
        require(basket.bassets.length > _basset, "Basset does not exist");
        return _getBasset(_basset);
    }

    /**
      * @dev Get all basket assets
      * @return Struct array of all basket assets
      */
    function _getBasset(uint256 _bassetIndex)
        internal
        view
        returns (
            Basset memory bAsset
        )
    {
        bAsset = basket.bassets[_bassetIndex];
    }

    /**
      * @dev Checks if a particular asset is in the basket
      * @param _asset Address of Basset to look for
      * @return bool to signal that the asset is in basket
      * @return uint256 Index of the Basset
      */
    function _isAssetInBasket(address _asset, address _integrator)
        internal
        view
        returns (bool exists, uint256 index)
    {
        index = bassetsMap[_asset][_integrator];
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


    /***************************************
                RE-COLLATERALISATION
    ****************************************/

    /**
      * @dev Executes the Auto Redistribution event by isolating the Basset from the Basket
      * @param _bAsset Address of the ERC20 token to isolate
      * @param _belowPeg Bool to describe whether the basset deviated below peg (t) or above (f)
      * @return alreadyActioned Bool to show whether a Basset had already been actioned
      */
    function handlePegLoss(uint8 _bAsset, bool _belowPeg)
        external
        managerOrGovernor
        basketIsHealthy
        returns (bool alreadyActioned)
    {
        require(basket.bassets.length > _bAsset, "bAsset does not exist");

        BassetStatus oldStatus = basket.bassets[_bAsset].status;
        BassetStatus newStatus = _belowPeg ? BassetStatus.BrokenBelowPeg : BassetStatus.BrokenAbovePeg;

        if(oldStatus == newStatus ||
            _bassetHasRecolled(oldStatus)) {
            return true;
        }

        // If we need to update the status.. then do it
        basket.bassets[_bAsset].status = newStatus;

        return false;
    }

    /**
      * @dev Negates the isolation of a given Basset
      * @param _bAsset Address of the Basset
      */
    function negateIsolation(uint8 _bAsset)
    external
    managerOrGovernor {
        require(basket.bassets.length > _bAsset, "bAsset does not exist");

        BassetStatus currentStatus = basket.bassets[_bAsset].status;
        if(currentStatus == BassetStatus.BrokenBelowPeg ||
            currentStatus == BassetStatus.BrokenAbovePeg ||
            currentStatus == BassetStatus.Blacklisted) {
            basket.bassets[_bAsset].status = BassetStatus.Normal;
        }
    }
}
