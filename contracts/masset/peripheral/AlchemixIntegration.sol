// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.2;

import { IAlchemixStakingPool } from "../../peripheral/Alchemix/IAlchemixStakingPool.sol";
import { MassetHelpers } from "../../shared/MassetHelpers.sol";
import { AbstractIntegration } from "./AbstractIntegration.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title   AlchemixIntegration
 * @author  mStable
 * @notice  A simple connection to farm ALCX rewards with the Alchemix alUSD pool
 * @dev     VERSION: 1.0
 *          DATE:    2021-07-02
 */
contract AlchemixIntegration is AbstractIntegration {
    using SafeERC20 for IERC20;

    event SkippedWithdrawal(address bAsset, uint256 amount);
    event RewardTokenApproved(address rewardToken, address account);
    event RewardsClaimed();

    address public immutable rewardToken;

    IAlchemixStakingPool private immutable stakingPool;

    /**
     * @param _nexus            Address of the Nexus
     * @param _lp               Address of liquidity provider. eg mAsset or feeder pool
     * @param _rewardToken      Reward token, if any. eg ALCX
     * @param _stakingPool      Alchemix StakingPools contract address
     */
    constructor(
        address _nexus,
        address _lp,
        address _rewardToken,
        address _stakingPool
    ) AbstractIntegration(_nexus, _lp) {
        require(_rewardToken != address(0), "Invalid reward token");
        require(_stakingPool != address(0), "Invalid staking pool");
        rewardToken = _rewardToken;
        stakingPool = IAlchemixStakingPool(_stakingPool);
    }

    /***************************************
                    ADMIN
    ****************************************/

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
     *  @dev Claims any accrued rewardToken for a given bAsset staked
     */
    function claimRewards(address _bAsset) external onlyGovernor {
        uint256 len = bAssetsMapped.length;
        for (uint256 i = 0; i < len; i++) {
            uint256 poolId = _getPoolIdFor(bAssetsMapped[i]);
            stakingPool.claim(poolId);
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

        uint256 poolId = _getPoolIdFor(_bAsset);

        quantityDeposited = _amount;

        if (isTokenFeeCharged) {
            // If we charge a fee, account for it
            uint256 prevBal = this.checkBalance(_bAsset);
            stakingPool.deposit(poolId, _amount);
            uint256 newBal = this.checkBalance(_bAsset);
            quantityDeposited = _min(quantityDeposited, newBal - prevBal);
        } else {
            // Else just deposit the amount
            stakingPool.deposit(poolId, _amount);
        }

        emit Deposit(_bAsset, address(stakingPool), quantityDeposited);
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

        uint256 poolId = _getPoolIdFor(_bAsset);

        uint256 userWithdrawal = _amount;

        if (_hasTxFee) {
            require(_amount == _totalAmount, "Cache inactive with tx fee");
            IERC20 b = IERC20(_bAsset);
            uint256 prevBal = b.balanceOf(address(this));
            stakingPool.withdraw(poolId, _amount);
            uint256 newBal = b.balanceOf(address(this));
            userWithdrawal = _min(userWithdrawal, newBal - prevBal);
        } else {
            // Redeem Underlying bAsset amount
            stakingPool.withdraw(poolId, _totalAmount);
        }

        // Send redeemed bAsset to the receiver
        IERC20(_bAsset).safeTransfer(_receiver, userWithdrawal);

        emit PlatformWithdrawal(_bAsset, address(stakingPool), _totalAmount, _amount);
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
        uint256 poolId = _getPoolIdFor(_bAsset);
        balance = stakingPool.getStakeTotalDeposited(address(this), poolId);
    }

    /***************************************
                    APPROVALS
    ****************************************/

    /**
     * @dev Re-approve the spending of all bAssets by their corresponding cToken,
     *      if for some reason is it necessary. Only callable through Governance.
     */
    function reApproveAllTokens() external onlyGovernor {
        uint256 bAssetCount = bAssetsMapped.length;
        for (uint256 i = 0; i < bAssetCount; i++) {
            address bAsset = bAssetsMapped[i];
            address cToken = bAssetToPToken[bAsset];
            MassetHelpers.safeInfiniteApprove(bAsset, cToken);
        }
    }

    /**
    FIXME do we need this?
     * @dev Internal method to respond to the addition of new bAsset / cTokens
     *      We need to approve the cToken and give it permission to spend the bAsset
     * @param _bAsset Address of the bAsset to approve
     * @param _cToken This cToken has the approval approval
     */
    function _abstractSetPToken(address _bAsset, address _cToken) internal override {
        // approve the pool to spend the bAsset
        MassetHelpers.safeInfiniteApprove(_bAsset, _cToken);
    }

    /***************************************
                    HELPERS
    ****************************************/

    /**
     * @dev Get the Alchemix pool id for a bAsset.
     *      Fails if the pToken doesn't exist in our mappings.
     * @param _bAsset   Address of the bAsset
     * @return poolId   Corresponding Alchemix StakingPools poolId
     */
    function _getPoolIdFor(address _bAsset) internal view returns (uint256 poolId) {
        poolId = stakingPool.tokenPoolIds(_bAsset);
        require(poolId > 0, "Asset not supported on Alchemix");
    }
}
