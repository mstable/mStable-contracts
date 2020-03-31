pragma solidity 0.5.16;
pragma experimental ABIEncoderV2;

// External
import { IForgeValidator } from "./forge-validator/IForgeValidator.sol";
import { IPlatformIntegration } from "../interfaces/IPlatformIntegration.sol";
import { IBasketManager } from "../interfaces/IBasketManager.sol";

// Internal
import { IMasset } from "../interfaces/IMasset.sol";
import { MassetToken } from "./MassetToken.sol";
import { PausableModule } from "../shared/PausableModule.sol";
import { MassetStructs } from "./shared/MassetStructs.sol";

// Libs
import { StableMath } from "../shared/StableMath.sol";
import { MassetHelpers } from "./shared/MassetHelpers.sol";
import { SafeERC20 }  from "openzeppelin-solidity/contracts/token/ERC20/SafeERC20.sol";
import { IERC20 }     from "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import { ReentrancyGuard } from "openzeppelin-solidity/contracts/utils/ReentrancyGuard.sol";

/**
 * @title   Masset
 * @author  Stability Labs Pty. Lte.
 * @notice  The Masset is a token that allows minting and redemption at a 1:1 ratio
 *          for underlying basket assets (bAssets) of the same peg (i.e. USD,
 *          EUR, gGold). Composition and validation is enforced via the BasketManager.
 */
