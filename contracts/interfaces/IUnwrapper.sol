// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

// TODO: -
// - Passes through router & routeType. I think we can cut this down to one somehow with storage, or maybe we leave it
// - Unwrapper set as immutable and set in constructor, needs proxy pattern for unwrapper

/**
 * @title IUnwrapper
 */
interface IUnwrapper {
    /// @dev Estimate output
    function getUnwrapOutput(
        uint8 _routeIndex,
        address _router,
        address _input,
        address _output,
        uint256 _amount
    ) external view returns (uint256 output);

    /// @dev Unwrap and send
    function unwrapAndSend(
        uint8 _routeIndex,
        address _router,
        address _input,
        address _output,
        uint256 _amount,
        uint256 _minAmountOut,
        address _beneficiary
    ) external returns (uint256 outputQuantity);
}
