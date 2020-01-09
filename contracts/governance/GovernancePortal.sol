pragma solidity ^0.5.12;

import { GovernancePortalModule, IManager } from "./GovernancePortalModule.sol";
import { IGovernancePortal } from "../interfaces/IGovernancePortal.sol";
import { MultiSigWallet } from "./MultiSigWallet.sol";

import { StableMath } from "../shared/math/StableMath.sol";

/**
 * @title GovernancePortal
 * @dev Mock Governance portal for lising all system votes
 *  This base code was taken to mirror basic functionality from Aragon:
 *  https://github.com/aragon/aragon-apps/blob/master/apps/voting/contracts/Voting.sol#L20
 */
contract GovernancePortal is IGovernancePortal, MultiSigWallet, GovernancePortalModule {

    using StableMath for uint256;
    using StableMath for uint64;

    /** @dev Events */
    event NewVoteProposed(uint256 indexed voteId, address masset, address basset);

    /** @dev Vote struct with basic props inspired by Aragon */
    struct Vote {
        bool executed;
        uint64 startDate;
        address masset;
        address basset;
        uint256 enact;
        uint256 negate;
        uint256 delay;
        uint256 validatedMassetPrice;
        uint256 validatedMetaPrice;
        mapping (address => VoteOption) voters;
    }

    /** @dev Vote storage */
    mapping (uint256 => Vote) public votes;
    mapping (address => uint256) internal bassetToActiveVote;
    uint256 public votesLength;
    uint256 public votePeriod = 72 hours;

    uint256 private constant priceThreshold = 5e16;


    modifier voteExistsAndIsActive(uint _voteId) {
        require(votes[_voteId].masset != address(0) && votes[_voteId].executed == false, "Vote must exist");
        _;
    }

    modifier notVoted(uint _voteId, address _voter) {
        require(votes[_voteId].voters[_voter] == VoteOption.Absent, "Must not have existing vote");
        _;
    }

    modifier validVote(VoteOption _option) {
        require(uint(_option) > 0 && uint(_option) <= 3, "Must be a valid option");
        _;
    }


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


    /**
     * @dev Creates a new recollateralisation vote with the default props
     * This is done automatically through the Manager peg detection mechanism
     * @param _masset Masset containing the failed Basset
     * @param _basset Address of the failed Basset
     * @return voteId uint ID of the newly created vote
     */
    function initiateFailedBassetVote(address _masset, address _basset)
    public
    onlyManager
    returns (uint256 voteId) {
        return _initiateVote(_masset, _basset);
    }

    /**
     * @dev Internal vote creation
     * @param _masset Masset containing the failed Basset
     * @param _basset Address of the failed Basset
     * @return voteId uint ID of the newly created vote
     */
    function _initiateVote(address _masset, address _basset)
    internal
    returns (uint256 voteId) {
        // Only create the vote if a vote for this Basset does not already exist
        if(bassetToActiveVote[_basset] == 0) {
            voteId = ++votesLength;

            Vote storage vote_ = votes[voteId];
            vote_.masset = _masset;
            vote_.basset = _basset;
            /* solium-disable-next-line */
            vote_.startDate = uint64(block.timestamp);

            bassetToActiveVote[_basset] = voteId;

            emit NewVoteProposed(voteId, _masset, _basset);
        }
    }

    /**
     * @dev Casts a vote in the Recollateralisation Voting system
     * @param _voteId ID of the vote
     * @param _option Type of vote
     * @param _voter Address of the voter (used to support future upgradability)
     * @param _massetPrice Price of the Masset in USD where $1 == 1e18
     * @param _metaPrice Price of the Meta token in USD where $1 == 1e18
     */
    function castVote(uint256 _voteId, VoteOption _option, address _voter, uint256 _massetPrice, uint256 _metaPrice)
    public
    ownerExists(_voter)
    voteExistsAndIsActive(_voteId)
    validVote(_option)
    {
        require(msg.sender == _voter, "Sender must cast own vote");
        Vote storage vote_ = votes[_voteId];

        _validateAssetPrices(vote_.masset, _massetPrice, _metaPrice);

        // Set the validated prices
        vote_.validatedMassetPrice = _massetPrice;
        vote_.validatedMetaPrice = _metaPrice;

        VoteOption currentVote = vote_.voters[_voter];

        // If voter had previously voted, decrease count
        if (currentVote == VoteOption.Enact) {
            vote_.enact = vote_.enact.sub(1);
        } else if (currentVote == VoteOption.Negate) {
            vote_.negate = vote_.negate.sub(1);
        } else if (currentVote == VoteOption.Delay) {
            vote_.delay = vote_.delay.sub(1);
        }

        // Add the vote to relevant option
        if (_option == VoteOption.Enact) {
            vote_.enact = vote_.enact.add(1);
        } else if (_option == VoteOption.Negate) {
            vote_.negate = vote_.negate.add(1);
        } else if (_option == VoteOption.Delay) {
            vote_.delay = vote_.delay.add(1);
        }

        vote_.voters[_voter] = _option;

        settleVote(_voteId);
    }

    /**
     * @dev Validates that the given asset prices are within a certain range
     */
    function _validateAssetPrices(address _masset, uint256 _massetPrice, uint256 _metaPrice)
    internal
    view {
      // Validate that the prices provided match those (within a limit) in the Oracle
      // 1. Fetch the prices from the Oracle (Masset && Meta)
      (uint256 oracleMassetPrice, uint256 oracleMetaPrice) = manager.getMassetPrice(_masset);
      // 2. Calculate range of acceptable values (priceThreshold deviance each side) (uppler/lower)
      uint256 massetDelta = oracleMassetPrice.mulTruncate(priceThreshold);
      uint256[2] memory massetBounds = [oracleMassetPrice.sub(massetDelta), oracleMassetPrice.add(massetDelta)];
      uint256 metaDelta = oracleMetaPrice.mulTruncate(priceThreshold);
      uint256[2] memory metaBounds = [oracleMetaPrice.sub(metaDelta), oracleMetaPrice.add(metaDelta)];
      // 3. Require that prices lay inside the range
      require(_massetPrice >= massetBounds[0] && _massetPrice <= massetBounds[1], "Masset price mismatch");
      require(_metaPrice >= metaBounds[0] && _metaPrice <= metaBounds[1], "Meta price mismatch");
    }

    /**
     * @dev Actions a finished recollateralisation vote by calling the relevant method
     * in the Manager
     * @param _voteId ID of the vote
     * @return Bool - vote is settled
     */
    function settleVote(uint _voteId)
    public
    voteExistsAndIsActive(_voteId)
    ownerExists(msg.sender)
    returns (bool settled)
    {
        Vote memory vote = votes[_voteId];
        uint voteCount = vote.enact + vote.negate + vote.delay;
        /* solium-disable-next-line */
        bool pastVotingPeriod = vote.startDate.add(votePeriod) < now;
        bool minQuorumReached = voteCount >= required;

        // Init the bool to signify vote resolution
        settled = false;

        // If time elapsed and not reached quorum, just restart the vote
        if (!minQuorumReached && pastVotingPeriod){
            settled = true;
            _initiateVote(vote.masset, vote.basset);
        }
        // If we reached the quorum, check for winning vote
        if(minQuorumReached){
            settled = true;
            // Check if enact is clear victor
            if(vote.enact > vote.negate && vote.enact > vote.delay){
                manager.recollatoraliseBasset(vote.masset, vote.basset, vote.validatedMassetPrice, vote.validatedMetaPrice);
            }
            // Else check if negate is clear victor
            else if(vote.negate > vote.enact && vote.negate > vote.delay){
                manager.negateRecol(vote.masset, vote.basset);
            }
            // Else check if delay is clear victor
            else if(vote.delay > vote.enact && vote.delay > vote.negate) {
                _initiateVote(vote.masset, vote.basset);
            }
            // No clear victor, if voting period elapsed, then restart
            else if(pastVotingPeriod){
                _initiateVote(vote.masset, vote.basset);
            }
            // Still have time to vote
            else {
                settled = false;
            }
        }
        if(settled){
            // Clean up existing vote
            votes[_voteId].executed = true;
            bassetToActiveVote[vote.basset] = 0;
        }
    }
}
