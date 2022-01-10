// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { IERC20, SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IVotiumBribe } from "../interfaces/IVotiumBribe.sol";
import { ImmutableModule } from "../shared/ImmutableModule.sol";

/**
 * @title  VotiumBribeForwarder
 * @author mStable
 * @notice Uses reward tokens to bribe vlCVX holders to vote for a Curve gauge using Votium.
 * @dev    VotiumBribe contract on Mainnet: 0x19bbc3463dd8d07f55438014b021fb457ebd4595
 * @dev    VERSION: 1.0
 *         DATE:    2021-11-03
 */
contract VotiumBribeForwarder is ImmutableModule {
    using SafeERC20 for IERC20;

    /// @notice Rewards token that is to be deposit.
    // solhint-disable-next-line var-name-mixedcase
    IERC20 public immutable REWARDS_TOKEN;
    /// @notice Token VotiumBribe contract. eg 0x19bbc3463dd8d07f55438014b021fb457ebd4595
    // solhint-disable-next-line var-name-mixedcase
    IVotiumBribe public immutable VOTIUM_BRIBE;
    /// @notice Votium brive deposit choice index.
    uint256 public choiceIndex;

    /**
     * @param _rewardsToken Bridged rewards token on the Polygon chain.
     * @param _votiumBribe Token votium bribe contract.
     */
    constructor(
        address _nexus,
        address _rewardsToken,
        address _votiumBribe
    ) ImmutableModule(_nexus) {
        require(_rewardsToken != address(0), "Invalid Rewards token");
        require(_votiumBribe != address(0), "Invalid VotiumBribe contract");
        REWARDS_TOKEN = IERC20(_rewardsToken);
        VOTIUM_BRIBE = IVotiumBribe(_votiumBribe);
    }

    /**
     * @notice Deposits a bribe into Votium, choiceIndex must be set previously.
     * @param amount  the amount of reward tokens to deposit including decimal places.
     * @param proposal votium bribe proposal
     */
    function depositBribe(uint256 amount, bytes32 proposal) external onlyKeeperOrGovernor {
        require(amount != 0, "Invalid amount");

        uint256 rewardBal = REWARDS_TOKEN.balanceOf(address(this));
        require(rewardBal >= amount, "Insufficient rewards");
        // Approve only the amount to be bribe. Any more and the funds in this contract can be stolen
        // using the depositBribe function on the VotiumBribe contract.
        REWARDS_TOKEN.safeApprove(address(VOTIUM_BRIBE), amount);
        VOTIUM_BRIBE.depositBribe(address(REWARDS_TOKEN), amount, proposal, choiceIndex);
    }

    /**
     * @notice Updates the choice index used for the bribe.
     * @param _choiceIndex the bribe choice index
     */
    function updateChoiceIndex(uint256 _choiceIndex) public onlyKeeperOrGovernor {
        choiceIndex = _choiceIndex;
    }
}
