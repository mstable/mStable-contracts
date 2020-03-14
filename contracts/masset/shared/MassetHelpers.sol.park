pragma solidity 0.5.16;
pragma experimental ABIEncoderV2;

import { IMasset } from "../../interfaces/IMasset.sol";
import { IBasketManager } from "../../interfaces/IBasketManager.sol";
import { IForgeValidator } from "../forge-validator/IForgeValidator.sol";
import { MassetStructs } from "./MassetStructs.sol";
import { StableMath } from "../../shared/StableMath.sol";
import { SafeMath }  from "openzeppelin-solidity/contracts/math/SafeMath.sol";
import { SafeERC20 }  from "openzeppelin-solidity/contracts/token/ERC20/SafeERC20.sol";
import { IERC20 }     from "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";

/**
  * @title MassetHelpers
  * @dev Helper functions to facilitate minting and redemption from off chain
  */
library MassetHelpers {

    using StableMath for uint256;
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    function transferTokens(
        address _sender,
        address _recipient,
        address _basset,
        bool _isFeeCharged,
        uint256 _qty
    )
        internal
        returns (uint256 receivedQty)
    {
        receivedQty = _qty;
        if(_isFeeCharged) {
            uint256 balBefore = IERC20(_basset).balanceOf(_recipient);
            IERC20(_basset).safeTransferFrom(_sender, _recipient, _qty);
            uint256 balAfter = IERC20(_basset).balanceOf(_recipient);
            receivedQty = StableMath.min(_qty, balAfter.sub(balBefore));
        } else {
            IERC20(_basset).safeTransferFrom(_sender, _recipient, _qty);
        }
    }

    function approveAllBassets(IMasset _mUSD, address _spender)
        internal
    {
        IBasketManager manager = IBasketManager(_mUSD.getBasketManager());
        address[] memory bAssets = manager.getAllBassetsAddress();
        for(uint256 i = 0; i < bAssets.length; i++) {
            IERC20(bAssets[i]).safeIncreaseAllowance(_spender, uint256(-1));
        }
    }

    function approveMTA(IERC20 _mta, address _spender)
        internal
    {
        _mta.safeIncreaseAllowance(_spender, uint256(-1));
    }

    /** @dev completely external view call - expensive if done in contract */
    // function validateMint(address _mAsset, address _bAsset, uint256 _bAssetQuantity)
    //     external
    //     view
    //     returns (bool isValid, string memory reason)
    // {
    //     // 1. get forge validator address
    //     IForgeValidator forgeValidator = IForgeValidator(Masset(_mAsset).forgeValidator());
    //     // 2. get Basset struct
    //     MassetStructs.Basset memory bAsset = _getBasset(_mAsset, _bAsset);
    //     // 3. get totalSupply
    //     uint256 totalSupply = IERC20(_mAsset).totalSupply();
    //     // 4. call validateMint
    //     return forgeValidator.validateMint(totalSupply, bAsset, _bAssetQuantity);
    // }

    // function validateMintMulti(address _mAsset, uint32 _bAssetsBitmap, uint256[] calldata _bAssetQuantity)
    //     external
    //     view
    //     returns (bool isValid, string memory reason)
    // {
    //     // 1. get forge validator address
    //     IForgeValidator forgeValidator = IForgeValidator(IMasset(_mAsset).forgeValidator());
    //     // 2. get Basset struct
    //     MassetStructs.Basset memory bAsset = _getBasset(_mAsset, _bAsset);
    //     // 3. get totalSupply
    //     uint256 totalSupply = IERC20(_mAsset).totalSupply();
    //     // 4. call validateMint
    //     return forgeValidator.validateMint(totalSupply, bAsset, _bAssetQuantity);
    // }

    // function _getBasset(address _mAsset, address _bAsset)
    //     internal
    //     view
    //     returns (MassetStructs.Basset memory)
    // {
    //     (
    //         ,
    //         uint256 ratio,
    //         uint256 weight,
    //         uint256 vaultBalance,
    //         bool isTransferFeeCharged,
    //         MassetStructs.BassetStatus status
    //     ) = Masset(_mAsset).getBasset(_bAsset);
    //     return _getBassetStruct(_bAsset, ratio, weight, vaultBalance, isTransferFeeCharged, status);
    // }

    // function _getBassetStruct(
    //     address addr,
    //     uint256 ratio,
    //     uint256 weight,
    //     uint256 vaultBalance,
    //     bool isTransferFeeCharged,
    //     MassetStructs.BassetStatus status
    // )
    //     internal
    //     pure
    //     returns (MassetStructs.Basset memory)
    // {
    //     return MassetStructs.Basset({
    //         addr: addr,
    //         ratio: ratio,
    //         maxWeight: weight,
    //         vaultBalance: vaultBalance,
    //         status: status,
    //         isTransferFeeCharged: isTransferFeeCharged
    //     });
    // }
}