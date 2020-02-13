pragma solidity ^0.5.12;

import { Governable } from "./Governable.sol";

/**
 * @title 2 way handshake for Governance transfer
 */
contract ClaimableGovernor is Governable {
    event GovernorChangeClaimed(address previousAddress, address newAddress);
    event GovernorChangeCancelled(address governor, address proposed);
    event GovernorChangeRequested(address governor, address proposed);

    address public proposedGovernor;

    modifier onlyProposedGovernor() {
        require(msg.sender == proposedGovernor, "Sender is not a proposed governor.");
        _;
    }

    function changeGovernor(address newGovernor) public onlyGovernor {
        revert("Direct change of Governor not possible");
    }

    function requestGovernorChange(address _proposedGovernor) public onlyGovernor {
        require(_proposedGovernor != address(0), "error");
        require(proposedGovernor == address(0), "error");

        proposedGovernor = _proposedGovernor;
        emit GovernorChangeRequested(governor(), _proposedGovernor);
    }

    function cancelGovernorChange() public onlyGovernor {
        require(proposedGovernor != address(0), "Proposed Governor not set");

        emit GovernorChangeCancelled(governor(), proposedGovernor);
        proposedGovernor = address(0);
    }

    function claimGovernorChange() public onlyProposedGovernor {
        _changeGovernor(proposedGovernor);
        proposedGovernor = address(0);
    }
}
