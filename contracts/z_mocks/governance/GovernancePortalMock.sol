pragma solidity ^0.5.12;

import { GovernancePortal } from "../../governance/GovernancePortal.sol";

/**
 * @title GovernancePortalMock
 */
contract GovernancePortalMock is GovernancePortal {


    constructor(
        address _nexus,
        address[] memory _owners,
        uint _requiredQuorum
    )
        GovernancePortal(
            _nexus,
            _owners,
            _requiredQuorum
        )
        public
    {
      
    }
}


