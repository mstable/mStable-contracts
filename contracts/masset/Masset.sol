pragma solidity 0.5.16;
pragma experimental ABIEncoderV2;

// External
import { IBasketManager } from "../interfaces/IBasketManager.sol";
import { IForgeValidator } from "./forge-validator/IForgeValidator.sol";
import { IPlatform } from "./platform/IPlatform.sol";

// Internal
import { IMasset } from "../interfaces/IMasset.sol";
import { BasketManager } from "./BasketManager.sol";
import { MassetToken } from "./MassetToken.sol";
import { PausableModule } from "../shared/PausableModule.sol";
import { MassetStructs } from "./shared/MassetStructs.sol";

// Libs
import { StableMath } from "../shared/StableMath.sol";
import { SafeERC20 }  from "openzeppelin-solidity/contracts/token/ERC20/SafeERC20.sol";
import { IERC20 }     from "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";

/**
 * @title Masset
 * @author Stability Labs Pty Ltd
 * @dev Base layer functionality for the Masset
 */
contract Masset is IMasset, MassetToken, PausableModule {

    using StableMath for uint256;
    using SafeERC20 for IERC20;

    /** @dev Forging events */
    event Minted(address indexed account, uint256 massetQuantity, uint8 bAsset, uint256 bAssetQuantity);
    event MintedMulti(address indexed account, uint256 massetQuantity, uint256 bitmap, uint256[] bAssetQuantities);
    event Redeemed(address indexed recipient, address redeemer, uint256 massetQuantity, uint8 bAsset, uint256 bAssetQuantity);
    event RedeemedMulti(address indexed recipient, address redeemer, uint256 massetQuantity, uint256 bitmap, uint256[] bAssetQuantities);
    event PaidFee(address payer, uint256 feeQuantity, uint256 feeRate);

    /** @dev State events */
    event RedemptionFeeChanged(uint256 fee);
    event FeeRecipientChanged(address feePool);

    /** @dev Modules */
    IForgeValidator public forgeValidator;
    bool internal forgeValidatorLocked = false;
    IBasketManager private basketManager;

    /** @dev Meta information for ecosystem fees */
    address public feeRecipient;
    uint256 public redemptionFee;
    uint256 internal constant maxFee = 1e17;


    /** @dev constructor */
    constructor (
        string memory _name,
        string memory _symbol,
        address _nexus,
        address _feeRecipient,
        address _forgeValidator
    )
        MassetToken(
            _name,
            _symbol,
            18
        )
        PausableModule(
            _nexus
        )
        public
    {
        feeRecipient = _feeRecipient;
        forgeValidator = IForgeValidator(_forgeValidator);
        // address newBasketManager = address(
        //     new BasketManager(
        //         _nexus,
        //         address(this),
        //         _bassets,
        //         new address[],
        //         _weights,
        //         _hasTransferFees
        //     )
        // );
        // basketManager = IBasketManager(newBasketManager);
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
     * @dev Mint a single bAsset
     * @param _basset bAsset address to mint
     * @param _bassetQuantity bAsset quantity to mint
     * @return returns the number of newly minted mAssets
     */
    function mint(
        uint8 _basset,
        uint256 _bassetQuantity
    )
        external
        whenNotPaused
        returns (uint256 massetMinted)
    {
        return _mintTo(_basset, _bassetQuantity, msg.sender);
    }

    /**
     * @dev Mint a single bAsset
     * @param _basset bAsset address to mint
     * @param _bassetQuantity bAsset quantity to mint
     * @param _recipient receipient of the newly minted mAsset tokens
     * @return returns the number of newly minted mAssets
     */
    function mintTo(
        uint8 _basset,
        uint256 _bassetQuantity,
        address _recipient
    )
        external
        whenNotPaused
        returns (uint256 massetMinted)
    {
        return _mintTo(_basset, _bassetQuantity, _recipient);
    }

    /**
     * @dev Mint with bAsset addresses in bitmap
     * @param _bassetsBitmap bAssets index in bitmap
     * @param _bassetQuantity bAsset's quantity to send
     * @return massetMinted returns the number of newly minted mAssets
     */
    function mintMulti(
        uint32 _bassetsBitmap,
        uint256[] calldata _bassetQuantity,
        address _recipient
    )
        external
        whenNotPaused
        returns(uint256 massetMinted)
    {
        return _mintTo(_bassetsBitmap, _bassetQuantity, _recipient);
    }

    /***************************************
              MINTING (INTERNAL)
    ****************************************/

    /**
     * @dev Mints a number of Massets based on a Basset user sends
     * @param _bAsset Address of Basset user sends
     * @param _bAssetQuantity Exact units of Basset user wants to send to contract
     * @param _recipient Address to which the Masset should be minted
     */
    function _mintTo(
        uint8 _bAsset,
        uint256 _bAssetQuantity,
        address _recipient
    )
        internal
        returns (uint256 massetMinted)
    {
        Basket memory basket = basketManager.getBasket();
        require(!basket.failed, "Basket must be healthy");

        require(_recipient != address(0), "Recipient must not be 0x0");
        require(_bAssetQuantity > 0, "Quantity must not be 0");

        Basset memory b = _selectBasset(basket.bassets, _bAsset);

        uint256 bAssetQty = IPlatform(b.integrator).deposit(msg.sender, b.addr, _bAssetQuantity, b.isTransferFeeCharged);

        // Validation should be after token transfer, as bAssetQty is unknown before
        (bool isValid, string memory reason) = forgeValidator.validateMint(totalSupply(), b, bAssetQty);
        require(isValid, reason);

        basketManager.increaseVaultBalance(_bAsset, bAssetQty);
        // ratioedBasset is the number of masset quantity to mint
        uint256 ratioedBasset = bAssetQty.mulRatioTruncate(b.ratio);

        // Mint the Masset
        _mint(_recipient, ratioedBasset);
        emit Minted(_recipient, ratioedBasset, _bAsset, bAssetQty);

        return ratioedBasset;
    }

    /**
     * @dev Mints a number of Massets based on the sum of the value of the Bassets
     * @param _bassetsBitmap bits set in bitmap represent position of bAssets to use
     * @param _bassetQuantity Exact units of Bassets to mint
     * @param _recipient Address to which the Masset should be minted
     * @return number of newly minted mAssets
     */
    function _mintTo(
        uint32 _bassetsBitmap,
        uint256[] memory _bassetQuantity,
        address _recipient
    )
        internal
        returns (uint256 massetMinted)
    {
        Basket memory basket = basketManager.getBasket();
        require(!basket.failed, "Basket must be healthy");

        require(_recipient != address(0), "Recipient must not be 0x0");
        uint256 len = _bassetQuantity.length;

        // Load only needed bAssets in array
        (Basset[] memory bAssets, uint8[] memory indexes)
            = basketManager.convertBitmapToBassets(_bassetsBitmap, uint8(len));

        uint256 massetQuantity = 0;

        uint256[] memory receivedQty = new uint256[](len);
        // Transfer the Bassets to the integrator, update storage and calc MassetQ
        for(uint256 i = 0; i < len; i++){
            if(_bassetQuantity[i] > 0){
                // bAsset == bAssets[i] == basket.bassets[indexes[i]]
                Basset memory bAsset = bAssets[i];

                uint256 receivedBassetQty = IPlatform(bAsset.integrator).deposit(msg.sender, bAsset.addr, _bassetQuantity[i], bAsset.isTransferFeeCharged);
                receivedQty[i] = receivedBassetQty;

                basketManager.increaseVaultBalance(indexes[i], receivedBassetQty);

                uint256 ratioedBasset = receivedBassetQty.mulRatioTruncate(bAsset.ratio);
                massetQuantity = massetQuantity.add(ratioedBasset);
            }
        }

        // Validate the proposed mint, after token transfer, as bAsset quantity is unknown until transferred
        (bool isValid, string memory reason) = forgeValidator.validateMint(totalSupply(), bAssets, receivedQty);
        require(isValid, reason);

        require(massetQuantity > 0, "No masset quantity to mint");

        // Mint the Masset
        _mint(_recipient, massetQuantity);
        emit MintedMulti(_recipient, massetQuantity, _bassetsBitmap, _bassetQuantity);

        return massetQuantity;
    }

    /***************************************
              REDEMPTION (PUBLIC)
    ****************************************/

    /**
     * @dev Redeems a certain quantity of Bassets, in exchange for burning the relative Masset quantity from the User
     * @param _bassetQuantity Exact quantities of Bassets to redeem
     */
    function redeem(
        uint8 _basset,
        uint256 _bassetQuantity
    )
        external
        whenNotPaused
        returns (uint256 massetRedeemed)
    {
        return _redeem(_basset, _bassetQuantity, msg.sender);
    }


    function redeemTo(
        uint8 _basset,
        uint256 _bassetQuantity,
        address _recipient
    )
        external
        whenNotPaused
        returns (uint256 massetRedeemed)
    {
        return _redeem(_basset, _bassetQuantity, _recipient);
    }


    /**
     * @dev Redeems a certain quantity of Bassets, in exchange for burning the relative Masset quantity from the User
     * @param _bassetQuantities Exact quantities of Bassets to redeem
     * @param _recipient Account to which the redeemed Bassets should be sent
     */
    function redeemMulti(
        uint32 _bassetsBitmap,
        uint256[] calldata _bassetQuantities,
        address _recipient
    )
        external
        whenNotPaused
        returns (uint256 massetRedeemed)
    {
        require(_recipient != address(0), "Recipient must not be 0x0");
        uint256 redemptionAssetCount = _bassetQuantities.length;

        // Fetch high level details
        Basket memory basket = basketManager.getBasket();

        // Load only needed bAssets in array
        (Basset[] memory bAssets, uint8[] memory indexes)
            = basketManager.convertBitmapToBassets(_bassetsBitmap, uint8(redemptionAssetCount));

        // Validate redemption
        (bool isValid, string memory reason) =
            forgeValidator.validateRedemption(basket.bassets, basket.failed, totalSupply(), indexes, _bassetQuantities);
        require(isValid, reason);

        uint256 massetQuantity = 0;

        // Calc MassetQ and update the Vault
        for(uint256 i = 0; i < redemptionAssetCount; i++){
            if(_bassetQuantities[i] > 0){
                // Calc equivalent mAsset amount
                uint256 ratioedBasset = _bassetQuantities[i].mulRatioTruncateCeil(bAssets[i].ratio);
                massetQuantity = massetQuantity.add(ratioedBasset);

                // bAsset == bAssets[i] == basket.bassets[indexes[i]]
                basketManager.decreaseVaultBalance(indexes[i], _bassetQuantities[i]);
            }
        }

        // Pay the redemption fee
        _payRedemptionFee(massetQuantity, msg.sender);

        // Ensure payout is relevant to collateralisation ratio (if ratio is 90%, we burn more)
        massetQuantity = massetQuantity.divPrecisely(basket.collateralisationRatio);

        // Burn the Masset
        _burn(msg.sender, massetQuantity);

        // Transfer the Bassets to the user
        for(uint256 i = 0; i < redemptionAssetCount; i++){
            if(_bassetQuantities[i] > 0){
                IPlatform(bAssets[i].integrator).withdraw(_recipient, bAssets[i].addr, _bassetQuantities[i]);
            }
        }

        emit RedeemedMulti(_recipient, msg.sender, massetQuantity, _bassetsBitmap, _bassetQuantities);
        return massetQuantity;
    }

    /***************************************
              REDEMPTION (INTERNAL)
    ****************************************/

    /**
     * @dev Redeems a certain quantity of Bassets, in exchange for burning the relative Masset quantity from the User
     * @param _bAsset Addr
     * @param _bAssetQuantity Exact quantities of Bassets to redeem
     * @param _recipient Account to which the redeemed Bassets should be sent
     */
    function _redeem(
        uint8 _bAsset,
        uint256 _bAssetQuantity,
        address _recipient
    )
        internal
        returns (uint256 massetRedeemed)
    {
        require(_recipient != address(0), "Recipient must not be 0x0");
        require(_bAssetQuantity > 0, "Quantity must not be 0");

        Basket memory basket = basketManager.getBasket();

        // Fetch bAsset from array
        Basset memory b = _selectBasset(basket.bassets, _bAsset);

        // Validate redemption
        (bool isValid, string memory reason) =
            forgeValidator.validateRedemption(basket.bassets, basket.failed, totalSupply(), _bAsset, _bAssetQuantity);
        require(isValid, reason);

        // Calc equivalent mAsset amount
        uint256 massetQuantity = _bAssetQuantity.mulRatioTruncateCeil(b.ratio);

        // Decrease balance in storage
        basketManager.decreaseVaultBalance(_bAsset, _bAssetQuantity);

        // Pay the redemption fee
        _payRedemptionFee(massetQuantity, msg.sender);

        // Ensure payout is relevant to collateralisation ratio (if ratio is 90%, we burn more)
        massetQuantity = massetQuantity.divPrecisely(basket.collateralisationRatio);

        // Burn the Masset
        _burn(msg.sender, massetQuantity);

        // Transfer the Bassets to the user
        IPlatform(b.integrator).withdraw(_recipient, b.addr, _bAssetQuantity);

        emit Redeemed(_recipient, msg.sender, massetQuantity, _bAsset, _bAssetQuantity);
        return massetQuantity;
    }

    /**
     * @dev Pay the forging fee by burning MetaToken
     * @param _quantity Exact amount of Masset being forged
     * @param _payer Address who is liable for the fee
     */
    function _payRedemptionFee(uint256 _quantity, address _payer)
    private {
        uint256 feeRate = redemptionFee;

        if(feeRate > 0){
            // e.g. for 500 massets.
            // feeRate == 1% == 1e16. _quantity == 5e20.
            uint256 amountOfMassetSubjectToFee = feeRate.mulTruncate(_quantity);

            require(transferFrom(_payer, feeRecipient, amountOfMassetSubjectToFee), "Must be successful fee payment");

            emit PaidFee(_payer, amountOfMassetSubjectToFee, feeRate);
        }
    }

    /***************************************
                    STATE
    ****************************************/

    /**
      * @dev Upgrades the version of ForgeValidator protocol
      * @param _newForgeValidator Address of the new ForgeValidator
      */
    function upgradeForgeValidator(address _newForgeValidator)
    external
    whenNotPaused
    managerOrGovernor {
        require(!forgeValidatorLocked, "Must be allowed to upgrade");
        require(_newForgeValidator != address(0), "Must be non null address");
        forgeValidator = IForgeValidator(_newForgeValidator);
    }

    /**
      * @dev Locks the ForgeValidator into it's final form
      */
    function lockForgeValidator()
    external
    whenNotPaused
    managerOrGovernor {
        forgeValidatorLocked = true;
    }

    /**
      * @dev Set the recipient address of forge fees
      * @param _feeRecipient Address of the fee pool
      */
    function setFeeRecipient(address _feeRecipient)
    external
    whenNotPaused
    managerOrGovernor {
        require(_feeRecipient != address(0), "Must be valid address");
        feeRecipient = _feeRecipient;
        emit FeeRecipientChanged(_feeRecipient);
    }

    /**
      * @dev Set the ecosystem fee for redeeming a masset
      * @param _redemptionFee Fee calculated in (%/100 * 1e18)
      */
    function setRedemptionFee(uint256 _redemptionFee)
    external
    whenNotPaused
    managerOrGovernor {
        require(_redemptionFee <= maxFee, "Redemption fee > maxFee");
        redemptionFee = _redemptionFee;
        emit RedemptionFeeChanged(_redemptionFee);
    }

    function getBasketManager()
    external
    view
    returns (address) {
        return address(basketManager);
    }

    /***************************************
                    INFLATION
    ****************************************/

    function collectInterest()
        external
        onlySavingsManager
        whenNotPaused
        returns (uint256 totalInterestGained, uint256 newSupply)
    {
        totalInterestGained = 0;
        // get basket details from BasketManager
        (Basset[] memory allBassets, uint256 bitmap, uint256 count) = basketManager.getBassets();
        uint256[] memory gains = new uint256[](count);
        // foreach bAsset
        for(uint256 i = 0; i < count; i++) {
            Basset memory b = allBassets[i];
            // call each integration to `checkBalance`
            uint256 balance = IPlatform(b.integrator).checkBalance(b.addr);
            // accumulate interestdelta (ratioed bAsset
            if(balance > b.vaultBalance) {
                uint256 interestDelta = balance.sub(b.vaultBalance);
                gains[i] = interestDelta;
                uint256 ratioedDelta = interestDelta.mulRatioTruncate(b.ratio);
                totalInterestGained = totalInterestGained.add(ratioedDelta);
            } else {
                gains[i] = 0;
            }
        }
        // Validate collection and increase balances
        require(basketManager.logInterest(gains), "Must be a valid inflation");
        // mint new mAsset to sender
        _mint(msg.sender, totalInterestGained);
        emit MintedMulti(msg.sender, totalInterestGained, bitmap, gains);

        newSupply = totalSupply();
    }

    function _selectBasset(Basset[] memory allBassets, uint8 _index)
        internal
        pure
        returns (
            Basset memory bAsset
        )
    {
        require(allBassets.length > _index, "Basset does not exist");
        return allBassets[_index];
    }
}
