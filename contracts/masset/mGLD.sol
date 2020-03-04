pragma solidity 0.5.16;
pragma experimental ABIEncoderV2;

import { Masset } from "./Masset.sol";

/**
  * @title mGLD
  * @author Stability Labs Pty Ltd
  * @dev Base layer functionality for the Masset
  */
contract MGLD is Masset {

    /** @dev constructor */
    constructor (
        address _nexus,
        address[] memory _bassets,
        uint256[] memory _bassetWeights,
        uint256[] memory _measurementMultiples,
        bool[] memory _hasTransferFees,
        address _feePool,
        address _forgeValidator
    )
        Masset(
            "mStable Gold",
            "mGLD",
            _nexus,
            _bassets,
            _bassetWeights,
            _measurementMultiples,
            _hasTransferFees,
            _feePool,
            _forgeValidator
        )
        public
    {
    }
}