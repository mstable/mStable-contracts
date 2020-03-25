pragma solidity 0.5.16;

import { InitializableModuleKeys } from "../shared/InitializableModuleKeys.sol";
import { INexus } from "../interfaces/INexus.sol";

/**
 * @title   InitializableModule
 * @author  Stability Labs Pty. Lte.
 * @dev     Subscribes to module updates from a given publisher and reads from its registry.
 *          Contract is used for upgradable proxy contracts.
 */
contract InitializableModule is InitializableModuleKeys {

    INexus public nexus;

    /**
     * @dev Address of the DelayedProxyAdmin contract.
     *      This will be initialized from the first implementation contract. In the new upgraded
     *      contract instances, this will not change.
     *      DO NOT MODIFY / REMOVE THIS FROM THE NEW UPGRADED CONTRACTS
     */
    address public proxyAdmin;

    /**
     * @dev The modifier should be used for `initializeX()` functions present in the new upgraded
     *      contract implementation. This modifier is used to avoid unauthorized calls to the
     *      `initializeX()` like functions in the new implementation contract.
     */
    modifier onlyProxyAdmin() {
        require(msg.sender == proxyAdmin, "Only ProxyAdmin can execute");
        _;
    }

    /**
     * @dev Initialises the Module by setting publisher, and reading all available system
     *      module information.
     * @param _proxyAdmin DelayedProxyAdmin contract address
     * @param _nexus Nexus contract address
     */
    constructor(address _proxyAdmin, address _nexus) internal {
        InitializableModule._initialize(_proxyAdmin, _nexus);
    }

    /**
     * @dev Modifier to allow function calls only from the Governor.
     */
    modifier onlyGovernor() {
        require(msg.sender == _governor(), "Only governor can execute");
        _;
    }

    /**
     * @dev Modifier to allow function calls only from the Governance.
     *      Governance is either Governor address or Governance address.
     */
    modifier onlyGovernance() {
        require(
            msg.sender == _governor() || msg.sender == _governance(),
            "Only governance can execute"
        );
        _;
    }

    /**
     * @dev Modifier to allow function calls only from the Manager.
     */
    modifier onlyManager() {
        require(msg.sender == _manager(), "Only manager can execute");
        _;
    }

    /**
     * @dev Initialization function for upgradable proxy contracts
     * @param _proxyAdmin DelayedProxyAdmin contract address
     * @param _nexus Nexus contract address
     */
    function _initialize(address _proxyAdmin, address _nexus) internal {
        require(_nexus != address(0), "Nexus address is zero");
        proxyAdmin = _proxyAdmin;
        nexus = INexus(_nexus);
        InitializableModuleKeys._initialize();
    }

    /**
     * @dev Returns Governor address from the Nexus
     * @return Address of Governor Contract
     */
    function _governor() internal view returns (address) {
        return nexus.governor();
    }

    /**
     * @dev Returns Governance Module address from the Nexus
     * @return Address of the Governance (Phase 2)
     */
    function _governance() internal view returns (address) {
        return nexus.getModule(Key_Governance);
    }

    /**
     * @dev Return Staking Module address from the Nexus
     * @return Address of the Staking Module contract
     */
    function _staking() internal view returns (address) {
        return nexus.getModule(Key_Staking);
    }

    /**
     * @dev Return MetaToken Module address from the Nexus
     * @return Address of the MetaToken Module contract
     */
    function _metaToken() internal view returns (address) {
        return nexus.getModule(Key_MetaToken);
    }

    /**
     * @dev Return OracleHub Module address from the Nexus
     * @return Address of the OracleHub Module contract
     */
    function _oracleHub() internal view returns (address) {
        return nexus.getModule(Key_OracleHub);
    }

    /**
     * @dev Return Manager Module address from the Nexus
     * @return Address of the Manager Module contract
     */
    function _manager() internal view returns (address) {
        return nexus.getModule(Key_Manager);
    }

    /**
     * @dev Return SavingsManager Module address from the Nexus
     * @return Address of the SavingsManager Module contract
     */
    function _savingsManager() internal view returns (address) {
        return nexus.getModule(Key_SavingsManager);
    }

    /**
     * @dev Return Recollateraliser Module address from the Nexus
     * @return  Address of the Recollateraliser Module contract (Phase 2)
     */
    function _recollateraliser() internal view returns (address) {
        return nexus.getModule(Key_Recollateraliser);
    }
}
