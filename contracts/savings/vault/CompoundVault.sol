pragma solidity ^0.5.16;

import { AbstractPlatform } from "../platform/AbstractPlatform.sol";
import { ICErc20 } from "../platform/compound/ICErc20.sol";
import { SafeERC20 } from "openzeppelin-solidity/contracts/token/ERC20/SafeERC20.sol";
import { IERC20 } from "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";

contract CompoundVault is AbstractPlatform {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    constructor(address _compoundAddress)
        AbstractPlatform(_compoundAddress)
        public
    {

    }

    function deposit(
        address _spender,
        address _bAsset,
        uint256 _amount,
        bool isTokenFeeCharged
    )
        external
        onlyWhitelisted
        returns (uint256 quantityDeposited)
    {

        IERC20(_bAsset).safeTransferFrom(_spender, address(this), _amount);
        if(isTokenFeeCharged) {
            uint256 prevBal = getCTokenFor(_bAsset).balanceOfUnderlying(address(this));
            getCTokenFor(_bAsset).mint(_amount);
            uint256 newBal = getCTokenFor(_bAsset).balanceOfUnderlying(address(this));
            quantityDeposited = newBal.sub(prevBal);
        } else {
            quantityDeposited = _amount;
            getCTokenFor(_bAsset).mint(_amount);
        }
    }

    function withdraw(
        address _receiver,
        address _bAsset,
        uint256 _amount
    )
        external
        onlyWhitelisted
    {
        getCTokenFor(_bAsset).redeem(_amount);
        IERC20(_bAsset).safeTransfer(_receiver, _amount);
    }

    function checkBalance(address _bAsset) external returns (uint256 balance) {
        return getCTokenFor(_bAsset).balanceOfUnderlying(address(this));
    }

    function getCTokenFor(address _bAsset) internal view returns (ICErc20) {
        address cToken = bAssetToPToken[_bAsset];
        return ICErc20(cToken);
    }

}