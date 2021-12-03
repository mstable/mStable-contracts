// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { IERC20, SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IVotiumBribe } from "../interfaces/IVotiumBribe.sol";
import { ImmutableModule } from "../shared/ImmutableModule.sol";

/**
 * @title  VotiumBribeForwarder
 * @author mStable
 * @notice Transfers reward tokens to a list of off-chain calculated recipients and amounts.
 * @dev    VotiumBribe contract on Mainnet, Polygon, Fantom: 0x19bbc3463dd8d07f55438014b021fb457ebd4595
 * @dev    VERSION: 1.0
 *         DATE:    2021-11-03
 */
contract VotiumBribeForwarder is ImmutableModule {
    using SafeERC20 for IERC20;

    /// @notice Rewards token that is to be deposit.
    IERC20 public immutable REWARDS_TOKEN;
    /// @notice Token Disperser contract. eg 0x19bbc3463dd8d07f55438014b021fb457ebd4595
    IVotiumBribe public immutable VOTIUM_BRIBE;
    /// @notice Votium brive proposal.
    bytes32 public immutable PROPOSAL;
    /// @notice Votium brive deposit choice index.
    uint256 public choiceIndex

    /**
     * @param _rewardsToken Bridged rewards token on the Polygon chain.
     * @param _votiumBribe Token votium bribe contract.
     * @param _proposal The proposal to bribe.
     */
    constructor(address _nexus, address _rewardsToken, address _votiumBribe, bytes32 _proposal)
        ImmutableModule(_nexus) {
        require(_rewardsToken != address(0), "Invalid Rewards token");
        require(_votiumBribe != address(0), "Invalid VotiumBribe contract");
        REWARDS_TOKEN = IERC20(_rewardsToken);
        VOTIUM_BRIBE = IVotiumBribe(_votiumBribe);
        PROPOSAL = _proposal;
    }


    /**
     * @notice Deposits a bribe into Votium, choiceIndex must be set previously.
     * @param amount amount of  reward token to deposit including decimal places.
     */
    function disperseToken(uint256 amount) external onlyKeeperOrGovernor {
        require(amount != 0, "Invalid amount");

        uint256 rewardBal = REWARDS_TOKEN.balanceOf(address(this));
        require(rewardBal >= amount, "Insufficient rewards");
        // Approve only the amount to be bribe. Any more and the funds in this contract can be stolen
        // using the depositBribe function on the VotiumBribe contract.
        REWARDS_TOKEN.safeApprove(address(VOTIUM_BRIBE), total);
        VOTIUM_BRIBE.depositBribe(address(REWARDS_TOKEN), total, PROPOSAL, choiceIndex);
    }

    /**
     * @notice Updates the choice index used for the bribe.
     * @param _choiceIndex the bribe choice index
     */
    function updateChoiceIndex(uint256 _choiceIndex) public onlyKeeperOrGovernor {
      choiceIndex = _feeAddress;
    }
}
