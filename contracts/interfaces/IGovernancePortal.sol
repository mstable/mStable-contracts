pragma solidity ^0.5.12;

/**
  * @title IGovernancePortal
  * @dev Lite interface for the system to interact with the governance portal
  */
interface IGovernancePortal {

    /** @dev What stance does this voter have on the recollateralisation Vote */
    enum VoteOption {
      Absent,
      Enact,
      Negate,
      Delay
    }

    /** @dev System proposals used by Manager */
    function initiateFailedBassetVote(address _masset, address _basset) external returns(uint256);

    /** @dev Vote and resolve polls */
    function castVote(uint256 _voteId, VoteOption _option, address _voter, uint256 _massetPrice, uint256 _metaPrice) external;
    function settleVote(uint256 _voteId) external returns (bool);
}