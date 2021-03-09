// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.0;

interface IConfigurableRightsPool {
    function joinswapExternAmountIn(
        address tokenIn,
        uint256 tokenAmountIn,
        uint256 minPoolAmountOut
    ) external returns (uint256 poolAmountOut);
}
