pragma solidity 0.5.16;
pragma experimental ABIEncoderV2;

import { Masset } from "./Masset.sol";

/**
  * @title mUSD
  * @author Stability Labs Pty Ltd
  * @dev Base layer functionality for the Masset
  */
contract MUSD is Masset {

    /** @dev constructor */
    constructor (
        address _nexus,
        address _feePool,
        address _forgeValidator,
        address[] memory _bassets,
        uint256[] memory _weights,
        uint256[] memory _multiples,
        bool[] memory _hasTransferFees
    )
        Masset(
            "mStable USD",
            "mUSD",
            _nexus,
            _feePool,
            _forgeValidator,
            _bassets,
            _weights,
            _multiples,
            _hasTransferFees
        )
        public
    {
    }
}