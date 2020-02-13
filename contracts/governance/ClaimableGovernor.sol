pragma solidity ^0.5.12;

import { Governable } from "./Governable.sol";

/**
 * @title 2 way handshake for Governance transfer
 */
contract ClaimableGovernor is Governable {

    address public proposedGovernor;

    event GovernorChangeClaimed(address indexed previous, address indexed newGovernor);
    event GovernorChangeCancelled(address indexed governor, address indexed proposed);
    event GovernorChangeRequested(address indexed governor, address indexed proposed);

    /**
     * @dev Throws if called by any account other than the Proposed Governor.
     */
    modifier onlyProposedGovernor() {
        require(msg.sender == proposedGovernor, "Sender is not a proposed governor");
        _;
    }

    //@override
    function changeGovernor(address) public onlyGovernor {
        revert("Direct change of Governor not allowed");
    }

    /**
     * @dev Current Governor request to proposes a new Governor
     * @param _proposedGovernor Address of the proposed Governor
     */
    function requestGovernorChange(address _proposedGovernor) public onlyGovernor {
        require(_proposedGovernor != address(0), "Proposed governor is the zero zero address");
        require(proposedGovernor == address(0), "Proposed governor already set");

        proposedGovernor = _proposedGovernor;
        emit GovernorChangeRequested(governor(), _proposedGovernor);
    }

    /**
     * @dev Current Governor cancel Governor change request
     */
    function cancelGovernorChange() public onlyGovernor {
        require(proposedGovernor != address(0), "Proposed Governor not set");

        emit GovernorChangeCancelled(governor(), proposedGovernor);
        proposedGovernor = address(0);
    }

    /**
     * @dev Proposed Governor can claim governance ownership
     */
    function claimGovernorChange() public onlyProposedGovernor {
        _changeGovernor(proposedGovernor);
        emit GovernorChangeClaimed(proposedGovernor, governor());
        proposedGovernor = address(0);
    }
}
