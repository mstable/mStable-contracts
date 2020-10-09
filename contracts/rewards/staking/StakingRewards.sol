pragma solidity 0.5.16;

// Internal
import { StakingTokenWrapper } from "./StakingTokenWrapper.sol";
import { RewardsDistributionRecipient } from "../RewardsDistributionRecipient.sol";

// Libs
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import { StableMath } from "../../shared/StableMath.sol";


/**
 * @title  StakingRewards
 * @author Originally: Synthetix (forked from /Synthetixio/synthetix/contracts/StakingRewards.sol)
 *         Audit: https://github.com/sigp/public-audits/blob/master/synthetix/unipool/review.pdf
 *         Changes by: Stability Labs Pty. Ltd.
 * @notice Rewards stakers of a given LP token (a.k.a StakingToken) with RewardsToken, on a pro-rata basis
 * @dev    Uses an ever increasing 'rewardPerTokenStored' variable to distribute rewards
 * each time a write action is called in the contract. This allows for passive reward accrual.
 *         Changes:
 *           - Cosmetic (comments, readability)
 *           - Addition of getRewardToken()
 *           - Changing of `StakingTokenWrapper` funcs from `super.stake` to `_stake`
 *           - Introduced a `stake(_beneficiary)` function to enable contract wrappers to stake on behalf
 */
contract StakingRewards is StakingTokenWrapper, RewardsDistributionRecipient {

    using StableMath for uint256;

    IERC20 public rewardsToken;

    uint256 public constant DURATION = 7 days;

    // Timestamp for current period finish
    uint256 public periodFinish = 0;
    // RewardRate for the rest of the PERIOD
    uint256 public rewardRate = 0;
    // Last time any user took action
    uint256 public lastUpdateTime = 0;
    // Ever increasing rewardPerToken rate, based on % of total supply
    uint256 public rewardPerTokenStored = 0;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    event RewardAdded(uint256 reward);
    event Staked(address indexed user, uint256 amount, address payer);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward);

    /** @dev StakingRewards is a TokenWrapper and RewardRecipient */
    constructor(
        address _nexus,
        address _stakingToken,
        address _rewardsToken,
        address _rewardsDistributor
    )
        public
        StakingTokenWrapper(_stakingToken)
        RewardsDistributionRecipient(_nexus, _rewardsDistributor)
    {
        rewardsToken = IERC20(_rewardsToken);
    }

    /** @dev Updates the reward for a given address, before executing function */
    modifier updateReward(address _account) {
        // Setting of global vars
        uint256 newRewardPerToken = rewardPerToken();
        // If statement protects against loss in initialisation case
        if(newRewardPerToken > 0) {
            rewardPerTokenStored = newRewardPerToken;
            lastUpdateTime = lastTimeRewardApplicable();
            // Setting of personal vars based on new globals
            if (_account != address(0)) {
                rewards[_account] = earned(_account);
                userRewardPerTokenPaid[_account] = newRewardPerToken;
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
    function stake(uint256 _amount)
        external
    {
        _stake(msg.sender, _amount);
    }

    /**
     * @dev Stakes a given amount of the StakingToken for a given beneficiary
     * @param _beneficiary Staked tokens are credited to this address
     * @param _amount      Units of StakingToken
     */
    function stake(address _beneficiary, uint256 _amount)
        external
    {
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
    function withdraw(uint256 _amount)
        public
        updateReward(msg.sender)
    {
        require(_amount > 0, "Cannot withdraw 0");
        _withdraw(_amount);
        emit Withdrawn(msg.sender, _amount);
    }

    /**
     * @dev Claims outstanding rewards for the sender.
     * First updates outstanding reward allocation and then transfers.
     */
    function claimReward()
        public
        updateReward(msg.sender)
    {
        uint256 reward = rewards[msg.sender];
        if (reward > 0) {
            rewards[msg.sender] = 0;
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
    function getRewardToken()
        external
        view
        returns (IERC20)
    {
        return rewardsToken;
    }

    /**
     * @dev Gets the last applicable timestamp for this reward period
     */
    function lastTimeRewardApplicable()
        public
        view
        returns (uint256)
    {
        return StableMath.min(block.timestamp, periodFinish);
    }

    /**
     * @dev Calculates the amount of unclaimed rewards per token since last update,
     * and sums with stored to give the new cumulative reward per token
     * @return 'Reward' per staked token
     */
    function rewardPerToken()
        public
        view
        returns (uint256)
    {
        // If there is no StakingToken liquidity, avoid div(0)
        uint256 stakedTokens = totalSupply();
        if (stakedTokens == 0) {
            return rewardPerTokenStored;
        }
        // new reward units to distribute = rewardRate * timeSinceLastUpdate
        uint256 rewardUnitsToDistribute = rewardRate.mul(lastTimeRewardApplicable().sub(lastUpdateTime));
        // new reward units per token = (rewardUnitsToDistribute * 1e18) / totalTokens
        uint256 unitsToDistributePerToken = rewardUnitsToDistribute.divPrecisely(stakedTokens);
        // return summed rate
        return rewardPerTokenStored.add(unitsToDistributePerToken);
    }

    /**
     * @dev Calculates the amount of unclaimed rewards a user has earned
     * @param _account User address
     * @return Total reward amount earned
     */
    function earned(address _account)
        public
        view
        returns (uint256)
    {
        // current rate per token - rate user previously received
        uint256 userRewardDelta = rewardPerToken().sub(userRewardPerTokenPaid[_account]);
        // new reward = staked tokens * difference in rate
        uint256 userNewReward = balanceOf(_account).mulTruncate(userRewardDelta);
        // add to previous rewards
        return rewards[_account].add(userNewReward);
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
        onlyRewardsDistributor
        updateReward(address(0))
    {
        require(_reward < 1e24, "Cannot notify with more than a million units");

        uint256 currentTime = block.timestamp;
        // If previous period over, reset rewardRate
        if (currentTime >= periodFinish) {
            rewardRate = _reward.div(DURATION);
        }
        // If additional reward to existing period, calc sum
        else {
            uint256 remaining = periodFinish.sub(currentTime);
            uint256 leftover = remaining.mul(rewardRate);
            rewardRate = _reward.add(leftover).div(DURATION);
        }

        lastUpdateTime = currentTime;
        periodFinish = currentTime.add(DURATION);

        emit RewardAdded(_reward);
    }
}