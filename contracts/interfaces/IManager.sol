pragma solidity 0.5.16;

/**
 * @title IManager
 * @dev (External) Interface for Manager
 */
interface IManager {

    /** ManagerPortal provides getters relevant to Massets */
    function validateBasset(address, address, uint256, bool) external view returns(bool isValid);
    function getAssetPrices(address _asset1, address _asset2) external view returns(uint256, uint256);
    function getAssetPrice(address _asset) external view returns(uint256);

    /** Getters for Manager/System state */
    function getMassets() external view returns(address[] memory, bytes32[] memory);

    /** Masset Factory */
    function addMasset(bytes32 _massetKey, address _masset) external returns (address);
    function ejectMasset(address _masset) external;

}