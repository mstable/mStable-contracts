pragma solidity 0.5.16;

// Internal
import { RewardsDistributionRecipient } from "../rewards/RewardsDistributionRecipient.sol";
import { IIncentivisedVotingLockup } from "../interfaces/IIncentivisedVotingLockup.sol";

// Libs
import { IERC20, SafeERC20 } from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import { StableMath, SafeMath } from "../shared/StableMath.sol";

contract AbstractStakingRewards is RewardsDistributionRecipient {

    using StableMath for uint256;
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    IERC20 public rewardsToken;
    IIncentivisedVotingLockup public staking;

    uint256 private constant DURATION = 7 days;

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
    // Power details
    mapping(address => bool) public switchedOn;
    mapping(address => uint256) public userPower;
    uint256 public totalPower;

    event RewardAdded(uint256 reward);
    event RewardPaid(address indexed user, uint256 reward);

    /** @dev StakingRewards is a TokenWrapper and RewardRecipient */
    constructor(
        address _nexus,
        address _rewardsToken,
        address _rewardsDistributor
    )
        public
        RewardsDistributionRecipient(_nexus, _rewardsDistributor)
    {
        rewardsToken = IERC20(_rewardsToken);
    }

    function balanceOf(address _account) public view returns (uint256);
    function totalSupply() public view returns (uint256);

    modifier updatePower(address _account) {
        _;
        uint256 before = userPower[_account];
        uint256 current = balanceOf(_account);
        userPower[_account] = current;
        uint256 delta = current > before ? current.sub(before) : before.sub(current);
        totalPower = current > before ? totalPower.add(delta) : totalPower.sub(delta);
    }

    /** @dev Updates the reward for a given address, before executing function */
    // Fresh case scenario: SLOAD  SSTORE
    // _rewardPerToken         x5
    // rewardPerTokenStored            5k
    // lastUpdateTime                  5k
    // _earned1                x3     20k
    //                       6.4k     30k
    //                      =       36.4k
    modifier updateReward(address _account) {
        // Setting of global vars
        (uint256 newRewardPerToken, uint256 lastApplicableTime) = _rewardPerToken();
        // If statement protects against loss in initialisation case
        if(newRewardPerToken > 0) {
            rewardPerTokenStored = newRewardPerToken;
            lastUpdateTime = lastApplicableTime;
            // Setting of personal vars based on new globals
            if (_account != address(0)) {
                rewards[_account] = _earned(_account, newRewardPerToken);
                userRewardPerTokenPaid[_account] = newRewardPerToken;
            }
        }
        _;
    }

    // Worst case scenario: SLOAD  SSTORE
    // _rewardPerToken         x5
    // rewardPerTokenStored            5k
    // lastUpdateTime                  5k
    // _earned1                x3  10-25k
    // _earned2                x3  10-25k
    //                       8.8k  30-60k
    //                      = 38.8k-68.8k
    // Wrapper scenario:    SLOAD  SSTORE
    // _rewardPerToken         x3
    // rewardPerTokenStored            0k
    // lastUpdateTime                  0k
    // _earned1                x3  10-25k
    // _earned2                x3  10-25k
    //                       8.8k  30-60k
    //                      = 38.8k-68.8k
    modifier updateRewards(address _a1, address _a2) {
        // Setting of global vars
        (uint256 newRewardPerToken, uint256 lastApplicableTime) = _rewardPerToken();
        // If statement protects against loss in initialisation case
        if(newRewardPerToken > 0) {
            rewardPerTokenStored = newRewardPerToken;
            lastUpdateTime = lastApplicableTime;
            // Setting of personal vars based on new globals
            if (_a1 != address(0)) {
                rewards[_a1] = _earned(_a1, newRewardPerToken);
                userRewardPerTokenPaid[_a1] = newRewardPerToken;
            }
            if (_a2 != address(0)) {
                rewards[_a2] = _earned(_a2, newRewardPerToken);
                userRewardPerTokenPaid[_a2] = newRewardPerToken;
            }
        }
        _;
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
        // TODO - make this base 1 to reduce SSTORE cost in updaterwd
        if (reward > 0) {
            rewards[msg.sender] = 0;
            // TODO - simply add to week in 24 weeks time (floor)
            rewardsToken.safeTransfer(msg.sender, reward);
            emit RewardPaid(msg.sender, reward);
        }
    }

    function withdrawReward(uint256[] calldata _ids)
        external
    {
        // withdraw all unlocked rewards
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
        (uint256 rewardPerToken_, ) = _rewardPerToken();
        return rewardPerToken_;
    }

    function _rewardPerToken()
        internal
        view
        returns (uint256 rewardPerToken_, uint256 lastTimeRewardApplicable_)
    {
        uint256 lastApplicableTime = lastTimeRewardApplicable(); // + 1 SLOAD
        uint256 timeDelta = lastApplicableTime.sub(lastUpdateTime); // + 1 SLOAD
        // If this has been called twice in the same block, shortcircuit to reduce gas
        if(timeDelta == 0) {
            return (rewardPerTokenStored, lastApplicableTime);
        }
        // new reward units to distribute = rewardRate * timeSinceLastUpdate
        uint256 rewardUnitsToDistribute = rewardRate.mul(timeDelta); // + 1 SLOAD
        uint256 totalPower_ = totalPower; // + 1 SLOAD
        // If there is no StakingToken liquidity, avoid div(0)
        // If there is nothing to distribute, short circuit
        if (totalPower_ == 0 || rewardUnitsToDistribute == 0) {
            return (rewardPerTokenStored, lastApplicableTime);
        }
        // new reward units per token = (rewardUnitsToDistribute * 1e18) / totalTokens
        uint256 unitsToDistributePerToken = rewardUnitsToDistribute.divPrecisely(totalPower_);
        // return summed rate
        return (rewardPerTokenStored.add(unitsToDistributePerToken), lastApplicableTime); // + 1 SLOAD
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
        return _earned(_account, rewardPerToken());
    }

    function _earned(address _account, uint256 _currentRewardPerToken)
        internal
        view
        returns (uint256)
    {
        // current rate per token - rate user previously received
        uint256 userRewardDelta = _currentRewardPerToken.sub(userRewardPerTokenPaid[_account]); // + 1 SLOAD
        // Short circuit if there is nothing new to distribute
        if(userRewardDelta == 0){
            return rewards[_account];
        }
        // new reward = staked tokens * difference in rate
        uint256 userNewReward = userPower[_account].mulTruncate(userRewardDelta); // + 1 SLOAD
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