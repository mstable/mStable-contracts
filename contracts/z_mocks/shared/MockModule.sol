pragma solidity 0.5.16;

import { Module } from "../../shared/Module.sol";

contract MockModule is Module {

    uint256 public temp;

    constructor(address _nexus) public Module(_nexus) {}

    function governor() public view returns (address) {
        return super._governor();
    }

    function governance() public view returns (address) {
        return super._governance();
    }

    function staking() public view returns (address) {
        return super._staking();
    }

    function metaToken() public view returns (address) {
        return super._metaToken();
    }

    function oracleHub() public view returns (address) {
        return super._oracleHub();
    }

    function manager() public view returns (address) {
        return super._manager();
    }

    function savingsManager() public view returns (address) {
        return super._savingsManager();
    }

    function recollateraliser() public view returns (address) {
        return super._recollateraliser();
    }

    function proxyAdmin() public view returns (address) {
        return super._proxyAdmin();
    }

    function shouldAllowOnlyGovernor() public onlyGovernor {
        temp = 1;
    }

    function shouldAllowOnlyGovernance() public onlyGovernance {
        temp = 2;
    }

    function shouldAllowOnlyManager() public onlyManager {
        temp = 3;
    }

    function shouldAllowOnlyProxyAdmin() public onlyProxyAdmin {
        temp = 4;
    }
}