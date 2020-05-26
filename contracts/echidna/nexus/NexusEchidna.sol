pragma solidity 0.5.16;

import { Nexus } from "../../nexus/Nexus.sol";

contract NexusEchidna is Nexus(0x00a329C0648769a73afAC7F9381e08fb43DBEA70) {

    constructor() public {
        // Adding a LOCKED module directly
        modules[bytes32("0x01")].addr = address(0x1);
        modules[bytes32("0x01")].isLocked = true;

        // Adding a UNLOCKED module directly
        modules[bytes32("0x02")].addr = address(0x2);
        modules[bytes32("0x02")].isLocked = false;
    }

    // ===============================
    //      OVERIDDEN FUNCTIONS
    // ===============================

    bytes32[] private proposedKeys;
    bytes32[] private acceptedProposals;

    // @override
    function _acceptProposedModule(bytes32 _key) internal {
        // To store all proposed keys
        proposedKeys.push(_key);

        // To list all valid accepted proposals
        Proposal memory p = proposedModules[_key];
        uint timestamp = p.timestamp;
        if(timestamp > 0 && now >= timestamp.add(UPGRADE_DELAY)) {
            acceptedProposals.push(_key);
        }

        // In case of invalid key, the transaction will revert.
        super._acceptProposedModule(_key);
    }

    // ===============================
    //      PROPERTIES
    // ===============================

    function echidna_proposedKeys_must_have_timestamp() public view returns (bool) {
        bool isValid = true;
        for(uint256 i = 0; i < proposedKeys.length; i++) {
            Proposal memory p = proposedModules[proposedKeys[i]];
            if(p.newAddress != address(0)) {
                isValid = isValid && (p.timestamp > 0);
            }
        }

        return isValid;
    }

    function echidna_all_accepted_modules_must_exist() public view returns (bool) {
        bool isValid = true;
        for(uint256 i = 0; i < acceptedProposals.length; i++) {
            Module memory p = modules[acceptedProposals[i]];
            isValid = isValid && (p.addr != address(0));
        }

        return isValid;
    }

    function echidna_all_locked_modules_must_not_have_proposedModule_entry() public view returns (bool) {
        bool isValid = true;
        for(uint256 i = 0; i < acceptedProposals.length; i++) {
            bytes32 key = acceptedProposals[i];
            Module memory p = modules[key];
            if(p.isLocked) {
                isValid = isValid && (proposedModules[key].timestamp == 0);
            }
        }

        return isValid;
    }

    function echidna_no_module_with_zero() public view returns (bool) {
        return (
            modules[bytes32(0x00)].addr == address(0) &&
            proposedModules[bytes32(0x00)].newAddress == address(0) &&
            proposedLockModules[bytes32(0x00)] == 0
        );
    }

    function echidna_locked_module_must_not_change() public view returns (bool) {
        return (
            modules[bytes32("0x01")].addr == address(0x1) &&
            modules[bytes32("0x01")].isLocked == true
        );
    }

    function echidna_unlocked_module_may_change() public view returns (bool) {
        address addr = modules[bytes32("0x02")].addr;
        bool isLocked = modules[bytes32("0x02")].isLocked;
        bool validAddr = (addr != address(0) || addr == address(0x2));
        bool validLocked = isLocked ? true: true;
        return (validAddr && validLocked);
    }

    function echidna_both_modules_must_always_exist() public view returns (bool) {
        return (moduleExists(bytes32("0x01")) && moduleExists(bytes32("0x02")));
    }
}