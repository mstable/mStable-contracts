// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { IVotes } from "../interfaces/IVotes.sol";

/**
 * @title IEmissionsController
 * @dev Emissions Controller interface used for by RevenueBuyBack
 */
interface IEmissionsController {
    function donate(uint256[] memory _dialIds, uint256[] memory _amounts) external;

    function stakingContracts(uint256 dialId) external returns (address);
}
