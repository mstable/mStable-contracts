pragma solidity 0.5.16;

import { IAaveAToken, IAaveLendingPoolV1, IAaveLendingPoolV2, ILendingPoolAddressesProvider } from "./IAave.sol";
import { InitializableAbstractIntegration, MassetHelpers, IERC20, SafeMath } from "./InitializableAbstractIntegration.sol";


/**
 * @title   AaveIntegration
 * @author  Stability Labs Pty. Ltd.
 * @notice  A simple connection to deposit and withdraw bAssets from Aave
 * @dev     VERSION: 2.0
 *          DATE:    2020-10-08
 */
contract AaveIntegration is InitializableAbstractIntegration {

    /***************************************
                    CORE
    ****************************************/

    /**
     * @dev Deposit a quantity of bAsset into the platform. Credited aTokens
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
        IAaveAToken aToken = _getATokenFor(_bAsset);

        // We should have been sent this amount, if not, the deposit will fail
        quantityDeposited = _amount;

        uint16 referralCode = 36; // temp code

        if(_isTokenFeeCharged) {
            // If we charge a fee, account for it
            uint256 prevBal = _checkBalance(aToken);
            _getLendingPool().deposit(_bAsset, _amount, address(this), referralCode);
            uint256 newBal = _checkBalance(aToken);
            quantityDeposited = _min(quantityDeposited, newBal.sub(prevBal));
        } else {
            // aTokens are 1:1 for each asset
            _getLendingPool().deposit(_bAsset, _amount, address(this), referralCode);
        }

        emit Deposit(_bAsset, address(aToken), quantityDeposited);
    }

    /**
     * @dev Withdraw a quantity of bAsset from the platform. Redemption
     *      should fail if we have insufficient balance on the platform.
     * @param _receiver     Address to which the bAsset should be sent
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
        // Get the Target token
        IAaveAToken aToken = _getATokenFor(_bAsset);

        uint256 quantityWithdrawn = _amount;

        // Don't need to Approve aToken, as it gets burned in redeem()
        if(_isTokenFeeCharged) {
            IERC20 b = IERC20(_bAsset);
            uint256 prevBal = b.balanceOf(address(this));
            aToken.redeem(_amount);
            uint256 newBal = b.balanceOf(address(this));
            quantityWithdrawn = _min(quantityWithdrawn, newBal.sub(prevBal));
        } else {
            aToken.redeem(_amount);
        }

        // Send redeemed bAsset to the receiver
        IERC20(_bAsset).safeTransfer(_receiver, quantityWithdrawn);

        emit Withdrawal(_bAsset, address(aToken), quantityWithdrawn);
    }

    /**
     * @dev Get the total bAsset value held in the platform
     *      This includes any interest that was generated since depositing
     *      Aave gradually increases the balances of all aToken holders, as the interest grows
     * @param _bAsset     Address of the bAsset
     * @return balance    Total value of the bAsset in the platform
     */
    function checkBalance(address _bAsset)
        external
        returns (uint256 balance)
    {
        // balance is always with token aToken decimals
        IAaveAToken aToken = _getATokenFor(_bAsset);
        return _checkBalance(aToken);
    }

    /**
     * @dev Migrates from V1 to V2 by:
     *        - Withdrawing all reserves from V1
     *        - Updating the aToken address
     *        - Depositing into new reserve
     * @param _bAssets     Array of bAsset addresses
     * @param _newATokens  Address of newAToken addresses
     */
    function migrate(address[] calldata _bAssets, address[] calldata _newATokens)
        external
        onlyGovernor
    {
        uint256 len = _bAssets.length;
        require(len == _newATokens.length, "_bAssets and _newATokens arrays must be the same length");

        // Loop over bAssets, withdraw from v1 and deposit to v2
        for(uint i = 0; i < len; i++){
            address bAsset = _bAssets[i];
            address newAToken = _newATokens[i];
            require(newAToken != address(0), "Invalid AToken address");

            // 1. Redeem all existing aTokens
            //    Get the existing Aave Platform Token for the bAsset
            IAaveAToken oldAToken = _getATokenFor(bAsset);
            //    Get the balance held on the contract
            uint256 oldATokenBalance = _checkBalance(oldAToken);
            //    Redeem the underlying tokens from Aave v1
            oldAToken.redeem(oldATokenBalance);

            // 2. Update aToken address
            bAssetToPToken[bAsset] = newAToken;
            _abstractSetPToken(bAsset, newAToken);

            // 3. Deposit all into new reserve
            //    Get balance of _bAsset
            IERC20 b = IERC20(bAsset);
            uint256 bAssetBalance = b.balanceOf(address(this));
            //    Deposit to lending pool
            _getLendingPool().deposit(bAsset, bAssetBalance, address(this), 36);
            uint256 newATokenBalance = _checkBalance(_getATokenFor(bAsset));
            //    Dust = 1e24 / 1e6 = 1e18
            uint256 dust = newATokenBalance.div(1e6);
            require(newATokenBalance >= oldATokenBalance.sub(dust), "Balance must be gte previous balance");
            require(newATokenBalance <= oldATokenBalance.add(dust), "Balance must be within bounds of prev balance");
        }
    }

    /***************************************
                    APPROVALS
    ****************************************/

    /**
     * @dev Re-approve the spending of all bAssets by the Aave lending pool core,
     *      if for some reason is it necessary for example if the address of core changes.
     *      Only callable through Governance.
     */
    function reApproveAllTokens()
        external
        onlyGovernor
    {
        uint256 bAssetCount = bAssetsMapped.length;
        address lendingPoolVault = _getLendingPoolCore();
        // approve the pool to spend the bAsset
        for(uint i = 0; i < bAssetCount; i++){
            MassetHelpers.safeInfiniteApprove(bAssetsMapped[i], lendingPoolVault);
        }
    }

    /**
     * @dev Internal method to respond to the addition of new bAsset / pTokens
     *      We need to approve the Aave lending pool core conrtact and give it permission
     *      to spend the bAsset
     * @param _bAsset Address of the bAsset to approve
     */
    function _abstractSetPToken(address _bAsset, address /*_pToken*/)
        internal
    {
        address lendingPoolVault = _getLendingPoolCore();
        // approve the pool to spend the bAsset
        MassetHelpers.safeInfiniteApprove(_bAsset, lendingPoolVault);
    }

    /***************************************
                    HELPERS
    ****************************************/

    /**
     * @dev Get the current address of the Aave lending pool, which is the gateway to
     *      depositing.
     * @return Current lending pool implementation
     */
    function _getLendingPool()
        internal
        view
        returns (IAaveLendingPoolV2)
    {
        address lendingPool = ILendingPoolAddressesProvider(platformAddress).getLendingPool();
        require(lendingPool != address(0), "Lending pool does not exist");
        return IAaveLendingPoolV2(lendingPool);
    }

    /**
     * @dev Get the current address of the Aave lending pool core, which stores all the
     *      reserve tokens in its vault.
     * @return Current lending pool core address
     */
    function _getLendingPoolCore()
        internal
        view
        returns (address payable)
    {
        address payable lendingPoolCore = ILendingPoolAddressesProvider(platformAddress).getLendingPoolCore();
        require(lendingPoolCore != address(uint160(address(0))), "Lending pool core does not exist");
        return lendingPoolCore;
    }

    /**
     * @dev Get the pToken wrapped in the IAaveAToken interface for this bAsset, to use
     *      for withdrawing or balance checking. Fails if the pToken doesn't exist in our mappings.
     * @param _bAsset  Address of the bAsset
     * @return aToken  Corresponding to this bAsset
     */
    function _getATokenFor(address _bAsset)
        internal
        view
        returns (IAaveAToken)
    {
        address aToken = bAssetToPToken[_bAsset];
        require(aToken != address(0), "aToken does not exist");
        return IAaveAToken(aToken);
    }

    /**
     * @dev Get the total bAsset value held in the platform
     * @param _aToken     aToken for which to check balance
     * @return balance    Total value of the bAsset in the platform
     */
    function _checkBalance(IAaveAToken _aToken)
        internal
        view
        returns (uint256 balance)
    {
        return _aToken.balanceOf(address(this));
    }

}
