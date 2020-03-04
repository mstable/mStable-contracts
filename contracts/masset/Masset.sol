pragma solidity 0.5.16;
pragma experimental ABIEncoderV2;

// External
import { BasketManager } from "./BasketManager.sol";
import { IForgeValidator } from "./forge-validator/IForgeValidator.sol";

// Internal
import { IMasset } from "../interfaces/IMasset.sol";
import { MassetToken } from "./MassetToken.sol";
import { Module } from "../shared/Module.sol";
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
contract Masset is IMasset, MassetToken, Module {

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

    /** @dev FeePool */
    address public feeRecipient;

    /** @dev Meta information for ecosystem fees */
    uint256 public redemptionFee;

    /** @dev Maximum minting/redemption fee */
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
        Module(
            _nexus
        )
        public
    {
        feeRecipient = _feeRecipient;
        forgeValidator = IForgeValidator(_forgeValidator);
        redemptionFee = 2e16;                 // 2%
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
        returns(uint256 massetMinted)
    {
        return _mintTo(_bassetsBitmap, _bassetQuantity, _recipient);
    }

    /***************************************
              MINTING (INTERNAL)
    ****************************************/

    /**
     * @dev Mints a number of Massets based on a Basset user sends
     * @param _basset Address of Basset user sends
     * @param _bassetQuantity Exact units of Basset user wants to send to contract
     * @param _recipient Address to which the Masset should be minted
     */
    function _mintTo(
        address _basset,
        uint256 _bassetQuantity,
        address _recipient
    )
        internal
        // basketIsHealthy
        returns (uint256 massetMinted)
    {
        require(_recipient != address(0), "Recipient must not be 0x0");
        require(_bassetQuantity > 0, "Quantity must not be 0");

        (bool exists, uint256 i) = _isAssetInBasket(_basset);
        require(exists, "bAsset doesn't exist");

        Basset memory b = basket.bassets[i];

        uint256 bAssetQty = _transferTokens(_basset, b.isTransferFeeCharged, _bassetQuantity);

        // Validation should be after token transfer, as bAssetQty is unknown before
        (bool isValid, string memory reason) = forgeValidator.validateMint(totalSupply(), b, bAssetQty);
        require(isValid, reason);

        basket.bassets[i].vaultBalance = b.vaultBalance.add(bAssetQty);
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
        // basketIsHealthy
        returns (uint256 massetMinted)
    {
        require(_recipient != address(0), "Recipient must not be 0x0");
        uint256 len = _bassetQuantity.length;

        // Load only needed bAssets in array
        (Basset[] memory bAssets, uint8[] memory indexes)
            = convertBitmapToBassets(_bassetsBitmap, uint8(len));

        uint256 massetQuantity = 0;

        uint256[] memory receivedQty = new uint256[](len);
        // Transfer the Bassets to this contract, update storage and calc MassetQ
        for(uint256 j = 0; j < len; j++){
            if(_bassetQuantity[j] > 0){
                // bAsset == bAssets[j] == basket.bassets[indexes[j]]
                Basset memory bAsset = bAssets[j];

                uint256 receivedBassetQty = _transferTokens(bAsset.addr, bAsset.isTransferFeeCharged, _bassetQuantity[j]);
                receivedQty[j] = receivedBassetQty;
                basket.bassets[indexes[j]].vaultBalance = bAsset.vaultBalance.add(receivedBassetQty);

                uint256 ratioedBasset = receivedBassetQty.mulRatioTruncate(bAsset.ratio);
                massetQuantity = massetQuantity.add(ratioedBasset);
            }
        }

        // Validate the proposed mint, after token transfer, as bAssert quantity is unknown until transferred
        (bool isValid, string memory reason) = forgeValidator.validateMint(totalSupply(), bAssets, receivedQty);
        require(isValid, reason);

        require(massetQuantity > 0, "No masset quantity to mint");

        // Mint the Masset
        _mint(_recipient, massetQuantity);
        emit Minted(_recipient, massetQuantity, _bassetQuantity);

        return massetQuantity;
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
    managerOrGovernor {
        forgeValidatorLocked = true;
    }

    /**
      * @dev Set the recipient address of forge fees
      * @param _feeRecipient Address of the fee pool
      */
    function setFeeRecipient(address _feeRecipient)
    external
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
    managerOrGovernor {
        require(_redemptionFee <= maxFee, "Redemption fee > maxFee");
        redemptionFee = _redemptionFee;
        emit RedemptionFeeChanged(_redemptionFee);
    }

}
