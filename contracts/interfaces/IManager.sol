pragma solidity ^0.5.12;

/**
 * @title IManager
 * @dev (External) Interface for Manager
 */
interface IManager {

    /** Masset Setters */
    function upgradeForgeValidator(address _newForgeValidator) external;

    /** ManagerPortal provides getters relevant to Massets */
    function getMassetPrice(address _masset) external view returns(uint256, uint256);

    /** Getters for Manager/System state */
    function getMassets() external view returns(address[] memory, bytes32[] memory);

    /** Masset Factory */
    function addMasset(bytes32 _massetKey, address _masset) external returns (address);
    function ejectMasset(address _masset) external;

}