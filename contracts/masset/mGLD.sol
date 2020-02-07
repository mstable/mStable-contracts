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
        address[] memory _bassets,
        bytes32[] memory _bassetKeys,
        uint256[] memory _bassetWeights,
        uint256[] memory _measurementMultiples,
        address _feePool,
        address _forgeLib
    )
        Masset(
            "mStable Gold",
            "mGLD",
            _bassets,
            _bassetKeys,
            _bassetWeights,
            _measurementMultiples,
            _feePool,
            _forgeLib
        )
        public
    {
    }
}