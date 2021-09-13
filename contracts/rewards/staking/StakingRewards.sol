// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

// Internal
import { StakingTokenWrapper } from "./StakingTokenWrapper.sol";
import { InitializableRewardsDistributionRecipient } from "../InitializableRewardsDistributionRecipient.sol";
import { StableMath } from "../../shared/StableMath.sol";

// Libs
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

/**
 * @title  StakingRewards
 * @author Originally: Synthetix (forked from /Synthetixio/synthetix/contracts/StakingRewards.sol)
 *         Audit: https://github.com/sigp/public-audits/blob/master/synthetix/unipool/review.pdf
 *         Changes by: mStable
 * @notice Rewards stakers of a given LP token (a.k.a StakingToken) with RewardsToken, on a pro-rata basis
 * @dev    Uses an ever increasing 'rewardPerTokenStored' variable to distribute rewards
 * each time a write action is called in the contract. This allows for passive reward accrual.
 *         Changes:
 *           - Cosmetic (comments, readability)
 *           - Addition of getRewardToken()
 *           - Changing of `StakingTokenWrapper` funcs from `super.stake` to `_stake`
 *           - Introduced a `stake(_beneficiary)` function to enable contract wrappers to stake on behalf
 */
contract StakingRewards is
    Initializable,
    StakingTokenWrapper,
    InitializableRewardsDistributionRecipient
{
    using SafeERC20 for IERC20;
    using StableMath for uint256;

    /// @notice token the rewards are distributed in. eg MTA
    IERC20 public immutable rewardsToken;

    /// @notice length of each staking period in seconds. 7 days = 604,800; 3 months = 7,862,400
    uint256 public immutable DURATION;

    struct Data {
        /// Timestamp for current period finish
        uint32 periodFinish;
        /// Last time any user took action
        uint32 lastUpdateTime;
        /// RewardRate for the rest of the period
        uint96 rewardRate;
        /// Ever increasing rewardPerToken rate, based on % of total supply
        uint96 rewardPerTokenStored;
    }

    struct UserData {
        uint128 rewardPerTokenPaid;
        uint128 rewards;
    }

    Data public globalData;
    mapping(address => UserData) public userData;

    event RewardAdded(uint256 reward);
    event Staked(address indexed user, uint256 amount, address payer);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);

    /**
     * @param _nexus mStable system Nexus address
     * @param _stakingToken token that is beinf rewarded for being staked. eg MTA, imUSD or fPmUSD/GUSD
     * @param _rewardsToken first token that is being distributed as a reward. eg MTA
     * @param _duration length of each staking period in seconds. 7 days = 604,800; 3 months = 7,862,400
     */
    constructor(
        address _nexus,
        address _stakingToken,
        address _rewardsToken,
        uint256 _duration
    ) StakingTokenWrapper(_stakingToken) InitializableRewardsDistributionRecipient(_nexus) {
        rewardsToken = IERC20(_rewardsToken);
        DURATION = _duration;
    }

    /**
     * @dev Initialization function for upgradable proxy contract.
     *      This function should be called via Proxy just after contract deployment.
     *      To avoid variable shadowing appended `Arg` after arguments name.
     * @param _rewardsDistributorArg mStable Reward Distributor contract address
     * @param _nameArg token name. eg imUSD Vault or GUSD Feeder Pool Vault
     * @param _symbolArg token symbol. eg v-imUSD or v-fPmUSD/GUSD
     */
    function initialize(
        address _rewardsDistributorArg,
        string calldata _nameArg,
        string calldata _symbolArg
    ) external initializer {
        InitializableRewardsDistributionRecipient._initialize(_rewardsDistributorArg);
        StakingTokenWrapper._initialize(_nameArg, _symbolArg);
    }

    /** @dev Updates the reward for a given address, before executing function */
    modifier updateReward(address _account) {
        // Setting of global vars
        (uint256 newRewardPerToken, uint256 lastApplicableTime) = _rewardPerToken();
        // If statement protects against loss in initialisation case
        if (newRewardPerToken > 0) {
            globalData.rewardPerTokenStored = SafeCast.toUint96(newRewardPerToken);
            globalData.lastUpdateTime = SafeCast.toUint32(lastApplicableTime);
            // Setting of personal vars based on new globals
            if (_account != address(0)) {
                userData[_account] = UserData({
                    rewardPerTokenPaid: SafeCast.toUint128(newRewardPerToken),
                    rewards: SafeCast.toUint128(_earned(_account, newRewardPerToken))
                });
            }
        }
        _;
    }

    /***************************************
                    ACTIONS
    ****************************************/

    /**
     * @dev Stakes a given amount of the StakingToken for the sender
     * @param _amount Units of StakingToken
     */
    function stake(uint256 _amount) external {
        _stake(msg.sender, _amount);
    }

    /**
     * @dev Stakes a given amount of the StakingToken for a given beneficiary
     * @param _beneficiary Staked tokens are credited to this address
     * @param _amount      Units of StakingToken
     */
    function stake(address _beneficiary, uint256 _amount) external {
        _stake(_beneficiary, _amount);
    }

    /**
     * @dev Internally stakes an amount by depositing from sender,
     * and crediting to the specified beneficiary
     * @param _beneficiary Staked tokens are credited to this address
     * @param _amount      Units of StakingToken
     */
    function _stake(address _beneficiary, uint256 _amount)
        internal
        override
        updateReward(_beneficiary)
    {
        require(_amount > 0, "Cannot stake 0");
        super._stake(_beneficiary, _amount);
        emit Staked(_beneficiary, _amount, msg.sender);
    }

    /**
     * @dev Withdraws stake from pool and claims any rewards
     */
    function exit() external {
        withdraw(balanceOf(msg.sender));
        claimReward();
    }

    /**
     * @dev Withdraws given stake amount from the pool
     * @param _amount Units of the staked token to withdraw
     */
    function withdraw(uint256 _amount) public updateReward(msg.sender) {
        require(_amount > 0, "Cannot withdraw 0");
        _withdraw(_amount);
        emit Withdrawn(msg.sender, _amount);
    }

    /**
     * @dev Claims outstanding rewards for the sender.
     * First updates outstanding reward allocation and then transfers.
     */
    function claimReward() public updateReward(msg.sender) {
        uint128 reward = userData[msg.sender].rewards;
        if (reward > 0) {
            userData[msg.sender].rewards = 0;
            rewardsToken.safeTransfer(msg.sender, reward);
            emit RewardPaid(msg.sender, reward);
        }
    }

    /***************************************
                    GETTERS
    ****************************************/

    /**
     * @dev Gets the RewardsToken
     */
    function getRewardToken() external view override returns (IERC20) {
        return rewardsToken;
    }

    /**
     * @dev Gets the last applicable timestamp for this reward period
     */
    function lastTimeRewardApplicable() public view returns (uint256) {
        return StableMath.min(block.timestamp, globalData.periodFinish);
    }

    /**
     * @dev Calculates the amount of unclaimed rewards per token since last update,
     * and sums with stored to give the new cumulative reward per token
     * @return 'Reward' per staked token
     */
    function rewardPerToken() public view returns (uint256) {
        (uint256 rewardPerToken_, ) = _rewardPerToken();
        return rewardPerToken_;
    }

    function _rewardPerToken()
        internal
        view
        returns (uint256 rewardPerToken_, uint256 lastTimeRewardApplicable_)
    {
        uint256 lastApplicableTime = lastTimeRewardApplicable(); // + 1 SLOAD
        Data memory data = globalData;
        uint256 timeDelta = lastApplicableTime - data.lastUpdateTime; // + 1 SLOAD
        // If this has been called twice in the same block, shortcircuit to reduce gas
        if (timeDelta == 0) {
            return (data.rewardPerTokenStored, lastApplicableTime);
        }
        // new reward units to distribute = rewardRate * timeSinceLastUpdate
        uint256 rewardUnitsToDistribute = data.rewardRate * timeDelta; // + 1 SLOAD
        uint256 supply = totalSupply(); // + 1 SLOAD
        // If there is no StakingToken liquidity, avoid div(0)
        // If there is nothing to distribute, short circuit
        if (supply == 0 || rewardUnitsToDistribute == 0) {
            return (data.rewardPerTokenStored, lastApplicableTime);
        }
        // new reward units per token = (rewardUnitsToDistribute * 1e18) / totalTokens
        uint256 unitsToDistributePerToken = rewardUnitsToDistribute.divPrecisely(supply);
        // return summed rate
        return (data.rewardPerTokenStored + unitsToDistributePerToken, lastApplicableTime); // + 1 SLOAD
    }

    /**
     * @dev Calculates the amount of unclaimed rewards a user has earned
     * @param _account User address
     * @return Total reward amount earned
     */
    function earned(address _account) public view returns (uint256) {
        return _earned(_account, rewardPerToken());
    }

    function _earned(address _account, uint256 _currentRewardPerToken)
        internal
        view
        returns (uint256)
    {
        // current rate per token - rate user previously received
        uint256 userRewardDelta = _currentRewardPerToken - userData[_account].rewardPerTokenPaid; // + 1 SLOAD
        // Short circuit if there is nothing new to distribute
        if (userRewardDelta == 0) {
            return userData[_account].rewards;
        }
        // new reward = staked tokens * difference in rate
        uint256 userNewReward = balanceOf(_account).mulTruncate(userRewardDelta); // + 1 SLOAD
        // add to previous rewards
        return userData[_account].rewards + userNewReward;
    }

    /***************************************
                    ADMIN
    ****************************************/

    /**
     * @dev Notifies the contract that new rewards have been added.
     * Calculates an updated rewardRate based on the rewards in period.
     * @param _reward Units of RewardToken that have been added to the pool
     */
    function notifyRewardAmount(uint256 _reward)
        external
        override
        onlyRewardsDistributor
        updateReward(address(0))
    {
        require(_reward < 1e24, "Cannot notify with more than a million units");

        uint256 currentTime = block.timestamp;
        // If previous period over, reset rewardRate
        if (currentTime >= globalData.periodFinish) {
            globalData.rewardRate = SafeCast.toUint96(_reward / DURATION);
        }
        // If additional reward to existing period, calc sum
        else {
            uint256 remaining = globalData.periodFinish - currentTime;
            uint256 leftover = remaining * globalData.rewardRate;
            globalData.rewardRate = SafeCast.toUint96((_reward + leftover) / DURATION);
        }

        globalData.lastUpdateTime = SafeCast.toUint32(currentTime);
        globalData.periodFinish = SafeCast.toUint32(currentTime + DURATION);

        emit RewardAdded(_reward);
    }
}
