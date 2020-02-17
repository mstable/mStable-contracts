pragma solidity ^0.5.12;

/**
  * @title INexus
  * @dev Basic interface for interacting with the Nexus i.e. SystemKernel
  */
interface INexus {
    function governor() external view returns (address);
    function getModule(bytes32 key) external view returns (address);

    //function addModule(bytes32 _key, address _addr) external returns (bool);
    //function addModules(bytes32[] calldata _moduleKeys, address[] calldata _modules) external returns (bool);

    function lockModule(bytes32 _key) external returns (bool);
}