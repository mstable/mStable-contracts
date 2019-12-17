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
    event Redeemed(address indexed account, uint256 massetQuantity, uint256[] bassetQuantities);


    /** @dev constructor */
    constructor (
        string memory _name,
        string memory _symbol,
        address[] memory _bassets,
        bytes32[] memory _bassetKeys,
        uint256[] memory _bassetWeights,
        uint256[] memory _bassetMultiples,
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

        (address _systok, address _forgeLib,) = manager.getModuleAddresses();
        require(_systok != address(0) && _forgeLib != address(0), "Must get address from Manager");

        systok = ISystok(_systok);
        forgeLib = IForgeLib(_forgeLib);
    }

    /**
      * @dev Mints a number of Massets based on the sum of the value of the Bassets
      * @param _bassetQuantity Exact units of Bassets to mint
      */
    function mintMasset(
        uint256[] memory _bassetQuantity
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
                IERC20(basset).transferFrom(msg.sender, address(this), _bassetQuantity[i]);

                basket.bassets[i].vaultBalance = basket.bassets[i].vaultBalance.add(_bassetQuantity[i]);

                // TODO - Move this func to the ForgeLib? As it is already being Ratioed and summed there
                uint ratioedBasset = _bassetQuantity[i].mulRatioTruncate(basket.bassets[i].ratio);
                massetQuantity = massetQuantity.add(ratioedBasset);
            }
        }

        // Pay the minting fee
        _payActionFee(massetQuantity, Action.MINT);

        // Mint the Masset
        _mint(msg.sender, massetQuantity);
        emit Minted(msg.sender, massetQuantity, _bassetQuantity);

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
        _payActionFee(massetQuantity, Action.REDEEM);

        // Ensure payout is relevant to collateralisation ratio
        massetQuantity = massetQuantity.divPrecisely(basket.collateralisationRatio);

        // Burn the Masset
        _burn(msg.sender, massetQuantity);

        // Transfer the Bassets to the user
        for(uint i = 0; i < _bassetQuantity.length; i++){
            if(_bassetQuantity[i] > 0){
                address basset = basket.bassets[i].addr;

                IERC20(basset).transfer(msg.sender, _bassetQuantity[i]);
            }
        }

        emit Redeemed(msg.sender, massetQuantity, _bassetQuantity);
        return massetQuantity;
    }

    /**
     * @dev Pay the forging fee by burning Systok
     * @param _quantity Exact amount of Masset being forged
     * @param _action Type of Forge action to execute
     */
    function _payActionFee(uint256 _quantity, Action _action)
    private {
        (uint256 ownPrice, uint256 systokPrice) = manager.getMassetPrice(address(this));

        uint256 feeRate = _action == Action.MINT ? mintingFee : redemptionFee;

        if(feeRate > 0){
            // e.g. for 500 massets.
            // feeRate == 1% == 1e16. _quantity == 5e20.
            uint256 amountOfMassetSubjectToFee = feeRate.mulTruncate(_quantity);

            // amountOfMassetSubjectToFee == 5e18
            // ownPrice == $1 == 1e18.
            uint256 feeAmountInDollars = amountOfMassetSubjectToFee.mul(ownPrice);

            // feeAmountInDollars == $5 == 5e18
            // systokPrice == $20 == 20e18
            // do feeAmount*1e18 / systokPrice
            uint256 feeAmountInSystok = feeAmountInDollars.divPrecisely(systokPrice);

            // feeAmountInSystok == 0.25e18 == 25e16
            systok.burnFrom(msg.sender, feeAmountInSystok);
        }
    }

}