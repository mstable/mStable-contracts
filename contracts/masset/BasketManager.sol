pragma solidity 0.5.16;
pragma experimental ABIEncoderV2;

// External
import { IPlatformIntegration } from "../interfaces/IPlatformIntegration.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// Internal
import { InitializablePausableModule } from "../shared/InitializablePausableModule.sol";
import { IBasketManager } from "../interfaces/IBasketManager.sol";
import { Initializable } from "@openzeppelin/upgrades/contracts/Initializable.sol";
import { PausableModule } from "../shared/PausableModule.sol";

// Libs
import { CommonHelpers } from "../shared/CommonHelpers.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { StableMath } from "../shared/StableMath.sol";

/**
 * @title   BasketManager
 * @notice  Manages the Basket composition for a particular mAsset. Feeds all required
 *          basket data to the mAsset and is responsible for keeping accurate data.
 *          BasketManager can also optimise lending pool integrations and perform
 *          re-collateralisation on failed bAssets.
 * @dev     VERSION: 1.0
 *          DATE:    2020-03-26
 */
contract BasketManager is Initializable, IBasketManager, InitializablePausableModule {

    using SafeMath for uint256;
    using StableMath for uint256;
    using SafeERC20 for IERC20;

    // Events for Basket composition changes
    event BassetAdded(address indexed bAsset, address integrator);
    event BassetRemoved(address indexed bAsset);
    event BasketWeightsUpdated(address[] indexed bAssets, uint256[] targetWeights);
    event GraceUpdated(uint256 newGrace);
    event BassetStatusChanged(address indexed bAsset, BassetStatus status);

    // mAsset linked to the manager (const)
    address public mAsset;

    // Struct holding Basket details
    Basket public basket;
    // Variable used to determine deviation threshold in ForgeValidator
    uint256 public grace;
    // Mapping holds bAsset token address => array index
    mapping(address => uint8) private bAssetsMap;
    // Holds relative addresses of the integration platforms
    mapping(uint8 => address) public integrations;

    /**
     * @dev Initialization function for upgradable proxy contract.
     *      This function should be called via Proxy just after contract deployment.
     * @param _nexus            Address of system Nexus
     * @param _mAsset           Address of the mAsset whose Basket to manage
     * @param _grace            Deviation allowance for ForgeValidator
     * @param _bAssets          Array of erc20 bAsset addresses
     * @param _integrators      Matching array of the platform intergations for bAssets
     * @param _weights          Weightings of each bAsset, summing to 1e18
     * @param _hasTransferFees  Bool signifying if this bAsset has xfer fees
     */
    function initialize(
        address _nexus,
        address _mAsset,
        uint256 _grace,
        address[] calldata _bAssets,
        address[] calldata _integrators,
        uint256[] calldata _weights,
        bool[] calldata _hasTransferFees
    )
        external
        initializer
    {
        InitializablePausableModule._initialize(_nexus);

        mAsset = _mAsset;
        grace = _grace;

        require(_bAssets.length > 0, "Must initialise with some bAssets");

        // Defaults
        basket.maxBassets = 16;               // 16
        basket.collateralisationRatio = 1e18; // 100%

        for (uint256 i = 0; i < _bAssets.length; i++) {
            _addBasset(
                _bAssets[i],
                _integrators[i],
                StableMath.getRatioScale(),
                _hasTransferFees[i]
                );
        }
        _setBasketWeights(_bAssets, _weights);
    }

    /**
     * @dev Requires the overall basket composition to be healthy
     */
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
      * @dev Verifies that the caller is governed mAsset
      */
    modifier onlyMasset() {
        require(mAsset == msg.sender, "Must be called by mAsset");
        _;
    }

    /***************************************
                VAULT BALANCE
    ****************************************/

    /**
     * @dev Called by only mAsset, and only when the basket is healthy, to add units to
     *      storage after they have been deposited into the vault
     * @param _bAsset           Index of the bAsset
     * @param _increaseAmount   Units deposited
     */
    function increaseVaultBalance(uint8 _bAsset, address /* _integrator */, uint256 _increaseAmount)
        external
        onlyMasset
        basketIsHealthy
    {
        basket.bassets[_bAsset].vaultBalance = basket.bassets[_bAsset].vaultBalance.add(_increaseAmount);
    }

    /**
     * @dev Called by only mAsset, and only when the basket is healthy, to add units to
     *      storage after they have been deposited into the vault
     * @param _bAssets          Index of the bAsset
     * @param _increaseAmount   Units deposited
     */
    function increaseVaultBalances(
        uint8[] calldata _bAssets,
        address[] calldata /* _integrator */,
        uint256[] calldata _increaseAmount,
        uint256 len
    )
        external
        onlyMasset
        basketIsHealthy
    {
        for(uint i = 0; i < len; i++){
            basket.bassets[_bAssets[i]].vaultBalance = basket.bassets[_bAssets[i]].vaultBalance.add(_increaseAmount[i]);
        }
    }

    /**
     * @dev Called by mAsset after redeeming tokens. Simply reduce the balance in the vault
     * @param _bAsset           Index of the bAsset
     * @param _decreaseAmount   Units withdrawn
     */
    function decreaseVaultBalance(uint8 _bAsset, address /* _integrator */, uint256 _decreaseAmount)
        external
        onlyMasset
    {
        basket.bassets[_bAsset].vaultBalance = basket.bassets[_bAsset].vaultBalance.sub(_decreaseAmount);
    }

    /**
     * @dev Called by mAsset after redeeming tokens. Simply reduce the balance in the vault
     * @param _bAssets          Index of the bAsset
     * @param _decreaseAmount   Units withdrawn
     */
    function decreaseVaultBalances(
        uint8[] calldata _bAssets,
        address[] calldata /* _integrator */,
        uint256[] calldata _decreaseAmount,
        uint256 len
    )
        external
        onlyMasset
    {
        for(uint i = 0; i < len; i++){
            basket.bassets[_bAssets[i]].vaultBalance = basket.bassets[_bAssets[i]].vaultBalance.sub(_decreaseAmount[i]);
        }
    }

    /**
     * @dev Called by mAsset to calculate how much interested has been generated in the basket
     *      and withdraw it. Cycles through the connected platforms to check the balances.
     * @return interestCollected   Total amount of interest collected, in mAsset terms
     * @return bitmap              Bitmap to correspond to the gains
     * @return gains               Array of bAsset units gained
     */
    function collectInterest()
        external
        onlyMasset
        whenNotPaused
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
      * @dev External func to allow the Governor to conduct add operations on the Basket
      * @param _bAsset               Address of the ERC20 token to add to the Basket
      * @param _integration          Address of the vault integration to deposit and withdraw
      * @param _isTransferFeeCharged Bool - are transfer fees charged on this bAsset
      * @return index                Position of the bAsset in the Basket
      */
    function addBasset(address _bAsset, address _integration, bool _isTransferFeeCharged)
        external
        onlyGovernor
        basketIsHealthy
        returns (uint8 index)
    {
        return _addBasset(_bAsset, _integration, StableMath.getRatioScale(), _isTransferFeeCharged);
    }

    /**
      * @dev Adds a bAsset to the Basket, fetching its decimals and calculating the Ratios
      * @param _bAsset               Address of the ERC20 token to add to the Basket
      * @param _integration          Address of the Platform Integration
      * @param _measurementMultiple  Base 1e8 var to determine measurement ratio between bAsset:mAsset
      * @param _isTransferFeeCharged Bool - are transfer fees charged on this bAsset
      * @return index                Position of the bAsset in the Basket
      */
    function _addBasset(
        address _bAsset,
        address _integration,
        uint256 _measurementMultiple,
        bool _isTransferFeeCharged
    )
        internal
        returns (uint8 index)
    {
        require(_bAsset != address(0), "Asset address must be valid");
        require(_integration != address(0), "Asset address must be valid");
        (bool alreadyInBasket, ) = _isAssetInBasket(_bAsset);
        require(!alreadyInBasket, "Asset already exists in Basket");
        require(_measurementMultiple >= 1e6 && _measurementMultiple <= 1e10, "MM out of range");

        // Programmatic enforcement of bAsset validity should service through oracle
        // require(
        //     IManager(_manager()).validateBasset(address(this), _bAsset, _measurementMultiple, _isTransferFeeCharged),
        //     "New bAsset must be valid"
        // );

        uint256 bAsset_decimals = CommonHelpers.getDecimals(_bAsset);

        uint256 delta = uint256(18).sub(bAsset_decimals);

        uint256 ratio = _measurementMultiple.mul(10 ** delta);

        uint8 numberOfBassetsInBasket = uint8(basket.bassets.length);
        require(numberOfBassetsInBasket < basket.maxBassets, "Max bAssets in Basket");

        bAssetsMap[_bAsset] = numberOfBassetsInBasket;
        integrations[numberOfBassetsInBasket] = _integration;

        basket.bassets.push(Basset({
            addr: _bAsset,
            ratio: ratio,
            targetWeight: 0,
            vaultBalance: 0,
            status: BassetStatus.Normal,
            isTransferFeeCharged: _isTransferFeeCharged
        }));


        emit BassetAdded(_bAsset, _integration);

        return numberOfBassetsInBasket;
    }


    /**
      * @dev External call for the governor to set weightings of all bAssets
      * @param _bAssets     Array of bAsset addresses
      * @param _weights     Array of bAsset weights - summing 100% where 100% == 1e18
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
      * @dev Requires the modified bAssets to be in a Normal state
      * @param _bAssets Array of bAsset addresses
      * @param _weights Array of bAsset weights - summing 100% where 100% == 1e18
      */
    function _setBasketWeights(
        address[] memory _bAssets,
        uint256[] memory _weights
    )
        internal
    {
        uint256 bAssetCount = _bAssets.length;
        require(bAssetCount == _weights.length, "Must be matching bAsset arrays");

        for (uint256 i = 0; i < bAssetCount; i++) {
            (bool exists, uint8 index) = _isAssetInBasket(_bAssets[i]);
            require(exists, "bAsset must exist");

            Basset memory bAsset = _getBasset(index);

            uint256 bAssetWeight = _weights[i];

            if(bAsset.status == BassetStatus.Normal) {
                require(bAssetWeight >= 0 && bAssetWeight <= StableMath.getFullScale(), "Asset weight must be <= 1e18");
                basket.bassets[index].targetWeight = bAssetWeight;
            } else {
                require(bAssetWeight == basket.bassets[index].targetWeight, "Affected bAssets must be static");
            }
        }

        _validateBasketWeight();

        emit BasketWeightsUpdated(_bAssets, _weights);
    }

    /**
      * @dev Throws if the total Basket weight does not sum to 100
      */
    function _validateBasketWeight() internal view {
        uint256 len = basket.bassets.length;
        uint256 weightSum = 0;
        for(uint256 i = 0; i < len; i++){
            weightSum = weightSum.add(basket.bassets[i].targetWeight);
        }
        require(weightSum == StableMath.getFullScale(), "Basket weight must be >= 1e18");
    }

    /**
     * @dev Update transfer fee flag for a given bAsset, should it change its fee practice
     * @param _bAsset   bAsset address
     * @param _flag         Charge transfer fee when its set to 'true', otherwise 'false'
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
     * @dev Update Grace allowance for use in the Forge Validation
     * @param _newGrace Exact amount of units
     */
    function setGrace(uint256 _newGrace)
        external
        managerOrGovernor
    {
        require(_newGrace >= 1e18 && _newGrace <= 1e25, "Must be within valid grace range");
        grace = _newGrace;
        emit GraceUpdated(_newGrace);
    }

    /**
      * @dev Removes a specific Asset from the Basket, given that its target/collateral
      *      level is already 0, throws if invalid.
      * @param _assetToRemove The asset to remove from the basket
      */
    function removeBasset(address _assetToRemove)
        external
        basketIsHealthy
        managerOrGovernor
    {
        _removeBasset(_assetToRemove);
    }

    /**
      * @dev Removes a specific Asset from the Basket, given that its target/collateral
      *      level is already 0, throws if invalid.
      * @param _assetToRemove The asset to remove from the basket
      */
    function _removeBasset(address _assetToRemove)
    internal {
        (bool existsInBasket, uint8 index) = _isAssetInBasket(_assetToRemove);
        require(existsInBasket, "Asset must appear in Basket");

        uint256 len = basket.bassets.length;
        Basset memory bAsset = basket.bassets[index];
        require(bAsset.targetWeight == 0, "bAsset must have a target weight of 0");
        require(bAsset.vaultBalance == 0, "bAsset vault must be empty");
        require(bAsset.status != BassetStatus.Liquidating, "bAsset must be active");

        basket.bassets[index] = basket.bassets[len-1];
        basket.bassets.pop();

        bAssetsMap[_assetToRemove] = 0;
        integrations[index] = address(0);

        emit BassetRemoved(bAsset.addr);
    }


    /***************************************
                    GETTERS
    ****************************************/

    /**
      * @dev Get basket details for `MassetStructs.Basket`
      * @return b   Basket struct
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
      * @dev Prepare given bAsset for Forging. Currently returns integrator
      *      and essential minting info.
      * @param _token     Address of the bAsset
      * @return props     Struct of all relevant Forge information
      */
    function prepareForgeBasset(address _token, uint256 /*_amt*/, bool /*_mint*/)
        external
        whenNotPaused
        returns (
            ForgeProps memory props
        )
    {
        (bool exists, uint8 idx) = _isAssetInBasket(_token);
        require(exists, "bAsset does not exist");
        return ForgeProps({
            isValid: true,
            bAsset: basket.bassets[idx],
            integrator: integrations[idx],
            index: idx,
            grace: grace
        });
    }

    /**
     * @dev Prepare given bAsset bitmap for Forging. Currently returns integrator
     *      and essential minting info for each bAsset
     * @param _bitmap    Bits set in bitmap represents which bAssets to use
     * @param _size      Size of bAssets array
     * @return props     Struct of all relevant Forge information
     */
    function prepareForgeBassets(
        uint32 _bitmap,
        uint8 _size,
        uint256[] calldata /*_amts*/,
        bool /* _isMint */
    )
        external
        whenNotPaused
        returns (ForgePropsMulti memory props)
    {
        Basset[] memory bAssets = new Basset[](_size);
        address[] memory integrators = new address[](_size);
        uint8[] memory indexes = _convertBitmapToIndexArr(_bitmap, _size);
        for(uint8 i = 0; i < indexes.length; i++) {
            bAssets[i] = basket.bassets[indexes[i]];
            integrators[i] = integrations[indexes[i]];
        }
        return ForgePropsMulti({
            isValid: true,
            bAssets: bAssets,
            integrators: integrators,
            indexes: indexes,
            grace: grace
        });
    }

    /**
      * @dev Get data for a all bAssets in basket
      * @return bAssets  Struct[] with full bAsset data
      * @return bitmap   Bitmap for all bAssets
      * @return len      Number of bAssets in the Basket
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

    /**
      * @dev Get data for a specific bAsset, if it exists
      * @param _token   Address of bAsset
      * @return bAsset  Struct with full bAsset data
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
      * @dev Get current integrator for a specific bAsset, if it exists
      * @param _token       Address of bAsset
      * @return integrator  Address of current integrator
      */
    function getBassetIntegrator(address _token)
        external
        view
        returns (address integrator)
    {
        (bool exists, uint8 index) = _isAssetInBasket(_token);
        require(exists, "bAsset must exist");
        return integrations[index];
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

    function _getBasset(uint8 _bAssetIndex)
        internal
        view
        returns (
            Basset memory bAsset
        )
    {
        return basket.bassets[_bAssetIndex];
    }


    /***************************************
                    HELPERS
    ****************************************/

    /**
     * @dev Returns the bitmap for given bAssets addresses
     * @param _bAssets  bAsset addresses for which bitmap is needed
     * @return bitmap   Bits set according to bAsset address position
     */
    function getBitmapFor(address[] calldata _bAssets) external view returns (uint32 bitmap) {
        for(uint32 i = 0; i < _bAssets.length; i++) {
            (bool exist, uint256 idx) = _isAssetInBasket(_bAssets[i]);
            if(exist) bitmap |= uint32(2)**uint8(idx);
        }
    }

    /**
     * @dev Convert the given bitmap into an array representing bAssets index location in the array
     * @param _bitmap   Bits set in bitmap represents which bAssets to use
     * @param _size     Size of the bAssetsQuantity array
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
      * @param _asset   Address of bAsset to look for
      * @return exists  bool to signal that the asset is in basket
      * @return index   uint256 Index of the bAsset
      */
    function _isAssetInBasket(address _asset)
        internal
        view
        returns (bool exists, uint8 index)
    {
        index = bAssetsMap[_asset];
        if(index == 0) {
            if(basket.bassets.length == 0){
                return (false, 0);
            }
            return (basket.bassets[0].addr == _asset, 0);
        }
        return (true, index);
    }

    /**
     * @notice Determine whether or not a bAsset has already undergone re-collateralisation
     * @param _status   Status of the bAsset
     * @return          Bool to determine if undergone re-collateralisation
     */
    function _bAssetHasRecolled(BassetStatus _status)
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
      * @dev Executes the Auto Redistribution event by isolating the bAsset from the Basket
      * @param _bAsset          Address of the ERC20 token to isolate
      * @param _belowPeg        Bool to describe whether the bAsset deviated below peg (t) or above (f)
      * @return alreadyActioned Bool to show whether a bAsset had already been actioned
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
            _bAssetHasRecolled(oldStatus)) {
            return true;
        }

        // If we need to update the status.. then do it
        basket.bassets[i].status = newStatus;
        emit BassetStatusChanged(_bAsset, newStatus);
        return false;
    }

    /**
      * @dev Negates the isolation of a given bAsset
      * @param _bAsset Address of the bAsset
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
            emit BassetStatusChanged(_bAsset, BassetStatus.Normal);
        }
    }
}
