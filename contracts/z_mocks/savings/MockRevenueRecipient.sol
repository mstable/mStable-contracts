pragma solidity 0.5.16;

import { IRevenueRecipient } from "../../interfaces/ISavingsManager.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockRevenueRecipient is IRevenueRecipient {


    function notifyRedistributionAmount(address _mAsset, uint256 _amount) external {
        IERC20(_mAsset).transferFrom(msg.sender, address(this), _amount);
    }
}