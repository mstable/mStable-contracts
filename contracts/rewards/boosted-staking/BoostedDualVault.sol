// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.2;

// Internal
import { IRewardsRecipientWithPlatformToken } from "../../interfaces/IRewardsDistributionRecipient.sol";
import { IBoostedDualVaultWithLockup } from "../../interfaces/IBoostedDualVaultWithLockup.sol";
import { IRewardsDistributionRecipient, InitializableRewardsDistributionRecipient } from "../InitializableRewardsDistributionRecipient.sol";
import { BoostedTokenWrapper } from "./BoostedTokenWrapper.sol";
import { PlatformTokenVendor } from "../staking/PlatformTokenVendor.sol";
import { Initializable } from "../../shared/@openzeppelin-2.5/Initializable.sol";

// Libs
import { IERC20, SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { StableMath } from "../../shared/StableMath.sol";

/**
 * @title  BoostedVault
 * @author mStable
 * @notice Accrues rewards second by second, based on a users boosted balance
 * @dev    Forked from rewards/staking/StakingRewards.sol
 *         Changes:
 *          - Lockup implemented in `updateReward` hook (20% unlock immediately, 80% locked for 6 months)
 *          - `updateBoost` hook called after every external action to reset a users boost
 *          - Struct packing of common data
 *          - Searching for and claiming of unlocked rewards
 */
contract BoostedDualVault is
    IBoostedDualVaultWithLockup,
    IRewardsRecipientWithPlatformToken,
    Initializable,
    InitializableRewardsDistributionRecipient,
    BoostedTokenWrapper
{
    using SafeERC20 for IERC20;
    using StableMath for uint256;
    using SafeCast for uint256;

    event RewardAdded(uint256 reward, uint256 platformReward);
    event Staked(address indexed user, uint256 amount, address payer);
    event Withdrawn(address indexed user, uint256 amount);
    event Poked(address indexed user);
    event RewardPaid(address indexed user, uint256 reward, uint256 platformReward);

    /// @notice token the rewards are distributed in. eg MTA
    IERC20 public immutable rewardsToken;
    /// @notice token the platform rewards are distributed in. eg WMATIC
    IERC20 public immutable platformToken;
    /// @notice contract that holds the platform tokens
    PlatformTokenVendor public platformTokenVendor;
    /// @notice total raw balance
    uint256 public totalRaw;

    uint64 public constant DURATION = 7 days;
    /// @notice  Length of token lockup, after rewards are earned
    uint256 public constant LOCKUP = 26 weeks;
    /// @notice  Percentage of earned tokens unlocked immediately
    uint64 public constant UNLOCK = 33e16;

    /// @notice  Timestamp for current period finish
    uint256 public periodFinish;
    /// @notice  RewardRate for the rest of the PERIOD
    uint256 public rewardRate;
    /// @notice Platform reward rate for the rest of the period
    uint256 public platformRewardRate;
    /// @notice Last time any user took action
    uint256 public lastUpdateTime;
    /// @notice  Ever increasing rewardPerToken rate, based on % of total supply
    uint256 public rewardPerTokenStored;
    /// @notice Ever increasing platformRewardPerToken rate, based on % of total supply
    uint256 public platformRewardPerTokenStored;

    mapping(address => UserData) public userData;
    /// @notice  Locked reward tracking
    mapping(address => Reward[]) public userRewards;
    mapping(address => uint64) public userClaim;

    struct UserData {
        uint128 rewardPerTokenPaid;
        uint128 rewards;
        uint128 platformRewardPerTokenPaid;
        uint128 platformRewards;
        uint64 lastAction;
        uint64 rewardCount;
    }

    struct Reward {
        uint64 start;
        uint64 finish;
        uint128 rate;
    }

    constructor(
        address _nexus,
        address _stakingToken,
        address _boostDirector,
        uint256 _priceCoeff,
        uint256 _coeff,
        address _rewardsToken,
        address _platformToken
    )
        InitializableRewardsDistributionRecipient(_nexus)
        BoostedTokenWrapper(_stakingToken, _boostDirector, _priceCoeff, _coeff)
    {
        rewardsToken = IERC20(_rewardsToken);
        platformToken = IERC20(_platformToken);
    }

    /**
     * @dev StakingRewards is a TokenWrapper and RewardRecipient
     * Constants added to bytecode at deployTime to reduce SLOAD cost
     */
    function initialize(
        address _rewardsDistributor,
        string calldata _nameArg,
        string calldata _symbolArg
    ) external initializer {
        InitializableRewardsDistributionRecipient._initialize(_rewardsDistributor);
        BoostedTokenWrapper._initialize(_nameArg, _symbolArg);
        platformTokenVendor = new PlatformTokenVendor(platformToken);
    }

    /**
     * @dev Updates the reward for a given address, before executing function.
     * Locks 80% of new rewards up for 6 months, vesting linearly from (time of last action + 6 months) to
     * (now + 6 months). This allows rewards to be distributed close to how they were accrued, as opposed
     * to locking up for a flat 6 months from the time of this fn call (allowing more passive accrual).
     */
    modifier updateReward(address _account) {
        uint256 currentTime = block.timestamp;
        uint64 currentTime64 = SafeCast.toUint64(currentTime);

        // Setting of global vars
        (
            uint256 newRewardPerToken,
            uint256 newPlatformRewardPerToken,
            uint256 lastApplicableTime
        ) = _rewardPerToken();
        // If statement protects against loss in initialisation case
        if (newRewardPerToken > 0 || newPlatformRewardPerToken > 0) {
            rewardPerTokenStored = newRewardPerToken;
            platformRewardPerTokenStored = newPlatformRewardPerToken;
            lastUpdateTime = lastApplicableTime;

            // Setting of personal vars based on new globals
            if (_account != address(0)) {
                UserData memory data = userData[_account];
                uint256 earned_ = _earned(
                    _account,
                    data.rewardPerTokenPaid,
                    newRewardPerToken,
                    false
                );
                uint256 platformEarned_ = _earned(
                    _account,
                    data.platformRewardPerTokenPaid,
                    newPlatformRewardPerToken,
                    true
                );

                // If earned == 0, then it must either be the initial stake, or an action in the
                // same block, since new rewards unlock after each block.
                if (earned_ > 0) {
                    uint256 unlocked = earned_.mulTruncate(UNLOCK);
                    uint256 locked = earned_ - unlocked;

                    userRewards[_account].push(
                        Reward({
                            start: SafeCast.toUint64(LOCKUP + data.lastAction),
                            finish: SafeCast.toUint64(LOCKUP + currentTime),
                            rate: SafeCast.toUint128(locked / (currentTime - data.lastAction))
                        })
                    );

                    userData[_account] = UserData({
                        rewardPerTokenPaid: SafeCast.toUint128(newRewardPerToken),
                        rewards: SafeCast.toUint128(unlocked + data.rewards),
                        platformRewardPerTokenPaid: SafeCast.toUint128(newPlatformRewardPerToken),
                        platformRewards: data.platformRewards + SafeCast.toUint128(platformEarned_),
                        lastAction: currentTime64,
                        rewardCount: data.rewardCount + 1
                    });
                } else {
                    userData[_account] = UserData({
                        rewardPerTokenPaid: SafeCast.toUint128(newRewardPerToken),
                        rewards: data.rewards,
                        platformRewardPerTokenPaid: SafeCast.toUint128(newPlatformRewardPerToken),
                        platformRewards: data.platformRewards + SafeCast.toUint128(platformEarned_),
                        lastAction: currentTime64,
                        rewardCount: data.rewardCount
                    });
                }
            }
        } else if (_account != address(0)) {
            // This should only be hit once, for first staker in initialisation case
            userData[_account].lastAction = currentTime64;
        }
        _;
    }

    /** @dev Updates the boost for a given address, after the rest of the function has executed */
    modifier updateBoost(address _account) {
        _;
        _setBoost(_account);
    }

    /***************************************
                ACTIONS - EXTERNAL
    ****************************************/

    /**
     * @dev Stakes a given amount of the StakingToken for the sender
     * @param _amount Units of StakingToken
     */
    function stake(uint256 _amount)
        external
        override
        updateReward(msg.sender)
        updateBoost(msg.sender)
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
        override
        updateReward(_beneficiary)
        updateBoost(_beneficiary)
    {
        _stake(_beneficiary, _amount);
    }

    /**
     * @dev Withdraws stake from pool and claims any unlocked rewards.
     * Note, this function is costly - the args for _claimRewards
     * should be determined off chain and then passed to other fn
     */
    function exit() external override updateReward(msg.sender) updateBoost(msg.sender) {
        _withdraw(rawBalanceOf(msg.sender));
        (uint256 first, uint256 last) = _unclaimedEpochs(msg.sender);
        _claimRewards(first, last);
    }

    /**
     * @dev Withdraws stake from pool and claims any unlocked rewards.
     * @param _first    Index of the first array element to claim
     * @param _last     Index of the last array element to claim
     */
    function exit(uint256 _first, uint256 _last)
        external
        override
        updateReward(msg.sender)
        updateBoost(msg.sender)
    {
        _withdraw(rawBalanceOf(msg.sender));
        _claimRewards(_first, _last);
    }

    /**
     * @dev Withdraws given stake amount from the pool
     * @param _amount Units of the staked token to withdraw
     */
    function withdraw(uint256 _amount)
        external
        override
        updateReward(msg.sender)
        updateBoost(msg.sender)
    {
        _withdraw(_amount);
    }

    /**
     * @dev Claims only the tokens that have been immediately unlocked, not including
     * those that are in the lockers.
     */
    function claimReward() external override updateReward(msg.sender) updateBoost(msg.sender) {
        uint256 unlocked = userData[msg.sender].rewards;
        userData[msg.sender].rewards = 0;

        if (unlocked > 0) {
            rewardsToken.safeTransfer(msg.sender, unlocked);
        }

        uint256 platformReward = _claimPlatformReward();

        emit RewardPaid(msg.sender, unlocked, platformReward);
    }

    /**
     * @dev Claims all unlocked rewards for sender.
     * Note, this function is costly - the args for _claimRewards
     * should be determined off chain and then passed to other fn
     */
    function claimRewards() external override updateReward(msg.sender) updateBoost(msg.sender) {
        (uint256 first, uint256 last) = _unclaimedEpochs(msg.sender);

        _claimRewards(first, last);
    }

    /**
     * @dev Claims all unlocked rewards for sender. Both immediately unlocked
     * rewards and also locked rewards past their time lock.
     * @param _first    Index of the first array element to claim
     * @param _last     Index of the last array element to claim
     */
    function claimRewards(uint256 _first, uint256 _last)
        external
        override
        updateReward(msg.sender)
        updateBoost(msg.sender)
    {
        _claimRewards(_first, _last);
    }

    /**
     * @dev Pokes a given account to reset the boost
     */
    function pokeBoost(address _account)
        external
        override
        updateReward(_account)
        updateBoost(_account)
    {
        emit Poked(_account);
    }

    /***************************************
                ACTIONS - INTERNAL
    ****************************************/

    /**
     * @dev Claims all unlocked rewards for sender. Both immediately unlocked
     * rewards and also locked rewards past their time lock.
     * @param _first    Index of the first array element to claim
     * @param _last     Index of the last array element to claim
     */
    function _claimRewards(uint256 _first, uint256 _last) internal {
        (uint256 unclaimed, uint256 lastTimestamp) = _unclaimedRewards(msg.sender, _first, _last);
        userClaim[msg.sender] = uint64(lastTimestamp);

        uint256 unlocked = userData[msg.sender].rewards;
        userData[msg.sender].rewards = 0;

        uint256 total = unclaimed + unlocked;

        if (total > 0) {
            rewardsToken.safeTransfer(msg.sender, total);
        }

        uint256 platformReward = _claimPlatformReward();

        emit RewardPaid(msg.sender, total, platformReward);
    }

    /**
     * @dev Claims any outstanding platform reward tokens
     */
    function _claimPlatformReward() internal returns (uint256) {
        uint256 platformReward = userData[msg.sender].platformRewards;
        if (platformReward > 0) {
            userData[msg.sender].platformRewards = 0;
            platformToken.safeTransferFrom(
                address(platformTokenVendor),
                msg.sender,
                platformReward
            );
        }
        return platformReward;
    }

    /**
     * @dev Internally stakes an amount by depositing from sender,
     * and crediting to the specified beneficiary
     * @param _beneficiary Staked tokens are credited to this address
     * @param _amount      Units of StakingToken
     */
    function _stake(address _beneficiary, uint256 _amount) internal {
        require(_amount > 0, "Cannot stake 0");
        require(_beneficiary != address(0), "Invalid beneficiary address");

        _stakeRaw(_beneficiary, _amount);
        totalRaw += _amount;
        emit Staked(_beneficiary, _amount, msg.sender);
    }

    /**
     * @dev Withdraws raw units from the sender
     * @param _amount      Units of StakingToken
     */
    function _withdraw(uint256 _amount) internal {
        require(_amount > 0, "Cannot withdraw 0");
        _withdrawRaw(_amount);
        totalRaw -= _amount;
        emit Withdrawn(msg.sender, _amount);
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
        override(IRewardsDistributionRecipient, IRewardsRecipientWithPlatformToken)
        returns (IERC20)
    {
        return rewardsToken;
    }

    /**
     * @dev Gets the PlatformToken
     */
    function getPlatformToken() external view override returns (IERC20) {
        return platformToken;
    }

    /**
     * @dev Gets the last applicable timestamp for this reward period
     */
    function lastTimeRewardApplicable() public view override returns (uint256) {
        return StableMath.min(block.timestamp, periodFinish);
    }

    /**
     * @dev Calculates the amount of unclaimed rewards per token since last update,
     * and sums with stored to give the new cumulative reward per token
     * @return 'Reward' per staked token
     */
    function rewardPerToken() public view override returns (uint256, uint256) {
        (uint256 rewardPerToken_, uint256 platformRewardPerToken_, ) = _rewardPerToken();
        return (rewardPerToken_, platformRewardPerToken_);
    }

    function _rewardPerToken()
        internal
        view
        returns (
            uint256 rewardPerToken_,
            uint256 platformRewardPerToken_,
            uint256 lastTimeRewardApplicable_
        )
    {
        uint256 lastApplicableTime = lastTimeRewardApplicable(); // + 1 SLOAD
        uint256 timeDelta = lastApplicableTime - lastUpdateTime; // + 1 SLOAD
        // If this has been called twice in the same block, shortcircuit to reduce gas
        if (timeDelta == 0) {
            return (rewardPerTokenStored, platformRewardPerTokenStored, lastApplicableTime);
        }
        // new reward units to distribute = rewardRate * timeSinceLastUpdate
        uint256 rewardUnitsToDistribute = rewardRate * timeDelta; // + 1 SLOAD
        uint256 platformRewardUnitsToDistribute = platformRewardRate * timeDelta; // + 1 SLOAD
        // If there is no StakingToken liquidity, avoid div(0)
        // If there is nothing to distribute, short circuit
        if (
            totalSupply() == 0 ||
            (rewardUnitsToDistribute == 0 && platformRewardUnitsToDistribute == 0)
        ) {
            return (rewardPerTokenStored, platformRewardPerTokenStored, lastApplicableTime);
        }
        // new reward units per token = (rewardUnitsToDistribute * 1e18) / totalTokens
        uint256 unitsToDistributePerToken = rewardUnitsToDistribute.divPrecisely(totalSupply());
        uint256 platformUnitsToDistributePerToken = platformRewardUnitsToDistribute.divPrecisely(
            totalRaw
        );
        // return summed rate
        return (
            rewardPerTokenStored + unitsToDistributePerToken,
            platformRewardPerTokenStored + platformUnitsToDistributePerToken,
            lastApplicableTime
        ); // + 1 SLOAD
    }

    /**
     * @dev Returned the units of IMMEDIATELY claimable rewards a user has to receive. Note - this
     * does NOT include the majority of rewards which will be locked up.
     * @param _account User address
     * @return Total reward amount earned
     * @return Platform reward claimable
     */
    function earned(address _account) public view override returns (uint256, uint256) {
        (uint256 rewardPerToken_, uint256 platformRewardPerToken_) = rewardPerToken();
        uint256 newEarned = _earned(
            _account,
            userData[_account].rewardPerTokenPaid,
            rewardPerToken_,
            false
        );
        uint256 immediatelyUnlocked = newEarned.mulTruncate(UNLOCK);
        return (
            immediatelyUnlocked + userData[_account].rewards,
            _earned(
                _account,
                userData[_account].platformRewardPerTokenPaid,
                platformRewardPerToken_,
                true
            )
        );
    }

    /**
     * @dev Calculates all unclaimed reward data, finding both immediately unlocked rewards
     * and those that have passed their time lock.
     * @param _account User address
     * @return amount Total units of unclaimed rewards
     * @return first Index of the first userReward that has unlocked
     * @return last Index of the last userReward that has unlocked
     */
    function unclaimedRewards(address _account)
        external
        view
        override
        returns (
            uint256 amount,
            uint256 first,
            uint256 last,
            uint256 platformAmount
        )
    {
        (first, last) = _unclaimedEpochs(_account);
        (uint256 unlocked, ) = _unclaimedRewards(_account, first, last);
        (uint256 earned_, uint256 platformEarned_) = earned(_account);
        amount = unlocked + earned_;
        platformAmount = platformEarned_;
    }

    /** @dev Returns only the most recently earned rewards */
    function _earned(
        address _account,
        uint256 _userRewardPerTokenPaid,
        uint256 _currentRewardPerToken,
        bool _useRawBalance
    ) internal view returns (uint256) {
        // current rate per token - rate user previously received
        uint256 userRewardDelta = _currentRewardPerToken - _userRewardPerTokenPaid;
        // Short circuit if there is nothing new to distribute
        if (userRewardDelta == 0) {
            return 0;
        }
        // new reward = staked tokens * difference in rate
        uint256 bal = _useRawBalance ? rawBalanceOf(_account) : balanceOf(_account);
        return bal.mulTruncate(userRewardDelta);
    }

    /**
     * @dev Gets the first and last indexes of array elements containing unclaimed rewards
     */
    function _unclaimedEpochs(address _account)
        internal
        view
        returns (uint256 first, uint256 last)
    {
        uint64 lastClaim = userClaim[_account];

        uint256 firstUnclaimed = _findFirstUnclaimed(lastClaim, _account);
        uint256 lastUnclaimed = _findLastUnclaimed(_account);

        return (firstUnclaimed, lastUnclaimed);
    }

    /**
     * @dev Sums the cumulative rewards from a valid range
     */
    function _unclaimedRewards(
        address _account,
        uint256 _first,
        uint256 _last
    ) internal view returns (uint256 amount, uint256 latestTimestamp) {
        uint256 currentTime = block.timestamp;
        uint64 lastClaim = userClaim[_account];

        // Check for no rewards unlocked
        uint256 totalLen = userRewards[_account].length;
        if (_first == 0 && _last == 0) {
            if (totalLen == 0 || currentTime <= userRewards[_account][0].start) {
                return (0, currentTime);
            }
        }
        // If there are previous unlocks, check for claims that would leave them untouchable
        if (_first > 0) {
            require(
                lastClaim >= userRewards[_account][_first - 1].finish,
                "Invalid _first arg: Must claim earlier entries"
            );
        }

        uint256 count = _last - _first + 1;
        for (uint256 i = 0; i < count; i++) {
            uint256 id = _first + i;
            Reward memory rwd = userRewards[_account][id];

            require(currentTime >= rwd.start && lastClaim <= rwd.finish, "Invalid epoch");

            uint256 endTime = StableMath.min(rwd.finish, currentTime);
            uint256 startTime = StableMath.max(rwd.start, lastClaim);
            uint256 unclaimed = (endTime - startTime) * rwd.rate;

            amount += unclaimed;
        }

        // Calculate last relevant timestamp here to allow users to avoid issue of OOG errors
        // by claiming rewards in batches.
        latestTimestamp = StableMath.min(currentTime, userRewards[_account][_last].finish);
    }

    /**
     * @dev Uses binarysearch to find the unclaimed lockups for a given account
     */
    function _findFirstUnclaimed(uint64 _lastClaim, address _account)
        internal
        view
        returns (uint256 first)
    {
        uint256 len = userRewards[_account].length;
        if (len == 0) return 0;
        // Binary search
        uint256 min = 0;
        uint256 max = len - 1;
        // Will be always enough for 128-bit numbers
        for (uint256 i = 0; i < 128; i++) {
            if (min >= max) break;
            uint256 mid = (min + max + 1) / 2;
            if (_lastClaim > userRewards[_account][mid].start) {
                min = mid;
            } else {
                max = mid - 1;
            }
        }
        return min;
    }

    /**
     * @dev Uses binarysearch to find the unclaimed lockups for a given account
     */
    function _findLastUnclaimed(address _account) internal view returns (uint256 first) {
        uint256 len = userRewards[_account].length;
        if (len == 0) return 0;
        // Binary search
        uint256 min = 0;
        uint256 max = len - 1;
        // Will be always enough for 128-bit numbers
        for (uint256 i = 0; i < 128; i++) {
            if (min >= max) break;
            uint256 mid = (min + max + 1) / 2;
            if (block.timestamp > userRewards[_account][mid].start) {
                min = mid;
            } else {
                max = mid - 1;
            }
        }
        return min;
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
        override(IRewardsDistributionRecipient, IRewardsRecipientWithPlatformToken)
        onlyRewardsDistributor
        updateReward(address(0))
    {
        require(_reward < 1e24, "Cannot notify with more than a million units");

        uint256 newPlatformRewards = platformToken.balanceOf(address(this));
        if (newPlatformRewards > 0) {
            platformToken.safeTransfer(address(platformTokenVendor), newPlatformRewards);
        }

        uint256 currentTime = block.timestamp;
        // If previous period over, reset rewardRate
        if (currentTime >= periodFinish) {
            rewardRate = _reward / DURATION;
            platformRewardRate = newPlatformRewards / DURATION;
        }
        // If additional reward to existing period, calc sum
        else {
            uint256 remaining = periodFinish - currentTime;

            uint256 leftoverReward = remaining * rewardRate;
            rewardRate = (_reward + leftoverReward) / DURATION;

            uint256 leftoverPlatformReward = remaining * platformRewardRate;
            platformRewardRate = (newPlatformRewards + leftoverPlatformReward) / DURATION;
        }

        lastUpdateTime = currentTime;
        periodFinish = currentTime + DURATION;

        emit RewardAdded(_reward, newPlatformRewards);
    }
}
