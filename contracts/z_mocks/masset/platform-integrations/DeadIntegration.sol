pragma solidity 0.5.16;


/**
 * @title Platform interface to integrate with lending platform like Compound, AAVE etc.
 */
interface IPlatformIntegration {

    function checkBalance(address _bAsset) external returns (uint256 balance);

}

/**
 * @dev This file is used purely to allow the instantiation of BasketManagers
 * initialize function with dead data. This stops attackers calling the func
 * and initializing the contract with data. Even though this is the implementation
 * contract of a proxy and the storage will not be used.
 */
contract DeadIntegration is IPlatformIntegration{

    function checkBalance(address /*_bAsset*/) external returns (uint256 balance) {
        return 0;
    }
}