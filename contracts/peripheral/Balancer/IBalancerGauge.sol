// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IBalancerGauge is IERC20 {
    /**
     * @notice Deposit `_value` LP tokens. eg mBPT.
     * @param _value Number of tokens to deposit
     */
    function deposit(uint256 _value) external;

    /**
     * @notice Withdraw `_value` LP tokens. eg mBPT.
     * @param _value Number of tokens to withdraw
     */
    function withdraw(uint256 _value) external;

    /**
     * @notice Set the default reward receiver for the caller.
     * @dev When set to ZERO_ADDRESS, rewards are sent to the caller
     * @param _receiver Receiver address for any rewards claimed via `claim_rewards`
     */
     function set_rewards_receiver(address _receiver) external;


    /**
     * @notice Claim available reward tokens for `_addr`
     * @param _addr Address to claim for
     */
    function claim_rewards(address _addr) external;
}