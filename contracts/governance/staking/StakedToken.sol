// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;
pragma abicoder v2;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IStakedToken } from "./IStakedToken.sol";

import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { ERC20VotesUpgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20VotesUpgradeable.sol";
import { HeadlessStakingRewards } from "../../rewards/staking/HeadlessStakingRewards.sol";

/**
 * @title StakedToken
 * @notice Contract to stake Aave token, tokenize the position and get rewards, inheriting from a distribution manager contract
 * @author Aave
 **/
contract StakedToken is IStakedToken, ERC20VotesUpgradeable, HeadlessStakingRewards {
    using SafeERC20 for IERC20;

    IERC20 public immutable STAKED_TOKEN;
    uint256 public immutable COOLDOWN_SECONDS;
    uint256 public immutable UNSTAKE_WINDOW;

    mapping(address => uint256) public stakersCooldowns;

    event Staked(address indexed user, address indexed onBehalfOf, uint256 amount);
    event Redeem(address indexed user, address indexed to, uint256 amount);
    event Cooldown(address indexed user);

    /***************************************
                    INIT
    ****************************************/

    constructor(
        address _nexus,
        address _rewardsToken,
        uint256 _duration,
        address _stakedToken,
        uint256 _cooldownSeconds,
        uint256 _unstakeWindow
    ) HeadlessStakingRewards(_nexus, _rewardsToken, _duration) {
        STAKED_TOKEN = IERC20(_stakedToken);
        COOLDOWN_SECONDS = _cooldownSeconds;
        UNSTAKE_WINDOW = _unstakeWindow;
    }

    /**
     * @dev Called by the proxy contract
     **/
    function initialize(
        string memory _nameArg,
        string memory _symbolArg,
        address _rewardsDistributorArg
    ) external initializer {
        __ERC20Permit_init(_nameArg);
        __ERC20_init(_nameArg, _symbolArg);
        HeadlessStakingRewards._initialize(_rewardsDistributorArg);
    }

    /***************************************
                    ACTIONS
    ****************************************/

    function stake(uint256 amount, address onBehalfOf) external override {
        require(amount != 0, "INVALID_ZERO_AMOUNT");
        uint256 balanceOfUser = balanceOf(onBehalfOf);

        stakersCooldowns[onBehalfOf] = getNextCooldownTimestamp(
            0,
            amount,
            onBehalfOf,
            balanceOfUser
        );

        IERC20(STAKED_TOKEN).safeTransferFrom(msg.sender, address(this), amount);
        _mint(onBehalfOf, amount);

        emit Staked(msg.sender, onBehalfOf, amount);
    }

    /**
     * @dev Redeems staked tokens, and stop earning rewards
     * @param to Address to redeem to
     * @param amount Amount to redeem
     **/
    function redeem(uint256 amount, address to) external override {
        require(amount != 0, "INVALID_ZERO_AMOUNT");
        //solium-disable-next-line
        uint256 cooldownStartTimestamp = stakersCooldowns[msg.sender];
        require(
            block.timestamp > cooldownStartTimestamp + COOLDOWN_SECONDS,
            "INSUFFICIENT_COOLDOWN"
        );
        require(
            block.timestamp - (cooldownStartTimestamp + COOLDOWN_SECONDS) <= UNSTAKE_WINDOW,
            "UNSTAKE_WINDOW_FINISHED"
        );
        uint256 balanceOfMessageSender = balanceOf(msg.sender);

        uint256 amountToRedeem = (amount > balanceOfMessageSender)
            ? balanceOfMessageSender
            : amount;

        _burn(msg.sender, amountToRedeem);

        if ((balanceOfMessageSender - amountToRedeem) == 0) {
            stakersCooldowns[msg.sender] = 0;
        }

        IERC20(STAKED_TOKEN).safeTransfer(to, amountToRedeem);

        emit Redeem(msg.sender, to, amountToRedeem);
    }

    /**
     * @dev Activates the cooldown period to unstake
     * - It can't be called if the user is not staking
     **/
    function cooldown() external override {
        require(balanceOf(msg.sender) != 0, "INVALID_BALANCE_ON_COOLDOWN");
        //solium-disable-next-line
        stakersCooldowns[msg.sender] = block.timestamp;

        emit Cooldown(msg.sender);
    }

    /***************************************
                    HOOKS
    ****************************************/

    /**
     * @dev Internal ERC20 _transfer of the tokenized staked tokens
     * @param from Address to transfer from
     * @param to Address to transfer to
     * @param amount Amount to transfer
     **/
    function _transfer(
        address from,
        address to,
        uint256 amount
    ) internal override {
        uint256 balanceOfFrom = balanceOf(from);

        // Recipient
        if (from != to) {
            uint256 balanceOfTo = balanceOf(to);

            uint256 previousSenderCooldown = stakersCooldowns[from];
            stakersCooldowns[to] = getNextCooldownTimestamp(
                previousSenderCooldown,
                amount,
                to,
                balanceOfTo
            );
            // if cooldown was set and whole balance of sender was transferred - clear cooldown
            if (balanceOfFrom == amount && previousSenderCooldown != 0) {
                stakersCooldowns[from] = 0;
            }
        }

        super._transfer(from, to, amount);
    }

    // TODO - move?
    /// @dev Simply used to update rewards BEFORE each action (mint, burn, transfer)
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal override updateRewards(from, to) {}

    /***************************************
                    GETTERS
    ****************************************/

    function _balanceOf(address account) internal view override returns (uint256) {
        return balanceOf(account);
    }

    function _totalSupply() internal view override returns (uint256) {
        return totalSupply();
    }

    /**
     * @dev Calculates the new cooldown timestamp depending on the sender/receiver situation
     *  - If the timestamp of the sender is "better" or the timestamp of the recipient is 0, we take the one of the recipient
     *  - Weighted average of from/to cooldown timestamps if:
     *    # The sender doesn't have the cooldown activated (timestamp 0).
     *    # The sender timestamp is expired
     *    # The sender has a "worse" timestamp
     *  - If the receiver's cooldown timestamp expired (too old), the next is 0
     * @param fromCooldownTimestamp Cooldown timestamp of the sender
     * @param amountToReceive Amount
     * @param toAddress Address of the recipient
     * @param toBalance Current balance of the receiver
     * @return The new cooldown timestamp
     **/
    function getNextCooldownTimestamp(
        uint256 fromCooldownTimestamp,
        uint256 amountToReceive,
        address toAddress,
        uint256 toBalance
    ) public view returns (uint256) {
        uint256 toCooldownTimestamp = stakersCooldowns[toAddress];
        if (toCooldownTimestamp == 0) {
            return 0;
        }

        uint256 minimalValidCooldownTimestamp = block.timestamp - COOLDOWN_SECONDS - UNSTAKE_WINDOW;

        if (minimalValidCooldownTimestamp > toCooldownTimestamp) {
            toCooldownTimestamp = 0;
        } else {
            uint256 fromCooldownTimestamp = (minimalValidCooldownTimestamp > fromCooldownTimestamp)
                ? block.timestamp
                : fromCooldownTimestamp;

            if (fromCooldownTimestamp < toCooldownTimestamp) {
                return toCooldownTimestamp;
            } else {
                toCooldownTimestamp =
                    ((amountToReceive * fromCooldownTimestamp) +
                        (toBalance * toCooldownTimestamp)) /
                    (amountToReceive + toBalance);
            }
        }
        return toCooldownTimestamp;
    }
}
