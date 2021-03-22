// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.0;

/**
 * @title token interface to Tether tokens. eg USDT
 * @notice Tether is not compliant with ERC20 as it does not return a bool.
 */
interface ITether {
    function balanceOf(address) external returns (uint256);
    function approve(address spender, uint256 amount) external;
    function transfer(address _to, uint256 _value) external;
}
