pragma solidity 0.5.16;

/**
 * @title ISavingsContract
 */
interface ISavingsContract {

    /** @dev Admin privs */
    function depositInterest(uint256 _amount) external;

    /** @dev User privs */
    function depositSavings(uint256 _amount) external returns (uint256 creditsIssued);
    function redeem(uint256 _amount) external returns (uint256 massetReturned);

}