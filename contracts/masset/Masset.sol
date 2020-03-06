pragma solidity 0.5.16;
pragma experimental ABIEncoderV2;

// External
import { IBasketManager } from "../interfaces/IBasketManager.sol";
import { IForgeValidator } from "./forge-validator/IForgeValidator.sol";

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

interface IPlatform {
    function deposit(
        address _spender,
        address _bAsset,
        uint256 _amount,
        bool _hasFee
    ) external returns (uint256 quantityDeposited);
    function withdraw(
        address _receiver,
        address _bAsset,
        uint256 _amount
    ) external;
    function checkBalance(address _bAsset) external returns (uint256 balance);
}

interface IManager {
    function getAssetPrices(address, address) external returns (uint256, uint256);
}

/**
 * @title Masset
 * @author Stability Labs Pty Ltd
 * @dev Base layer functionality for the Masset
 */
contract Masset is IMasset, MassetToken, PausableModule {

    using StableMath for uint256;
    using SafeERC20 for IERC20;

    /** @dev Forging events */
    event Minted(address indexed account, uint256 massetQuantity, uint256[] bAssetQuantities);
    event Minted(address indexed account, uint256 massetQuantity, uint256 bAssetQuantity);
    event PaidFee(address payer, uint256 feeQuantity, uint256 feeRate);
    event Redeemed(address indexed recipient, address redeemer, uint256 massetQuantity, uint256[] bAssetQuantities);
    event RedeemedSingle(address indexed recipient, address redeemer, uint256 massetQuantity, uint256 index, uint256 bAssetQuantity);

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
    bool private metaFee = false;
    uint256 internal constant maxFee = 1e17;


    /** @dev constructor */
    constructor (
        string memory _name,
        string memory _symbol,
        address _nexus,
        address _feeRecipient,
        address _forgeValidator,
        address[] memory _bassets,
        uint256[] memory _weights,
        uint256[] memory _multiples,
        bool[] memory _hasTransferFees
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
        address newBasketManager = address(
            new BasketManager(
                _nexus,
                address(this),
                _bassets,
                _weights,
                _multiples,
                _hasTransferFees
            )
        );
        basketManager = IBasketManager(newBasketManager);
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
        address _basset,
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
        address _basset,
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
        address _bAsset,
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

        (Basset memory b, ) = basketManager.getBasset(_bAsset);

        uint256 bAssetQty = IPlatform(b.integrator).deposit(msg.sender, _bAsset, _bAssetQuantity, b.isTransferFeeCharged);

        // Validation should be after token transfer, as bAssetQty is unknown before
        (bool isValid, string memory reason) = forgeValidator.validateMint(totalSupply(), b, bAssetQty);
        require(isValid, reason);

        basketManager.increaseVaultBalance(_bAsset, bAssetQty);
        // ratioedBasset is the number of masset quantity to mint
        uint256 ratioedBasset = bAssetQty.mulRatioTruncate(b.ratio);

        // Mint the Masset
        _mint(_recipient, ratioedBasset);
        emit Minted(_recipient, ratioedBasset, bAssetQty);

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
        (Basset[] memory bAssets, )
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

                basketManager.increaseVaultBalance(bAsset.addr, receivedBassetQty);

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
        emit Minted(_recipient, massetQuantity, _bassetQuantity);

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
        address _basset,
        uint256 _bassetQuantity
    )
        external
        whenNotPaused
        returns (uint256 massetRedeemed)
    {
        return _redeem(_basset, _bassetQuantity, msg.sender);
    }


    function redeemTo(
        address _basset,
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
                basketManager.decreaseVaultBalance(bAssets[i].addr, _bassetQuantities[i]);
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

        emit Redeemed(_recipient, msg.sender, massetQuantity, _bassetQuantities);
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

        // Fetch bAsset from storage
        (Basset memory b, uint256 i) = basketManager.getBasset(_bAsset);

        // Validate redemption
        (bool isValid, string memory reason) =
            forgeValidator.validateRedemption(basket.bassets, basket.failed, totalSupply(), i, _bAssetQuantity);
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
        IPlatform(b.integrator).withdraw(_recipient, _bAsset, _bAssetQuantity);

        emit RedeemedSingle(_recipient, msg.sender, massetQuantity, i, _bAssetQuantity);
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
            uint256 feeUnitsPaid = 0;

            // e.g. for 500 massets.
            // feeRate == 1% == 1e16. _quantity == 5e20.
            uint256 amountOfMassetSubjectToFee = feeRate.mulTruncate(_quantity);

            if(metaFee){
                address metaTokenAddress = _metaToken();

                (uint256 ownPrice, uint256 metaTokenPrice) = IManager(_manager()).getAssetPrices(address(this), metaTokenAddress);

                // amountOfMassetSubjectToFee == 5e18
                // ownPrice == $1 == 1e18.
                uint256 feeAmountInDollars = amountOfMassetSubjectToFee.mulTruncate(ownPrice);

                // feeAmountInDollars == $5 == 5e18
                // metaTokenPrice == $20 == 20e18
                // do feeAmount*1e18 / metaTokenPrice
                feeUnitsPaid = feeAmountInDollars.divPrecisely(metaTokenPrice);

                // feeAmountInMetaToken == 0.25e18 == 25e16
                require(IERC20(metaTokenAddress).transferFrom(_payer, feeRecipient, feeUnitsPaid), "Must be successful fee payment");
            } else {
                feeUnitsPaid = amountOfMassetSubjectToFee;

                require(transferFrom(_payer, feeRecipient, feeUnitsPaid), "Must be successful fee payment");
            }

            emit PaidFee(_payer, feeUnitsPaid, feeRate);
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

    function enableMetaFee()
    external
    whenNotPaused
    onlyGovernor {
        metaFee = true;
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
        (Basset[] memory allBassets, uint256 count) = basketManager.getBassets();
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
            }
        }
        // Validate collection and increase balances
        require(basketManager.collectInterest(gains), "Must be a valid inflation");
        // mint new mAsset to sender
        _mint(msg.sender, totalInterestGained);
        emit Minted(msg.sender, totalInterestGained, 0);

        newSupply = totalSupply();
    }
}
