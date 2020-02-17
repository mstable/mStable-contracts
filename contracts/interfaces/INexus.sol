pragma solidity ^0.5.12;

/**
  * @title INexus
  * @dev Basic interface for interacting with the Nexus i.e. SystemKernel
  */
interface INexus {
    function governor() external view returns (address);
    function getModule(bytes32 key) external view returns (address);

    function requestModule(bytes32 _key, address _addr) external;
    function cancelProposedModule(bytes32 _key, address _addr) external;
    function addProposedModule(bytes32 _key, address _addr) external;
    function addProposedModules(bytes32[] calldata _keys, address[] calldata _addrs) external;

    function requestLockModule(bytes32 _key) external;
    function cancelLockModule(bytes32 _key) external;
    function lockModule(bytes32 _key) external returns (bool);
}