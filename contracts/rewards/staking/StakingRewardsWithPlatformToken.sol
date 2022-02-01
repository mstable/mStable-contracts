// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

// Internal
import { IRewardsDistributionRecipient, IRewardsRecipientWithPlatformToken } from "../../interfaces/IRewardsDistributionRecipient.sol";
import { IStakingRewardsWithPlatformToken } from "../../interfaces/IStakingRewardsWithPlatformToken.sol";
import { InitializableRewardsDistributionRecipient } from "../InitializableRewardsDistributionRecipient.sol";
import { ISavingsContractV3 } from "../../interfaces/ISavingsContract.sol";
import { StakingTokenWrapper } from "./StakingTokenWrapper.sol";
import { PlatformTokenVendor } from "./PlatformTokenVendor.sol";
import { StableMath } from "../../shared/StableMath.sol";

// Libs
import { ReentrancyGuard } from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

/**
 * @title  StakingRewardsWithPlatformToken
 * @author mStable
 * @notice Rewards stakers of a given LP token (a.k.a StakingToken) with RewardsToken, on a pro-rata basis
 * additionally, distributes the Platform token airdropped by the platform
 * @dev    Derives from ./StakingRewards.sol and implements a secondary token into the core logic
 * @dev StakingRewardsWithPlatformToken is a StakingTokenWrapper and InitializableRewardsDistributionRecipient
 */
