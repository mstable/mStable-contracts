pragma solidity 0.5.16;

/**
 * @title ISavingsContract
 */
interface ISavingsContract {

    /** @dev Admin privs */
    function depositInterest(uint256 _amount) external;

    /** @dev User privs */
    function save(uint256 _amount) external;
    function withdraw(uint256 _amount) external;

}