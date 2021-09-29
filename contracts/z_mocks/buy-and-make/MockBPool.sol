// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;
import { IBPool } from "../../buy-and-make/IBPool.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockBPool is ERC20, IBPool {
    // output = input * ratio / 1e18
    uint256 inputToOutputRatio;
    mapping(address => bool) private _tokenIsValid;

    constructor(
        uint256 _inputToOutputRatio,
        address[] memory _tokens,
        string memory _name,
        string memory _symbol
    ) ERC20(_name, _symbol) {
        inputToOutputRatio = _inputToOutputRatio;
        uint256 len = _tokens.length;
        for (uint256 i = 0; i < len; i++) {
            _tokenIsValid[_tokens[i]] = true;
        }
    }

    function addOutputToken(address _token, uint256 _amt) external {
        IERC20(_token).transferFrom(msg.sender, address(this), _amt);
    }

    function joinswapExternAmountIn(
        address tokenIn,
        uint256 tokenAmountIn,
        uint256 minPoolAmountOut
    ) external override returns (uint256 poolAmountOut) {
        require(_tokenIsValid[tokenIn], "Invalid token");
        IERC20(tokenIn).transferFrom(msg.sender, address(this), tokenAmountIn);
        poolAmountOut = (tokenAmountIn * inputToOutputRatio) / 1e18;
        require(poolAmountOut > minPoolAmountOut, "Invalid output amount");
        _mint(msg.sender, poolAmountOut);
    }

    function swapExactAmountIn(
        address tokenIn,
        uint256 tokenAmountIn,
        address tokenOut,
        uint256 minAmountOut,
        uint256 /*maxPrice*/
    )
        external
        override
        returns (
            uint256 tokenAmountOut,
            uint256 /*spotPriceAfter*/
        )
    {
        require(_tokenIsValid[tokenIn], "Invalid token");
        require(_tokenIsValid[tokenOut], "Invalid token");
        IERC20(tokenIn).transferFrom(msg.sender, address(this), tokenAmountIn);

        tokenAmountOut = (tokenAmountIn * inputToOutputRatio) / 1e18;
        require(tokenAmountOut > minAmountOut, "Invalid output amount");
        IERC20(tokenOut).transfer(msg.sender, tokenAmountOut);
        return (tokenAmountOut, 0);
    }
}
