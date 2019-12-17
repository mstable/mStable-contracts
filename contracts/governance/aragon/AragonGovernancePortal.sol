pragma solidity ^0.5.12;

import { IGovernancePortal } from "../../interfaces/IGovernancePortal.sol";
import { GovernancePortalModule } from "../GovernancePortalModule.sol";

import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";

/**
  * @dev Interface to allow usage of relevant Aragon App Voting
  * funcs from within our Governance Portal
  */
interface IAragonVoting {
    function newVote(bytes calldata _executionScript, string calldata _metadata) external returns (uint256 voteId);
    function vote(uint256 _voteId, bool _supports, bool _executesIfDecided) external;
}

/**
 * @title AragonGovernancePortal
 * @dev Intermediate Governance portal for communicating vote information to Aragon App
 *  This base code was taken to mirror basic functionality from Aragon:
 *  https://github.com/aragon/aragon-apps/blob/master/apps/voting/contracts/Voting.sol#L20
 */
contract AragonGovernancePortal is IGovernancePortal, GovernancePortalModule {

    using SafeMath for uint256;

    /** @dev Reference to the mStable-org implementation of the Voting-App */
    IAragonVoting _voting;

    /** @dev Events to emit */
    event VoteProposed(uint256 indexed voteId, string title);
    event VoteCast(uint256 indexed voteId, address voter, bool _supports);

    /** @dev Creates a new instance of AragonGovPortal by initialising it as a module, and linking Voting */
    constructor(
        address _nexus,
        address _aragonVotingContract
    )
        GovernancePortalModule(_nexus)
        public
    {
        _voting = IAragonVoting(_aragonVotingContract);
    }

    /**
     * @dev Propagates a new system vote to the Aragon Governance system
     * Any active system module can propose a vote, as published by the Nexus
     * @param _title Question to propose to governance
     * @return uint ID of the Aragon vote
     */
    function proposeVote(string memory _title)
    public
    returns (uint256 voteId) {

        /**
         *
         * Aragons Voting app allows us to pass bytecode through to teh `newVote` func
         * which gets executed upon vote result. Aragon generally do this through front end libs.
         * e.g. https://github.com/aragon/aragon.js/blob/master/packages/aragon-wrapper/src/utils/callscript.js#L81
         *
         * In our case, we want to create this on chain as the vote is triggered from here.
         *
         * Below is an example (linked to us by Aragon) on how AutarkLabs do this.
         * https://github.com/AutarkLabs/planning-suite/blob/dev/apps/dot-voting/contracts/DotVoting.sol#L698
         *
         * Alternatively, we could generate the bytecode off-chain and then pass it through and store it here?
         *
         */

        voteId = _voting.newVote("0x", _title);
        emit VoteProposed(voteId, _title);
    }

    /**
     * @dev Casts a vote in the Aragon Voting system
     * @param _voteId ID of the vote
     * @param _supports Bool, does this voter support the vote
     * @param _voter Address of the voter
     */
    function castVote(uint256 _voteId, bool _supports, address _voter)
    public {
        emit VoteCast(_voteId, _voter, _supports);
        return _voting.vote(_voteId, _supports, true);
    }
}
