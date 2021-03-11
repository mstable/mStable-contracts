// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.0;
import { IConfigurableRightsPool } from "../../buy-and-make/IConfigurableRightsPool.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";


contract MockBPool is ERC20, IConfigurableRightsPool {

    // output = input * ratio / 1e18
    uint256 inputToOutputRatio;
    mapping(address => bool) private _tokenIsValid;

    constructor(uint256 _inputToOutputRatio, address[] memory _tokens, string memory _name, string memory _symbol) ERC20(_name, _symbol) {
        inputToOutputRatio = _inputToOutputRatio;
        uint len = _tokens.length;
        for(uint i = 0; i < len; i++){
            _tokenIsValid[_tokens[i]] = true;
        }
    }

    function joinswapExternAmountIn(
        address tokenIn,
        uint tokenAmountIn,
        uint minPoolAmountOut
    )
        external
        override
        returns (uint poolAmountOut)
    {
        require(_tokenIsValid[tokenIn], "Invalid token");
        IERC20(tokenIn).transferFrom(msg.sender, address(this), tokenAmountIn);
        poolAmountOut = tokenAmountIn * inputToOutputRatio / 1e18;
        require(poolAmountOut > minPoolAmountOut, "Invalid output amount");
        _mint(msg.sender, poolAmountOut);
    }

}