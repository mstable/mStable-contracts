pragma solidity 0.5.16;

/**
 * @title ISavingsContract
 */
interface ISavingsContract {

    /** @dev Manager privs */
    function depositInterest(uint256 _amount) external;

    /** @dev Saver privs */
    function depositSavings(uint256 _amount) external returns (uint256 creditsIssued);
    function redeem(uint256 _amount) external returns (uint256 massetReturned);

    /** @dev Getters */
    function exchangeRate() external view returns (uint256);
    function creditBalances(address) external view returns (uint256);
}