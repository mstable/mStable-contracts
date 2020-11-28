pragma solidity 0.5.16;

import { ISavingsContract } from "../../interfaces/ISavingsContract.sol";
import { IUniswapV2Router02 } from "../../masset/liquidator/IUniswapV2Router02.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract SaveViaUniswap {

    address save;
    address mAsset = "";
    IUniswapV2Router02 uniswap;

    constructor(address _save, address _uniswapAddress) public {
        save = _save;
        uniswap = IUniswapV2Router02(_uniswapAddress);
    }
    // 1. Approve this contract to spend the sell token (e.g. ETH)
    // 2. calculate the _path and other data relevant to the purchase off-chain
    // 3. Calculate the "min buy amount" if any, off chain
    function buyAndSave(address token, uint amountIn, uint amountOutMin, address[] calldata path, uint deadline) external {
        IERC20(token).transferFrom(msg.sender, address(this), amountIn);
        IERC20(token).approve(address(uniswap), amountIn);
        uint[] amounts = uniswap.swapExactTokensForTokens(
        amountIn,
        amountOutMin, //how do I get this value exactly?
        getPath(token),
        address(this),
        deadline
        );
        ISavingsContract(save).deposit(amounts[1], msg.sender);
    }

    function getPath(address token) private view returns (address[] memory) {
        address[] memory path = new address[](3);
        path[0] = token;
        path[1] = uniswap.ETH();
        path[2] = mAsset;
        return path;
    }

    function getEstimatedAmountForToken(address token, uint tokenAmount) public view returns (uint[] memory) {
        return uniswap.getAmountsIn(tokenAmount, getPath(token));
    }
}