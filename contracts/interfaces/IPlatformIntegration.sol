pragma solidity 0.5.16;

/**
 * @title Platform interface to integrate with lending platform like Compound, AAVE etc.
 */
interface IPlatformIntegration {

    /**
     * @dev Deposit the given bAsset to Lending platform
     * @param _bAsset bAsset address
     * @param _amount Amount to deposit
     */
    function deposit(address _bAsset, uint256 _amount, bool isTokenFeeCharged)
        external returns (uint256 quantityDeposited);

    /**
     * @dev Withdraw given bAsset from Lending platform
     */
    function withdraw(address _receiver, address _bAsset, uint256 _amount, bool _isTokenFeeCharged) external;

    /**
     * @dev Returns the current balance of the given bAsset
     */
    function checkBalance(address _bAsset) external returns (uint256 balance);
}