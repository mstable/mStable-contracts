// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IChildChainStreamer } from "../../peripheral/Balancer/IChildChainStreamer.sol";

contract MockChildChainStreamer is IChildChainStreamer {
    function notify_reward_amount(address token) external override {
        // stream  it to the gauge
    }
}
