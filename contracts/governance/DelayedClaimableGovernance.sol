pragma solidity ^0.5.12;

import { ClaimableGovernor } from "./ClaimableGovernor.sol";
import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";

/**
 * @title Current Goverenor can initiate governance change request.
 * After a defined delay, proposed Governor can claim governance
 * ownership.
 */
contract DelayedClaimableGovernance is ClaimableGovernor {

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
    function requestGovernorChange(address _proposedGovernor) public onlyGovernor {
        requestTime = now;
        super.requestGovernorChange(_proposedGovernor);
    }

    //override
    function cancelGovernorChange() public onlyGovernor {
        requestTime = 0;
        super.cancelGovernorChange();
    }

    //override
    function claimGovernorChange() public onlyProposedGovernor {
        require(now >= (requestTime.add(delay)), "Governor cannot claim ownership");
        super.claimGovernorChange();
        requestTime = 0;
    }
}