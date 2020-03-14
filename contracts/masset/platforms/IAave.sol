pragma solidity 0.5.16;

interface IAaveAToken {
    /**
     * @dev redeem() function of aToken
     */
    function redeem(uint256 _amount) external;

    function balanceOf(address _user) external view returns(uint256);
}

interface IAaveLendingPool {
    /**
     * deposit() function on LendingPool
     */
    function deposit(address _reserve, uint256 _amount, uint16 _referralCode) external;

}

interface ILendingPoolAddressesProvider {
    function getLendingPool() external view returns (address);
}