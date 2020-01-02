pragma solidity ^0.5.12;

/**
 * @title IManager
 * @dev (External) Interface for Manager
 */
interface IManager {

    /** Masset Setters */
    function upgradeForgeLib(address _newForgeLib) external;

    /** Peg detection */
    function detectAllPegDeviations() external;
    function detectPegDeviation(address _masset) external;

    /** Proposal Resolution */
    function recollatoraliseBasset(address _masset, address _basset, uint256 _validatedMassetPrice, uint256 _validatedMetaPrice) external;
    function negateRecol(address _masset, address _basset) external;

    /** Auction Resolution */
    function completeRecol(address _masset, address _basset, uint256 _unitsUnderCollateralised) external;


    /** ManagerPortal provides getters relevant to Massets */
    function getModuleAddresses() external view returns(address _systok, address _forgeLib, address _governance);
    function getMassetPrice(address _masset) external view returns(uint256, uint256);


    /** Getters for Manager/System state */
    function getMassets() external view returns(address[] memory, bytes32[] memory);


    /** Masset Factory */
    function addMasset(bytes32 _massetKey, address _masset) external returns (address);
    function ejectMasset(address _masset) external;

}