pragma solidity ^0.5.12;
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
        bool[] memory _isTransferFees,
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
            _isTransferFees,
            _feePool,
            _forgeValidator
        )
        public
    {
        // basket.hasFeesEnabled = true;
    }

    // TODO - Override or separate out 'Minting' functions here -
    // Minting volume for mGLD relies on subtracting the transfer/demourrage fees first
}