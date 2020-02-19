pragma solidity ^0.5.12;

import { ClaimableGovernor } from "./ClaimableGovernor.sol";
import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";

/**
 * @title Current Goverenor can initiate governance change request.
 * After a defined delay, proposed Governor can claim governance
 * ownership.
 */
contract DelayedClaimableGovernor is ClaimableGovernor {

    using SafeMath for uint256;

    uint256 public delay;
    uint256 public requestTime;

    /**
     * @dev Initializes the contract with given delay
     * @param _delay Delay in seconds for 2 way handshake
     */
    constructor(address _governor, uint256 _delay)
    public
    ClaimableGovernor(_governor) {
        require(_delay > 0, "Delay must be greater then zero");
        delay = _delay;
    }

    //@override
    /**
     * @notice Requests change of governor and logs request time
     * @param _proposedGovernor Address of the new governor
     */
    function requestGovernorChange(address _proposedGovernor) public onlyGovernor {
        requestTime = now;
        super.requestGovernorChange(_proposedGovernor);
    }

    //override
    /**
     * @notice Cancels an outstanding governor change request by resetting request time
     */
    function cancelGovernorChange() public onlyGovernor {
        requestTime = 0;
        super.cancelGovernorChange();
    }

    //override
    /**
     * @notice Proposed governor claims new position, callable after time elapsed
     */
    function claimGovernorChange() public onlyProposedGovernor {
        require(now >= (requestTime.add(delay)), "Delay not over");
        super.claimGovernorChange();
        requestTime = 0;
    }
}