contract StakingRewardsWithPlatformToken is
    Initializable,
    StakingTokenWrapper,
    IRewardsRecipientWithPlatformToken,
    IStakingRewardsWithPlatformToken,
    InitializableRewardsDistributionRecipient
{
    using SafeERC20 for IERC20;
    using StableMath for uint256;

    /// @notice token the rewards are distributed in. eg MTA
    IERC20 public immutable rewardsToken;
    /// @notice token the platform rewards are distributed in. eg WMATIC
    IERC20 public immutable platformToken;
    /// @notice contract that holds the platform tokens
    PlatformTokenVendor public platformTokenVendor;

    /// @notice length of each staking period in seconds. 7 days = 604,800; 3 months = 7,862,400
    uint256 public immutable DURATION;

    /// @notice Timestamp for current period finish
    uint256 public periodFinish = 0;
    /// @notice Reward rate for the rest of the period
    uint256 public rewardRate = 0;
    /// @notice Platform reward rate for the rest of the period
    uint256 public platformRewardRate = 0;
    /// @notice Last time any user took action
    uint256 public lastUpdateTime;
    /// @notice Ever increasing rewardPerToken rate, based on % of total supply
    uint256 public rewardPerTokenStored;
    /// @notice Ever increasing platformRewardPerToken rate, based on % of total supply
    uint256 public platformRewardPerTokenStored;

    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public userPlatformRewardPerTokenPaid;

    mapping(address => uint256) public rewards;
    mapping(address => uint256) public platformRewards;

    event RewardAdded(uint256 reward, uint256 platformReward);
    event Staked(address indexed user, uint256 amount, address payer);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, uint256 reward, uint256 platformReward);

    /**
     * @param _nexus mStable system Nexus address
     * @param _stakingToken token that is beinf rewarded for being staked. eg MTA, imUSD or fPmUSD/GUSD
     * @param _rewardsToken first token that is being distributed as a reward. eg MTA
     * @param _platformToken second token that is being distributed as a reward. eg wMATIC on Polygon
     * @param _duration length of each staking period in seconds. 7 days = 604,800; 3 months = 7,862,400
     */
    constructor(
        address _nexus,
        address _stakingToken,
        address _rewardsToken,
        address _platformToken,
        uint256 _duration
    ) StakingTokenWrapper(_stakingToken) InitializableRewardsDistributionRecipient(_nexus) {
        rewardsToken = IERC20(_rewardsToken);
        platformToken = IERC20(_platformToken);
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
        platformTokenVendor = new PlatformTokenVendor(platformToken);
    }

    /** @dev Updates the reward for a given address, before executing function */
    modifier updateReward(address _account) {
        // Setting of global vars
        (
            uint256 newRewardPerTokenStored,
            uint256 newPlatformRewardPerTokenStored
        ) = rewardPerToken();

        // If statement protects against loss in initialisation case
        if (newRewardPerTokenStored > 0 || newPlatformRewardPerTokenStored > 0) {
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
     * @notice Stakes a given amount of the StakingToken for the sender
     * @param _amount Units of StakingToken
     */
    function stake(uint256 _amount) external override {
        _stake(msg.sender, _amount);
    }

    /**
     * @notice Stakes a given amount of the StakingToken for a given beneficiary
     * @param _beneficiary Staked tokens are credited to this address
     * @param _amount      Units of StakingToken
     */
    function stake(address _beneficiary, uint256 _amount) external override {
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
     * @notice Withdraws stake from pool and claims any rewards
     */
    function exit() external override updateReward(msg.sender) {
        uint256 amount = balanceOf(msg.sender);
        _withdraw(amount);
        emit Withdrawn(msg.sender, amount);
        _claimReward(true);
    }

    /**
     * @notice Withdraws given stake amount from the pool
     * @param _amount Units of the staked token to withdraw
     */
    function withdraw(uint256 _amount) external override updateReward(msg.sender) {
        _withdraw(_amount);
        emit Withdrawn(msg.sender, _amount);
    }

    /**
     * @notice Redeems staked interest-bearing asset tokens for either bAsset or fAsset tokens.
     * Withdraws a given staked amount of interest-bearing assets from the vault,
     * redeems the interest-bearing asset for the underlying mAsset and either
     * 1. Redeems the underlying mAsset tokens for bAsset tokens.
     * 2. Swaps the underlying mAsset tokens for fAsset tokens in a Feeder Pool.
     * @param _amount        Units of the staked interest-bearing asset tokens to withdraw. eg imUSD or imBTC.
     * @param _minAmountOut  Minimum units of `output` tokens to be received by the beneficiary. This is to the same decimal places as the `output` token.
     * @param _output        Asset to receive in exchange for the redeemed mAssets. This can be a bAsset or a fAsset. For example:
        - bAssets (USDC, DAI, sUSD or USDT) or fAssets (GUSD, BUSD, alUSD, FEI or RAI) for mainnet imUSD Vault.
        - bAssets (USDC, DAI or USDT) or fAsset FRAX for Polygon imUSD Vault.
        - bAssets (WBTC, sBTC or renBTC) or fAssets (HBTC or TBTCV2) for mainnet imBTC Vault.
     * @param _beneficiary   Address to send `output` tokens to.
     * @param _router        mAsset address if the `output` is a bAsset. Feeder Pool address if the `output` is a fAsset.
     * @param _isBassetOut   `true` if `output` is a bAsset. `false` if `output` is a fAsset.
     * @return outputQuantity Units of `output` tokens sent to the beneficiary. This is to the same decimal places as the `output` token.
     */
    function withdrawAndUnwrap(
        uint256 _amount,
        uint256 _minAmountOut,
        address _output,
        address _beneficiary,
        address _router,
        bool _isBassetOut
    ) external override updateReward(msg.sender) returns (uint256 outputQuantity) {
        require(_amount > 0, "Cannot withdraw 0");

        // Reduce raw balance (but do not transfer `stakingToken`)
        _reduceRaw(_amount);

        // Unwrap `stakingToken` into `output` and send to `beneficiary`
        (, , outputQuantity) = ISavingsContractV3(address(stakingToken)).redeemAndUnwrap(
            _amount,
            true,
            _minAmountOut,
            _output,
            _beneficiary,
            _router,
            _isBassetOut
        );

        emit Withdrawn(msg.sender, _amount);
    }

    /**
     * @notice Claims outstanding rewards (both platform and native) for the sender.
     * First updates outstanding reward allocation and then transfers.
     */
    function claimReward() external override updateReward(msg.sender) {
        _claimReward(true);
    }

    /**
     * @notice Claims outstanding rewards for the sender. Only the native
     * rewards token, and not the platform rewards
     */
    function claimRewardOnly() external override updateReward(msg.sender) {
        _claimReward(false);
    }

    /**
     * @dev Claims outstanding rewards for the sender.
     * @param _isClaimingPlatform   If true, it claims the rewards from the platform.
     */
    function _claimReward(bool _isClaimingPlatform) internal {
        uint256 reward = _claimTokenReward();
        uint256 platformReward = 0;
        if (_isClaimingPlatform) {
            platformReward = _claimPlatformReward();
        }
        emit RewardPaid(msg.sender, reward, platformReward);
    }

    /**
     * @dev Credits any outstanding rewards to the sender
     */
    function _claimTokenReward() internal returns (uint256) {
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
    function _claimPlatformReward() internal returns (uint256) {
        uint256 platformReward = platformRewards[msg.sender];
        if (platformReward > 0) {
            platformRewards[msg.sender] = 0;
            platformToken.safeTransferFrom(
                address(platformTokenVendor),
                msg.sender,
                platformReward
            );
        }
        return platformReward;
    }

    /***************************************
                    GETTERS
    ****************************************/

    /**
     * @notice Gets the RewardsToken
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
     * @notice Gets the PlatformToken
     */
    function getPlatformToken() external view override returns (IERC20) {
        return platformToken;
    }

    /**
     * @notice Gets the last applicable timestamp for this reward period
     */
    function lastTimeRewardApplicable() public view override returns (uint256) {
        return StableMath.min(block.timestamp, periodFinish);
    }

    /**
     * @notice Calculates the amount of unclaimed rewards a user has earned
     * @return 'Reward' per staked token
     */
    function rewardPerToken() public view override returns (uint256, uint256) {
        // If there is no StakingToken liquidity, avoid div(0)
        uint256 stakedTokens = totalSupply();
        if (stakedTokens == 0) {
            return (rewardPerTokenStored, platformRewardPerTokenStored);
        }
        // new reward units to distribute = rewardRate * timeSinceLastUpdate
        uint256 timeDelta = lastTimeRewardApplicable() - lastUpdateTime;
        uint256 rewardUnitsToDistribute = rewardRate * timeDelta;
        uint256 platformRewardUnitsToDistribute = platformRewardRate * timeDelta;
        // new reward units per token = (rewardUnitsToDistribute * 1e18) / totalTokens
        uint256 unitsToDistributePerToken = rewardUnitsToDistribute.divPrecisely(stakedTokens);
        uint256 platformUnitsToDistributePerToken = platformRewardUnitsToDistribute.divPrecisely(
            stakedTokens
        );
        // return summed rate
        return (
            rewardPerTokenStored + unitsToDistributePerToken,
            platformRewardPerTokenStored + platformUnitsToDistributePerToken
        );
    }

    /**
     * @notice Calculates the amount of unclaimed rewards a user has earned
     * @param _account User address
     * @return Total reward amount earned
     */
    function earned(address _account) public view override returns (uint256, uint256) {
        // current rate per token - rate user previously received
        (uint256 currentRewardPerToken, uint256 currentPlatformRewardPerToken) = rewardPerToken();
        uint256 userRewardDelta = currentRewardPerToken - userRewardPerTokenPaid[_account];
        uint256 userPlatformRewardDelta = currentPlatformRewardPerToken -
            userPlatformRewardPerTokenPaid[_account];
        // new reward = staked tokens * difference in rate
        uint256 stakeBalance = balanceOf(_account);
        uint256 userNewReward = stakeBalance.mulTruncate(userRewardDelta);
        uint256 userNewPlatformReward = stakeBalance.mulTruncate(userPlatformRewardDelta);
        // add to previous rewards
        return (
            rewards[_account] + userNewReward,
            platformRewards[_account] + userNewPlatformReward
        );
    }

    /***************************************
                    ADMIN
    ****************************************/

    /**
     * @notice Notifies the contract that new rewards have been added.
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
