pragma solidity 0.5.16;

import { IUniswapV2Router02 } from "../../masset/liquidator/IUniswapV2Router02.sol";
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
        uint amountIn,
        uint amountOutMin,
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

        uint256 output = amountIn * ratio;
        require(output >= amountOutMin, "UNI: Output amount not enough");

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
        uint256 amountIn = amountOut / ratio;
        uint256 len = path.length;
        amounts = new uint[](len);
        amounts[0] = amountIn;
        amounts[len-1] = amountOut;
    }

    function swapExactETHForTokens(
        uint amountOutMin,
        address[] calldata path,
        address to, uint deadline
    ) external payable returns (uint[] memory amounts) {
        return new uint[](0);
    }
    function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts) {
        return new uint[](0);
    }
}