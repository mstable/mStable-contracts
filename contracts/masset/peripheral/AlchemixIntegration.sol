// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { IPlatformIntegration } from "../../interfaces/IPlatformIntegration.sol";
import { IAlchemixStakingPools } from "../../peripheral/Alchemix/IAlchemixStakingPools.sol";
import { ImmutableModule } from "../../shared/ImmutableModule.sol";
import { MassetHelpers } from "../../shared/MassetHelpers.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title   AlchemixIntegration
 * @author  mStable
 * @notice  A simple connection to farm ALCX rewards with the Alchemix alUSD pool
 * @dev     VERSION: 1.0
 *          DATE:    2021-07-02
 */
contract AlchemixIntegration is
    IPlatformIntegration,
    Initializable,
    ImmutableModule,
    ReentrancyGuard
{
    using SafeERC20 for IERC20;

    event Deposit(address indexed _bAsset, address _pToken, uint256 _amount);
    event Withdrawal(address indexed _bAsset, address _pToken, uint256 _amount);
    event PlatformWithdrawal(
        address indexed bAsset,
        address pToken,
        uint256 totalAmount,
        uint256 userAmount
    );
    event RewardsClaimed();

    /// @notice mAsset or Feeder Pool using the integration. eg fPmUSD/alUSD
    /// @dev LP has write access
    address public immutable lpAddress;
    /// @notice token the staking rewards are accrued and claimed in.
    address public immutable rewardToken;
    /// @notice Alchemix's StakingPools contract
    IAlchemixStakingPools public immutable stakingPools;
    /// @notice base asset that is integrated to Alchemix staking pool. eg alUSD
    address public immutable bAsset;
    /// @notice Alchemix pool identifier for bAsset deposits. eg pool id 0 for alUSD
    uint256 public immutable poolId;

    /**
     * @dev Modifier to allow function calls only from the Governor.
     */
    modifier onlyLP() {
        require(msg.sender == lpAddress, "Only the LP can execute");
        _;
    }

    /**
     * @param _nexus            Address of the Nexus
     * @param _lp               Address of liquidity provider. eg mAsset or feeder pool
     * @param _rewardToken      Reward token, if any. eg ALCX
     * @param _stakingPools     Alchemix StakingPools contract address
     * @param _bAsset           base asset to be deposited to Alchemix's staking pool. eg alUSD
     */
    constructor(
        address _nexus,
        address _lp,
        address _rewardToken,
        address _stakingPools,
        address _bAsset
    ) ImmutableModule(_nexus) {
        require(_lp != address(0), "Invalid LP address");
        require(_rewardToken != address(0), "Invalid reward token");
        require(_stakingPools != address(0), "Invalid staking pools");
        require(_bAsset != address(0), "Invalid bAsset address");

        lpAddress = _lp;
        rewardToken = _rewardToken;
        stakingPools = IAlchemixStakingPools(_stakingPools);
        bAsset = _bAsset;

        uint256 offsetPoolId = IAlchemixStakingPools(_stakingPools).tokenPoolIds(_bAsset);
        require(offsetPoolId >= 1, "bAsset can not be farmed");
        // Take one off the poolId
        poolId = offsetPoolId - 1;
    }

    /**
     * @dev Approve the spending of the bAsset by Alchemix's StakingPools contract,
     *      and the spending of the reward token by mStable's Liquidator contract
     */
    function initialize() public initializer {
        _approveContracts();
    }

    /***************************************
                    ADMIN
    ****************************************/

    /**
     * @dev Re-approve the spending of the bAsset by Alchemix's StakingPools contract,
     *      and the spending of the reward token by mStable's Liquidator contract
     *      if for some reason is it necessary. Only callable through Governance.
     */
    function reapproveContracts() external onlyGovernor {
        _approveContracts();
    }

    function _approveContracts() internal {
        // Approve Alchemix staking pools contract to transfer bAssets for deposits.
        MassetHelpers.safeInfiniteApprove(bAsset, address(stakingPools));

        // Approve Liquidator to transfer reward token when claiming rewards.
        address liquidator = nexus.getModule(keccak256("Liquidator"));
        require(liquidator != address(0), "Liquidator address is zero");

        MassetHelpers.safeInfiniteApprove(rewardToken, liquidator);
    }

    /***************************************
                    CORE
    ****************************************/

    /**
     * @notice Deposit a quantity of bAsset into the platform. Credited cTokens
     *      remain here in the vault. Can only be called by whitelisted addresses
     *      (mAsset and corresponding BasketManager)
     * @param _bAsset              Address for the bAsset
     * @param _amount              Units of bAsset to deposit
     * @param isTokenFeeCharged    Flag that signals if an xfer fee is charged on bAsset
     * @return quantityDeposited   Quantity of bAsset that entered the platform
     */
    function deposit(
        address _bAsset,
        uint256 _amount,
        bool isTokenFeeCharged
    ) external override onlyLP nonReentrant returns (uint256 quantityDeposited) {
        require(_amount > 0, "Must deposit something");
        require(_bAsset == bAsset, "Invalid bAsset");

        quantityDeposited = _amount;

        if (isTokenFeeCharged) {
            // If we charge a fee, account for it
            uint256 prevBal = this.checkBalance(_bAsset);
            stakingPools.deposit(poolId, _amount);
            uint256 newBal = this.checkBalance(_bAsset);
            quantityDeposited = _min(quantityDeposited, newBal - prevBal);
        } else {
            // Else just deposit the amount
            stakingPools.deposit(poolId, _amount);
        }

        emit Deposit(_bAsset, address(stakingPools), quantityDeposited);
    }

    /**
     * @notice Withdraw a quantity of bAsset from Alchemix
     * @param _receiver     Address to which the withdrawn bAsset should be sent
     * @param _bAsset       Address of the bAsset
     * @param _amount       Units of bAsset to withdraw
     * @param _hasTxFee     Is the bAsset known to have a tx fee?
     */
    function withdraw(
        address _receiver,
        address _bAsset,
        uint256 _amount,
        bool _hasTxFee
    ) external override onlyLP nonReentrant {
        _withdraw(_receiver, _bAsset, _amount, _amount, _hasTxFee);
    }

    /**
     * @notice Withdraw a quantity of bAsset from Alchemix
     * @param _receiver     Address to which the withdrawn bAsset should be sent
     * @param _bAsset       Address of the bAsset
     * @param _amount       Units of bAsset to withdraw
     * @param _totalAmount  Total units to pull from lending platform
     * @param _hasTxFee     Is the bAsset known to have a tx fee?
     */
    function withdraw(
        address _receiver,
        address _bAsset,
        uint256 _amount,
        uint256 _totalAmount,
        bool _hasTxFee
    ) external override onlyLP nonReentrant {
        _withdraw(_receiver, _bAsset, _amount, _totalAmount, _hasTxFee);
    }

    function _withdraw(
        address _receiver,
        address _bAsset,
        uint256 _amount,
        uint256 _totalAmount,
        bool _hasTxFee
    ) internal {
        require(_receiver != address(0), "Must specify recipient");
        require(_bAsset == bAsset, "Invalid bAsset");
        require(_totalAmount > 0, "Must withdraw something");

        uint256 userWithdrawal = _amount;

        if (_hasTxFee) {
            require(_amount == _totalAmount, "Cache inactive with tx fee");
            IERC20 b = IERC20(_bAsset);
            uint256 prevBal = b.balanceOf(address(this));
            stakingPools.withdraw(poolId, _amount);
            uint256 newBal = b.balanceOf(address(this));
            userWithdrawal = _min(userWithdrawal, newBal - prevBal);
        } else {
            // Redeem Underlying bAsset amount
            stakingPools.withdraw(poolId, _totalAmount);
        }

        // Send redeemed bAsset to the receiver
        IERC20(_bAsset).safeTransfer(_receiver, userWithdrawal);

        emit PlatformWithdrawal(_bAsset, address(stakingPools), _totalAmount, _amount);
    }

    /**
     * @notice Withdraw a quantity of bAsset from the cache.
     * @param _receiver     Address to which the bAsset should be sent
     * @param _bAsset       Address of the bAsset
     * @param _amount       Units of bAsset to withdraw
     */
    function withdrawRaw(
        address _receiver,
        address _bAsset,
        uint256 _amount
    ) external override onlyLP nonReentrant {
        require(_receiver != address(0), "Must specify recipient");
        require(_bAsset == bAsset, "Invalid bAsset");
        require(_amount > 0, "Must withdraw something");

        IERC20(_bAsset).safeTransfer(_receiver, _amount);

        emit Withdrawal(_bAsset, address(0), _amount);
    }

    /**
     * @notice Get the total bAsset value held in the platform
     * @param _bAsset     Address of the bAsset
     * @return balance    Total value of the bAsset in the platform
     */
    function checkBalance(address _bAsset) external view override returns (uint256 balance) {
        require(_bAsset == bAsset, "Invalid bAsset");
        balance = stakingPools.getStakeTotalDeposited(address(this), poolId);
    }

    /***************************************
                    Liquidation
    ****************************************/

    /**
     *  @notice Claims any accrued reward tokens from the Alchemix staking pool.
     *          eg ALCX tokens from the alUSD deposits.
     *          Claimed rewards are sent to this integration contract.
     *  @dev    The Alchemix StakingPools will emit event
     *          TokensClaimed(user, poolId, amount)
     */
    function claimRewards() external {
        stakingPools.claim(poolId);
    }

    /***************************************
                    HELPERS
    ****************************************/

    /**
     * @dev Simple helper func to get the min of two values
     */
    function _min(uint256 x, uint256 y) internal pure returns (uint256) {
        return x > y ? y : x;
    }
}
