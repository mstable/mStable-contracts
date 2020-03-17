pragma solidity 0.5.16;
pragma experimental ABIEncoderV2;

// External
import { IPlatformIntegration } from "../interfaces/IPlatformIntegration.sol";

// Internal
import { Module } from "../shared/Module.sol";
import { IBasketManager } from "../interfaces/IBasketManager.sol";
import { Initializable } from "@openzeppelin/upgrades/contracts/Initializable.sol";

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
contract BasketManager is Initializable, IBasketManager, Module {

    using SafeMath for uint256;
    using StableMath for uint256;
    using SafeERC20 for IERC20;

    /** @dev Basket composition events */
    event BassetAdded(address indexed basset, address integrator);
    event BassetRemoved(address indexed basset);
    event BasketWeightsUpdated(address[] indexed bassets, uint256[] maxWeights);

    /** @dev Basket Manager Version */
    string public constant version_impl = "1.0";

    /** @dev mAsset linked to the manager (const) */
    address public mAsset;

    /** @dev Struct holding Basket details */
    Basket public basket;
    // Mapping holds bAsset token address => index
    mapping(address => uint8) private bassetsMap;
    // Holds relative addresses of the integration platforms
    mapping(uint8 => address) public integrations;

    constructor(address _nexus) public Module(_nexus){}

    /**
     * @dev Initialization function for upgradable proxy contract.
     *      This function should be called via Proxy just after contract deployment.
     */
    function initialize(
        address _nexus,
        address _mAsset,
        address[] memory _bassets,
        address[] memory _integrators,
        uint256[] memory _weights,
        bool[] memory _hasTransferFees
    )
        public
        initializer
    {
        Module._initialize(_nexus);

        mAsset = _mAsset;
        // require(_bassets.length > 0, "Must initialise with some bAssets");

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

    // Can only be done when basket is healthy - this avoids minting after basket failure
    function increaseVaultBalance(uint8 _bAsset, address /* _integrator */, uint256 _increaseAmount)
        external
        onlyMasset
        basketIsHealthy
    {
        require(basket.bassets.length > _bAsset, "bAsset does not exist");
        basket.bassets[_bAsset].vaultBalance = basket.bassets[_bAsset].vaultBalance.add(_increaseAmount);
    }

    function decreaseVaultBalance(uint8 _bAsset, address /* _integrator */, uint256 _decreaseAmount)
        external
        onlyMasset
    {
        require(basket.bassets.length > _bAsset, "bAsset does not exist");
        basket.bassets[_bAsset].vaultBalance = basket.bassets[_bAsset].vaultBalance.sub(_decreaseAmount);
    }

    function collectInterest()
        external
        onlyMasset
        returns (uint256 interestCollected, uint32 bitmap, uint256[] memory gains)
    {
        // Get basket details
        (Basset[] memory allBassets, uint32 bitmapLocal, uint256 count) = _getBassets();
        gains = new uint256[](count);
        interestCollected = 0;

        // foreach bAsset
        for(uint8 i = 0; i < count; i++) {
            Basset memory b = allBassets[i];
            // call each integration to `checkBalance`
            uint256 balance = IPlatformIntegration(integrations[i]).checkBalance(b.addr);
            uint256 oldVaultBalance = b.vaultBalance;

            // accumulate interestdelta (ratioed bAsset
            if(balance > oldVaultBalance) {
                // Update balance
                basket.bassets[i].vaultBalance = balance;

                uint256 interestDelta = balance.sub(oldVaultBalance);
                gains[i] = interestDelta;

                // Calc MassetQ
                uint256 ratioedDelta = interestDelta.mulRatioTruncate(b.ratio);
                interestCollected = interestCollected.add(ratioedDelta);
            } else {
                gains[i] = 0;
            }
        }

        return(interestCollected, bitmapLocal, gains);
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
        returns (uint8 index)
    {
        return _addBasset(_basset, _integration, StableMath.getRatioScale(), _isTransferFeeCharged);
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
        returns (uint8 index)
    {
        require(_basset != address(0), "Asset address must be valid");
        require(_integration != address(0), "Asset address must be valid");
        (bool alreadyInBasket, ) = _isAssetInBasket(_basset);
        require(!alreadyInBasket, "Asset already exists in Basket");
        
        // TODO -> Require mm to be >= 1e6 (i.e. 1%) and <= 1e10

        // require(
        //     IManager(_manager()).validateBasset(address(this), _basset, _measurementMultiple, _isTransferFeeCharged),
        //     "New bAsset must be valid"
        // );

        // Check for ERC20 compatibility by forcing decimal retrieval
        // Ultimate enforcement of Basset validity should service through governance & manager
        uint256 basset_decimals = CommonHelpers.mustGetDecimals(_basset);

        uint256 delta = uint256(18).sub(basset_decimals);

        uint256 ratio = _measurementMultiple.mul(10 ** delta);

        uint8 numberOfBassetsInBasket = uint8(basket.bassets.length);
        require(numberOfBassetsInBasket < basket.maxBassets, "Max bAssets in Basket");

        bassetsMap[_basset] = numberOfBassetsInBasket;
        integrations[numberOfBassetsInBasket] = _integration;

        basket.bassets.push(Basset({
            addr: _basset,
            ratio: ratio,
            maxWeight: 0,
            vaultBalance: 0,
            status: BassetStatus.Normal,
            isTransferFeeCharged: _isTransferFeeCharged
        }));


        emit BassetAdded(_basset, _integration);
    }


    /**
      * @dev External call to set weightings of all Bassets
      * @param _bAssets Array of Basset addresses
      * @param _weights Array of Basset weights - summing 100% where 100% == 1e18
      */
    function setBasketWeights(
        address[] calldata _bAssets,
        uint256[] calldata _weights
    )
        external
        onlyGovernor
        basketIsHealthy
    {
        _setBasketWeights(_bAssets, _weights);
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

        for (uint256 i = 0; i < bassetCount; i++) {
            (bool exists, uint8 index) = _isAssetInBasket(_bassets[i]);
            require(exists, "bAsset must exist");

            Basset memory bAsset = _getBasset(index);

            uint256 bassetWeight = _weights[i];

            if(bAsset.status == BassetStatus.Normal) {
                require(bassetWeight >= 0, "Weight must be positive");
                require(bassetWeight <= StableMath.getFullScale(), "Asset weight must be <= 1e18");
                basket.bassets[index].maxWeight = bassetWeight;
            } else {
                require(bassetWeight == basket.bassets[index].maxWeight, "Affected bAssets must be static");
            }
        }

        _validateBasketWeight();

        emit BasketWeightsUpdated(_bassets, _weights);
    }

    function _validateBasketWeight() internal view {
        uint256 len = basket.bassets.length;
        uint256 weightSum = 0;
        for(uint256 i = 0; i < len; i++){
            weightSum = weightSum.add(basket.bassets[i].maxWeight);
        }
        require(weightSum >= StableMath.getFullScale(), "Basket weight must be >= 1e18");
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
        (bool exist, uint8 index) = _isAssetInBasket(_bAsset);
        require(exist, "bAsset does not exist");
        basket.bassets[index].isTransferFeeCharged = _flag;
    }

    /**
      * @dev Removes a specific Asset from the Basket, given that its target/collateral level is 0
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
        (bool existsInBasket, uint8 index) = _isAssetInBasket(_assetToRemove);
        require(existsInBasket, "Asset must appear in Basket");

        uint256 len = basket.bassets.length;
        Basset memory basset = basket.bassets[index];
        // require(basset.maxWeight == 0, "bASset must have a target weight of 0");
        require(basset.vaultBalance == 0, "bASset vault must be empty");
        require(basset.status != BassetStatus.Liquidating, "bASset must be active");

        basket.bassets[index] = basket.bassets[len-1];
        basket.bassets.pop();

        bassetsMap[_assetToRemove] = 0;
        integrations[index] = address(0);

        emit BassetRemoved(basset.addr);
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
        )
    {
        return basket;
    }

    /**
      * @dev Get all basket assets, failing if the Basset does not exist
      * @return Struct array of all basket assets
      */
    function getForgeBasset(address _token, bool /*_mint*/)
        external
        view
        returns (
            Basset memory bAsset,
            address integrator,
            uint8 index
        )
    {
        (bool exists, uint8 idx) = _isAssetInBasket(_token);
        require(exists, "bAsset does not exist");
        // Get the most optimal integration contract
        return (basket.bassets[idx], integrations[idx], idx);
    }

    /**
     * @dev Convert bitmap representing bAssets location to Bassets array
     * @param _bitmap bits set in bitmap represents which bAssets to use
     * @param _size size of bAssets array
     * @return array of Basset array
     */
    function getForgeBassets(
        uint32 _bitmap,
        uint8 _size,
        bool /* _isMint */
    )
        external
        view
        returns (Basset[] memory bAssets, address[] memory integrators, uint8[] memory indexes)
    {
        bAssets = new Basset[](_size);
        integrators = new address[](_size);
        indexes = _convertBitmapToIndexArr(_bitmap, _size);
        for(uint8 i = 0; i < indexes.length; i++) {
            bAssets[i] = basket.bassets[indexes[i]];
            integrators[i] = integrations[indexes[i]];
        }
    }

    /**
      * @dev Get all basket assets
      * @return Struct array of all basket assets
      */
    function getBasset(address _token)
        external
        view
        returns (Basset memory bAsset)
    {
        (bool exists, uint8 index) = _isAssetInBasket(_token);
        require(exists, "bAsset must exist");
        return _getBasset(index);
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
        )
    {
        return _getBassets();
    }

    function _getBassets()
        internal
        view
        returns (
            Basset[] memory bAssets,
            uint32 bitmap,
            uint256 len
        )
    {
        len = basket.bassets.length;

        bAssets = new Basset[](len);

        for(uint8 i = 0; i < len; i++){
            bitmap |= uint32(2)**uint8(i);
            bAssets[i] = _getBasset(i);
        }
    }

    /**
      * @dev Get all basket assets
      * @return Struct array of all basket assets
      */
    function _getBasset(uint8 _bassetIndex)
        internal
        view
        returns (
            Basset memory bAsset
        )
    {
        return basket.bassets[_bassetIndex];
    }


    /***************************************
                    HELPERS
    ****************************************/

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

    /**
      * @dev Checks if a particular asset is in the basket
      * @param _asset Address of Basset to look for
      * @return bool to signal that the asset is in basket
      * @return uint256 Index of the Basset
      */
    function _isAssetInBasket(address _asset)
        internal
        view
        returns (bool exists, uint8 index)
    {
        index = bassetsMap[_asset];
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
    function handlePegLoss(address _bAsset, bool _belowPeg)
        external
        managerOrGovernor
        basketIsHealthy
        returns (bool alreadyActioned)
    {
        (bool exists, uint256 i) = _isAssetInBasket(_bAsset);
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
      * @param _bAsset Address of the Basset
      */
    function negateIsolation(address _bAsset)
    external
    managerOrGovernor {
        (bool exists, uint256 i) = _isAssetInBasket(_bAsset);
        require(exists, "bASset must exist in Basket");

        BassetStatus currentStatus = basket.bassets[i].status;
        if(currentStatus == BassetStatus.BrokenBelowPeg ||
            currentStatus == BassetStatus.BrokenAbovePeg ||
            currentStatus == BassetStatus.Blacklisted) {
            basket.bassets[i].status = BassetStatus.Normal;
        }
    }
}
