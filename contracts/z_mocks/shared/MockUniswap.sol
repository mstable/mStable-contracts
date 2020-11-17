pragma solidity 0.5.16;

import { IUniswapV2Router02 } from "../../masset/liquidator/IUniswapV2Router02.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";


// Simulates the selling of COMP
// Assumptions:
//   COMP = $106
//   out token has 18 decimals
contract MockUniswap is IUniswapV2Router02 {


    // takes input from sender, produces output
    function swapExactTokensForTokens(
        uint amountIn,
        uint /*amountOutMin*/,
        address[] calldata path,
        address /*to*/,
        uint /*deadline*/
    )
        external
        returns (uint[] memory amounts)
    {
        uint256 len = path.length;

        amounts = new uint[](len);
        amounts[0] = amountIn;
        IERC20(path[0]).transferFrom(msg.sender, address(this), amountIn);

        uint256 output = amountIn * 106;
        amounts[len-1] = output;
        IERC20(path[len-1]).transfer(msg.sender, output);
    }

    function getAmountsIn(
        uint amountOut,
        address[] calldata path
    )
        external
        view
        returns (uint[] memory amounts)
    {
        uint256 amountIn = amountOut / 106;
        uint256 len = path.length;
        amounts = new uint[](len);
        amounts[0] = amountIn;
        amounts[len-1] = amountOut;
    }
}