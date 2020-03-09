pragma solidity 0.5.16;

/**
 * @title ISavingsManager
 */
interface ISavingsManager {

    /** @dev Admin privs */
    function collectAndDistributeInterest(address _mAsset) external;

}