pragma solidity ^0.5.16;

/**
 * @title IManager
 * @dev (External) Interface for Manager
 */
interface IManager {

    /** ManagerPortal provides getters relevant to Massets */
    function validateBasset(address _masset, address _newBasset, uint256 _measurementMultiple, bool _isTransferFeeCharged)
        external view returns(bool isValid);
    function getMassetPrice(address _masset) external view returns(uint256, uint256);

    /** Getters for Manager/System state */
    function getMassets() external view returns(address[] memory, bytes32[] memory);

    /** Masset Factory */
    function addMasset(bytes32 _massetKey, address _masset) external returns (address);
    function ejectMasset(address _masset) external;

}