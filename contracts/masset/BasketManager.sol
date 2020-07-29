pragma solidity 0.5.16;
pragma experimental ABIEncoderV2;

// External
import { IPlatformIntegration } from "../interfaces/IPlatformIntegration.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// Internal
import { InitializablePausableModule } from "../shared/InitializablePausableModule.sol";
import { IBasketManager } from "../interfaces/IBasketManager.sol";
import { Initializable } from "@openzeppelin/upgrades/contracts/Initializable.sol";

// Libs
import { CommonHelpers } from "../shared/CommonHelpers.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { StableMath } from "../shared/StableMath.sol";
import { InitializableReentrancyGuard } from "../shared/InitializableReentrancyGuard.sol";

/**
 * @title   BasketManager
 * @notice  Manages the Basket composition for a particular mAsset. Feeds all required
 *          basket data to the mAsset and is responsible for keeping accurate records.
 *          BasketManager can also optimise lending pool integrations and perform
 *          re-collateralisation on failed bAssets.
 * @dev     VERSION: 1.0
 *          DATE:    2020-05-05
 */
contract BasketManager is
    Initializable,
    IBasketManager,
    InitializablePausableModule,
    InitializableReentrancyGuard
{
    using SafeMath for uint256;
    using StableMath for uint256;
    using SafeERC20 for IERC20;

    // Events for Basket composition changes
    event BassetAdded(address indexed bAsset, address integrator);
    event BassetRemoved(address indexed bAsset);
    event BasketWeightsUpdated(address[] bAssets, uint256[] maxWeights);
    event BassetStatusChanged(address indexed bAsset, BassetStatus status);
    event BasketStatusChanged();
    event TransferFeeEnabled(address indexed bAsset, bool enabled);

    // mAsset linked to the manager (const)
    address public mAsset;

    // Struct holding Basket details
    Basket public basket;
    // Mapping holds bAsset token address => array index
    mapping(address => uint8) private bAssetsMap;
    // Holds relative addresses of the integration platforms
    address[] public integrations;

    /**
     * @dev Initialization function for upgradable proxy contract.
     *      This function should be called via Proxy just after contract deployment.
     * @param _nexus            Address of system Nexus
     * @param _mAsset           Address of the mAsset whose Basket to manage
     * @param _bAssets          Array of erc20 bAsset addresses
     * @param _integrators      Matching array of the platform intergations for bAssets
     * @param _weights          Weightings of each bAsset, summing to 1e18
     * @param _hasTransferFees  Bool signifying if this bAsset has xfer fees
     */
    function initialize(
        address _nexus,
        address _mAsset,
        address[] calldata _bAssets,
        address[] calldata _integrators,
        uint256[] calldata _weights,
        bool[] calldata _hasTransferFees
    )
        external
        initializer
    {
        InitializableReentrancyGuard._initialize();
        InitializablePausableModule._initialize(_nexus);

        require(_mAsset != address(0), "mAsset address is zero");
        require(_bAssets.length > 0, "Must initialise with some bAssets");
        mAsset = _mAsset;

        // Defaults
        basket.maxBassets = 10;               // 10
        basket.collateralisationRatio = 1e18; // 100%

        for (uint256 i = 0; i < _bAssets.length; i++) {
            _addBasset(
                _bAssets[i],
                _integrators[i],
                StableMath.getRatioScale(),
                _hasTransferFees[i]
            );
        }
        _setBasketWeights(_bAssets, _weights, true);
    }

    /**
     * @dev Requires the overall basket composition to be healthy
     */
    modifier whenBasketIsHealthy() {
        require(!basket.failed, "Basket must be alive");
        _;
    }

    /**
     * @dev Requires the overall basket composition to be healthy
     */
    modifier whenNotRecolling() {
        require(!basket.undergoingRecol, "No bAssets can be undergoing recol");
        _;
    }

    /**
     * @dev Verifies that the caller either Manager or Gov
     */
    modifier managerOrGovernor() {
        require(
            _manager() == msg.sender || _governor() == msg.sender,
            "Must be manager or governor");
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
     * @param _bAssetIndex      Index of the bAsset
     * @param _increaseAmount   Units deposited
     */
    function increaseVaultBalance(
        uint8 _bAssetIndex,
        address /* _integrator */,
        uint256 _increaseAmount
    )
        external
        onlyMasset
        whenBasketIsHealthy
        nonReentrant
    {
        basket.bassets[_bAssetIndex].vaultBalance =
            basket.bassets[_bAssetIndex].vaultBalance.add(_increaseAmount);
    }

    /**
     * @dev Called by only mAsset, and only when the basket is healthy, to add units to
     *      storage after they have been deposited into the vault
     * @param _bAssetIndices    Array of bAsset indexes
     * @param _increaseAmount   Units deposited
     */
    function increaseVaultBalances(
        uint8[] calldata _bAssetIndices,
        address[] calldata /* _integrator */,
        uint256[] calldata _increaseAmount
    )
        external
        onlyMasset
        whenBasketIsHealthy
        nonReentrant
    {
        uint256 len = _bAssetIndices.length;
        for(uint i = 0; i < len; i++) {
            basket.bassets[_bAssetIndices[i]].vaultBalance =
                basket.bassets[_bAssetIndices[i]].vaultBalance.add(_increaseAmount[i]);
        }
    }

    /**
     * @dev Called by mAsset after redeeming tokens. Simply reduce the balance in the vault
     * @param _bAssetIndex      Index of the bAsset
     * @param _decreaseAmount   Units withdrawn
     */
    function decreaseVaultBalance(
        uint8 _bAssetIndex,
        address /* _integrator */,
        uint256 _decreaseAmount
    )
        external
        onlyMasset
        nonReentrant
    {
        basket.bassets[_bAssetIndex].vaultBalance =
            basket.bassets[_bAssetIndex].vaultBalance.sub(_decreaseAmount);
    }

    /**
     * @dev Called by mAsset after redeeming tokens. Simply reduce the balance in the vault
     * @param _bAssetIndices    Array of bAsset indexes
     * @param _decreaseAmount   Units withdrawn
     */
    function decreaseVaultBalances(
        uint8[] calldata _bAssetIndices,
        address[] calldata /* _integrator */,
        uint256[] calldata _decreaseAmount
    )
        external
        onlyMasset
        nonReentrant
    {
        uint256 len = _bAssetIndices.length;
        for(uint i = 0; i < len; i++) {
            basket.bassets[_bAssetIndices[i]].vaultBalance =
                basket.bassets[_bAssetIndices[i]].vaultBalance.sub(_decreaseAmount[i]);
        }
    }

    /**
     * @dev Called by mAsset to calculate how much interest has been generated in the basket
     *      and withdraw it. Cycles through the connected platforms to check the balances.
     * @return interestCollected   Total amount of interest collected, in mAsset terms
     * @return gains               Array of bAsset units gained
     */
    function collectInterest()
        external
        onlyMasset
        whenNotPaused
        whenBasketIsHealthy
        nonReentrant
        returns (uint256 interestCollected, uint256[] memory gains)
    {
        // Get basket details
        (Basset[] memory allBassets, uint256 count) = _getBassets();
        gains = new uint256[](count);
        interestCollected = 0;

        // foreach bAsset
        for(uint8 i = 0; i < count; i++) {
            Basset memory b = allBassets[i];
            // call each integration to `checkBalance`
            uint256 balance = IPlatformIntegration(integrations[i]).checkBalance(b.addr);
            uint256 oldVaultBalance = b.vaultBalance;

            // accumulate interest (ratioed bAsset)
            if(balance > oldVaultBalance && b.status == BassetStatus.Normal) {
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
    }


    /***************************************
                BASKET MANAGEMENT
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
        whenBasketIsHealthy
        whenNotRecolling
        returns (uint8 index)
    {
        index = _addBasset(
            _bAsset,
            _integration,
            StableMath.getRatioScale(),
            _isTransferFeeCharged
        );
    }

    /**
     * @dev Adds a bAsset to the Basket, fetching its decimals and calculating the Ratios
     * @param _bAsset               Address of the ERC20 token to add to the Basket
     * @param _integration          Address of the Platform Integration
     * @param _measurementMultiple  Base 1e8 var to determine measurement ratio
     *                              between bAsset:mAsset
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
        require(_bAsset != address(0), "bAsset address must be valid");
        require(_integration != address(0), "Integration address must be valid");
        require(_measurementMultiple >= 1e6 && _measurementMultiple <= 1e10, "MM out of range");

        (bool alreadyInBasket, ) = _isAssetInBasket(_bAsset);
        require(!alreadyInBasket, "bAsset already exists in Basket");

        // Should fail if bAsset is not added to integration
        // Programmatic enforcement of bAsset validity should service through decentralised feed
        IPlatformIntegration(_integration).checkBalance(_bAsset);

        uint256 bAsset_decimals = CommonHelpers.getDecimals(_bAsset);
        uint256 delta = uint256(18).sub(bAsset_decimals);

        uint256 ratio = _measurementMultiple.mul(10 ** delta);

        uint8 numberOfBassetsInBasket = uint8(basket.bassets.length);
        require(numberOfBassetsInBasket < basket.maxBassets, "Max bAssets in Basket");

        bAssetsMap[_bAsset] = numberOfBassetsInBasket;

        integrations.push(_integration);
        basket.bassets.push(Basset({
            addr: _bAsset,
            ratio: ratio,
            maxWeight: 0,
            vaultBalance: 0,
            status: BassetStatus.Normal,
            isTransferFeeCharged: _isTransferFeeCharged
        }));

        emit BassetAdded(_bAsset, _integration);

        index = numberOfBassetsInBasket;
    }


    /**
     * @dev External call for the governor to set weightings of all bAssets
     * @param _bAssets Array of bAsset addresses
     * @param _weights Array of bAsset weights - summing 100% where 100% == 1e18
     */
    function setBasketWeights(
        address[] calldata _bAssets,
        uint256[] calldata _weights
    )
        external
        onlyGovernor
        whenBasketIsHealthy
    {
        _setBasketWeights(_bAssets, _weights, false);
    }

    /**
     * @notice Sets new Basket weightings
     * @dev Requires the modified bAssets to be in a Normal state
     * @param _bAssets Array of bAsset addresses
     * @param _weights Array of bAsset weights - summing 100% where 100% == 1e18
     * @param _isBootstrap True only on the first occurence of weight setting
     */
    function _setBasketWeights(
        address[] memory _bAssets,
        uint256[] memory _weights,
        bool _isBootstrap
    )
        internal
    {
        uint256 bAssetCount = _bAssets.length;
        require(bAssetCount > 0, "Empty bAssets array passed");
        require(bAssetCount == _weights.length, "Must be matching bAsset arrays");

        for (uint256 i = 0; i < bAssetCount; i++) {
            (bool exists, uint8 index) = _isAssetInBasket(_bAssets[i]);
            require(exists, "bAsset must exist");

            Basset memory bAsset = _getBasset(index);

            uint256 bAssetWeight = _weights[i];

            if(bAsset.status == BassetStatus.Normal) {
                require(
                    bAssetWeight <= 1e18,
                    "Asset weight must be <= 100%"
                );
                basket.bassets[index].maxWeight = bAssetWeight;
            } else {
                require(
                    bAssetWeight == basket.bassets[index].maxWeight,
                    "Affected bAssets must be static"
                );
            }
        }

        if(!_isBootstrap){
            _validateBasketWeight();
        }

        emit BasketWeightsUpdated(_bAssets, _weights);
    }

    /**
     * @dev Throws if the sum of all bAsset maxWeights is not in range 100-400%
     */
    function _validateBasketWeight() internal view {
        uint256 len = basket.bassets.length;
        uint256 weightSum = 0;
        for(uint256 i = 0; i < len; i++) {
            weightSum = weightSum.add(basket.bassets[i].maxWeight);
        }
        require(weightSum >= 1e18 && weightSum <= 4e18, "Basket weight must be >= 100 && <= 400%");
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

        emit TransferFeeEnabled(_bAsset, _flag);
    }


    /**
     * @dev Removes a specific Asset from the Basket, given that its target/collateral
     *      level is already 0, throws if invalid.
     * @param _assetToRemove The asset to remove from the basket
     */
    function removeBasset(address _assetToRemove)
        external
        whenBasketIsHealthy
        whenNotRecolling
        managerOrGovernor
    {
        _removeBasset(_assetToRemove);
    }

    /**
     * @dev Removes a specific Asset from the Basket, given that its target/collateral
     *      level is already 0, throws if invalid.
     * @param _assetToRemove The asset to remove from the basket
     */
    function _removeBasset(address _assetToRemove) internal {
        (bool exists, uint8 index) = _isAssetInBasket(_assetToRemove);
        require(exists, "bAsset does not exist");

        uint256 len = basket.bassets.length;
        Basset memory bAsset = basket.bassets[index];

        require(bAsset.maxWeight == 0, "bAsset must have a target weight of 0");
        require(bAsset.vaultBalance == 0, "bAsset vault must be empty");
        require(bAsset.status != BassetStatus.Liquidating, "bAsset must be active");

        uint8 lastIndex = uint8(len.sub(1));
        if(index == lastIndex) {
            basket.bassets.pop();
            bAssetsMap[_assetToRemove] = 0;
            integrations.pop();
        } else {
            // Swap the bassets
            basket.bassets[index] = basket.bassets[lastIndex];
            basket.bassets.pop();
            Basset memory swappedBasset = basket.bassets[index];
            // Update bassetsMap
            bAssetsMap[_assetToRemove] = 0;
            bAssetsMap[swappedBasset.addr] = index;
            // Update integrations
            integrations[index] = integrations[lastIndex];
            integrations.pop();
        }

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
        returns (Basket memory b)
    {
        b = basket;
    }

    /**
     * @dev Prepare given bAsset for Forging. Currently returns integrator
     *      and essential minting info.
     * @param _bAsset    Address of the bAsset
     * @return props     Struct of all relevant Forge information
     */
    function prepareForgeBasset(address _bAsset, uint256 /*_amt*/, bool /*_mint*/)
        external
        whenNotPaused
        whenNotRecolling
        returns (bool isValid, BassetDetails memory bInfo)
    {
        (bool exists, uint8 idx) = _isAssetInBasket(_bAsset);
        require(exists, "bAsset does not exist");
        isValid = true;
        bInfo = BassetDetails({
            bAsset: basket.bassets[idx],
            integrator: integrations[idx],
            index: idx
        });
    }

    /**
     * @dev Prepare given bAssets for swapping
     * @param _input     Address of the input bAsset
     * @param _output    Address of the output bAsset
     * @param _isMint    Is this swap actually a mint? i.e. output == address(mAsset)
     * @return props     Struct of all relevant Forge information
     */
    function prepareSwapBassets(address _input, address _output, bool _isMint)
        external
        view
        whenNotPaused
        returns (bool, string memory, BassetDetails memory, BassetDetails memory)
    {
        BassetDetails memory input = BassetDetails({
            bAsset: basket.bassets[0],
            integrator: address(0),
            index: 0
        });
        BassetDetails memory output = input;
        // Check that basket state is healthy
        if(basket.failed || basket.undergoingRecol){
            return (false, "Basket is undergoing change", input, output);
        }

        // Fetch input bAsset
        (bool inputExists, uint8 inputIdx) = _isAssetInBasket(_input);
        if(!inputExists) {
            return (false, "Input asset does not exist", input, output);
        }
        input = BassetDetails({
            bAsset: basket.bassets[inputIdx],
            integrator: integrations[inputIdx],
            index: inputIdx
        });

        // If this is a mint, we don't need output bAsset
        if(_isMint) {
            return (true, "", input, output);
        }

        // Fetch output bAsset
        (bool outputExists, uint8 outputIdx) = _isAssetInBasket(_output);
        if(!outputExists) {
            return (false, "Output asset does not exist", input, output);
        }
        output = BassetDetails({
            bAsset: basket.bassets[outputIdx],
            integrator: integrations[outputIdx],
            index: outputIdx
        });
        return (true, "", input, output);
    }

    /**
     * @dev Prepare given bAsset addresses for Forging. Currently returns integrator
     *      and essential minting info for each bAsset
     * @param _bAssets   Array of bAsset addresses with which to forge
     * @return props     Struct of all relevant Forge information
     */
    function prepareForgeBassets(
        address[] calldata _bAssets,
        uint256[] calldata /*_amts*/,
        bool /* _isMint */
    )
        external
        whenNotPaused
        whenNotRecolling
        returns (ForgePropsMulti memory props)
    {
        // Pass the fetching logic to the internal view func to reduce SLOAD cost
        (Basset[] memory bAssets, uint8[] memory indexes, address[] memory integrators) = _fetchForgeBassets(_bAssets);
        props = ForgePropsMulti({
            isValid: true,
            bAssets: bAssets,
            integrators: integrators,
            indexes: indexes
        });
    }

    /**
     * @dev Prepare given bAsset addresses for RedeemMulti. Currently returns integrator
     *      and essential minting info for each bAsset
     * @return props     Struct of all relevant Forge information
     */
    function prepareRedeemMulti()
        external
        view
        whenNotPaused
        whenNotRecolling
        returns (RedeemPropsMulti memory props)
    {
        (Basset[] memory bAssets, uint256 len) = _getBassets();
        address[] memory orderedIntegrators = new address[](len);
        uint8[] memory indexes = new uint8[](len);
        for(uint8 i = 0; i < len; i++){
            orderedIntegrators[i] = integrations[i];
            indexes[i] = i;
        }
        props = RedeemPropsMulti({
            colRatio: basket.collateralisationRatio,
            bAssets: bAssets,
            integrators: orderedIntegrators,
            indexes: indexes
        });
    }

    /**
     * @dev Internal func to fetch an array of bAssets and their integrators from storage
     * @param _bAssets       Array of non-duplicate bAsset addresses with which to forge
     * @return bAssets       Array of bAsset structs for the given addresses
     * @return indexes       Array of indexes for the given addresses
     * @return integrators   Array of integrators for the given addresses
     */
    function _fetchForgeBassets(address[] memory _bAssets)
        internal
        view
        returns (
            Basset[] memory bAssets,
            uint8[] memory indexes,
            address[] memory integrators
        )
    {
        uint8 len = uint8(_bAssets.length);

        bAssets = new Basset[](len);
        integrators = new address[](len);
        indexes = new uint8[](len);

        // Iterate through the input
        for(uint8 i = 0; i < len; i++) {
            address current = _bAssets[i];

            // If there is a duplicate here, throw
            // Gas costs do not incur SLOAD
            for(uint8 j = i+1; j < len; j++){
                require(current != _bAssets[j], "Must have no duplicates");
            }

            // Fetch and log all the relevant data
            (bool exists, uint8 index) = _isAssetInBasket(current);
            require(exists, "bAsset must exist");
            indexes[i] = index;
            bAssets[i] = basket.bassets[index];
            integrators[i] = integrations[index];
        }
    }

    /**
     * @dev Get data for a all bAssets in basket
     * @return bAssets  Struct[] with full bAsset data
     * @return len      Number of bAssets in the Basket
     */
    function getBassets()
        external
        view
        returns (
            Basset[] memory bAssets,
            uint256 len
        )
    {
        return _getBassets();
    }

    /**
     * @dev Get data for a specific bAsset, if it exists
     * @param _bAsset   Address of bAsset
     * @return bAsset  Struct with full bAsset data
     */
    function getBasset(address _bAsset)
        external
        view
        returns (Basset memory bAsset)
    {
        (bool exists, uint8 index) = _isAssetInBasket(_bAsset);
        require(exists, "bAsset must exist");
        bAsset = _getBasset(index);
    }

    /**
     * @dev Get current integrator for a specific bAsset, if it exists
     * @param _bAsset      Address of bAsset
     * @return integrator  Address of current integrator
     */
    function getBassetIntegrator(address _bAsset)
        external
        view
        returns (address integrator)
    {
        (bool exists, uint8 index) = _isAssetInBasket(_bAsset);
        require(exists, "bAsset must exist");
        integrator = integrations[index];
    }

    function _getBassets()
        internal
        view
        returns (
            Basset[] memory bAssets,
            uint256 len
        )
    {
        bAssets = basket.bassets;
        len = basket.bassets.length;
    }

    function _getBasset(uint8 _bAssetIndex)
        internal
        view
        returns (Basset memory bAsset)
    {
        bAsset = basket.bassets[_bAssetIndex];
    }


    /***************************************
                    HELPERS
    ****************************************/

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
            if(basket.bassets.length == 0) {
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
     * @param _belowPeg        Bool to describe whether the bAsset deviated below peg (t)
     *                         or above (f)
     * @return alreadyActioned Bool to show whether a bAsset had already been actioned
     */
    function handlePegLoss(address _bAsset, bool _belowPeg)
        external
        managerOrGovernor
        whenBasketIsHealthy
        returns (bool alreadyActioned)
    {
        (bool exists, uint256 i) = _isAssetInBasket(_bAsset);
        require(exists, "bAsset must exist in Basket");

        BassetStatus oldStatus = basket.bassets[i].status;
        BassetStatus newStatus =
            _belowPeg ? BassetStatus.BrokenBelowPeg : BassetStatus.BrokenAbovePeg;

        if(oldStatus == newStatus || _bAssetHasRecolled(oldStatus)) {
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
        managerOrGovernor
    {
        (bool exists, uint256 i) = _isAssetInBasket(_bAsset);
        require(exists, "bAsset must exist");

        BassetStatus currentStatus = basket.bassets[i].status;
        if(currentStatus == BassetStatus.BrokenBelowPeg ||
            currentStatus == BassetStatus.BrokenAbovePeg ||
            currentStatus == BassetStatus.Blacklisted) {
            basket.bassets[i].status = BassetStatus.Normal;
            emit BassetStatusChanged(_bAsset, BassetStatus.Normal);
        }
    }

    /**
     * @dev Marks a bAsset as permanently deviated from peg
     * @param _bAsset Address of the bAsset
     */
    function failBasset(address _bAsset)
        external
        onlyGovernor
    {
        (bool exists, uint256 i) = _isAssetInBasket(_bAsset);
        require(exists, "bAsset must exist");

        BassetStatus currentStatus = basket.bassets[i].status;
        require(
            currentStatus == BassetStatus.BrokenBelowPeg ||
            currentStatus == BassetStatus.BrokenAbovePeg,
            "bAsset must be affected"
        );
        basket.failed = true;
    }
}
