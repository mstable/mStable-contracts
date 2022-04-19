// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { IBalancerGauge } from "../../peripheral/Balancer/IBalancerGauge.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockBPTGauge is IBalancerGauge, ERC20 {

    IERC20 public immutable stakedToken;
    mapping (address => address) public rewards_receiver;

    constructor(
        address _stakedToken
    ) ERC20("BPT Gauge", "BPT-Gauge") {
        stakedToken = IERC20(_stakedToken);
    }

    function deposit(uint256 amount) external override {
        stakedToken.transferFrom(msg.sender, address(this), amount);

        _mint(msg.sender, amount);
    }

    function withdraw(
        uint256 amount
    ) external override {

        // Burn stkAave
        _burn(msg.sender, amount);

        // Transfer AAVE
        stakedToken.transfer(msg.sender, amount);
    }

    function set_rewards_receiver(address _receiver) external override {
        rewards_receiver[msg.sender] = _receiver;
    }

    function claim_rewards(address _addr) external override {
        
    }
}
