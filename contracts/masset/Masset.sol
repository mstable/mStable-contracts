pragma solidity ^0.5.12;
pragma experimental ABIEncoderV2;

import { IMasset } from "../interfaces/IMasset.sol";
import { ISystok } from "../interfaces/ISystok.sol";

import { MassetBasket, IManager, IForgeValidator } from "./MassetBasket.sol";
import { MassetToken } from "./MassetToken.sol";

import { StableMath } from "../shared/StableMath.sol";
import { SafeERC20 }  from "openzeppelin-solidity/contracts/token/ERC20/SafeERC20.sol";
import { IERC20 }     from "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";

/**
 * @title Masset
 * @author Stability Labs Pty Ltd
 * @dev Base layer functionality for the Masset
 */
contract Masset is IMasset, MassetToken, MassetBasket {

    using StableMath for uint256;
    using SafeERC20 for IERC20;

    /** @dev Forging events */
    event Minted(address indexed account, uint256 massetQuantity, uint256[] bAssetQuantities);
    event Minted(address indexed account, uint256 massetQuantity, uint256 bAssetQuantity);
    event PaidFee(address payer, uint256 feeQuantity, uint256 feeRate);
    event Redeemed(address indexed recipient, address redeemer, uint256 massetQuantity, uint256[] bAssetQuantities);
    event RedeemedSingle(address indexed recipient, address redeemer, uint256 massetQuantity, uint256 index, uint256 bAssetQuantity);


    /** @dev constructor */
    constructor (
        string memory _name,
        string memory _symbol,
        address _nexus,
        address[] memory _bassets,
        uint256[] memory _bassetWeights,
        uint256[] memory _bassetMultiples,
        bool[] memory _hasTransferFees,
        address _feePool,
        address _forgeValidator
    )
        MassetToken(
            _name,
            _symbol,
            18
        )
        MassetBasket(
          _nexus,
          _bassets,
          _bassetWeights,
          _bassetMultiples,
          _hasTransferFees
        )
        public
    {
        feePool = _feePool;
        forgeValidator = IForgeValidator(_forgeValidator);
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
    function mintSingle(
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
    function mintSingleTo(
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
    function mintBitmapTo(
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
        basketIsHealthy
        returns (uint256 massetMinted)
    {
        require(_recipient != address(0), "Recipient must not be 0x0");
        require(_bassetQuantity > 0, "Quantity must not be 0");

        (bool exists, uint256 i) = _isAssetInBasket(_basset);
        require(exists, "bAsset doesn't exist");

        Basset memory b = basket.bassets[i];

        uint256 bAssetQty = _transferTokens(_basset, b.isTransferFeeCharged, _bassetQuantity);

        //Validation should be after token transfer, as bAssetQty is unknown before
        forgeValidator.validateMint(totalSupply(), b, bAssetQty);

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
        basketIsHealthy
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

                uint ratioedBasset = receivedBassetQty.mulRatioTruncate(bAsset.ratio);
                massetQuantity = massetQuantity.add(ratioedBasset);
            }
        }

        // Validate the proposed mint, after token transfer, as bAssert quantity is unknown until transferred
        forgeValidator.validateMint(totalSupply(), bAssets, receivedQty);

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
    function redeemSingle(
        address _basset,
        uint256 _bassetQuantity
    )
        external
        returns (uint256 massetRedeemed)
    {
        return _redeem(_basset, _bassetQuantity, msg.sender);
    }


    function redeemSingleTo(
        address _basset,
        uint256 _bassetQuantity,
        address _recipient
    )
        external
        returns (uint256 massetRedeemed)
    {
        return _redeem(_basset, _bassetQuantity, _recipient);
    }


    /**
     * @dev Redeems a certain quantity of Bassets, in exchange for burning the relative Masset quantity from the User
     * @param _bassetQuantities Exact quantities of Bassets to redeem
     * @param _recipient Account to which the redeemed Bassets should be sent
     */
    function redeemBitmapTo(
        uint32 _bassetsBitmap,
        uint256[] calldata _bassetQuantities,
        address _recipient
    )
        external
        returns (uint256 massetRedeemed)
    {
        require(_recipient != address(0), "Recipient must not be 0x0");
        uint256 redemptionAssetCount = _bassetQuantities.length;

        // Load only needed bAssets in array
        (Basset[] memory bAssets, uint8[] memory indexes)
            = convertBitmapToBassets(_bassetsBitmap, uint8(redemptionAssetCount));

        forgeValidator.validateRedemption(basket.bassets, basket.failed, totalSupply(), indexes, _bassetQuantities);

        uint256 massetQuantity = 0;

        // Calc MassetQ and update the Vault
        for(uint i = 0; i < redemptionAssetCount; i++){
            if(_bassetQuantities[i] > 0){
                uint ratioedBasset = _bassetQuantities[i].mulRatioTruncateCeil(bAssets[i].ratio);
                massetQuantity = massetQuantity.add(ratioedBasset);

                // bAsset == bAssets[i] == basket.bassets[indexes[i]]
                basket.bassets[indexes[i]].vaultBalance = bAssets[i].vaultBalance.sub(_bassetQuantities[i]);
            }
        }

        // Pay the redemption fee
        _payRedemptionFee(massetQuantity, msg.sender);

        // Ensure payout is relevant to collateralisation ratio (if ratio is 90%, we burn more)
        massetQuantity = massetQuantity.divPrecisely(basket.collateralisationRatio);

        // Burn the Masset
        _burn(msg.sender, massetQuantity);

        // Transfer the Bassets to the user
        for(uint i = 0; i < redemptionAssetCount; i++){
            if(_bassetQuantities[i] > 0){
                IERC20(bAssets[i].addr).safeTransfer(_recipient, _bassetQuantities[i]);
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
     * @param _bassetQuantity Exact quantities of Bassets to redeem
     * @param _recipient Account to which the redeemed Bassets should be sent
     */
    function _redeem(
        address _basset,
        uint256 _bassetQuantity,
        address _recipient
    )
        internal
        returns (uint256 massetRedeemed)
    {
        require(_recipient != address(0), "Recipient must not be 0x0");
        require(_bassetQuantity > 0, "Quantity must not be 0");

        (bool exists, uint256 i) = _isAssetInBasket(_basset);
        require(exists, "bAsset doesn't exist");

        Basset memory b = basket.bassets[i];

        forgeValidator.validateRedemption(basket.bassets, basket.failed, totalSupply(), i, _bassetQuantity);

        uint256 massetQuantity = _bassetQuantity.mulRatioTruncateCeil(b.ratio);

        basket.bassets[i].vaultBalance = b.vaultBalance.sub(_bassetQuantity);

        // Pay the redemption fee
        _payRedemptionFee(massetQuantity, msg.sender);

        // Ensure payout is relevant to collateralisation ratio (if ratio is 90%, we burn more)
        massetQuantity = massetQuantity.divPrecisely(basket.collateralisationRatio);

        // Burn the Masset
        _burn(msg.sender, massetQuantity);

        // Transfer the Bassets to the user
        IERC20(b.addr).safeTransfer(_recipient, _bassetQuantity);

        emit RedeemedSingle(_recipient, msg.sender, massetQuantity, i, _bassetQuantity);
        return massetQuantity;
    }
    /**
     * @dev Pay the forging fee by burning Systok
     * @param _quantity Exact amount of Masset being forged
     * @param _payer Address who is liable for the fee
     */
    function _payRedemptionFee(uint256 _quantity, address _payer)
    private {

        uint256 feeRate = redemptionFee;

        if(feeRate > 0){
            (uint256 ownPrice, uint256 systokPrice) = IManager(_manager()).getMassetPrice(address(this));

            // e.g. for 500 massets.
            // feeRate == 1% == 1e16. _quantity == 5e20.
            uint256 amountOfMassetSubjectToFee = feeRate.mulTruncate(_quantity);

            // amountOfMassetSubjectToFee == 5e18
            // ownPrice == $1 == 1e18.
            uint256 feeAmountInDollars = amountOfMassetSubjectToFee.mulTruncate(ownPrice);

            // feeAmountInDollars == $5 == 5e18
            // systokPrice == $20 == 20e18
            // do feeAmount*1e18 / systokPrice
            uint256 feeAmountInSystok = feeAmountInDollars.divPrecisely(systokPrice);

            // feeAmountInSystok == 0.25e18 == 25e16
            require(ISystok(_systok()).transferFrom(_payer, feePool, feeAmountInSystok), "Must be successful fee payment");

            emit PaidFee(_payer, feeAmountInSystok, feeRate);
        }
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
        private
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
                  MANAGEMENT
    ****************************************/

    /**
     * @dev Completes the auctioning process for a given Basset
     * @param _basset Address of the ERC20 token to isolate
     * @param _unitsUnderCollateralised Masset units that we failed to recollateralise
     */
    function completeRecol(address _basset, uint256 _unitsUnderCollateralised)
        external
        onlyManager
    {
        (bool exists, uint i) = _isAssetInBasket(_basset);
        require(exists, "bASset must exist in Basket");

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

}
