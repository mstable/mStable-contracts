// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.2;

import { IPlatformIntegration } from "../../interfaces/IPlatformIntegration.sol";
import { IAlchemixStakingPools } from "../../peripheral/Alchemix/IAlchemixStakingPools.sol";
import { Initializable } from "@openzeppelin/contracts/utils/Initializable.sol";
import { ImmutableModule } from "../../shared/ImmutableModule.sol";
import { MassetHelpers } from "../../shared/MassetHelpers.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
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
    ReentrancyGuard {
    using SafeERC20 for IERC20;

    event Deposit(address indexed _bAsset, address _pToken, uint256 _amount);
    event Withdrawal(address indexed _bAsset, address _pToken, uint256 _amount);
    event PlatformWithdrawal(
        address indexed bAsset,
        address pToken,
        uint256 totalAmount,
        uint256 userAmount
    );
    event AssetAdded(address _bAsset, uint256 poolId);
    event RewardTokenApproved(address rewardToken, address account);
    event RewardsClaimed();

    /// @notice mAsset or Feeder Pool using the integration. eg fPmUSD/alUSD
    /// @dev LP has write access
    address public immutable lpAddress;
    /// @notice token the staking rewards are accrued and claimed in.
    address public immutable rewardToken;
    /// @notice Alchemix's StakingPools contract
    IAlchemixStakingPools public immutable stakingPools;

    /// @notice bAsset => Alchemix pool id
    mapping(address => uint256) public bAssetToPoolId;
    /// @notice Full list of all bAssets supported here
    address[] public bAssetsMapped;

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
     */
    constructor(
        address _nexus,
        address _lp,
        address _rewardToken,
        address _stakingPools
    ) ImmutableModule(_nexus) {
        require(_lp != address(0), "Invalid LP address");
        require(_rewardToken != address(0), "Invalid reward token");
        require(_stakingPools != address(0), "Invalid staking pools");
        lpAddress = _lp;
        rewardToken = _rewardToken;
        stakingPools = IAlchemixStakingPools(_stakingPools);
    }

    /**
     * @dev Simple initializer to add the first bAssets
     * @param _bAssets array of base assets that can be staked in an Alchemix staking pool. eg alUSD
     */
    function initialize(address[] calldata _bAssets)
        public
        initializer
    {
        uint256 len = _bAssets.length;
        for (uint256 i = 0; i < len; i++) {
            address bAsset = _bAssets[i];
            _addAsset(bAsset);
        }
    }

    /***************************************
                    ADMIN
    ****************************************/

    /**
     * @dev add another asset that can be staked in an Alchemix staking pool.
     * This method can only be called by the system Governor
     * @param _bAsset   Address for the bAsset
     */
    function addAsset(address _bAsset) external onlyGovernor {
        _addAsset(_bAsset);
    }

    function _addAsset(address _bAsset) internal {
        require(_bAsset != address(0), "Invalid addresses");

        uint256 poolId = _getPoolIdFor(_bAsset);
        bAssetToPoolId[_bAsset] = poolId;
        bAssetsMapped.push(_bAsset);

        // approve staking pools contract to transfer bAssets on deposits
        MassetHelpers.safeInfiniteApprove(_bAsset, address(stakingPools));

        emit AssetAdded(_bAsset, poolId);
    }

    /**
     * @dev Approves Liquidator to spend reward tokens
     */
    function approveRewardToken() external onlyGovernor {
        address liquidator = nexus.getModule(keccak256("Liquidator"));
        require(liquidator != address(0), "Liquidator address is zero");

        MassetHelpers.safeInfiniteApprove(rewardToken, liquidator);

        emit RewardTokenApproved(rewardToken, liquidator);
    }

    /**
     *  @dev Claims any accrued reward tokens for all the bAssets
     */
    function claimRewards() external onlyGovernor {
        uint256 len = bAssetsMapped.length;
        for (uint256 i = 0; i < len; i++) {
            uint256 poolId = bAssetToPoolId[bAssetsMapped[i]];
            stakingPools.claim(poolId);
        }

        emit RewardsClaimed();
    }

    /***************************************
                    CORE
    ****************************************/

    /**
     * @dev Deposit a quantity of bAsset into the platform. Credited cTokens
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

        uint256 poolId = bAssetToPoolId[_bAsset];

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
     * @dev Withdraw a quantity of bAsset from Alchemix
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
     * @dev Withdraw a quantity of bAsset from Alchemix
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
        require(_totalAmount > 0, "Must withdraw something");
        require(_receiver != address(0), "Must specify recipient");

        uint256 poolId = bAssetToPoolId[_bAsset];

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
     * @dev Withdraw a quantity of bAsset from the cache.
     * @param _receiver     Address to which the bAsset should be sent
     * @param _bAsset       Address of the bAsset
     * @param _amount       Units of bAsset to withdraw
     */
    function withdrawRaw(
        address _receiver,
        address _bAsset,
        uint256 _amount
    ) external override onlyLP nonReentrant {
        require(_amount > 0, "Must withdraw something");
        require(_receiver != address(0), "Must specify recipient");

        IERC20(_bAsset).safeTransfer(_receiver, _amount);

        emit Withdrawal(_bAsset, address(0), _amount);
    }

    /**
     * @dev Get the total bAsset value held in the platform
     * @param _bAsset     Address of the bAsset
     * @return balance    Total value of the bAsset in the platform
     */
    function checkBalance(address _bAsset) external view override returns (uint256 balance) {
        uint256 poolId = bAssetToPoolId[_bAsset];
        balance = stakingPools.getStakeTotalDeposited(address(this), poolId);
    }

    /***************************************
                    APPROVALS
    ****************************************/

    /**
     * @dev Re-approve the spending of all bAssets by the staking pools contract,
     *      if for some reason is it necessary. Only callable through Governance.
     */
    function reApproveAllTokens() external onlyGovernor {
        uint256 bAssetCount = bAssetsMapped.length;
        for (uint256 i = 0; i < bAssetCount; i++) {
            address bAsset = bAssetsMapped[i];
            MassetHelpers.safeInfiniteApprove(bAsset, address(stakingPools));
        }
    }

    /***************************************
                    HELPERS
    ****************************************/

    /**
     * @dev Get the Alchemix pool id for a bAsset.
     * @param _asset   Address of the integrated asset
     * @return poolId   Corresponding Alchemix staking pool identifier
     */
    function _getPoolIdFor(address _asset) internal view returns (uint256 poolId) {
        poolId = stakingPools.tokenPoolIds(_asset);
        require(poolId >= 1, "Asset not supported on Alchemix");
        // Take one off the poolId
        poolId = poolId - 1;
    }

    /**
     * @dev Simple helper func to get the min of two values
     */
    function _min(uint256 x, uint256 y) internal pure returns (uint256) {
        return x > y ? y : x;
    }
}
