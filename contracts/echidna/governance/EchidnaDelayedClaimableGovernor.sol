pragma solidity 0.5.16;

import { Governable } from "../../governance/Governable.sol";
import { ClaimableGovernor } from "../../governance/ClaimableGovernor.sol";
import { DelayedClaimableGovernor } from "../../governance/DelayedClaimableGovernor.sol";

contract EchidnaDelayedClaimableGovernor is DelayedClaimableGovernor {
    uint256 public delay = 0;
    uint256 public requestTime = 0;
    

    constructor(address _governorAddr, uint256 _delay)
        public
        ClaimableGovernor(_governorAddr)
    {
        require(_delay > 0, "Delay must be greater than zero");
        address _governorAddr = address(0x1);
        delay = _delay;
    }

    function echidna_require_delay_above_zero() public returns (bool) {
        return (delay > 0);
    } 

    function echidna_now_does_not_exceed_return() public returns (bool) {
        return (now >= (requestTime.add(delay))
    }

}