pragma solidity 0.5.16;

import { ISavingsContract } from "../../interfaces/ISavingsContract.sol";
import { IUniswapV2Router02 } from "../../masset/liquidator/IUniswapV2Router02.sol";


interface ISaveWithAnything {

}


contract SaveViaUniswap {

    address save;
    address platform;

    constructor(address _save, address _curve) public {
      save = _save;
      platform = _curve;
    }

    // 1. Approve this contract to spend the sell token (e.g. ETH)
    // 2. calculate the _path and other data relevant to the purchase off-chain
    // 3. Calculate the "min buy amount" if any, off chain
    function buyAndSave(address _mAsset, address[] calldata _path, uint256 _minBuyAmount) external {
      // 1. transfer the sell token to here
      // 2. approve the platform to spend the selltoken
      // 3. buy asset from the platform
      // 3.1. optional > call mint
      // 4. deposit into save on behalf of the sender
      // ISavingsContract(save).deposit(buyAmount, msg.sender);
      // IUniswapV2Router02(platform).swapExactTokensForTokens(.....)
    }

    function mintAndSave(address _mAsset, address _bAsset) external {
      // 1. transfer the sell token to here
      // 2. approve the platform to spend the selltoken
      // 3. call the mint
      // 4. deposit into save on behalf of the sender
      // ISavingsContract(save).deposit(buyAmount, msg.sender);
    }
}