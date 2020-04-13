pragma solidity 0.5.16;

import { ClaimableGovernor } from "./ClaimableGovernor.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";

/**
 * @title   DelayedClaimableGovernor
 * @author  Stability Labs Pty. Ltd.
 * @notice  Current Governor can initiate governance change request.
 *          After a defined delay, proposed Governor can claim governance
 *          ownership.
 */
contract DelayedClaimableGovernor is ClaimableGovernor {

    using SafeMath for uint256;

    uint256 public delay = 0;
    uint256 public requestTime = 0;

    /**
     * @dev Initializes the contract with given delay
     * @param _governorAddr Initial governor
     * @param _delay    Delay in seconds for 2 way handshake
     */
    constructor(address _governorAddr, uint256 _delay)
        public
        ClaimableGovernor(_governorAddr)
    {
        require(_delay > 0, "Delay must be greater than zero");
        delay = _delay;
    }

    //@override
    /**
     * @dev Requests change of governor and logs request time
     * @param _proposedGovernor Address of the new governor
     */
    function requestGovernorChange(address _proposedGovernor) public onlyGovernor {
        requestTime = now;
        super.requestGovernorChange(_proposedGovernor);
    }

    //@override
    /**
     * @dev Cancels an outstanding governor change request by resetting request time
     */
    function cancelGovernorChange() public onlyGovernor {
        requestTime = 0;
        super.cancelGovernorChange();
    }

    //@override
    /**
     * @dev Proposed governor claims new position, callable after time elapsed
     */
    function claimGovernorChange() public onlyProposedGovernor {
        require(now >= (requestTime.add(delay)), "Delay not over");
        super.claimGovernorChange();
        requestTime = 0;
    }
}