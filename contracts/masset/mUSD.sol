pragma solidity ^0.5.16;
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
        address[] memory _bassets,
        uint256[] memory _bassetWeights,
        bool[] memory _hasTransferFees,
        address _feePool,
        address _forgeValidator
    )
        Masset(
            "mStable USD",
            "mUSD",
            _nexus,
            _bassets,
            _bassetWeights,
            new uint256[](0),
            _hasTransferFees,
            _feePool,
            _forgeValidator
        )
        public
    {
    }
}