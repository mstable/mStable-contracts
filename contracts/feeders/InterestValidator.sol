// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.0;

import { IFeederPool } from "../interfaces/IFeederPool.sol";
import { PausableModule } from "../shared/PausableModule.sol";

contract InterestValidator is PausableModule {
    event InterestCollected(
        address indexed feederPool,
        uint256 interest,
        uint256 newTotalSupply,
        uint256 apy
    );

    // Utils to help keep interest under check
    uint256 private constant SECONDS_IN_YEAR = 365 days;
    // Theoretical cap on APY to avoid excess inflation
    uint256 private constant MAX_APY = 15e18;

    // Batches are for the platformInterest collection
    mapping(address => uint256) public lastBatchCollected;

    constructor(address _nexus) public PausableModule(_nexus) {}

    function collectAndValidateInterest(address[] calldata _feeders) external whenNotPaused {
        uint256 currentTime = block.timestamp;

        uint256 len = _feeders.length;

        for (uint256 i = 0; i < len; i++) {
            address feeder = _feeders[i];

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
            }

            emit InterestCollected(feeder, interestCollected, totalSupply, 0);
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
