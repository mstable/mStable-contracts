pragma solidity 0.5.16;

import { Governable } from "./Governable.sol";

/**
 * @title 2 way handshake for Governance transfer
 */
contract ClaimableGovernor is Governable {

    address public proposedGovernor;

    event GovernorChangeClaimed(address indexed proposedGovernor);
    event GovernorChangeCancelled(address indexed governor, address indexed proposed);
    event GovernorChangeRequested(address indexed governor, address indexed proposed);

    /**
     * @dev Throws if called by any account other than the Proposed Governor.
     */
    modifier onlyProposedGovernor() {
        require(msg.sender == proposedGovernor, "Sender is not proposed governor");
        _;
    }

    constructor(address _governor) public {
        _changeGovernor(_governor);
    }

    //@override
    function changeGovernor(address) public onlyGovernor {
        revert("Direct change not allowed");
    }

    /**
     * @dev Current Governor request to proposes a new Governor
     * @param _proposedGovernor Address of the proposed Governor
     */
    function requestGovernorChange(address _proposedGovernor) public onlyGovernor {
        require(_proposedGovernor != address(0), "Proposed governor is address(0)");
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
        emit GovernorChangeClaimed(proposedGovernor);
        proposedGovernor = address(0);
    }
}
