pragma solidity ^0.5.16;

import { AbstractPlatform } from "../platform/AbstractPlatform.sol";
import { IAaveAToken } from "../platform/aave/IAaveAToken.sol";
import { IAaveLendingPool } from "../platform/aave/IAaveLendingPool.sol";
import { ILendingPoolAddressesProvider } from "../platform/aave/ILendingPoolAddressesProvider.sol";
import { SafeERC20 } from "openzeppelin-solidity/contracts/token/ERC20/SafeERC20.sol";
import { IERC20 } from "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";
import { Initializable } from "@openzeppelin/upgrades/contracts/Initializable.sol";


contract AaveVault is AbstractPlatform, Initializable {

    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    constructor(address _aaveAddress)
        AbstractPlatform(_aaveAddress)
        public
    {

    }

    /**
     * @dev Initialization function for upgradable proxy contract
     */
    function initialize(
        address _nexus,
        address[] memory _whitelisted,
        address _aaveAddress
    ) public initializer {
        Module._initialize(_nexus);
        GovernableWhitelist._initialize(_whitelisted);
        AbstractPlatform._initialize(_platformAddress);
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

        address aToken = bAssetToPToken[_bAsset];
        uint16 referralCode = 9999; // temp code
        IERC20(_bAsset).safeTransferFrom(_spender, address(this), _amount);

        if(isTokenFeeCharged) {
            uint256 prevBal = getATokenFor(_bAsset).balanceOf(address(this));
            getLendingPool().deposit(aToken, _amount, referralCode);
            uint256 newBal = getATokenFor(_bAsset).balanceOf(address(this));
            quantityDeposited = newBal.sub(prevBal);
        } else {
            quantityDeposited = _amount;
            // aTokens are 1:1 for each asset
            getLendingPool().deposit(aToken, _amount, referralCode);
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
        // don't need to Approve aToken, as it gets burned in redeem()
        // redeem() also takes uint256(-1), to redeem all tokens
        // TODO Will there be any need for it?
        getATokenFor(_bAsset).redeem(_amount);

        // Send bAsset to the receiver
        IERC20(_bAsset).safeTransfer(_receiver, _amount);
    }

    function checkBalance(address _bAsset) external returns (uint256 balance) {
        // balance is always with token aToken decimals
        return getATokenFor(_bAsset).balanceOf(address(this));
    }

    function getLendingPool() internal view returns (IAaveLendingPool) {
        return IAaveLendingPool(ILendingPoolAddressesProvider(platformAddress).getLendingPool());
    }

    function getATokenFor(address _bAsset) internal view returns (IAaveAToken) {
        address aToken = bAssetToPToken[_bAsset];
        return IAaveAToken(aToken);
    }
}