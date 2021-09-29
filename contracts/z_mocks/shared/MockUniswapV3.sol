// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IUniswapV3SwapRouter } from "../../peripheral/Uniswap/IUniswapV3SwapRouter.sol";
import { IUniswapV3Quoter } from "../../peripheral/Uniswap/IUniswapV3Quoter.sol";
import { Path } from "../../peripheral/Uniswap/Path.sol";

// Simulates the selling of COMP
// Assumptions:
//   COMP = $430
//   out token has 18 decimals
contract MockUniswapV3 is IUniswapV3SwapRouter, IUniswapV3Quoter {
    using Path for bytes;

    // 0.3% = 3000
    // 1% = 10000
    // 100% = 1000000
    uint256 FEE_SCALE = 1000000;
    uint256 private constant RATE_SCALE = 1e18;

    // mapping of exchange rates of tokenIn => tokenOut => exchange rate
    // The excahnge rate is the amount of output tokens for one input token
    // The rate is scaled to 18 decimal places
    // eg COMP => USDC => 430 * 1e6 / 1e18 * 1e18 = 430 * 1e6
    mapping(address => mapping(address => uint256)) public rates;

    function setRate(
        address _tokenIn,
        address _tokenOut,
        uint256 _rate
    ) external {
        rates[_tokenIn][_tokenOut] = _rate;
    }

    /////// IUniswapV3SwapRouter functions

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        override
        returns (uint256 amountOut)
    {
        IERC20(params.tokenIn).transferFrom(msg.sender, address(this), params.amountIn);

        uint256 rate = rates[params.tokenIn][params.tokenOut];
        amountOut = (params.amountIn * rate * (FEE_SCALE - params.fee)) / (FEE_SCALE * RATE_SCALE);
        require(amountOut >= params.amountOutMinimum, "Too little received");

        IERC20(params.tokenOut).transfer(msg.sender, amountOut);
    }

    function exactInput(ExactInputParams calldata params)
        external
        payable
        override
        returns (uint256 amountOut)
    {
        (address tokenIn, , uint24 fee) = params.path.decodeFirstPool();
        (, address tokenOut, ) = params.path.skipToken().decodeFirstPool();

        IERC20(tokenIn).transferFrom(msg.sender, address(this), params.amountIn);

        uint256 rate = rates[tokenIn][tokenOut];
        amountOut = (params.amountIn * rate * (FEE_SCALE - fee)) / (FEE_SCALE * RATE_SCALE);
        require(amountOut >= params.amountOutMinimum, "Too little received");

        IERC20(tokenOut).transfer(msg.sender, amountOut);
    }

    function exactOutputSingle(ExactOutputSingleParams calldata params)
        external
        payable
        override
        returns (uint256 amountIn)
    {
        uint256 rate = rates[params.tokenIn][params.tokenOut];
        amountIn = (params.amountOut * RATE_SCALE * FEE_SCALE) / (rate * (FEE_SCALE - params.fee));

        IERC20(params.tokenIn).transferFrom(msg.sender, address(this), amountIn);

        require(amountIn <= params.amountInMaximum, "Too much requested");

        IERC20(params.tokenOut).transfer(msg.sender, params.amountOut);
    }

    function exactOutput(ExactOutputParams calldata params)
        external
        payable
        override
        returns (uint256 amountIn)
    {
        (address tokenIn, , uint24 fee) = params.path.decodeFirstPool();
        (, address tokenOut, ) = params.path.skipToken().decodeFirstPool();

        uint256 rate = rates[tokenIn][tokenOut];
        amountIn = (params.amountOut * RATE_SCALE * FEE_SCALE) / (rate * (FEE_SCALE - fee));

        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);

        require(amountIn <= params.amountInMaximum, "Too much requested");

        IERC20(tokenOut).transfer(msg.sender, params.amountOut);
    }

    /////// IUniswapV3Quoter functions

    function quoteExactInput(bytes memory path, uint256 amountIn)
        external
        view
        override
        returns (uint256 amountOut)
    {
        (address tokenIn, , uint24 fee) = path.decodeFirstPool();
        (, address tokenOut, ) = path.skipToken().decodeFirstPool();

        uint256 rate = rates[tokenIn][tokenOut];
        amountOut = ((amountIn * rate * (FEE_SCALE - fee)) / (FEE_SCALE * RATE_SCALE));
    }

    function quoteExactInputSingle(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn,
        uint160 /*sqrtPriceLimitX96*/
    ) external view override returns (uint256 amountOut) {
        uint256 rate = rates[tokenIn][tokenOut];
        amountOut = amountIn * rate * ((FEE_SCALE - fee) / FEE_SCALE);
    }

    function quoteExactOutput(bytes memory path, uint256 amountOut)
        external
        view
        override
        returns (uint256 amountIn)
    {
        (address tokenOut, , uint24 fee) = path.decodeFirstPool();
        (, address tokenIn, ) = path.skipToken().decodeFirstPool();

        uint256 rate = rates[tokenIn][tokenOut];
        amountIn = (amountOut * RATE_SCALE * FEE_SCALE) / (rate * (FEE_SCALE - fee));
    }

    function quoteExactOutputSingle(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountOut,
        uint160 /*sqrtPriceLimitX96*/
    ) external view override returns (uint256 amountIn) {
        uint256 rate = rates[tokenIn][tokenOut];
        amountIn = (amountOut * RATE_SCALE * FEE_SCALE) / (rate * (FEE_SCALE - fee));
    }
}
