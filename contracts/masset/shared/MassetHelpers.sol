pragma solidity 0.5.16;

import { IMasset } from "../../interfaces/IMasset.sol";
import { IBasketManager } from "../../interfaces/IBasketManager.sol";
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

    function safeInfiniteApprove(address _asset, address _spender)
        internal
    {
        IERC20(_asset).safeApprove(_spender, 0);
        IERC20(_asset).safeApprove(_spender, uint256(-1));
    }
}
