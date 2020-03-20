pragma solidity 0.5.16;

/**
 * @dev Interface for Aaves A Token
 * Documentation: https://developers.aave.com/#atokens
 */
interface IAaveAToken {

    /**
     * @notice Non-standard ERC20 function to redeem an _amount of aTokens for the underlying
     * asset, burning the aTokens during the process.
     * @param _amount Amount of aTokens
     */
    function redeem(uint256 _amount) external;

    /**
     * @notice returns the current total aToken balance of _user all interest collected included.
     * To obtain the user asset principal balance with interests excluded , ERC20 non-standard
     * method principalBalanceOf() can be used.
     */
    function balanceOf(address _user) external view returns(uint256);
}

/**
 * @dev Interface for Aaves Lending Pool
 * Documentation: https://developers.aave.com/#lendingpool
 */
interface IAaveLendingPool {

    /**
     * @notice Deposits a certain _amount of an asset specified by the _reserve parameter.
     * @dev The caller receives a certain amount of corresponding aTokens in exchange.
     * The amount of aTokens received depends on the corresponding aToken exchange rate.
     * LendingPoolCore must be approved to spend this reserve
     */
    function deposit(address _reserve, uint256 _amount, uint16 _referralCode) external;

}
/**
 * @dev Interface for Aaves Lending Pool
 * Documentation: https://developers.aave.com/#lendingpooladdressesprovider
 */
interface ILendingPoolAddressesProvider {

    /**
     * @notice Get the current address for Aave LendingPool
     * @dev Lending pool is the core contract on which to call deposit
     */
    function getLendingPool() external view returns (address);

    /**
     * @notice Get the address for lendingPoolCore
     * @dev IMPORTANT - this is where _reserve must be approved before deposit
     */
    function getLendingPoolCore() external view returns (address payable);

}