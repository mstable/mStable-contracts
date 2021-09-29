// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { IUniswapV2Router02 } from "../../peripheral/Uniswap/IUniswapV2Router02.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// Simulates the selling of COMP
// Assumptions:
//   COMP = $106
//   out token has 18 decimals
contract MockUniswap is IUniswapV2Router02 {
    // how many tokens to give out for 1 in
    uint256 ratio = 106;

    function setRatio(uint256 _outRatio) external {
        ratio = _outRatio;
    }

    // takes input from sender, produces output
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address, /*to*/
        uint256 /*deadline*/
    ) external override returns (uint256[] memory amounts) {
        uint256 len = path.length;

        amounts = new uint256[](len);
        amounts[0] = amountIn;
        IERC20(path[0]).transferFrom(msg.sender, address(this), amountIn);

        uint256 output = amountIn * ratio;
        require(output >= amountOutMin, "UNI: Output amount not enough");

        amounts[len - 1] = output;
        IERC20(path[len - 1]).transfer(msg.sender, output);
    }

    function getAmountsIn(uint256 amountOut, address[] calldata path)
        external
        view
        override
        returns (uint256[] memory amounts)
    {
        uint256 amountIn = amountOut / ratio;
        uint256 len = path.length;
        amounts = new uint256[](len);
        amounts[0] = amountIn;
        amounts[len - 1] = amountOut;
    }

    function swapExactETHForTokens(
        uint256, /*amountOutMin*/
        address[] calldata, /*path*/
        address, /*to*/
        uint256 /*deadline*/
    ) external payable override returns (uint256[] memory amounts) {
        return new uint256[](0);
    }

    function getAmountsOut(
        uint256, /*amountIn*/
        address[] calldata /*path*/
    ) external pure override returns (uint256[] memory amounts) {
        return new uint256[](0);
    }
}
