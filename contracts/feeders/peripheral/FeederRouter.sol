// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.0;
pragma abicoder v2;

// Internal
import { IMasset } from "../../interfaces/IMasset.sol";
import { FeederPool } from "../FeederPool.sol";

// Libs
import { IERC20 } from "@openzeppelin/contracts-sol8/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts-sol8/contracts/token/ERC20/SafeERC20.sol";

// Routes:
//  1) multiMint and multiRedeem from fPool (fp) to mAsset pools (mp)
//     e.g.
//      - mintMulti (fAsset / mpAsset)
//      - redeemExact (fAsset / mpAsset)
//  2) swaps between all fPools (fp)
//     e.g.
//      - fp a -> fp b
contract FeederRouter {

}
