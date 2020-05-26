pragma solidity 0.5.16;

import { DelayedProxyAdmin } from "../../upgradability/DelayedProxyAdmin.sol";
import { AdminUpgradeabilityProxy } from "@openzeppelin/upgrades/contracts/upgradeability/AdminUpgradeabilityProxy.sol";
import { AaveIntegration } from "../../masset/platform-integrations/AaveIntegration.sol";

// Use command with config to run Echidna
// echidna-test . --contract DelayedProxyAdminEchidna --config contracts/echidna/upgradability/config.yaml
contract DelayedProxyAdminEchidna is DelayedProxyAdmin {

    uint256 public constant START_TIME = 1000;
    AdminUpgradeabilityProxy private proxy;
    AaveIntegration aave;
    AaveIntegration aave2;

    constructor() public DelayedProxyAdmin(address(0x00a329C0648769a73afAC7F9381e08fb43DBEA70)){
        aave = new AaveIntegration();
        aave2 = new AaveIntegration();
        proxy = new AdminUpgradeabilityProxy(address(aave), address(this), "");

        // ==============================
        //      UPGRADE REQ 1
        // ==============================
        // Added a propose request directly
        // Added config.yaml to filter cancel transaction
        Request storage request = requests[address(proxy)];
        request.implementation = address(aave2);
        request.data = "";
        // `now` value seems to be 0 initially. Hence, hard coded value
        request.timestamp = START_TIME;

    }

    // Allows any caller to call any `onlyGovernor` protected functions
    function _governor() internal view returns (address) {
        return msg.sender;
    }

    /**
     * @dev Adds an upgrade req 2 when first upgrade is complete
     */
    bool private upgrade_req_2_done = false;
    function addUpgradeReq2() public {
        require(!upgrade_req_2_done, "");

        // First upgrade request performed
        address impl = getProxyImplementation(address(proxy));
        bool upgraded = impl == address(aave2);
        require(upgraded, "");

        // ==============================
        //      UPGRADE REQ 2
        // ==============================
        Request storage request = requests[address(proxy)];
        request.implementation = address(aave2);
        request.data = "";
        request.timestamp = now + START_TIME;

        upgrade_req_2_done = true;
    }

    // ====================================
    //              INVARIANTS
    // ====================================

    function echidna_valid_test_env() public view returns (bool) {
        return
            address(aave) != address(0) &&
            address(aave2) != address(0) &&
            address(proxy) != address(0);
    }

    function echidna_upgrade_delay_must_not_change() public pure returns (bool) {
        return UPGRADE_DELAY == 1 weeks;
    }

    function echidna_must_not_have_zero_proxy_addr() public view returns (bool) {
        Request memory r = requests[address(0)];
        return r.implementation == address(0) && r.timestamp == 0;
    }

    function echidna_no_eth() public view returns (bool) {
        return address(this).balance == 0;
    }

    function echidna_must_upgrade_after_1_week_delay() public view returns (bool) {
        Request memory r = requests[address(proxy)];
        uint256 timestamp = r.timestamp;
        if(timestamp == 0) return true; // upgraded

        uint256 delay = (now - START_TIME); // current timestamp - timestampWhenProposed

        address impl = getProxyImplementation(address(proxy));
        bool notUpgraded = impl == address(aave);
        bool upgraded = impl == address(aave2);

        if(notUpgraded) {
            return (delay <= 1 weeks || delay > 1 weeks);
        }

        if(upgraded) {
            return delay > 1 weeks;
        }

        return false;
    }

    function echidna_proxy_admin_must_be_this() public view returns (bool) {
        return getProxyAdmin(address(proxy)) == address(this);
    }

    function echidna_should_upgrade_to_new_implementation() public view returns (bool) {
        address impl = getProxyImplementation(address(proxy));
        return impl == address(aave) || impl == address(aave2);
    }

    // THIS TEST MUST FAIL AS THERE IS NO CHECK IN THE CODE
    // TODO STILL PASSING
    function echidna_should_not_allow_same_impl_upgrade() public view returns (bool) {
        if(upgrade_req_2_done == false) return true;

        Request storage request = requests[address(proxy)];
        return request.timestamp > 0;
    }
}