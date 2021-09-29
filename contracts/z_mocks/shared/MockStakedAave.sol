// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { IStakedAave } from "../../peripheral/Aave/IAave.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/** Interface for Staking AAVE Token
 * Documentation: https://docs.aave.com/developers/protocol-governance/staking-aave
 */
contract MockStakedAave is IStakedAave, ERC20 {
    uint256 public override COOLDOWN_SECONDS = 864000;
    uint256 public override UNSTAKE_WINDOW = 172800;
    // mapping of stakers to cooldown start time in epoch seconds
    mapping(address => uint256) public override stakersCooldowns;

    IERC20 public immutable aave;

    constructor(
        address _aave,
        address _initialRecipient,
        uint256 _initialMint
    ) ERC20("Staked Aave", "stkAAVE") {
        aave = IERC20(_aave);
        _mint(_initialRecipient, _initialMint * 1e18);
    }

    function stake(address to, uint256 amount) external override {
        // transfer in Aave
        aave.transferFrom(msg.sender, address(this), amount);

        stakersCooldowns[msg.sender] = block.timestamp;

        // Mint stkAave
        _mint(to, amount);
    }

    function redeem(
        address to,
        uint256 /*amount*/
    ) external override {
        require(
            block.timestamp > stakersCooldowns[msg.sender] + COOLDOWN_SECONDS,
            "INSUFFICIENT_COOLDOWN"
        );
        require(
            block.timestamp < stakersCooldowns[msg.sender] + COOLDOWN_SECONDS + UNSTAKE_WINDOW,
            "UNSTAKE_WINDOW_FINISHED"
        );

        // Get the amount of stkAAVE the redeemer has
        uint256 redeemAmount = balanceOf(msg.sender);

        // Burn stkAave
        _burn(msg.sender, redeemAmount);

        // Transfer AAVE
        aave.transfer(to, redeemAmount);
    }

    function cooldown() external override {
        stakersCooldowns[msg.sender] = block.timestamp;
    }

    function claimRewards(address to, uint256 amount) external override {
        // This is just a mock for testing so mint whatever
        _mint(to, amount);
    }
}
