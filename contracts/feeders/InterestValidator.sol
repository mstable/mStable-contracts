// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.2;

import { IFeederPool } from "../interfaces/IFeederPool.sol";
import { PausableModule } from "../shared/PausableModule.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

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

    // Utils to help keep interest under check
    uint256 private constant SECONDS_IN_YEAR = 365 days;
    // Theoretical cap on APY to avoid excess inflation
    uint256 private constant MAX_APY = 15e18;

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
            (uint256 interestCollected, uint256 totalSupply) =
                IFeederPool(feeder).collectPlatformInterest();

            if (interestCollected > 0) {
                // Validate APY
                uint256 apy =
                    _validateCollection(totalSupply, interestCollected, timeSincePreviousBatch);

                emit InterestCollected(feeder, interestCollected, totalSupply, apy);
            } else {
                emit InterestCollected(feeder, interestCollected, totalSupply, 0);
            }
        }
    }

    /**
     * @dev Collects gov fees from fPools in the form of fPtoken, then converts to
     * mAsset and sends directly to the SavingsManager, where it will be picked up and
     * converted to mBPT upon the next collection
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
                uint256 outputAmt =
                    IFeederPool(fPool).redeem(mAsset, fpTokenBal, (fpTokenBal * 7) / 10, savingsManager);
                emit GovFeeCollected(fPool, mAsset, outputAmt);
            }
        }
    }

    /**
     * @dev Validates that an interest collection does not exceed a maximum APY. If last collection
     * was under 30 mins ago, simply check it does not exceed 10bps
     * @param _newSupply               New total supply of the mAsset
     * @param _interest                Increase in total supply since last collection
     * @param _timeSinceLastCollection Seconds since last collection
     */
    function _validateCollection(
        uint256 _newSupply,
        uint256 _interest,
        uint256 _timeSinceLastCollection
    ) internal pure returns (uint256 extrapolatedAPY) {
        // Percentage increase in total supply
        // e.g. (1e20 * 1e18) / 1e24 = 1e14 (or a 0.01% increase)
        // e.g. (5e18 * 1e18) / 1.2e24 = 4.1667e12
        // e.g. (1e19 * 1e18) / 1e21 = 1e16
        uint256 oldSupply = _newSupply - _interest;
        uint256 percentageIncrease = (_interest * 1e18) / oldSupply;

        //      If over 30 mins, extrapolate APY
        // e.g. day: (86400 * 1e18) / 3.154e7 = 2.74..e15
        // e.g. 30 mins: (1800 * 1e18) / 3.154e7 = 5.7..e13
        // e.g. epoch: (1593596907 * 1e18) / 3.154e7 = 50.4..e18
        uint256 yearsSinceLastCollection = (_timeSinceLastCollection * 1e18) / SECONDS_IN_YEAR;

        // e.g. 0.01% (1e14 * 1e18) / 2.74..e15 = 3.65e16 or 3.65% apr
        // e.g. (4.1667e12 * 1e18) / 5.7..e13 = 7.1e16 or 7.1% apr
        // e.g. (1e16 * 1e18) / 50e18 = 2e14
        extrapolatedAPY = (percentageIncrease * 1e18) / yearsSinceLastCollection;

        require(extrapolatedAPY < MAX_APY, "Interest protected from inflating past maxAPY");
    }
}
