pragma solidity 0.5.16;
pragma experimental ABIEncoderV2;

// External
import { IForgeValidator } from "./forge-validator/IForgeValidator.sol";
import { IPlatformIntegration } from "../interfaces/IPlatformIntegration.sol";
import { IBasketManager } from "../interfaces/IBasketManager.sol";

// Internal
import { IMasset } from "../interfaces/IMasset.sol";
import { MassetToken } from "./MassetToken.sol";
import { Module } from "../shared/Module.sol";
import { MassetStructs } from "./shared/MassetStructs.sol";

// Libs
import { StableMath } from "../shared/StableMath.sol";
import { MassetHelpers } from "./shared/MassetHelpers.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title   Masset
 * @author  Stability Labs Pty. Ltd.
 * @notice  The Masset is a token that allows minting and redemption at a 1:1 ratio
 *          for underlying basket assets (bAssets) of the same peg (i.e. USD,
 *          EUR, gGold). Composition and validation is enforced via the BasketManager.
 */
contract Masset is IMasset, MassetToken, Module, ReentrancyGuard {

    using StableMath for uint256;

    // Forging Events
    event Minted(address indexed account, uint256 mAssetQuantity, address bAsset, uint256 bAssetQuantity);
    event MintedMulti(address indexed account, uint256 mAssetQuantity, address[] bAssets, uint256[] bAssetQuantities);
    event Redeemed(address indexed recipient, address redeemer, uint256 mAssetQuantity, address[] bAssets, uint256[] bAssetQuantit);
    event RedeemedMulti(address indexed recipient, address redeemer, uint256 mAssetQuantity);
    event PaidFee(address payer, address asset, uint256 feeQuantity);

    // State Events
    event SwapFeeChanged(uint256 fee);
    event FeeRecipientChanged(address feePool);
    event ForgeValidatorChanged(address forgeValidator);

    // Modules and connectors
    IForgeValidator public forgeValidator;
    bool private forgeValidatorLocked = false;
    IBasketManager private basketManager;

    // Basic redemption fee information
    address public feeRecipient;
    uint256 public swapFee;
    uint256 private constant MAX_FEE = 2e16;

    constructor (
        string memory _name,
        string memory _symbol,
        address _nexus,
        address _feeRecipient,
        address _forgeValidator,
        address _basketManager
    )
        MassetToken(
            _name,
            _symbol
        )
        Module(
            _nexus
        )
        public
    {
        feeRecipient = _feeRecipient;
        forgeValidator = IForgeValidator(_forgeValidator);

        basketManager = IBasketManager(_basketManager);

        swapFee = 4e15;
    }

    /**
      * @dev Verifies that the caller is the Savings Manager contract
      */
    modifier onlySavingsManager() {
        require(_savingsManager() == msg.sender, "Must be savings manager");
        _;
    }


    /***************************************
                MINTING (PUBLIC)
    ****************************************/

    /**
     * @dev Mint a single bAsset, at a 1:1 ratio with the bAsset. This contract
     *      must have approval to spend the senders bAsset
     * @param _bAsset         Address of the bAsset to mint
     * @param _bAssetQuantity Quantity in bAsset units
     * @return massetMinted   Number of newly minted mAssets
     */
    function mint(
        address _bAsset,
        uint256 _bAssetQuantity
    )
        external
        returns (uint256 massetMinted)
    {
        return _mintTo(_bAsset, _bAssetQuantity, msg.sender);
    }

    /**
     * @dev Mint a single bAsset, at a 1:1 ratio with the bAsset. This contract
     *      must have approval to spend the senders bAsset
     * @param _bAsset         Address of the bAsset to mint
     * @param _bAssetQuantity Quantity in bAsset units
     * @param _recipient receipient of the newly minted mAsset tokens
     * @return massetMinted   Number of newly minted mAssets
     */
    function mintTo(
        address _bAsset,
        uint256 _bAssetQuantity,
        address _recipient
    )
        external
        returns (uint256 massetMinted)
    {
        return _mintTo(_bAsset, _bAssetQuantity, _recipient);
    }

    /**
     * @dev Mint with multiple bAssets, at a 1:1 ratio to mAsset. This contract
     *      must have approval to spend the senders bAssets
     * @param _bAssets          Non-duplicate address array of bAssets with which to mint
     * @param _bAssetQuantity   Quantity of each bAsset to mint. Order of array
     *                          should mirror the above
     * @param _recipient        Address to receive the newly minted mAsset tokens
     * @return massetMinted     Number of newly minted mAssets
     */
    function mintMulti(
        address[] calldata _bAssets,
        uint256[] calldata _bAssetQuantity,
        address _recipient
    )
        external
        returns(uint256 massetMinted)
    {
        return _mintTo(_bAssets, _bAssetQuantity, _recipient);
    }

    /***************************************
              MINTING (INTERNAL)
    ****************************************/

    /** @dev Mint Single */
    function _mintTo(
        address _bAsset,
        uint256 _bAssetQuantity,
        address _recipient
    )
        internal
        nonReentrant
        returns (uint256 massetMinted)
    {
        require(_recipient != address(0), "Must be a valid recipient");
        require(_bAssetQuantity > 0, "Quantity must not be 0");

        ForgeProps memory props = basketManager.prepareForgeBasset(_bAsset, _bAssetQuantity, true);
        if(!props.isValid) return 0;

        // Transfer collateral to the platform integration address and call deposit
        address integrator = props.integrator;
        (uint256 quantityDeposited, uint256 ratioedDeposit) =
            _depositTokens(_bAsset, props.bAsset.ratio, integrator, props.bAsset.isTransferFeeCharged, _bAssetQuantity);

        // Validation should be after token transfer, as bAssetQty is unknown before
        (bool mintValid, string memory reason) = forgeValidator.validateMint(totalSupply(), props.bAsset, quantityDeposited);
        require(mintValid, reason);

        // Log the Vault increase - can only be done when basket is healthy
        basketManager.increaseVaultBalance(props.index, integrator, quantityDeposited);

        // Mint the Masset
        _mint(_recipient, ratioedDeposit);
        emit Minted(_recipient, ratioedDeposit, _bAsset, quantityDeposited);

        return ratioedDeposit;
    }

    /** @dev Mint Multi */
    function _mintTo(
        address[] memory _bAssets,
        uint256[] memory _bAssetQuantities,
        address _recipient
    )
        internal
        nonReentrant
        returns (uint256 massetMinted)
    {
        require(_recipient != address(0), "Must be a valid recipient");
        uint256 len = _bAssetQuantities.length;
        require(len > 0 && len == _bAssets.length, "Input array mismatch");

        // Load only needed bAssets in array
        ForgePropsMulti memory props
            = basketManager.prepareForgeBassets(_bAssets, _bAssetQuantities, true);
        if(!props.isValid) return 0;

        uint256 mAssetQuantity = 0;
        uint256[] memory receivedQty = new uint256[](len);

        // Transfer the Bassets to the integrator, update storage and calc MassetQ
        for(uint256 i = 0; i < len; i++){
            uint256 bAssetQuantity = _bAssetQuantities[i];
            if(bAssetQuantity > 0){
                // bAsset == bAssets[i] == basket.bassets[indexes[i]]
                Basset memory bAsset = props.bAssets[i];

                (uint256 quantityDeposited, uint256 ratioedDeposit) =
                    _depositTokens(bAsset.addr, bAsset.ratio, props.integrators[i], bAsset.isTransferFeeCharged, bAssetQuantity);

                receivedQty[i] = quantityDeposited;
                mAssetQuantity = mAssetQuantity.add(ratioedDeposit);
            }
        }
        require(mAssetQuantity > 0, "No masset quantity to mint");

        basketManager.increaseVaultBalances(props.indexes, props.integrators, receivedQty);

        // Validate the proposed mint, after token transfer
        (bool mintValid, string memory reason) = forgeValidator.validateMintMulti(totalSupply(), props.bAssets, receivedQty);
        require(mintValid, reason);

        // Mint the Masset
        _mint(_recipient, mAssetQuantity);
        emit MintedMulti(_recipient, mAssetQuantity, _bAssets, _bAssetQuantities);

        return mAssetQuantity;
    }

    /** @dev Deposits tokens into the platform integration and returns the ratioed amount */
    function _depositTokens(
        address _bAsset,
        uint256 _bAssetRatio,
        address _integrator,
        bool _xferCharged,
        uint256 _quantity
    )
        internal
        returns (uint256 quantityDeposited, uint256 ratioedDeposit)
    {
        uint256 quantityTransferred = MassetHelpers.transferTokens(msg.sender, _integrator, _bAsset, _xferCharged, _quantity);
        uint256 deposited = IPlatformIntegration(_integrator).deposit(_bAsset, quantityTransferred, _xferCharged);
        quantityDeposited = StableMath.min(deposited, _quantity);
        ratioedDeposit = quantityDeposited.mulRatioTruncate(_bAssetRatio);
    }


    /***************************************
              REDEMPTION (PUBLIC)
    ****************************************/

    /**
     * @dev Credits the sender with a certain quantity of selected bAsset, in exchange for burning the
     *      relative mAsset quantity from the sender. Sender also incurs a small mAsset fee, if any.
     * @param _bAsset           Address of the bAsset to redeem
     * @param _bAssetQuantity   Units of the bAsset to redeem
     * @return massetMinted     Relative number of mAsset units burned to pay for the bAssets
     */
    function redeem(
        address _bAsset,
        uint256 _bAssetQuantity
    )
        external
        returns (uint256 massetRedeemed)
    {
        return _redeemTo(_bAsset, _bAssetQuantity, msg.sender);
    }

    /**
     * @dev Credits a recipient with a certain quantity of selected bAsset, in exchange for burning the
     *      relative Masset quantity from the sender. Sender also incurs a small fee, if any.
     * @param _bAsset           Address of the bAsset to redeem
     * @param _bAssetQuantity   Units of the bAsset to redeem
     * @param _recipient        Address to credit with withdrawn bAssets
     * @return massetMinted     Relative number of mAsset units burned to pay for the bAssets
     */
    function redeemTo(
        address _bAsset,
        uint256 _bAssetQuantity,
        address _recipient
    )
        external
        returns (uint256 massetRedeemed)
    {
        return _redeemTo(_bAsset, _bAssetQuantity, _recipient);
    }

    /**
     * @dev Credits a recipient with a certain quantity of selected bAssets, in exchange for burning the
     *      relative Masset quantity from the sender. Sender also incurs a small fee, if any.
     * @param _bAssets          Address of the bAssets to redeem
     * @param _bAssetQuantities Units of the bAssets to redeem
     * @param _recipient        Address to credit with withdrawn bAssets
     * @return massetMinted     Relative number of mAsset units burned to pay for the bAssets
     */
    function redeemTo(
        address[] calldata _bAssets,
        uint256[] calldata _bAssetQuantities,
        address _recipient
    )
        external
        returns (uint256 massetRedeemed)
    {
        return _redeemTo(_bAssets, _bAssetQuantities, _recipient);
    }

    /**
     * @dev Credits a recipient with a certain quantity of bAssets, in exchange for burning the
     *      relative mAsset quantity from the sender. Sender also incurs a small Masset fee, if any.
     * @param _mAssetQuantity   Quantity of mAsset to redeem
     * @param _recipient        Address to credit the withdrawn bAssets
     */
    function redeemMulti(
        uint256 _mAssetQuantity,
        address _recipient
    )
        external
    {
        _redeemMulti(_mAssetQuantity, _recipient);
    }

    /***************************************
              REDEMPTION (INTERNAL)
    ****************************************/

    /** @dev Casting to arrays for use in redeemMulti func */
    function _redeemTo(
        address _bAsset,
        uint256 _bAssetQuantity,
        address _recipient
    )
        internal
        returns (uint256 massetRedeemed)
    {
        address[] memory bAssets = new address[](1);
        uint256[] memory quantities = new uint256[](1);
        bAssets[0] = _bAsset;
        quantities[0] = _bAssetQuantity;
        return _redeemTo(bAssets, quantities, _recipient);
    }

    /** @dev Redeem mAsset for one or more bAssets */
    function _redeemTo(
        address[] memory _bAssets,
        uint256[] memory _bAssetQuantities,
        address _recipient
    )
        internal
        nonReentrant
        returns (uint256 massetRedeemed)
    {
        require(_recipient != address(0), "Must be a valid recipient");
        uint256 bAssetCount = _bAssetQuantities.length;
        require(bAssetCount > 0 && bAssetCount == _bAssets.length, "Input array mismatch");

        // Get high level basket info
        Basket memory basket = basketManager.getBasket();
        uint256 colRatio = StableMath.min(basket.collateralisationRatio, StableMath.getFullScale());

        // Prepare relevant data
        ForgePropsMulti memory props = basketManager.prepareForgeBassets(_bAssets, _bAssetQuantities, false);
        if(!props.isValid) return 0;

        // Validate redemption
        (bool redemptionValid, string memory reason, bool applyFee) =
            forgeValidator.validateRedemption(basket.failed, totalSupply().mulTruncate(colRatio), basket.bassets, props.indexes, _bAssetQuantities);
        require(redemptionValid, reason);

        uint256 mAssetQuantity = 0;

        // Calc total redeemed mAsset quantity
        for(uint256 i = 0; i < bAssetCount; i++){
            uint256 bAssetQuantity = _bAssetQuantities[i];
            if(bAssetQuantity > 0){
                // Calc equivalent mAsset amount
                uint256 ratioedBasset = bAssetQuantity.mulRatioTruncateCeil(props.bAssets[i].ratio);
                mAssetQuantity = mAssetQuantity.add(ratioedBasset);
            }
        }
        require(mAssetQuantity > 0, "Must redeem some bAssets");

        // Ensure payout is relevant to collateralisation ratio (if ratio is 90%, we burn more)
        mAssetQuantity = mAssetQuantity.divPrecisely(colRatio);

        // Apply fees, burn mAsset and return bAsset to recipient
        _settleRedemption(mAssetQuantity, props.bAssets, props.indexes, props.integrators, _bAssetQuantities, applyFee, _recipient);

        emit Redeemed(_recipient, msg.sender, mAssetQuantity, _bAssets, _bAssetQuantities);
        return mAssetQuantity;
    }


    /** @dev Redeem mAsset for a multiple bAssets */
    function _redeemMulti(
        uint256 _mAssetQuantity,
        address _recipient
    )
        internal
        nonReentrant
    {
        require(_recipient != address(0), "Must be a valid recipient");
        require(_mAssetQuantity > 0, "Must redeem some mAsset");

        // Fetch high level details
        RedeemPropsMulti memory props = basketManager.prepareRedeemMulti();
        uint256 colRatio = StableMath.min(props.colRatio, StableMath.getFullScale());
        uint256 collateralisedMassetQuantity = _mAssetQuantity.mulTruncate(colRatio);

        // Calculate redemption quantities
        (bool redemptionValid, string memory reason, uint256[] memory bAssetQuantities) =
            forgeValidator.calculateRedemptionMulti(collateralisedMassetQuantity, props.bAssets);
        require(redemptionValid, reason);

        // Apply fees, burn mAsset and return bAsset to recipient
        _settleRedemption(_mAssetQuantity, props.bAssets, props.indexes, props.integrators, bAssetQuantities, false, _recipient);

        emit RedeemedMulti(_recipient, msg.sender, _mAssetQuantity);
    }

    /**
     * @dev Internal func to update contract state post-redemption
     * @param _mAssetQuantity   Total amount of mAsset to burn from sender
     * @param _bAssets          Array of bAssets to redeem
     * @param _indices          Matching indices for the bAsset array
     * @param _integrators      Matching integrators for the bAsset array
     * @param _bAssetQuantities Array of bAsset quantities
     * @param _applyFee         Apply a fee to this redemption?
     * @param _recipient        Recipient of the bAssets
     */
    function _settleRedemption(
        uint256 _mAssetQuantity,
        Basset[] memory _bAssets,
        uint8[] memory _indices,
        address[] memory _integrators,
        uint256[] memory _bAssetQuantities,
        bool _applyFee,
        address _recipient
    ) internal {
        // Burn the full amount of Masset
        _burn(msg.sender, _mAssetQuantity);

        // Reduce the amount of bAssets marked in the vault
        basketManager.decreaseVaultBalances(_indices, _integrators, _bAssetQuantities);

        // Redemption has fee? Fetch the rate
        uint256 fee = _applyFee ? swapFee : 0;

        // Transfer the Bassets to the recipient
        uint256 bAssetCount = _bAssets.length;
        for(uint256 i = 0; i < bAssetCount; i++){
            address bAsset = _bAssets[i].addr;
            uint256 q = _bAssetQuantities[i];
            if(q > 0){
                // Deduct the redemption fee, if any
                q = _deductSwapFee(bAsset, q, fee);
                // Transfer the Bassets to the user
                IPlatformIntegration(_integrators[i]).withdraw(_recipient, bAsset, q, _bAssets[i].isTransferFeeCharged);
            }
        }
    }

    /**
     * @dev Pay the forging fee by burning relative amount of mAsset
     * @param _bAssetQuantity     Exact amount of bAsset being swapped out
     */
    function _deductSwapFee(address _asset, uint256 _bAssetQuantity, uint256 _feeRate)
    private
    returns (uint256 outputMinusFee) {
        if(_feeRate > 0){
            // e.g. for 500 massets.
            // feeRate == 1% == 1e16. _quantity == 5e20.
            // (5e20 * 1e16) / 1e18 = 5e18
            uint256 feeAmount = _bAssetQuantity.mulTruncate(_feeRate);
            outputMinusFee = _bAssetQuantity.sub(feeAmount);
            emit PaidFee(msg.sender, _asset, feeAmount);
        }
    }

    /***************************************
                    STATE
    ****************************************/

    /**
      * @dev Upgrades the version of ForgeValidator protocol. Governor can do this
      *      only while ForgeValidator is unlocked.
      * @param _newForgeValidator Address of the new ForgeValidator
      */
    function upgradeForgeValidator(address _newForgeValidator)
        external
        onlyGovernor
    {
        require(!forgeValidatorLocked, "Must be allowed to upgrade");
        require(_newForgeValidator != address(0), "Must be non null address");
        forgeValidator = IForgeValidator(_newForgeValidator);
        emit ForgeValidatorChanged(_newForgeValidator);
    }

    /**
      * @dev Locks the ForgeValidator into it's final form. Called by Governor
      */
    function lockForgeValidator()
        external
        onlyGovernor
    {
        forgeValidatorLocked = true;
    }

    /**
      * @dev Set the recipient address of redemption fees
      * @param _feeRecipient Address of the fee recipient
      */
    function setFeeRecipient(address _feeRecipient)
        external
        onlyGovernor
    {
        require(_feeRecipient != address(0), "Must be valid address");
        feeRecipient = _feeRecipient;

        emit FeeRecipientChanged(_feeRecipient);
    }

    /**
      * @dev Set the ecosystem fee for redeeming a mAsset
      * @param _swapFee Fee calculated in (%/100 * 1e18)
      */
    function setSwapFee(uint256 _swapFee)
        external
        onlyGovernor
    {
        require(_swapFee <= MAX_FEE, "Rate must be within bounds");
        swapFee = _swapFee;

        emit SwapFeeChanged(_swapFee);
    }

    /**
      * @dev Gets the address of the BasketManager for this mAsset
      * @return basketManager Address
      */
    function getBasketManager()
        external
        view
        returns (address)
    {
        return address(basketManager);
    }

    /***************************************
                    INFLATION
    ****************************************/

    /**
     * @dev Collects the interest generated from the Basket, minting a relative
     *      amount of mAsset and sending it over to the SavingsManager.
     * @return totalInterestGained   Equivalent amount of mAsset units that have been generated
     * @return newSupply             New total mAsset supply
     */
    function collectInterest()
        external
        onlySavingsManager
        nonReentrant
        returns (uint256 totalInterestGained, uint256 newSupply)
    {
        (uint256 interestCollected, uint256[] memory gains) = basketManager.collectInterest();

        // mint new mAsset to sender
        _mint(msg.sender, interestCollected);
        emit MintedMulti(address(this), interestCollected, new address[](0), gains);

        return (interestCollected, totalSupply());
    }
}
