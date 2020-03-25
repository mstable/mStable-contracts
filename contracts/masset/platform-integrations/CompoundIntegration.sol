pragma solidity 0.5.16;

import { ICERC20 } from "./ICompound.sol";
import { InitializableAbstractIntegration, MassetHelpers, IERC20 } from "./InitializableAbstractIntegration.sol";


/**
 * @title   CompoundIntegration
 * @author  Stability Labs Pty. Lte.
 * @notice  A simple connection to deposit and withdraw bAssets from Compound
 */
contract CompoundIntegration is InitializableAbstractIntegration {

    /***************************************
                    CORE
    ****************************************/

    /**
     * @dev Deposit a quantity of bAsset into the platform. Credited cTokens
     * remain here in the vault. Can only be called by whitelisted addresses
     * (mAsset and corresponding BasketManager)
     * @param _bAsset              Address for the bAsset
     * @param _amount              Units of bAsset to deposit
     * @param _isTokenFeeCharged   Flag that signals if an xfer fee is charged on bAsset
     * @return quantityDeposited   Quantity of bAsset that entered the platform
     */
    function deposit(
        address _bAsset,
        uint256 _amount,
        bool _isTokenFeeCharged
    )
        external
        onlyWhitelisted
        returns (uint256 quantityDeposited)
    {
        // Get the Target token
        ICERC20 cToken = _getCTokenFor(_bAsset);

        // We should have been sent this amount, if not, the deposit will fail
        quantityDeposited = _amount;

        if(_isTokenFeeCharged) {
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

    /**
     * @dev Withdraw a quantity of bAsset from Compound. Redemption
     * should fail if we have insufficient cToken balance.
     * @param _receiver     Address to which the withdrawn bAsset should be sent
     * @param _bAsset       Address of the bAsset
     * @param _amount       Units of bAsset to withdraw
     */
    function withdraw(
        address _receiver,
        address _bAsset,
        uint256 _amount
    )
        external
        onlyWhitelisted
    {
        // Get the Target token
        ICERC20 cToken = _getCTokenFor(_bAsset);

        // Redeem Underlying bAsset amount
        require(cToken.redeemUnderlying(_amount) == 0, "something went wrong");

        // Send redeemed bAsset to the receiver
        IERC20(_bAsset).safeTransfer(_receiver, _amount);

        emit Withdrawal(_bAsset, address(cToken), _amount);
    }

    /**
     * @dev Get the total bAsset value held in the platform
     * This includes any interest that was generated since depositing
     * Compound exchange rate between the cToken and bAsset gradually increases,
     * causing the cToken to be worth more corresponding bAsset.
     * @param _bAsset     Address of the bAsset
     * @return balance    Total value of the bAsset in the platform
     */
    function checkBalance(address _bAsset)
        external
        returns (uint256 balance)
    {
        // balance is always with token cToken decimals
        ICERC20 cToken = _getCTokenFor(_bAsset);
        return _checkBalance(cToken);
    }

    /***************************************
                    APPROVALS
    ****************************************/

    /**
     * @dev Re-approve the spending of all bAssets by their corresponding cToken,
     * if for some reason is it necessary. Only callable through Governance.
     */
    function reApproveAllTokens()
        external
        onlyGovernor
    {
        uint256 bAssetCount = bAssetsMapped.length;
        for(uint i = 0; i < bAssetCount; i++){
            address bAsset = bAssetsMapped[i];
            address cToken = bAssetToPToken[bAsset];
            MassetHelpers.safeInfiniteApprove(bAssetsMapped[i], cToken);
        }
    }

    /**
     * @dev Internal method to respond to the addition of new bAsset / cTokens
     * We need to approve the cToken and give it permission to spend the bAsset
     * @param _bAsset Address of the bAsset to approve
     * @param _cToken This cToken has the approval approval
     */
    function _abstractSetPToken(address _bAsset, address _cToken)
        internal
    {
        // approve the pool to spend the bAsset
        MassetHelpers.safeInfiniteApprove(_bAsset, _cToken);
    }

    /***************************************
                    HELPERS
    ****************************************/

    /**
     * @dev Get the cToken wrapped in the ICERC20 interface for this bAsset.
     * Fails if the pToken doesn't exist in our mappings.
     * @param _bAsset  Address of the bAsset
     * @return cToken  Corresponding cToken to this bAsset
     */
    function _getCTokenFor(address _bAsset)
        internal
        view
        returns (ICERC20)
    {
        address cToken = bAssetToPToken[_bAsset];
        require(cToken != address(0), "cToken does not exist");
        return ICERC20(cToken);
    }

    /**
     * @dev Get the total bAsset value held in the platform
     * @param _cToken     cToken for which to check balance
     * @return balance    Total value of the bAsset in the platform
     */
    function _checkBalance(ICERC20 _cToken)
        internal
        returns (uint256 balance)
    {
        return _cToken.balanceOfUnderlying(address(this));
    }
}