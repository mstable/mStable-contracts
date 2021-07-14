// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;
pragma abicoder v2;

/**
 * @title   FeederRouter
 * @author  mStable
 * @notice  Routes trades efficiently between n Feeder Pools
 *          Routes:
 *           1) multiMint and multiRedeem from fPool (fp) to mAsset pools (mp)
 *              e.g.
 *               - mintMulti (fAsset / mpAsset)
 *               - redeemExact (fAsset / mpAsset)
 *           2) swaps between all fPools (fp)
 *              e.g.
 *               - fp a -> fp b
 * @dev     ToDo
 */
contract FeederRouter {

}
