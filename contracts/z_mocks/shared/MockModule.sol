pragma solidity ^0.5.16;

import { Module } from "../../shared/Module.sol";

contract MockModule is Module {

    uint256 public temp;

    function governor() public view returns (address) {
        return super._governor();
    }

    function governance() internal view returns (address) {
        return super._governance();
    }

    function staking() internal view returns (address) {
        return super._staking();
    }

    function metaToken() internal view returns (address) {
        return super._metaToken();
    }

    function oracleHub() internal view returns (address) {
        return super._oracleHub();
    }

    function manager() internal view returns (address) {
        return super._manager();
    }

    function savingsManager() internal view returns (address) {
        return super._savingsManager();
    }

    function recollateraliser() internal view returns (address) {
        return super._recollateraliser();
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
}