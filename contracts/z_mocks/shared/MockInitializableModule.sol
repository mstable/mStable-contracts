pragma solidity 0.5.16;

import { InitializableModule } from "../../shared/InitializableModule.sol";
import { Initializable } from "@openzeppelin/upgrades/contracts/Initializable.sol";

contract MockInitializableModule is Initializable, InitializableModule {

    uint256 public temp;

    function initialize(
        address _nexus
    )
        public
        initializer
    {
        InitializableModule._initialize(_nexus);
    }

    function governor() public view returns (address) {
        return super._governor();
    }

    function governance() public view returns (address) {
        return super._governance();
    }

    function proxyAdmin() public view returns (address) {
        return super._proxyAdmin();
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