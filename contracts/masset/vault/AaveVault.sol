pragma solidity 0.5.16;

import { AbstractPlatform, MassetHelpers } from "../platform/AbstractPlatform.sol";

import { IAaveAToken, IAaveLendingPool, ILendingPoolAddressesProvider } from "../platform/IAave.sol";

import { SafeERC20 } from "openzeppelin-solidity/contracts/token/ERC20/SafeERC20.sol";
import { IERC20 } from "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";


contract AaveVault is AbstractPlatform {

    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    constructor(address _aaveAddress)
        AbstractPlatform(_aaveAddress)
        public
    {
    }

    /***************************************
                    CORE
    ****************************************/

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
        // Get the Target token
        IAaveAToken aToken = _getATokenFor(_bAsset);

        // Transfer collateral to this address
        quantityDeposited = MassetHelpers.transferTokens(_spender, address(this), _bAsset, isTokenFeeCharged, _amount);

        uint16 referralCode = 9999; // temp code

        if(isTokenFeeCharged) {
            // If we charge a fee, account for it
            uint256 prevBal = _checkBalance(aToken);
            _getLendingPool().deposit(address(aToken), _amount, referralCode);
            uint256 newBal = _checkBalance(aToken);
            quantityDeposited = _min(quantityDeposited, newBal.sub(prevBal));
        } else {
            // aTokens are 1:1 for each asset
            _getLendingPool().deposit(address(aToken), _amount, referralCode);
        }

        emit Deposit(_bAsset, address(aToken), quantityDeposited);
    }

    function withdraw(
        address _receiver,
        address _bAsset,
        uint256 _amount
    )
        external
        onlyWhitelisted
    {
        // Get the Target token
        IAaveAToken aToken = _getATokenFor(_bAsset);

        // Don't need to Approve aToken, as it gets burned in redeem()
        aToken.redeem(_amount);

        // Send redeemed bAsset to the receiver
        IERC20(_bAsset).safeTransfer(_receiver, _amount);

        emit Withdrawal(_bAsset, address(aToken), _amount);
    }

    function checkBalance(address _bAsset)
        external
        returns (uint256 balance)
    {
        // balance is always with token aToken decimals
        IAaveAToken aToken = _getATokenFor(_bAsset);
        return _checkBalance(aToken);
    }

    /***************************************
                    APPROVALS
    ****************************************/

    function reApproveAllTokens()
        external
        onlyWhitelistAdmin
    {
        uint256 bAssetCount = bAssetsMapped.length;
        address pool = address(_getLendingPool());
        for(uint i = 0; i < bAssetCount; i++){
            MassetHelpers.safeInfiniteApprove(bAssetsMapped[i], address(pool));
        }
    }

    function _abstractSetPToken(address _bAsset, address /*_pToken*/)
        internal
    {
        IAaveLendingPool pool = _getLendingPool();
        // approve the pool to spend the bAsset
        MassetHelpers.safeInfiniteApprove(_bAsset, address(pool));
    }

    function _abstractUpdatePToken(address _bAsset, address _oldPToken, address _pToken)
        internal
    {
        // No need to re-approve the pool, as it already has access to this bAsset
    }

    /***************************************
                    HELPERS
    ****************************************/

    function _getLendingPool()
        internal
        view
        returns (IAaveLendingPool)
    {
        address lendingPool = ILendingPoolAddressesProvider(platformAddress).getLendingPool();
        require(lendingPool != address(0), "Lending pool does not exist");
        return IAaveLendingPool(lendingPool);
    }

    function _getATokenFor(address _bAsset)
        internal
        view
        returns (IAaveAToken)
    {
        address aToken = bAssetToPToken[_bAsset];
        require(aToken != address(0), "aToken does not exist");
        return IAaveAToken(aToken);
    }

    function _checkBalance(IAaveAToken _aToken)
        internal
        view
        returns (uint256 balance)
    {
        return _aToken.balanceOf(address(this));
    }
}