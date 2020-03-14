pragma solidity ^0.5.16;

import { Module } from "../shared/Module.sol";

/**
 * @title   GovernableWhitelist
 * @author  Stability Labs Pty. Lte.
 * @notice  Contract to store whitelisted address. The onlyWhitelisted() modifier should be used
 *          to allow the function calls only from the whitelisted addresses.
 */
contract GovernableWhitelist is Module {

    event Whitelisted(address indexed _address);

    mapping(address => bool) public whitelist;

    /**
     * @dev Modifier to allow function calls only from the whitelisted address.
     */
    modifier onlyWhitelisted() {
        require(whitelist[msg.sender], "Not a whitelisted address");
        _;
    }

    /**
     * @dev Internal Constructor
     * @param _whitelisted Array of whitelisted addresses.
     */
    constructor(
        address _nexus,
        address[] memory _whitelisted
    )
        internal
        Module(_nexus)
    {
        GovernableWhitelist._initialize(_nexus, _whitelisted);
    }

    /**
     * @dev Initialization function for upgradable proxy contracts
     * @param _whitelisted Array of whitelisted addresses.
     */
    function _initialize(address _nexus, address[] memory _whitelisted) internal {
        Module._initialize(_nexus);

        require(_whitelisted.length > 0, "Empty whitelist array");

        for(uint256 i = 0; i < _whitelisted.length; i++) {
            _addWhitelist(_whitelisted[i]);
        }
    }

    /**
     * @dev Adds a new whitelist address
     * @param _address Address to add in whitelist
     */
    function _addWhitelist(address _address) internal {
        require(_address != address(0), "Address is zero");
        require(! whitelist[_address], "Already whitelisted");

        whitelist[_address] = true;

        emit Whitelisted(_address);
    }

}