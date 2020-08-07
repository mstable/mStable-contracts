pragma solidity 0.5.16;

import { ICERC20 } from "./ICompound.sol";
import { InitializableAbstractIntegration, MassetHelpers, IERC20 } from "./InitializableAbstractIntegration.sol";


/**
 * @title   CompoundIntegration
 * @author  Stability Labs Pty. Ltd.
 * @notice  A simple connection to deposit and withdraw bAssets from Compound
 * @dev     VERSION: 1.1
 *          DATE:    2020-07-29
 */
contract CompoundIntegration is InitializableAbstractIntegration {

    event RewardTokenCollected(address recipient, uint256 amount);
    event SkippedWithdrawal(address bAsset, uint256 amount);

    /***************************************
                    ADMIN
    ****************************************/

    /**
     * @dev Collects the accumulated COMP token from the contract
     * @param _recipient Recipient to credit
     */
    function collectRewardToken(
        address _recipient
    )
        external
        onlyGovernor
    {
        // Official checksummed COMP token address
        // https://ethplorer.io/address/0xc00e94cb662c3520282e6f5717214004a7f26888
        IERC20 compToken = IERC20(0xc00e94Cb662C3520282E6f5717214004A7f26888);

        uint256 balance = compToken.balanceOf(address(this));

        require(compToken.transfer(_recipient, balance), "Collection transfer failed");

        emit RewardTokenCollected(_recipient, balance);
    }


    /***************************************
                    CORE
    ****************************************/

    /**
     * @dev Deposit a quantity of bAsset into the platform. Credited cTokens
     *      remain here in the vault. Can only be called by whitelisted addresses
     *      (mAsset and corresponding BasketManager)
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
        nonReentrant
        returns (uint256 quantityDeposited)
    {
        require(_amount > 0, "Must deposit something");

        // Get the Target token
        ICERC20 cToken = _getCTokenFor(_bAsset);

        // We should have been sent this amount, if not, the deposit will fail
        quantityDeposited = _amount;

        if(_isTokenFeeCharged) {
            // If we charge a fee, account for it
            uint256 prevBal = _checkBalance(cToken);
            require(cToken.mint(_amount) == 0, "cToken mint failed");
            uint256 newBal = _checkBalance(cToken);
            quantityDeposited = _min(quantityDeposited, newBal.sub(prevBal));
        } else {
            // Else just execute the mint
            require(cToken.mint(_amount) == 0, "cToken mint failed");
        }

        emit Deposit(_bAsset, address(cToken), quantityDeposited);
    }

    /**
     * @dev Withdraw a quantity of bAsset from Compound. Redemption
     *      should fail if we have insufficient cToken balance.
     * @param _receiver     Address to which the withdrawn bAsset should be sent
     * @param _bAsset       Address of the bAsset
     * @param _amount       Units of bAsset to withdraw
     */
    function withdraw(
        address _receiver,
        address _bAsset,
        uint256 _amount,
        bool _isTokenFeeCharged
    )
        external
        onlyWhitelisted
        nonReentrant
    {
        require(_amount > 0, "Must withdraw something");
        require(_receiver != address(0), "Must specify recipient");

        // Get the Target token
        ICERC20 cToken = _getCTokenFor(_bAsset);

        // If redeeming 0 cTokens, just skip, else COMP will revert
        // Reason for skipping: to ensure that redeemMasset is always able to execute
        uint256 cTokensToRedeem = _convertUnderlyingToCToken(cToken, _amount);
        if(cTokensToRedeem == 0) {
            emit SkippedWithdrawal(_bAsset, _amount);
            return;
        }

        uint256 quantityWithdrawn = _amount;

        if(_isTokenFeeCharged) {
            IERC20 b = IERC20(_bAsset);
            uint256 prevBal = b.balanceOf(address(this));
            require(cToken.redeemUnderlying(_amount) == 0, "redeem failed");
            uint256 newBal = b.balanceOf(address(this));
            quantityWithdrawn = _min(quantityWithdrawn, newBal.sub(prevBal));
        } else {
            // Redeem Underlying bAsset amount
            require(cToken.redeemUnderlying(_amount) == 0, "redeem failed");
        }

        // Send redeemed bAsset to the receiver
        IERC20(_bAsset).safeTransfer(_receiver, quantityWithdrawn);

        emit Withdrawal(_bAsset, address(cToken), quantityWithdrawn);
    }

    /**
     * @dev Get the total bAsset value held in the platform
     *      This includes any interest that was generated since depositing
     *      Compound exchange rate between the cToken and bAsset gradually increases,
     *      causing the cToken to be worth more corresponding bAsset.
     * @param _bAsset     Address of the bAsset
     * @return balance    Total value of the bAsset in the platform
     */
    function checkBalance(address _bAsset)
        external
        returns (uint256 balance)
    {
        // balance is always with token cToken decimals
        ICERC20 cToken = _getCTokenFor(_bAsset);
        balance = _checkBalance(cToken);
    }

    /***************************************
                    APPROVALS
    ****************************************/

    /**
     * @dev Re-approve the spending of all bAssets by their corresponding cToken,
     *      if for some reason is it necessary. Only callable through Governance.
     */
    function reApproveAllTokens()
        external
        onlyGovernor
    {
        uint256 bAssetCount = bAssetsMapped.length;
        for(uint i = 0; i < bAssetCount; i++){
            address bAsset = bAssetsMapped[i];
            address cToken = bAssetToPToken[bAsset];
            MassetHelpers.safeInfiniteApprove(bAsset, cToken);
        }
    }

    /**
     * @dev Internal method to respond to the addition of new bAsset / cTokens
     *      We need to approve the cToken and give it permission to spend the bAsset
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
     *      Fails if the pToken doesn't exist in our mappings.
     * @param _bAsset   Address of the bAsset
     * @return          Corresponding cToken to this bAsset
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
     *          underlying = (cTokenAmt * exchangeRate) / 1e18
     * @param _cToken     cToken for which to check balance
     * @return balance    Total value of the bAsset in the platform
     */
    function _checkBalance(ICERC20 _cToken)
        internal
        view
        returns (uint256 balance)
    {
        uint256 cTokenBalance = _cToken.balanceOf(address(this));
        uint256 exchangeRate = _cToken.exchangeRateStored();
        // e.g. 50e8*205316390724364402565641705 / 1e18 = 1.0265..e18
        balance = cTokenBalance.mul(exchangeRate).div(1e18);
    }

    /**
     * @dev Converts an underlying amount into cToken amount
     *          cTokenAmt = (underlying * 1e18) / exchangeRate
     * @param _cToken     cToken for which to change
     * @param _underlying Amount of underlying to convert
     * @return amount     Equivalent amount of cTokens
     */
    function _convertUnderlyingToCToken(ICERC20 _cToken, uint256 _underlying)
        internal
        view
        returns (uint256 amount)
    {
        uint256 exchangeRate = _cToken.exchangeRateStored();
        // e.g. 1e18*1e18 / 205316390724364402565641705 = 50e8
        // e.g. 1e8*1e18 / 205316390724364402565641705 = 0.45 or 0
        amount = _underlying.mul(1e18).div(exchangeRate);
    }
}
