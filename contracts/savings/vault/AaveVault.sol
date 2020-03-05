pragma solidity ^0.5.16;

import { AbstractPlatform } from "../platform/AbstractPlatform.sol";
import { IAaveAToken } from "../platform/aave/IAaveAToken.sol";
import { IAaveLendingPool } from "../platform/aave/IAaveLendingPool.sol";
import { SafeERC20 } from "openzeppelin-solidity/contracts/token/ERC20/SafeERC20.sol";
import { IERC20 } from "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";

contract AaveVault is AbstractPlatform {

    using SafeERC20 for IERC20;

    constructor(address _aaveAddress)
        AbstractPlatform(_aaveAddress)
        public
    {

    }

    function deposit(
        address _spender,
        address _bAsset,
        uint256 _amount
    )
        external
        onlyWhitelisted
        returns (uint256 quantityDeposited)
    {
        IERC20(_bAsset).safeTransferFrom(_spender, address(this), _amount);
        // TODO calculate quantityDeposited
        // TODO do we need to store balances here?

        address reserve = bAssetToPToken[_bAsset];
        uint16 referralCode = 9999; // temp code
        // platformAddress = LendingPool address
        IAaveLendingPool(platformAddress).deposit(reserve, _amount, referralCode);
        // TODO How do we know qtyDeposited into LendingPool ??
    }

    function withdraw(
        address _receiver,
        address _bAsset,
        uint256 _amount
    )
        external
        onlyWhitelisted
    {
        address aToken = bAssetToPToken[_bAsset];
        IAaveAToken(aToken).redeem(_amount);
    }

    function checkBalance(address _bAsset) external returns (uint256 balance) {
        address aToken = bAssetToPToken[_bAsset];
        return IAaveAToken(aToken).balanceOf(address(this));
    }
}