contract Masset is IMasset, MassetToken, PausableModule {

    using StableMath for uint256;
    using SafeERC20 for IERC20;

    // Forging Events
    event Minted(address indexed account, uint256 massetQuantity, address bAsset, uint256 bAssetQuantity);
    event MintedMulti(address indexed account, uint256 massetQuantity, uint256 bitmap, uint256[] bAssetQuantities);
    event Redeemed(address indexed recipient, address redeemer, uint256 massetQuantity, address bAsset, uint256 bAssetQuantity);
    event RedeemedMulti(address indexed recipient, address redeemer, uint256 massetQuantity, uint256 bitmap, uint256[] bAssetQuantities);
    event PaidFee(address payer, uint256 feeQuantity, uint256 feeRate);

    // State Events
    event RedemptionFeeChanged(uint256 fee);
    event FeeRecipientChanged(address feePool);
    event ForgeValidatorChanged(address forgeValidator);

    // Modules and connectors
    IForgeValidator public forgeValidator;
    bool internal forgeValidatorLocked = false;
    IBasketManager private basketManager;

    // Basic redemption fee information
    address public feeRecipient;
    uint256 public redemptionFee;
    uint256 internal constant maxFee = 1e17;

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
        PausableModule(
            _nexus
        )
        public
    {
        feeRecipient = _feeRecipient;
        forgeValidator = IForgeValidator(_forgeValidator);

        basketManager = IBasketManager(_basketManager);

        redemptionFee = 2e16;
    }

    /**
      * @dev Verifies that the caller either Manager or Gov
      */
    modifier managerOrGovernor() {
        require(_manager() == msg.sender || _governor() == msg.sender, "Must be manager or governance");
        _;
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
        whenNotPaused
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
        whenNotPaused
        returns (uint256 massetMinted)
    {
        return _mintTo(_bAsset, _bAssetQuantity, _recipient);
    }

    /**
     * @dev Mint with multiple bAssets, at a 1:1 ratio to mAsset. This contract
     *      must have approval to spend the senders bAssets
     * @param _bAssetsBitmap    Indexes that we should mint with in a bitmap
     * @param _bAssetQuantity   Quantity of each bAsset to mint
     * @param _recipient        Address to receive the newly minted mAsset tokens
     * @return massetMinted     Number of newly minted mAssets
     */
    function mintMulti(
        uint32 _bAssetsBitmap,
        uint256[] calldata _bAssetQuantity,
        address _recipient
    )
        external
        whenNotPaused
        returns(uint256 massetMinted)
    {
        return _mintTo(_bAssetsBitmap, _bAssetQuantity, _recipient);
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
        returns (uint256 massetMinted)
    {
        require(_recipient != address(0), "Recipient must not be 0x0");
        require(_bAssetQuantity > 0, "Quantity must not be 0");

        ForgeProps memory props = basketManager.prepareForgeBasset(_bAsset, true);
        if(!props.isValid) return 0;

        // Transfer collateral to the platform integration address and call deposit
        bool xferCharged = props.bAsset.isTransferFeeCharged;
        address integrator = props.integrator;
        uint256 quantityTransferred = MassetHelpers.transferTokens(msg.sender, integrator, _bAsset, xferCharged, _bAssetQuantity);
        uint256 quantityDeposited = IPlatformIntegration(integrator).deposit(_bAsset, quantityTransferred, xferCharged);

        // Validation should be after token transfer, as bAssetQty is unknown before
        (bool mintValid, string memory reason) = forgeValidator.validateMint(totalSupply(), props.grace, props.bAsset, quantityDeposited);
        require(mintValid, reason);

        // Log the Vault increase - can only be done when basket is healthy
        basketManager.increaseVaultBalance(props.index, integrator, quantityDeposited);

        // ratioedBasset is the number of masset quantity to mint
        uint256 ratioedBasset = quantityDeposited.mulRatioTruncate(props.bAsset.ratio);

        // Mint the Masset
        _mint(_recipient, ratioedBasset);
        emit Minted(_recipient, ratioedBasset, _bAsset, quantityDeposited);

        return ratioedBasset;
    }

    /** @dev Mint Multi */
    function _mintTo(
        uint32 _bAssetsBitmap,
        uint256[] memory _bAssetQuantity,
        address _recipient
    )
        internal
        returns (uint256 massetMinted)
    {
        require(_recipient != address(0), "Recipient must not be 0x0");
        uint256 len = _bAssetQuantity.length;

        // Load only needed bAssets in array
        ForgePropsMulti memory props
            = basketManager.prepareForgeBassets(_bAssetsBitmap, uint8(len), true);
        if(!props.isValid) return 0;

        uint256 massetQuantity = 0;

        uint256[] memory receivedQty = new uint256[](len);
        // Transfer the Bassets to the integrator, update storage and calc MassetQ
        for(uint256 i = 0; i < len; i++){
            uint256 bAssetQuantity = _bAssetQuantity[i];
            if(bAssetQuantity > 0){
                // bAsset == bAssets[i] == basket.bassets[indexes[i]]
                Basset memory bAsset = props.bAssets[i];

                address integrator = props.integrators[i];
                bool xferCharged = bAsset.isTransferFeeCharged;

                uint256 quantityTransfered = MassetHelpers.transferTokens(msg.sender, integrator, bAsset.addr, xferCharged, bAssetQuantity);
                uint256 quantityDeposited = IPlatformIntegration(integrator).deposit(bAsset.addr, quantityTransfered, xferCharged);
                receivedQty[i] = quantityDeposited;

                basketManager.increaseVaultBalance(props.indexes[i], integrator, quantityDeposited);

                uint256 ratioedBasset = quantityDeposited.mulRatioTruncate(bAsset.ratio);
                massetQuantity = massetQuantity.add(ratioedBasset);
            }
        }

        // Validate the proposed mint, after token transfer, as bAsset quantity is unknown until transferred
        (bool mintValid, string memory reason) = forgeValidator.validateMint(totalSupply(), props.grace, props.bAssets, receivedQty);
        require(mintValid, reason);

        require(massetQuantity > 0, "No masset quantity to mint");

        // Mint the Masset
        _mint(_recipient, massetQuantity);
        emit MintedMulti(_recipient, massetQuantity, _bAssetsBitmap, _bAssetQuantity);

        return massetQuantity;
    }

    /***************************************
              REDEMPTION (PUBLIC)
    ****************************************/

    /**
     * @dev Redeems a certain quantity of Bassets, in exchange for burning the relative Masset
     *      quantity from the sender. Sender also incurs a small Masset fee, if any.
     * @param _bAsset           Address of the bAsset to redeem
     * @param _bAssetQuantity   Units of the bAsset to redeem
     * @return massetMinted     Relative number of mAsset units burned to pay for the bAssets
     */
    function redeem(
        address _bAsset,
        uint256 _bAssetQuantity
    )
        external
        whenNotPaused
        returns (uint256 massetRedeemed)
    {
        return _redeemTo(_bAsset, _bAssetQuantity, msg.sender);
    }

    /**
     * @dev Redeems a certain quantity of Bassets, in exchange for burning the relative Masset
     *      quantity from the sender. Sender also incurs a small Masset fee, if any.
     * @param _bAsset           Address of the bAsset to redeem
     * @param _bAssetQuantity   Units of the bAsset to redeem
     * @return massetMinted     Relative number of mAsset units burned to pay for the bAssets
     */
    function redeemTo(
        address _bAsset,
        uint256 _bAssetQuantity,
        address _recipient
    )
        external
        whenNotPaused
        returns (uint256 massetRedeemed)
    {
        return _redeemTo(_bAsset, _bAssetQuantity, _recipient);
    }

    /**
     * @dev Redeems a certain quantity of Bassets, in exchange for burning the relative Masset
     *      quantity from the sender. Sender also incurs a small Masset fee, if any.
     * @param _bAssetsBitmap    Indexes that we should redeem with in a bitmap
     * @param _bAssetQuantities Quantity of each bAsset to redeem
     * @param _recipient        Address to receive the withdrawn bAssets
     * @return massetMinted     Relative number of mAsset units burned to pay for the bAssets
     */
    function redeemMulti(
        uint32 _bAssetsBitmap,
        uint256[] calldata _bAssetQuantities,
        address _recipient
    )
        external
        whenNotPaused
        returns (uint256 massetRedeemed)
    {
        return _redeemTo(_bAssetsBitmap, _bAssetQuantities, _recipient);
    }

    /***************************************
              REDEMPTION (INTERNAL)
    ****************************************/

    /** @dev Redeem Single */
    function _redeemTo(
        address _bAsset,
        uint256 _bAssetQuantity,
        address _recipient
    )
        internal
        returns (uint256 massetRedeemed)
    {
        require(_recipient != address(0), "Recipient must not be 0x0");
        require(_bAssetQuantity > 0, "Quantity must not be 0");

        Basket memory basket = basketManager.getBasket();
        uint256 colRatio = basket.collateralisationRatio;

        ForgeProps memory props = basketManager.prepareForgeBasset(_bAsset, false);
        if(!props.isValid) return 0;

        // Validate redemption
        (bool redemptionValid, string memory reason) =
            forgeValidator.validateRedemption(basket.failed, totalSupply().mulTruncate(colRatio), basket.bassets, props.grace, props.index, _bAssetQuantity);
        require(redemptionValid, reason);

        // Calc equivalent mAsset amount
        uint256 massetQuantity = _bAssetQuantity.mulRatioTruncateCeil(props.bAsset.ratio);

        // Decrease balance in storage
        basketManager.decreaseVaultBalance(props.index, props.integrator, _bAssetQuantity);

        // Pay the redemption fee
        _payRedemptionFee(massetQuantity);

        // Ensure payout is relevant to collateralisation ratio (if ratio is 90%, we burn more)
        massetQuantity = massetQuantity.divPrecisely(colRatio);

        // Burn the Masset
        _burn(msg.sender, massetQuantity);

        // Transfer the Bassets to the user
        IPlatformIntegration(props.integrator).withdraw(_recipient, props.bAsset.addr, _bAssetQuantity, props.bAsset.isTransferFeeCharged);

        emit Redeemed(_recipient, msg.sender, massetQuantity, _bAsset, _bAssetQuantity);
        return massetQuantity;
    }

    /** @dev Redeem Multi */
    function _redeemTo(
        uint32 _bAssetsBitmap,
        uint256[] memory _bAssetQuantities,
        address _recipient
    )
        internal
        returns (uint256 massetRedeemed)
    {
        require(_recipient != address(0), "Recipient must not be 0x0");
        uint256 redemptionAssetCount = _bAssetQuantities.length;

        // Fetch high level details
        Basket memory basket = basketManager.getBasket();
        uint256 colRatio = basket.collateralisationRatio;

        // Load only needed bAssets in array
        ForgePropsMulti memory props
            = basketManager.prepareForgeBassets(_bAssetsBitmap, uint8(redemptionAssetCount), false);
        if(!props.isValid) return 0;

        // Validate redemption
        (bool redemptionValid, string memory reason) =
            forgeValidator.validateRedemption(basket.failed, totalSupply().mulTruncate(colRatio), props.grace, props.indexes, _bAssetQuantities, basket.bassets);
        require(redemptionValid, reason);

        uint256 massetQuantity = 0;

        // Calc MassetQ and update the Vault
        for(uint256 i = 0; i < redemptionAssetCount; i++){
            uint256 bAssetQuantity = _bAssetQuantities[i];
            if(bAssetQuantity > 0){
                // Calc equivalent mAsset amount
                uint256 ratioedBasset = bAssetQuantity.mulRatioTruncateCeil(props.bAssets[i].ratio);
                massetQuantity = massetQuantity.add(ratioedBasset);

                // bAsset == bAssets[i] == basket.bassets[indexes[i]]
                basketManager.decreaseVaultBalance(props.indexes[i], props.integrators[i], bAssetQuantity);
            }
        }

        // Pay the redemption fee
        _payRedemptionFee(massetQuantity);

        // Ensure payout is relevant to collateralisation ratio (if ratio is 90%, we burn more)
        massetQuantity = massetQuantity.divPrecisely(colRatio);

        // Burn the Masset
        _burn(msg.sender, massetQuantity);

        // Transfer the Bassets to the user
        for(uint256 i = 0; i < redemptionAssetCount; i++){
            if(_bAssetQuantities[i] > 0){
                IPlatformIntegration(props.integrators[i]).withdraw(_recipient, props.bAssets[i].addr, _bAssetQuantities[i], props.bAssets[i].isTransferFeeCharged);
            }
        }

        emit RedeemedMulti(_recipient, msg.sender, massetQuantity, _bAssetsBitmap, _bAssetQuantities);
        return massetQuantity;
    }


    /**
     * @dev Pay the forging fee by burning relative amount of Masset
     * @param _quantity     Exact amount of Masset being forged
     */
    function _payRedemptionFee(uint256 _quantity)
    private {
        uint256 feeRate = redemptionFee;

        if(feeRate > 0){
            // e.g. for 500 massets.
            // feeRate == 1% == 1e16. _quantity == 5e20.
            // (5e20 * 1e16) / 1e18 = 5e18
            uint256 amountOfMassetSubjectToFee = _quantity.mulTruncate(feeRate);

            _transfer(msg.sender, feeRecipient, amountOfMassetSubjectToFee);

            emit PaidFee(msg.sender, amountOfMassetSubjectToFee, feeRate);
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
    managerOrGovernor {
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
    onlyGovernor {
        forgeValidatorLocked = true;
    }

    /**
      * @dev Set the recipient address of redemption fees
      * @param _feeRecipient Address of the fee recipient
      */
    function setFeeRecipient(address _feeRecipient)
    external
    managerOrGovernor {
        require(_feeRecipient != address(0), "Must be valid address");
        feeRecipient = _feeRecipient;

        emit FeeRecipientChanged(_feeRecipient);
    }

    /**
      * @dev Set the ecosystem fee for redeeming a mAsset
      * @param _redemptionFee Fee calculated in (%/100 * 1e18)
      */
    function setRedemptionFee(uint256 _redemptionFee)
    external
    managerOrGovernor {
        require(_redemptionFee <= maxFee, "Redemption fee > maxFee");
        redemptionFee = _redemptionFee;
        emit RedemptionFeeChanged(_redemptionFee);
    }

    /**
      * @dev Gets the address of the BasketManager for this mAsset
      * @return basketManager Address
      */
    function getBasketManager()
    external
    view
    returns (address) {
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
        whenNotPaused
        returns (uint256 totalInterestGained, uint256 newSupply)
    {
        (uint256 interestCollected, uint32 bitmap, uint256[] memory gains) = basketManager.collectInterest();

        // mint new mAsset to sender
        _mint(msg.sender, interestCollected);
        emit MintedMulti(address(this), interestCollected, bitmap, gains);

        return (interestCollected, totalSupply());
    }
}
