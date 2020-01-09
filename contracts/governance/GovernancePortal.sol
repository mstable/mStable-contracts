pragma solidity ^0.5.12;

import { GovernancePortalModule, IManager } from "./GovernancePortalModule.sol";
import { MultiSigWallet } from "./MultiSigWallet.sol";

import { StableMath } from "../shared/math/StableMath.sol";

/**
 * @title GovernancePortal
 * @dev Stub for pending upgrade to GovernancePortalRecol
 */
contract GovernancePortal is MultiSigWallet, GovernancePortalModule {


    /** @dev Creates a new instance of GovPortal by initialising it as a module */
    constructor(
        address _nexus,
        address[] memory _owners,
        uint _requiredQuorum
    )
        GovernancePortalModule(_nexus)
        MultiSigWallet(_owners, _requiredQuorum)
        public
    {}

}
