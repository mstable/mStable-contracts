// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.0;

import { IRevenueRecipient } from "../interfaces/IRevenueRecipient.sol";
import { IConfigurableRightsPool } from "./IConfigurableRightsPool.sol";
import { ImmutableModule } from "../shared/ImmutableModule.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title   RevenueRecipient
 * @author  mStable
 * @notice  Simply receives mAssets and then deposits to a pre-defined Balancer
 *          ConfigurableRightsPool.
 * @dev     VERSION: 1.0
 *          DATE:    2021-03-08
 */
contract RevenueRecipient is IRevenueRecipient, ImmutableModule {
    using SafeERC20 for IERC20;

    event RevenueReceived(address indexed mAsset, uint256 amountIn, uint256 amountOut);

    // BPT To which all revenue should be deposited
    IConfigurableRightsPool public immutable mBPT;

    // Minimum output units per 1e18 input units
    mapping(address => uint256) public minOut;

    /**
     * @dev Creates the RevenueRecipient contract
     * @param _nexus      mStable system Nexus address
     * @param _targetPool Balancer pool to which all revenue should be deposited
     * @param _assets     Initial list of supported mAssets
     * @param _minOut     Minimum BPT out per mAsset unit
     */
    constructor(
        address _nexus,
        address _targetPool,
        address[] memory _assets,
        uint256[] memory _minOut
    ) ImmutableModule(_nexus) {
        mBPT = IConfigurableRightsPool(_targetPool);

        uint256 len = _assets.length;
        for (uint256 i = 0; i < len; i++) {
            minOut[_assets[i]] = _minOut[i];
            IERC20(_assets[i]).safeApprove(_targetPool, 2**256 - 1);
        }
    }

    /**
     * @dev Called by SavingsManager after revenue has accrued
     * @param _mAsset Address of mAsset
     * @param _amount Units of mAsset collected
     */
    function notifyRedistributionAmount(address _mAsset, uint256 _amount) external override {
        // Transfer from sender to here
        IERC20(_mAsset).safeTransferFrom(msg.sender, address(this), _amount);

        // Deposit into pool
        uint256 minBPT = (_amount * minOut[_mAsset]) / 1e18;
        uint256 poolAmountOut = mBPT.joinswapExternAmountIn(_mAsset, _amount, minBPT);

        emit RevenueReceived(_mAsset, _amount, poolAmountOut);
    }

    /**
     * @dev Simply approves spending of a given mAsset by BPT
     * @param _mAsset Address of mAsset to approve
     */
    function approveAsset(address _mAsset) external onlyGovernor {
        IERC20(_mAsset).safeApprove(address(mBPT), 0);
        IERC20(_mAsset).safeApprove(address(mBPT), 2**256 - 1);
    }

    /**
     * @dev Sets the minimum amount of BPT to receive for a given mAsset
     * @param _mAsset Address of mAsset
     * @param _minOut Scaled amount to receive per 1e18 mAsset units
     */
    function updateAmountOut(address _mAsset, uint256 _minOut) external onlyGovernor {
        minOut[_mAsset] = _minOut;
    }

    /**
     * @dev Migrates BPT to a new revenue recipient
     * @param _recipient Address of recipient
     */
    function migrateBPT(address _recipient) external onlyGovernor {
        IERC20 mBPT_ = IERC20(address(mBPT));
        mBPT_.safeTransfer(_recipient, mBPT_.balanceOf(address(this)));
    }
}
