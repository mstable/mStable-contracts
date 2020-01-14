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

    /**
     * @dev Forging actions
     */
    enum Action {
        MINT,
        REDEEM
    }

    /** @dev Forging events */
    event Minted(address indexed account, uint256 massetQuantity, uint256[] bassetQuantities);
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
        address _manager,
        bool _mmEnabled
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
          _bassetMultiples,
          _mmEnabled
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
        basketIsHealthy
        returns (uint256 massetMinted)
    {
        return mintTo(_bassetQuantity, msg.sender, msg.sender);
    }

    /**
      * @dev Mints a number of Massets based on the sum of the value of the Bassets
      * @param _bassetQuantity Exact units of Bassets to mint
      * @param _minter Address from which to transfer the Bassets
      * @param _recipient Address to which the Masset should be minted
      */
    function mintTo(
        uint256[] memory _bassetQuantity,
        address _minter,
        address _recipient
    )
        public
        basketIsHealthy
        returns (uint256 massetMinted)
    {
        // Validate the proposed mint
        forgeLib.validateMint(basket, _bassetQuantity);

        uint massetQuantity = 0;

        // Transfer the Bassets to this contract, update storage and calc MassetQ
        for(uint i = 0; i < _bassetQuantity.length; i++){
            address basset = basket.bassets[i].addr;

            if(_bassetQuantity[i] > 0){
                IERC20(basset).transferFrom(_minter, address(this), _bassetQuantity[i]);

                basket.bassets[i].vaultBalance = basket.bassets[i].vaultBalance.add(_bassetQuantity[i]);

                uint ratioedBasset = _bassetQuantity[i].mulRatioTruncate(basket.bassets[i].ratio);
                massetQuantity = massetQuantity.add(ratioedBasset);
            }
        }

        // Pay the minting fee
        _payActionFee(massetQuantity, Action.MINT, _minter);

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
        return redeemTo(_bassetQuantity, msg.sender, msg.sender);
    }

    /**
      * @dev Redeems a certain quantity of Bassets, in exchange for burning the relative Masset quantity from the User
      * @param _bassetQuantity Exact quantities of Bassets to redeem
      * @param _redeemer Account from which to burn the Masset
      * @param _recipient Account to which the redeemed Bassets should be sent
      */
    function redeemTo(
        uint256[] memory _bassetQuantity,
        address _redeemer,
        address _recipient
    )
        public
        returns (uint256 massetRedeemed)
    {
        // Validate the proposed redemption
        forgeLib.validateRedemption(basket, _bassetQuantity);

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
        _payActionFee(massetQuantity, Action.REDEEM, _redeemer);

        // Ensure payout is relevant to collateralisation ratio (if ratio is 90%, we burn more)
        massetQuantity = massetQuantity.divPrecisely(basket.collateralisationRatio);

        // Burn the Masset
        _burn(_redeemer, massetQuantity);

        // Transfer the Bassets to the user
        for(uint i = 0; i < _bassetQuantity.length; i++){
            if(_bassetQuantity[i] > 0){
                address basset = basket.bassets[i].addr;

                IERC20(basset).transfer(_recipient, _bassetQuantity[i]);
            }
        }

        emit Redeemed(_recipient, _redeemer, massetQuantity, _bassetQuantity);
        return massetQuantity;
    }

    /**
     * @dev Pay the forging fee by burning Systok
     * @param _quantity Exact amount of Masset being forged
     * @param _action Type of Forge action to execute
     * @param _payer Address who is liable for the fee
     */
    function _payActionFee(uint256 _quantity, Action _action, address _payer)
    private {

        uint256 feeRate = _action == Action.MINT ? mintingFee : redemptionFee;

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
            systok.transferFrom(_payer, feePool, feeAmountInSystok);

            emit PaidFee(_payer, feeAmountInSystok, feeRate);
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
        basket.bassets[i].targetWeight = 0;

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
