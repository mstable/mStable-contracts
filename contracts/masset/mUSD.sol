pragma solidity 0.5.16;
pragma experimental ABIEncoderV2;

import { Masset } from "./Masset.sol";

/**
  * @title  mUSD
  * @author Stability Labs Pty. Lte.
  * @dev    mUSD is an mAsset backed 1:1 by a number of USD stablecoins
  */
contract MUSD is Masset {

    constructor (
        address _nexus,
        address _feePool,
        address _forgeValidator,
        address _basketManager
    )
        Masset(
            "mStable USD",
            "mUSD",
            _nexus,
            _feePool,
            _forgeValidator,
            _basketManager
        )
        public
    {
    }
}