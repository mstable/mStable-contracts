// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.0;

/** @dev Stores high level basket info */
struct Basket {
    Basset[] bassets;
    uint8 maxBassets;
    bool undergoingRecol;
    bool failed;
    uint256 collateralisationRatio;

}

/** @dev Stores bAsset info. The struct takes 5 storage slots per Basset */
struct Basset {
    address addr;
    BassetStatus status;
    bool isTransferFeeCharged;
    uint256 ratio;
    uint256 maxWeight;
    uint256 vaultBalance;

}

/** @dev Status of the Basset - has it broken its peg? */
enum BassetStatus {
    Default,
    Normal,
    BrokenBelowPeg,
    BrokenAbovePeg,
    Blacklisted,
    Liquidating,
    Liquidated,
    Failed
}

/** @dev Internal details on Basset */
struct BassetDetails {
    Basset bAsset;
    address integrator;
    uint8 index;
}
