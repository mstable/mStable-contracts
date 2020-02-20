pragma solidity ^0.5.12;
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
        bytes32[] memory _bassetKeys,
        uint256[] memory _bassetWeights,
        bool[] memory _isTransferFees,
        address _feePool,
        address _forgeValidator
    )
        Masset(
            "mStable USD",
            "mUSD",
            _nexus,
            _bassets,
            _bassetKeys,
            _bassetWeights,
            new uint256[](0),
            _isTransferFees,
            _feePool,
            _forgeValidator
        )
        public
    {
    }
}