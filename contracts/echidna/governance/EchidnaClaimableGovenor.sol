pragma solidity 0.5.16;

import { Governable } from "../../governance/Governable.sol";
import { ClaimableGovernor } from "../../governance/ClaimableGovernor.sol";

contract EchidnaClaimableGovernor is ClaimableGovernor {

    address public proposedGovernor = address(0);

    constructor(address _governorAddr) public {
        _changeGovernor(_governorAddr);
    }
    
    function echidna_proposed_governor_not_zero() public returns (bool) {
        return (proposedGovernor != address(0));
    }

    function echidna_proposed_governor_modifier_check() public returns (bool) {
        return (msg.sender == proposedGovernor);
    } 

}