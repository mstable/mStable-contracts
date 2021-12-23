// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { IFeederPool } from "../interfaces/IFeederPool.sol";
import { PausableModule } from "../shared/PausableModule.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { YieldValidator } from "../shared/YieldValidator.sol";

/**
 * @title   InterestValidator
 * @author  mStable
 * @notice  Simply validates the platform interest collection from the Feeder Pools. Normally this function
 *          is supported by the SavingsManager, which then distributes the inflated tokens to SAVE contracts.
 *          However, given that fPools collect value internally, we simply want to provide protections here
 *          without actually inflating supply. As such, this code is forked from `savings/SavingsManager.sol`.
 * @dev     VERSION: 1.0
 *          DATE:    2021-03-01
 */
contract InterestValidator is PausableModule {
    event InterestCollected(
        address indexed feederPool,
        uint256 interest,
        uint256 newTotalSupply,
        uint256 apy
    );
    event GovFeeCollected(address indexed feederPool, address mAsset, uint256 amount);

    mapping(address => uint256) public lastBatchCollected;

    constructor(address _nexus) PausableModule(_nexus) {}

    /**
     * @notice Collects and validates the interest of n feeder pools.
     * @dev First calls to calculate the interest that has accrued, and then validates the potential inflation
     * with respect to the previous timestamp.
     * @param _fPools     Addresses of the feeder pools on which to accrue interest
     */
    function collectAndValidateInterest(address[] calldata _fPools) external whenNotPaused {
        uint256 currentTime = block.timestamp;

        uint256 len = _fPools.length;

        for (uint256 i = 0; i < len; i++) {
            address feeder = _fPools[i];

            uint256 previousBatch = lastBatchCollected[feeder];
            uint256 timeSincePreviousBatch = currentTime - previousBatch;
            require(timeSincePreviousBatch > 12 hours, "Cannot collect twice in 12 hours");
            lastBatchCollected[feeder] = currentTime;

            // Batch collect
            (uint256 interestCollected, uint256 totalSupply) = IFeederPool(feeder)
            .collectPlatformInterest();

            if (interestCollected > 0) {
                // Validate APY
                uint256 apy = YieldValidator.validateCollection(
                    totalSupply,
                    interestCollected,
                    timeSincePreviousBatch
                );

                emit InterestCollected(feeder, interestCollected, totalSupply, apy);
            } else {
                emit InterestCollected(feeder, interestCollected, totalSupply, 0);
            }
        }
    }

    /**
     * @dev Collects gov fees from fPools in the form of fPtoken, then converts to
     * mAsset and sends directly to the SavingsManager as unallocated interest.
     */
    function collectGovFees(address[] calldata _fPools) external onlyGovernor {
        uint256 len = _fPools.length;

        address savingsManager = _savingsManager();
        for (uint256 i = 0; i < len; i++) {
            address fPool = _fPools[i];
            // 1. Collect pending fees
            IFeederPool(fPool).collectPendingFees();
            uint256 fpTokenBal = IERC20(fPool).balanceOf(address(this));
            // 2. If fpTokenBal > 0, convert to mAsset and transfer to savingsManager
            if (fpTokenBal > 0) {
                address mAsset = IFeederPool(fPool).mAsset();
                uint256 outputAmt = IFeederPool(fPool).redeem(
                    mAsset,
                    fpTokenBal,
                    (fpTokenBal * 7) / 10,
                    savingsManager
                );
                emit GovFeeCollected(fPool, mAsset, outputAmt);
            }
        }
    }
}
