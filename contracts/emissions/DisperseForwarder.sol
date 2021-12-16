// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { IERC20, SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IDisperse } from "../interfaces/IDisperse.sol";
import { ImmutableModule } from "../shared/ImmutableModule.sol";

/**
 * @title  DisperseForwarder
 * @author mStable
 * @notice Transfers reward tokens to a list of off-chain calculated recipients and amounts.
 * @dev    Disperse contract on Mainnet and Polygon: 0xD152f549545093347A162Dce210e7293f1452150
 * @dev    VERSION: 1.0
 *         DATE:    2021-11-03
 */
contract DisperseForwarder is ImmutableModule {
    using SafeERC20 for IERC20;

    /// @notice Rewards token that is to be dispersed.
    IERC20 public immutable REWARDS_TOKEN;
    /// @notice Token Disperser contract. eg 0xD152f549545093347A162Dce210e7293f1452150
    IDisperse public immutable DISPERSE;

    /**
     * @param _rewardsToken Bridged rewards token on the Polygon chain.
     * @param _disperse Token disperser contract.
     */
    constructor(address _nexus, address _rewardsToken, address _disperse)
        ImmutableModule(_nexus) {
        require(_rewardsToken != address(0), "Invalid Rewards token");
        require(_disperse != address(0), "Invalid Disperse contract");

        REWARDS_TOKEN = IERC20(_rewardsToken);
        DISPERSE = IDisperse(_disperse);

    }

    /**
     * @notice Transfers reward tokens to a list of recipients with amounts.
     * @param recipients Array of address that are to receive token rewards.
     * @param values Array of reward token amounts for each recipient including decimal places.
     */
    function disperseToken(address[] memory recipients, uint256[] memory values) external onlyKeeperOrGovernor {
        uint256 len = recipients.length;
        require(values.length == len, "array mismatch");

        // Calculate the total amount of rewards that will be dispersed.
        uint256 total = 0;
        for (uint256 i = 0; i < len; i++) {
            total += values[i];
        }

        uint256 rewardBal = REWARDS_TOKEN.balanceOf(address(this));
        require(rewardBal >= total, "Insufficient rewards");
        
        // Approve only the amount to be dispersed. Any more and the funds in this contract can be stolen
        // using the disperseTokenSimple function on the Disperse contract.
        REWARDS_TOKEN.safeApprove(address(DISPERSE), total);

        DISPERSE.disperseTokenSimple(REWARDS_TOKEN, recipients, values);
    }
}
