pragma solidity ^0.5.12;

/**
  * @title INexus
  * @dev Basic interface for interacting with the Nexus i.e. SystemKernel
  */
interface INexus {
    function getModule(bytes32 key) external view returns (address);
    function getModules() external view returns (uint count, bytes32[] memory keys, address[] memory addresses);

    function addModule(bytes32 _moduleKey, address _module, bool _isSubscriber) external returns (bool);
    function addModules(bytes32[] calldata _moduleKeys, address[] calldata _modules, bool[] calldata _isSubscriber) external returns (bool);

    function removeModule(bytes32 _moduleKey) external returns (bool);
}