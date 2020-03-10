pragma solidity ^0.5.16;

interface IAaveAToken {
    /**
     * @dev redeem() function of aToken
     */
    function redeem(uint256 _amount) external;

    function balanceOf(address _user) external view returns(uint256);
}