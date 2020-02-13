pragma solidity ^0.5.12;

import { ClaimableGovernor } from "./ClaimableGovernor.sol";

contract DelayedClaimableGovernance is ClaimableGovernor {

    uint64 public delay;
    uint256 public requestTime;

    constructor(uint64 _delay) public {
        require(_delay > 0, "Delay must be greater then zero");
        delay = _delay;
    }

    function requestGovernorChange(address _proposedGovernor) public onlyGovernor {
        requestTime = now;
        super.requestGovernorChange(_proposedGovernor);
    }

    function cancelGovernorChange() public onlyGovernor {
        requestTime = 0;
        super.cancelGovernorChange();
    }

    function claimGovernorChange() public onlyProposedGovernor {
        require(now >= (requestTime + delay), "Governor cannot claim ownership");
        super.claimGovernorChange();
        requestTime = 0;
    }
}