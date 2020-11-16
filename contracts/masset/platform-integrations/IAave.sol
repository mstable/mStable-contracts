pragma solidity 0.5.16;

/**
 * @dev Interface for Aaves A Token
 * Documentation: https://developers.aave.com/#atokens
 */
interface IAaveATokenV1 {

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
interface IAaveLendingPoolV1 {

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
interface ILendingPoolAddressesProviderV1 {

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

/**
 * @dev Interface for Aaves Lending Pool
 * Documentation: https://developers.aave.com/#lendingpooladdressesprovider
 */
interface ILendingPoolAddressesProviderV2 {

    /**
     * @notice Get the current address for Aave LendingPool
     * @dev Lending pool is the core contract on which to call deposit
     */
    function getLendingPool() external view returns (address);
}

/**
 * @dev Interface for Aaves A Token
 * Documentation: https://developers.aave.com/#atokens
 */
interface IAaveATokenV2 {

    /**
     * @notice returns the current total aToken balance of _user all interest collected included.
     * To obtain the user asset principal balance with interests excluded , ERC20 non-standard
     * method principalBalanceOf() can be used.
     */
    function balanceOf(address _user) external view returns(uint256);
}


interface IAaveLendingPoolV2 {

    /**
    * @dev deposits The underlying asset into the reserve. A corresponding amount of the overlying asset (aTokens)
    * is minted.
    * @param reserve the address of the reserve
    * @param amount the amount to be deposited
    * @param referralCode integrators are assigned a referral code and can potentially receive rewards.
    **/
    function deposit(
        address reserve,
        uint256 amount,
        address onBehalfOf,
        uint16 referralCode
    ) external;

    /**
    * @dev withdraws the assets of user.
    * @param reserve the address of the reserve
    * @param amount the underlying amount to be redeemed
    * @param to address that will receive the underlying
    **/
    function withdraw(
        address reserve,
        uint256 amount,
        address to
    ) external;
}