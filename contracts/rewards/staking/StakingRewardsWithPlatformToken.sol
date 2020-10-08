pragma solidity 0.5.16;

// Internal
import { RewardsDistributionRecipient } from "../RewardsDistributionRecipient.sol";
import { StakingTokenWrapper } from "./StakingTokenWrapper.sol";
import { PlatformTokenVendor } from "./PlatformTokenVendor.sol";

// Libs
import { SafeERC20, IERC20 } from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { StableMath } from "../../shared/StableMath.sol";


/**
 * @title  StakingRewardsWithPlatformToken
 * @author Stability Labs Pty. Ltd.
 * @notice Rewards stakers of a given LP token (a.k.a StakingToken) with RewardsToken, on a pro-rata basis
 * additionally, distributes the Platform token airdropped by the platform
 * @dev    Derives from ./StakingRewards.sol and implements a secondary token into the core logic
 */
contract StakingRewardsWithPlatformToken is StakingTokenWrapper, RewardsDistributionRecipient {

    using StableMath for uint256;

    IERC20 public rewardsToken;
    IERC20 public platformToken;
    PlatformTokenVendor public platformTokenVendor;

    uint256 public constant DURATION = 7 days;

    // Timestamp for current period finish
    uint256 public periodFinish = 0;
    // RewardRate for the rest of the PERIOD
    uint256 public rewardRate = 0;
    uint256 public platformRewardRate = 0;
    // Last time any user took action
    uint256 public lastUpdateTime;
    // Ever increasing rewardPerToken rate, based on % of total supply
    uint256 public rewardPerTokenStored;
    uint256 public platformRewardPerTokenStored;

    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public userPlatformRewardPerTokenPaid;

    mapping(address => uint256) public rewards;
    mapping(address => uint256) public platformRewards;

    event RewardAdded(uint256 reward, uint256 platformReward);
    event Staked(address indexed user, uint256 amount, address payer);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward, uint256 platformReward);

    /** @dev StakingRewards is a TokenWrapper and RewardRecipient */
    constructor(
        address _nexus,
        address _stakingToken,
        address _rewardsToken,
        address _platformToken,
        address _rewardsDistributor
    )
        public
        StakingTokenWrapper(_stakingToken)
        RewardsDistributionRecipient(_nexus, _rewardsDistributor)
    {
        rewardsToken = IERC20(_rewardsToken);
        platformToken = IERC20(_platformToken);
        platformTokenVendor = new PlatformTokenVendor(platformToken);
    }

    /** @dev Updates the reward for a given address, before executing function */
    modifier updateReward(address _account) {
        // Setting of global vars
        (uint256 newRewardPerTokenStored, uint256 newPlatformRewardPerTokenStored) = rewardPerToken();

        // If statement protects against loss in initialisation case
        if(newRewardPerTokenStored > 0 || newPlatformRewardPerTokenStored > 0) {
            rewardPerTokenStored = newRewardPerTokenStored;
            platformRewardPerTokenStored = newPlatformRewardPerTokenStored;

            lastUpdateTime = lastTimeRewardApplicable();

            // Setting of personal vars based on new globals
            if (_account != address(0)) {
                (rewards[_account], platformRewards[_account]) = earned(_account);

                userRewardPerTokenPaid[_account] = newRewardPerTokenStored;
                userPlatformRewardPerTokenPaid[_account] = newPlatformRewardPerTokenStored;
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
     * @dev Claims outstanding rewards (both platform and native) for the sender.
     * First updates outstanding reward allocation and then transfers.
     */
    function claimReward()
        public
        updateReward(msg.sender)
    {
        uint256 reward = _claimReward();
        uint256 platformReward = _claimPlatformReward();
        emit RewardPaid(msg.sender, reward, platformReward);
    }

    /**
     * @dev Claims outstanding rewards for the sender. Only the native
     * rewards token, and not the platform rewards
     */
    function claimRewardOnly()
        public
        updateReward(msg.sender)
    {
        uint256 reward = _claimReward();
        emit RewardPaid(msg.sender, reward, 0);
    }

    /**
     * @dev Credits any outstanding rewards to the sender
     */
    function _claimReward() internal returns (uint256) {
        uint256 reward = rewards[msg.sender];
        if (reward > 0) {
            rewards[msg.sender] = 0;
            rewardsToken.transfer(msg.sender, reward);
        }
        return reward;
    }

    /**
     * @dev Claims any outstanding platform reward tokens
     */
    function _claimPlatformReward() internal returns (uint256)  {
        uint256 platformReward = platformRewards[msg.sender];
        if(platformReward > 0) {
            platformRewards[msg.sender] = 0;
            platformToken.safeTransferFrom(address(platformTokenVendor), msg.sender, platformReward);
        }
        return platformReward;
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
     * @dev Calculates the amount of unclaimed rewards a user has earned
     * @return 'Reward' per staked token
     */
    function rewardPerToken()
        public
        view
        returns (uint256, uint256)
    {
        // If there is no StakingToken liquidity, avoid div(0)
        uint256 stakedTokens = totalSupply();
        if (stakedTokens == 0) {
            return (rewardPerTokenStored, platformRewardPerTokenStored);
        }
        // new reward units to distribute = rewardRate * timeSinceLastUpdate
        uint256 timeDelta = lastTimeRewardApplicable().sub(lastUpdateTime);
        uint256 rewardUnitsToDistribute = rewardRate.mul(timeDelta);
        uint256 platformRewardUnitsToDistribute = platformRewardRate.mul(timeDelta);
        // new reward units per token = (rewardUnitsToDistribute * 1e18) / totalTokens
        uint256 unitsToDistributePerToken = rewardUnitsToDistribute.divPrecisely(stakedTokens);
        uint256 platformUnitsToDistributePerToken = platformRewardUnitsToDistribute.divPrecisely(stakedTokens);
        // return summed rate
        return (
            rewardPerTokenStored.add(unitsToDistributePerToken),
            platformRewardPerTokenStored.add(platformUnitsToDistributePerToken)
        );
    }

    /**
     * @dev Calculates the amount of unclaimed rewards a user has earned
     * @param _account User address
     * @return Total reward amount earned
     */
    function earned(address _account)
        public
        view
        returns (uint256, uint256)
    {
        // current rate per token - rate user previously received
        (uint256 currentRewardPerToken, uint256 currentPlatformRewardPerToken) = rewardPerToken();
        uint256 userRewardDelta = currentRewardPerToken.sub(userRewardPerTokenPaid[_account]);
        uint256 userPlatformRewardDelta = currentPlatformRewardPerToken.sub(userPlatformRewardPerTokenPaid[_account]);
        // new reward = staked tokens * difference in rate
        uint256 stakeBalance = balanceOf(_account);
        uint256 userNewReward = stakeBalance.mulTruncate(userRewardDelta);
        uint256 userNewPlatformReward = stakeBalance.mulTruncate(userPlatformRewardDelta);
        // add to previous rewards
        return (
            rewards[_account].add(userNewReward),
            platformRewards[_account].add(userNewPlatformReward)
        );
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

        uint256 newPlatformRewards = platformToken.balanceOf(address(this));
        if(newPlatformRewards > 0){
            platformToken.safeTransfer(address(platformTokenVendor), newPlatformRewards);
        }

        uint256 currentTime = block.timestamp;
        // If previous period over, reset rewardRate
        if (currentTime >= periodFinish) {
            rewardRate = _reward.div(DURATION);
            platformRewardRate = newPlatformRewards.div(DURATION);
        }
        // If additional reward to existing period, calc sum
        else {
            uint256 remaining = periodFinish.sub(currentTime);

            uint256 leftoverReward = remaining.mul(rewardRate);
            rewardRate = _reward.add(leftoverReward).div(DURATION);

            uint256 leftoverPlatformReward = remaining.mul(platformRewardRate);
            platformRewardRate = newPlatformRewards.add(leftoverPlatformReward).div(DURATION);
        }

        lastUpdateTime = currentTime;
        periodFinish = currentTime.add(DURATION);

        emit RewardAdded(_reward, newPlatformRewards);
    }
}
