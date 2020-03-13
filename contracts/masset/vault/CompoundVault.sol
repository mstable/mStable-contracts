pragma solidity 0.5.16;

import { AbstractPlatform, MassetHelpers } from "../platform/AbstractPlatform.sol";

import { ICErc20 } from "../platform/ICompound.sol";

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
        ICErc20 cToken = _getCTokenFor(_bAsset);

        // Transfer collateral to this address
        quantityDeposited = MassetHelpers.transferTokens(_spender, address(this), _bAsset, isTokenFeeCharged, _amount);

        if(isTokenFeeCharged) {
            // If we charge a fee, account for it
            uint256 prevBal = _checkBalance(cToken);
            assert(cToken.mint(_amount) == 0);
            uint256 newBal = _checkBalance(cToken);
            quantityDeposited = _min(quantityDeposited, newBal.sub(prevBal));
        } else {
            // Else just execute the mint
            assert(cToken.mint(_amount) == 0);
        }

        emit Deposit(_bAsset, address(cToken), quantityDeposited);
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
        ICErc20 cToken = _getCTokenFor(_bAsset);

        // Redeem Underlying bAsset amount
        require(cToken.redeemUnderlying(_amount) == 0, "something went wrong");

        // Send redeemed bAsset to the receiver
        IERC20(_bAsset).safeTransfer(_receiver, _amount);

        emit Withdrawal(_bAsset, address(cToken), _amount);
    }

    function checkBalance(address _bAsset)
        external
        returns (uint256 balance)
    {
        // balance is always with token cToken decimals
        ICErc20 cToken = _getCTokenFor(_bAsset);
        return _checkBalance(cToken);
    }

    /***************************************
                    APPROVALS
    ****************************************/

    function reApproveAllTokens()
        external
        onlyWhitelistAdmin
    {
        uint256 bAssetCount = bAssetsMapped.length;
        for(uint i = 0; i < bAssetCount; i++){
            address bAsset = bAssetsMapped[i];
            address cToken = bAssetToPToken[bAsset];
            MassetHelpers.safeInfiniteApprove(bAssetsMapped[i], cToken);
        }
    }

    function _abstractUpdatePToken(address _bAsset, address _cToken)
        internal
    {
        // approve the pool to spend the bAsset
        MassetHelpers.safeInfiniteApprove(_bAsset, _cToken);
    }

    function _abstractUpdatePToken(address _bAsset, address _oldCToken, address _newCToken)
        internal
    {
        // Clean up old allowance
        IERC20(_bAsset).safeApprove(_oldCToken, 0);
        // approve the pool to spend the bAsset
        MassetHelpers.safeInfiniteApprove(_bAsset, _newCToken);
    }

    /***************************************
                    HELPERS
    ****************************************/

    function _getCTokenFor(address _bAsset)
        internal
        view
        returns (ICErc20)
    {
        address cToken = bAssetToPToken[_bAsset];
        require(cToken != address(0), "cToken does not exist");
        return ICErc20(cToken);
    }

    function _checkBalance(ICErc20 _cToken)
        internal
        returns (uint256 balance)
    {
        return _cToken.balanceOfUnderlying(address(this));
    }
}