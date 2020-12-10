pragma solidity 0.5.16;

import {
    IAaveATokenV2,
    IAaveLendingPoolV2,
    ILendingPoolAddressesProviderV2
} from "./IAave.sol";
import { InitializableAbstractIntegration, MassetHelpers, IERC20, SafeMath } from "./InitializableAbstractIntegration.sol";


/**
 * @title   AaveV2Integration
 * @author  Stability Labs Pty. Ltd.
 * @notice  A simple connection to deposit and withdraw bAssets from Aave
 * @dev     VERSION: 1.0
 *          DATE:    2020-16-11
 */
contract AaveV2Integration is InitializableAbstractIntegration {

    event RewardTokenApproved(address rewardToken, address account);

    /***************************************
                    ADMIN
    ****************************************/

    /**
     * @dev Approves Liquidator to spend reward tokens
     */
    function approveRewardToken()
        external
        onlyGovernor
    {
        address liquidator = nexus.getModule(keccak256("Liquidator"));
        require(liquidator != address(0), "Liquidator address cannot be zero");

        // Official checksummed AAVE token address
        // https://ethplorer.io/address/0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9
        address aaveToken = address(0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9);

        MassetHelpers.safeInfiniteApprove(aaveToken, liquidator);

        emit RewardTokenApproved(address(aaveToken), liquidator);
    }


    /***************************************
                    CORE
    ****************************************/

    /**
     * @dev Deposit a quantity of bAsset into the platform. Credited aTokens
     *      remain here in the vault. Can only be called by whitelisted addresses
     *      (mAsset and corresponding BasketManager)
     * @param _bAsset              Address for the bAsset
     * @param _amount              Units of bAsset to deposit
     * @param _hasTxFee            Is the bAsset known to have a tx fee?
     * @return quantityDeposited   Quantity of bAsset that entered the platform
     */
    function deposit(
        address _bAsset,
        uint256 _amount,
        bool _hasTxFee
    )
        external
        onlyWhitelisted
        nonReentrant
        returns (uint256 quantityDeposited)
    {
        require(_amount > 0, "Must deposit something");

        IAaveATokenV2 aToken = _getATokenFor(_bAsset);

        quantityDeposited = _amount;

        if(_hasTxFee) {
            // If we charge a fee, account for it
            uint256 prevBal = _checkBalance(aToken);
            _getLendingPool().deposit(_bAsset, _amount, address(this), 36);
            uint256 newBal = _checkBalance(aToken);
            quantityDeposited = _min(quantityDeposited, newBal.sub(prevBal));
        } else {
            _getLendingPool().deposit(_bAsset, _amount, address(this), 36);
        }

        emit Deposit(_bAsset, address(aToken), quantityDeposited);
    }

    /**
     * @dev Withdraw a quantity of bAsset from the platform
     * @param _receiver     Address to which the bAsset should be sent
     * @param _bAsset       Address of the bAsset
     * @param _amount       Units of bAsset to withdraw
     * @param _hasTxFee     Is the bAsset known to have a tx fee?
     */
    function withdraw(
        address _receiver,
        address _bAsset,
        uint256 _amount,
        bool _hasTxFee
    )
        external
        onlyWhitelisted
        nonReentrant
    {
        _withdraw(_receiver, _bAsset, _amount, _amount, _hasTxFee);
    }

    /**
     * @dev Withdraw a quantity of bAsset from the platform
     * @param _receiver     Address to which the bAsset should be sent
     * @param _bAsset       Address of the bAsset
     * @param _amount       Units of bAsset to send to recipient
     * @param _totalAmount  Total units to pull from lending platform
     * @param _hasTxFee     Is the bAsset known to have a tx fee?
     */
    function withdraw(
        address _receiver,
        address _bAsset,
        uint256 _amount,
        uint256 _totalAmount,
        bool _hasTxFee
    )
        external
        onlyWhitelisted
        nonReentrant
    {
        _withdraw(_receiver, _bAsset, _amount, _totalAmount, _hasTxFee);
    }

    /** @dev Withdraws _totalAmount from the lending pool, sending _amount to user */
    function _withdraw(
        address _receiver,
        address _bAsset,
        uint256 _amount,
        uint256 _totalAmount,
        bool _hasTxFee
    )
        internal
    {
        require(_totalAmount > 0, "Must withdraw something");

        IAaveATokenV2 aToken = _getATokenFor(_bAsset);

        if(_hasTxFee) {
            require(_amount == _totalAmount, "Cache inactive for assets with fee");
            _getLendingPool().withdraw(_bAsset, _amount, _receiver);
        } else {
            _getLendingPool().withdraw(_bAsset, _totalAmount, address(this));
            // Send redeemed bAsset to the receiver
            IERC20(_bAsset).safeTransfer(_receiver, _amount);
        }

        emit PlatformWithdrawal(_bAsset, address(aToken), _totalAmount, _amount);
    }

    /**
     * @dev Withdraw a quantity of bAsset from the cache.
     * @param _receiver     Address to which the bAsset should be sent
     * @param _bAsset       Address of the bAsset
     * @param _amount       Units of bAsset to withdraw
     */
    function withdrawRaw(
        address _receiver,
        address _bAsset,
        uint256 _amount
    )
        external
        onlyWhitelisted
        nonReentrant
    {
        require(_amount > 0, "Must withdraw something");
        require(_receiver != address(0), "Must specify recipient");

        // Send redeemed bAsset to the receiver
        IERC20(_bAsset).safeTransfer(_receiver, _amount);

        emit Withdrawal(_bAsset, address(0), _amount);
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
        IAaveATokenV2 aToken = _getATokenFor(_bAsset);
        return _checkBalance(aToken);
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
        address lendingPoolVault = address(_getLendingPool());
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
        address lendingPool = address(_getLendingPool());
        // approve the pool to spend the bAsset
        MassetHelpers.safeInfiniteApprove(_bAsset, lendingPool);
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
        address lendingPool = ILendingPoolAddressesProviderV2(platformAddress).getLendingPool();
        require(lendingPool != address(0), "Lending pool does not exist");
        return IAaveLendingPoolV2(lendingPool);
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
        returns (IAaveATokenV2)
    {
        address aToken = bAssetToPToken[_bAsset];
        require(aToken != address(0), "aToken does not exist");
        return IAaveATokenV2(aToken);
    }

    /**
     * @dev Get the total bAsset value held in the platform
     * @param _aToken     aToken for which to check balance
     * @return balance    Total value of the bAsset in the platform
     */
    function _checkBalance(IAaveATokenV2 _aToken)
        internal
        view
        returns (uint256 balance)
    {
        return _aToken.balanceOf(address(this));
    }

}
