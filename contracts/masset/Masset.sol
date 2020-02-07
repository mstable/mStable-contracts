pragma solidity ^0.5.12;
pragma experimental ABIEncoderV2;

import { IMasset } from "../interfaces/IMasset.sol";

import { MassetBasket, IManager, ISystok, IForgeLib, IERC20 } from "./MassetBasket.sol";
import { MassetToken } from "./MassetToken.sol";

/**
  * @title Masset
  * @author Stability Labs Pty Ltd
  * @dev Base layer functionality for the Masset
  */
contract Masset is IMasset, MassetToken, MassetBasket {

    /** @dev Forging events */
    event Minted(address indexed account, uint256 massetQuantity, uint256[] bassetQuantities);
    event Minted(address indexed account, uint256 massetQuantity, uint256 bassetQuantity);
    event PaidFee(address payer, uint256 feeQuantity, uint256 feeRate);
    event Redeemed(address indexed recipient, address indexed redeemer, uint256 massetQuantity, uint256[] bassetQuantities);


    /** @dev constructor */
    constructor (
        string memory _name,
        string memory _symbol,
        address[] memory _bassets,
        bytes32[] memory _bassetKeys,
        uint256[] memory _bassetWeights,
        uint256[] memory _bassetMultiples,
        address _feePool,
        address _manager
    )
        MassetToken(
            _name,
            _symbol,
            18
        )
        MassetBasket(
          _bassets,
          _bassetKeys,
          _bassetWeights,
          _bassetMultiples
        )
        public
    {
        manager = IManager(_manager);
        feePool = _feePool;

        (address _systok, address _forgeLib, address _governance) = manager.getModuleAddresses();
        require(_systok != address(0) && _forgeLib != address(0) && _governance != address(0), "Must get address from Manager");

        systok = ISystok(_systok);
        forgeLib = IForgeLib(_forgeLib);
        governance = _governance;
    }

    /**
      * @dev Mints a number of Massets based on the sum of the value of the Bassets
      * @param _bassetQuantity Exact units of Bassets to mint
      */
    function mint(
        uint256[] calldata _bassetQuantity
    )
        external
        returns (uint256 massetMinted)
    {
        return mintTo(getBitmapForAllBassets(), _bassetQuantity, msg.sender);
    }

    //TODO correct fn name once implementation is complete
    /**
     * @dev Mint with bAsset addresses in bitmap
     * @param _bassetsBitmap bAssets index in bitmap
     */
    function mintWithBitmap(
        uint32 _bassetsBitmap,
        uint256[] calldata _bassetQuantity
    )
        external
        returns(uint256 massetMinted)
    {
        //TODO
        return mintTo(_bassetsBitmap, _bassetQuantity, msg.sender);
    }

    /**
     * @dev Get bitmap for all bAsset addresses
     * @return bitmap with bits set according to bAsset address position
     */
     //TODO public as of now for testing/dependency, it will be `external`
    function getBitmapForAllBassets() public view returns (uint32 bitmap) {
        //TODO bassets array should not have more than 32 items
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

    //TODO making visibility public for testing purpose
    function convertBitmapToIndexArr(uint32 _bitmap, uint8 _size) public view returns (uint8[] memory) {
        uint8[] memory indexes = new uint8[](_size);
        uint8 idx = 0;
        // Assume there are 4 bAssets in array
        // size = 2
        // bitmap  = 00000000 00000000 00000000 00001010
        // mask    = 00000000 00000000 00000000 00001000
        //isBitSet = 00000000 00000000 00000000 00001000
        // indexes = [1, 3]
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
     * @dev Mints a number of Massets based on a Basset user sends
     * @param _basset Address of Basset user sends
     * @param _bassetQuantity Exact units of Basset user wants to send to contract
     * @param _recipient Address to which the Masset should be minted
     */
    function mintTo(
        address _basset,
        uint256 _bassetQuantity,
        address _recipient
    )
        external
        basketIsHealthy
        returns (uint256 massetMinted)
    {
        require(_bassetQuantity > 0, "Quantity must not be 0");
        require(_recipient != address(0), "Recipient must not be 0x0");
        (bool exists, uint256 i) = _isAssetInBasket(_basset);
        require(exists, "bAsset doesn't exist");

        Basset memory b = basket.bassets[i];

        forgeLib.validateMint(totalSupply(), b, _bassetQuantity);

        require(IERC20(_basset).transferFrom(msg.sender, address(this), _bassetQuantity), "Basset transfer failed");
        b.vaultBalance = b.vaultBalance.add(_bassetQuantity);
        // ratioedBasset is the number of masset quantity to mint
        uint256 ratioedBasset = _bassetQuantity.mulRatioTruncate(b.ratio);

        // Mint the Masset
        _mint(_recipient, ratioedBasset);
        emit Minted(_recipient, ratioedBasset, _bassetQuantity);

        return ratioedBasset;
    }

    //TODO keeping only to make test dependencies work
    //TODO Need to remove once impl complete
    function mintTo(
        uint256[] memory _bassetQuantity,
        address _recipient
    )
    public
    returns (uint256 massetMinted)
    {
        return mintTo(getBitmapForAllBassets(), _bassetQuantity, _recipient);
    }

    /**
      * @dev Mints a number of Massets based on the sum of the value of the Bassets
      * @param _bassetQuantity Exact units of Bassets to mint
      * @param _recipient Address to which the Masset should be minted
      */
    function mintTo(
        uint32 _bassetsBitmap,
        uint256[] memory _bassetQuantity,
        address _recipient
    )
        public
        basketIsHealthy
        returns (uint256 massetMinted)
    {
        // It is assumed the number of bits set are equal to the _bassetQuantity[] length
        uint8[] memory indexes = convertBitmapToIndexArr(_bassetsBitmap, uint8(_bassetQuantity.length));

        Basset[] memory bAssets = new Basset[](indexes.length);
        for(uint i = 0; i < indexes.length; i++) {
            bAssets[i] = basket.bassets[indexes[i]];
        }

        // Validate the proposed mint
        forgeLib.validateMint(totalSupply(), bAssets, _bassetQuantity);

        uint massetQuantity = 0;

        // Transfer the Bassets to this contract, update storage and calc MassetQ
        for(uint j = 0; j < bAssets.length; j++){

            if(_bassetQuantity[j] > 0){
                Basset memory bAsset = bAssets[j];

                require(IERC20(bAsset.addr).transferFrom(msg.sender, address(this), _bassetQuantity[j]), "Basset transfer failed");

                bAsset.vaultBalance = bAsset.vaultBalance.add(_bassetQuantity[j]);

                uint ratioedBasset = _bassetQuantity[j].mulRatioTruncate(bAsset.ratio);
                massetQuantity = massetQuantity.add(ratioedBasset);
            }
        }

        // Mint the Masset
        _mint(_recipient, massetQuantity);
        emit Minted(_recipient, massetQuantity, _bassetQuantity);

        return massetQuantity;
    }


    /**
      * @dev Redeems a certain quantity of Bassets, in exchange for burning the relative Masset quantity from the User
      * @param _bassetQuantity Exact quantities of Bassets to redeem
      */
    function redeem(
        uint256[] memory _bassetQuantity
    )
        public
        returns (uint256 massetRedeemed)
    {
        return redeemTo(_bassetQuantity, msg.sender);
    }


    function redeemSingle(
        address _basset,
        uint256 _bassetQuantity,
        address _recipient
    )
        external
        returns (uint256 massetMinted)
    {
        return redeemTo(getSingleForgeParams(_basset, _bassetQuantity), _recipient);
    }


    /**
      * @dev Redeems a certain quantity of Bassets, in exchange for burning the relative Masset quantity from the User
      * @param _bassetQuantity Exact quantities of Bassets to redeem
      * @param _recipient Account to which the redeemed Bassets should be sent
      */
    function redeemTo(
        uint256[] memory _bassetQuantity,
        address _recipient
    )
        public
        returns (uint256 massetRedeemed)
    {
        // Validate the proposed redemption
        forgeLib.validateRedemption(basket.failed, basket.bassets, _bassetQuantity);

        uint256 massetQuantity = 0;

        // Calc MassetQ and update the Vault
        for(uint i = 0; i < _bassetQuantity.length; i++){
            if(_bassetQuantity[i] > 0){
                uint ratioedBasset = _bassetQuantity[i].mulRatioTruncateCeil(basket.bassets[i].ratio);
                massetQuantity = massetQuantity.add(ratioedBasset);

                basket.bassets[i].vaultBalance = basket.bassets[i].vaultBalance.sub(_bassetQuantity[i]);
            }
        }

        // Pay the redemption fee
        _payRedemptionFee(massetQuantity, msg.sender);

        // Ensure payout is relevant to collateralisation ratio (if ratio is 90%, we burn more)
        massetQuantity = massetQuantity.divPrecisely(basket.collateralisationRatio);

        // Burn the Masset
        _burn(msg.sender, massetQuantity);

        // Transfer the Bassets to the user
        for(uint i = 0; i < _bassetQuantity.length; i++){
            if(_bassetQuantity[i] > 0){
                address basset = basket.bassets[i].addr;

                require(IERC20(basset).transfer(_recipient, _bassetQuantity[i]), "Must be successful transfer");
            }
        }

        emit Redeemed(_recipient, msg.sender, massetQuantity, _bassetQuantity);
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
            (uint256 ownPrice, uint256 systokPrice) = manager.getMassetPrice(address(this));

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
            require(systok.transferFrom(_payer, feePool, feeAmountInSystok), "Must be successful fee payment");

            emit PaidFee(_payer, feeAmountInSystok, feeRate);
        }
    }

    function getSingleForgeParams(
        address _basset,
        uint256 _bassetQuantity
    )
        public
        view
        returns (uint256[] memory quantities)
    {
        (bool exists, uint i) = _isAssetInBasket(_basset);
        require(exists, "Asset must be in the Basket");
        quantities = new uint256[](basket.bassets.length);
        quantities[i] = _bassetQuantity;
    }

    function getForgeParams(
        address[] calldata _bassets,
        uint256[] calldata _bassetQuantities
    )
        external
        view
        returns (uint256[] memory quantities)
    {
        quantities = new uint256[](basket.bassets.length);
        require(_bassets.length == _bassetQuantities.length, "Input arrays must be same length");

        for(uint256 i = 0; i < _bassets.length; i++) {
            (bool exists, uint j) = _isAssetInBasket(_bassets[i]);
            require(exists, "Asset must be in the Basket");
            quantities[j] = _bassetQuantities[i];
        }
    }

    /**
      * @dev Completes the auctioning process for a given Basset
      * @param _basset Address of the ERC20 token to isolate
      * @param _unitsUnderCollateralised Masset units that we failed to recollateralise
      */
    function completeRecol(address _basset, uint256 _unitsUnderCollateralised)
    external
    onlyManager {
        (bool exists, uint i) = _isAssetInBasket(_basset);
        require(exists, "Basset must exist in Basket");

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
